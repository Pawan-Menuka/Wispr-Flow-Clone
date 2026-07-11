import type { PrismaClient } from '@prisma/client';

/**
 * Stripe webhook processing (§20): idempotent via the StripeEvent ledger,
 * entitlements derived purely from subscription state. Kept SDK-free so the
 * logic is testable with fabricated event objects.
 */

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** active/trialing = paid; everything else falls back to FREE (§20 dunning). */
export function planForSubscriptionStatus(status: string): 'PRO' | 'FREE' {
  return status === 'active' || status === 'trialing' ? 'PRO' : 'FREE';
}

/** Returns false when the event was already processed (idempotency replay). */
export async function processStripeEvent(
  prisma: PrismaClient,
  event: StripeEventLike,
): Promise<boolean> {
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch {
    return false; // unique violation → replay → ack without side effects
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      // Link the Stripe customer to our user (set in checkout metadata).
      const session = event.data.object;
      const userId = (session['metadata'] as Record<string, string> | null)?.['userId'];
      const customerId = session['customer'] as string | null;
      if (userId && customerId) {
        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId },
        });
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const customerId = sub['customer'] as string;
      const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
      if (!user) break; // checkout.completed not seen yet — subsequent event heals

      const status =
        event.type === 'customer.subscription.deleted' ? 'canceled' : (sub['status'] as string);
      const priceId =
        ((sub['items'] as { data?: { price?: { id?: string } }[] } | undefined)?.data?.[0]?.price
          ?.id as string | undefined) ?? 'unknown';
      const periodEnd = new Date(((sub['current_period_end'] as number) ?? 0) * 1000);

      await prisma.subscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          stripeSubscriptionId: sub['id'] as string,
          status,
          priceId,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: Boolean(sub['cancel_at_period_end']),
        },
        update: {
          status,
          priceId,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: Boolean(sub['cancel_at_period_end']),
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: {
          plan: planForSubscriptionStatus(status),
          planExpiresAt: periodEnd,
        },
      });
      await prisma.auditLog.create({
        data: { userId: user.id, action: 'plan.change', meta: { status, priceId } },
      });
      break;
    }
    default:
      break; // unhandled types are acknowledged silently
  }
  return true;
}
