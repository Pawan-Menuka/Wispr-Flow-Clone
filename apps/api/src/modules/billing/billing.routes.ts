import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import type { AuthService } from '../auth/auth.service.js';
import { processStripeEvent } from './stripe-events.js';

/**
 * Billing surface (§20). Entirely env-gated: without STRIPE_SECRET_KEY the
 * routes exist but answer 503 BILLING_DISABLED, so the app degrades to
 * free-tier behavior instead of breaking.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO,
 *      BILLING_RETURN_URL (browser landing after checkout/portal).
 */
export function registerBillingRoutes(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  auth: AuthService,
): void {
  const secretKey = process.env['STRIPE_SECRET_KEY'];
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  const proPriceId = process.env['STRIPE_PRICE_PRO'];
  const returnUrl = process.env['BILLING_RETURN_URL'] ?? 'https://flow.app/billing';
  const stripe = secretKey ? new Stripe(secretKey) : null;

  const requireClaims = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const claims = token ? await auth.tokens.verifyAccessToken(token) : null;
    if (!claims) {
      await reply
        .status(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Sign in required' } });
      return null;
    }
    return claims;
  };

  const disabled = (reply: FastifyReply) =>
    reply
      .status(503)
      .send({ error: { code: 'BILLING_DISABLED', message: 'Billing is not configured' } });

  fastify.post('/v1/billing/checkout', async (request, reply) => {
    const claims = await requireClaims(request, reply);
    if (!claims) return;
    if (!stripe || !proPriceId) return disabled(reply);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: proPriceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email }),
      metadata: { userId: user.id },
      success_url: `${returnUrl}?state=success`,
      cancel_url: `${returnUrl}?state=cancelled`,
    });
    return reply.send({ url: session.url });
  });

  fastify.post('/v1/billing/portal', async (request, reply) => {
    const claims = await requireClaims(request, reply);
    if (!claims) return;
    if (!stripe) return disabled(reply);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: claims.sub } });
    if (!user.stripeCustomerId) {
      return reply
        .status(400)
        .send({ error: { code: 'NO_SUBSCRIPTION', message: 'No billing account yet' } });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });
    return reply.send({ url: session.url });
  });

  // Webhook needs the RAW body for signature verification — scoped parser.
  void fastify.register(async (scope) => {
    // Replace the JSON parser INSIDE this scope only (remove first, or
    // Fastify throws FST_ERR_CTP_ALREADY_PRESENT at boot).
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );
    scope.post('/v1/billing/webhook', async (request, reply) => {
      if (!stripe || !webhookSecret) return disabled(reply);
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string') {
        return reply.status(400).send({ error: { code: 'BAD_SIGNATURE', message: 'Missing signature' } });
      }
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(request.body as Buffer, signature, webhookSecret);
      } catch {
        return reply.status(400).send({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } });
      }
      // Ack fast; §21 moves processing to a queue — inline is fine pre-scale.
      await processStripeEvent(prisma, event as unknown as Parameters<typeof processStripeEvent>[1]);
      return reply.send({ received: true });
    });
  });
}
