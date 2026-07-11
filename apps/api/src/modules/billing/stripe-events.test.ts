import { describe, expect, it, beforeAll } from 'vitest';
import { planForSubscriptionStatus, processStripeEvent } from './stripe-events.js';
import type { PrismaClient } from '@prisma/client';

describe('planForSubscriptionStatus', () => {
  it('active/trialing are PRO, everything else FREE', () => {
    expect(planForSubscriptionStatus('active')).toBe('PRO');
    expect(planForSubscriptionStatus('trialing')).toBe('PRO');
    expect(planForSubscriptionStatus('past_due')).toBe('FREE');
    expect(planForSubscriptionStatus('canceled')).toBe('FREE');
    expect(planForSubscriptionStatus('unpaid')).toBe('FREE');
  });
});

const dbUrl = process.env['DATABASE_URL'];

describe.skipIf(!dbUrl)('processStripeEvent (integration)', () => {
  let prisma: PrismaClient;
  let userId = '';
  const customerId = `cus_test_${Date.now()}`;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    const user = await prisma.user.create({
      data: { email: `billing-${Date.now()}@flow.test` },
    });
    userId = user.id;
  });

  it('checkout.session.completed links the customer; replay is idempotent', async () => {
    const event = {
      id: `evt_checkout_${Date.now()}`,
      type: 'checkout.session.completed',
      data: { object: { customer: customerId, metadata: { userId } } },
    };
    expect(await processStripeEvent(prisma, event)).toBe(true);
    expect(await processStripeEvent(prisma, event)).toBe(false); // ledger replay

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.stripeCustomerId).toBe(customerId);
  });

  it('subscription lifecycle: active → PRO, deleted → FREE', async () => {
    const subObject = {
      id: `sub_test_${Date.now()}`,
      customer: customerId,
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
      items: { data: [{ price: { id: 'price_pro_test' } }] },
    };

    await processStripeEvent(prisma, {
      id: `evt_sub_up_${Date.now()}`,
      type: 'customer.subscription.updated',
      data: { object: subObject },
    });
    let user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.plan).toBe('PRO');

    await processStripeEvent(prisma, {
      id: `evt_sub_del_${Date.now()}`,
      type: 'customer.subscription.deleted',
      data: { object: subObject },
    });
    user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.plan).toBe('FREE');
  });
});
