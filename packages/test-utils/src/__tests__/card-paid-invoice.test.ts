/**
 * The invoice factory's default payment, and the mock PaymentIntent's charge
 * (Codex-2hxff.53).
 *
 * A card-paid invoice names only its PaymentIntent; its charge is the
 * PaymentIntent's `latest_charge`. A default that named the charge inline as
 * well hid Codex-2hxff.50 (a resolver that read only `charge` passed every
 * suite), and a mock that minted a new charge per retrieve would key a
 * redelivered invoice's payouts on a different charge.
 */

import { describe, expect, it } from 'vitest';
import { createMockStripe } from '../stripe-mock';
import { createMockStripeInvoice, paidByCard } from '../subscription-factories';

type Payment = { type?: string; payment_intent?: string; charge?: string };

const firstPayment = (invoice: Record<string, unknown>) =>
  (invoice.payments as { data: Array<{ payment: Payment }> }).data[0]?.payment;

describe('a card-paid invoice (Codex-2hxff.53)', () => {
  it('the default names only its PaymentIntent, as Stripe sends a card payment', () => {
    const payment = firstPayment(createMockStripeInvoice());

    expect(payment?.type).toBe('payment_intent');
    expect(payment?.payment_intent).toMatch(/^pi_/);
    expect(payment).not.toHaveProperty('charge');
  });

  it("the mock PaymentIntent's charge is the same on every retrieve", async () => {
    const stripe = createMockStripe();

    const first = await stripe.paymentIntents.retrieve('pi_a');
    const again = await stripe.paymentIntents.retrieve('pi_a');

    expect(first.latest_charge).toBe('ch_a');
    expect(again.latest_charge).toBe(first.latest_charge);
  });

  it('paidByCard(ch_x) names pi_x, whose charge is ch_x', async () => {
    const payment = firstPayment({ payments: paidByCard('ch_x') });
    expect(payment).toEqual({ type: 'payment_intent', payment_intent: 'pi_x' });

    const intent = await createMockStripe().paymentIntents.retrieve(
      payment?.payment_intent ?? ''
    );
    expect(intent.latest_charge).toBe('ch_x');
  });
});
