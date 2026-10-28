/**
 * Real Stripe test-mode objects for webhook round trips (Codex-2hxff.25).
 *
 * stripe-webhook.ts signs events; these helpers make the objects the events
 * describe exist in Stripe, so the handlers' own Stripe calls find them: the
 * PaymentIntent's `latest_charge`, the charge's refunds, the payee's
 * transfers. An invented `pi_test_*` id 404s there, the charge id comes back
 * null and the payouts ledger is skipped: a suite that invents ids passes
 * with no payout rows at all.
 *
 * Every object is tagged with the workers' environment. Production runs on
 * the same test-mode sandbox and receives every one of its events; it ignores
 * an object tagged with another environment (docs/payments/operations.md,
 * "The shared sandbox").
 */

import { stripeEnvMetadata } from '@codex/constants';
import { createStripeClient } from '@codex/purchase';

export type StripeClient = ReturnType<typeof createStripeClient>;

type CheckoutSession = Awaited<
  ReturnType<StripeClient['checkout']['sessions']['retrieve']>
>;
type Refund = Awaited<ReturnType<StripeClient['refunds']['create']>>;

/**
 * The workers' `ENVIRONMENT` under `wrangler dev --env test` (each worker's
 * wrangler.jsonc `env.test.vars`), so the tag they write and the one these
 * helpers write are the same.
 */
export const E2E_STRIPE_ENVIRONMENT = 'test';

/**
 * A Stripe client on `STRIPE_SECRET_KEY`, refusing anything but a test-mode
 * key: these helpers create real Stripe objects. The key is never printed.
 */
export function testModeStripe(): StripeClient {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY must be a test-mode key (sk_test_...): this suite creates real Stripe objects'
    );
  }
  return createStripeClient(key);
}

export interface PaidCheckoutSession {
  /** The session as Stripe sends it on `checkout.session.completed`. */
  session: CheckoutSession;
  paymentIntentId: string;
  /** `latest_charge`: the charge every payout slice of the sale is keyed on. */
  chargeId: string;
}

/**
 * Pay a Checkout Session the app created (`POST /checkout/create`), as its
 * buyer would on Stripe's page: a PaymentIntent for the session's amount and
 * customer, confirmed with Stripe's test Visa and tagged as the app tags it
 * (`payment_intent_data.metadata`, so its charge carries the tag too).
 *
 * Stripe's hosted page cannot be driven from here, so the session itself is
 * never paid in Stripe. What is returned is the session the app made, as
 * retrieved, with the fields a completed payment fills in: the handler reads
 * those and retrieves the PaymentIntent, which is real.
 */
export async function payCheckoutSession(
  stripe: StripeClient,
  sessionId: string
): Promise<PaidCheckoutSession> {
  const open = await stripe.checkout.sessions.retrieve(sessionId);
  if (open.amount_total === null || open.currency === null) {
    throw new Error(`Checkout Session ${sessionId} has no amount or currency`);
  }

  const intent = await stripe.paymentIntents.create({
    amount: open.amount_total,
    currency: open.currency,
    ...(typeof open.customer === 'string' ? { customer: open.customer } : {}),
    payment_method: 'pm_card_visa',
    payment_method_types: ['card'],
    confirm: true,
    metadata: stripeEnvMetadata(E2E_STRIPE_ENVIRONMENT),
  });
  const chargeId =
    typeof intent.latest_charge === 'string'
      ? intent.latest_charge
      : intent.latest_charge?.id;
  if (intent.status !== 'succeeded' || !chargeId) {
    throw new Error(
      `PaymentIntent ${intent.id} did not succeed with the test card (status ${intent.status})`
    );
  }

  return {
    session: {
      ...open,
      status: 'complete',
      payment_status: 'paid',
      payment_intent: intent.id,
    },
    paymentIntentId: intent.id,
    chargeId,
  };
}

/**
 * Refund a charge in full (no amount) or in part, as support's refund does
 * (`issueRefund`, packages/payments/src/refund.ts): tagged, so production
 * ignores the refund's own events. A card refund in test mode succeeds at
 * once; any other status fails the setup, because a pending refund is clawed
 * back only on `refund.updated`.
 */
export async function refundCharge(
  stripe: StripeClient,
  params: { chargeId: string; amountCents?: number }
): Promise<Refund> {
  const refund = await stripe.refunds.create({
    charge: params.chargeId,
    ...(params.amountCents === undefined ? {} : { amount: params.amountCents }),
    reason: 'requested_by_customer',
    metadata: stripeEnvMetadata(E2E_STRIPE_ENVIRONMENT),
  });
  if (refund.status !== 'succeeded') {
    throw new Error(
      `Refund ${refund.id} of ${params.chargeId} did not succeed (status ${refund.status})`
    );
  }
  return refund;
}

/**
 * A Connect account as the app creates one (`ConnectAccountService`,
 * packages/subscription), before its owner has been through onboarding, so
 * Stripe does not let it take charges. A refund that cancels a payee's unpaid
 * slice asks Stripe whether a transfer went out anyway (`lateTransferOf`):
 * on an invented `acct_*` id Stripe answers `resource_missing`, which the
 * ledger logs as an error for support and reads as no transfer. A real
 * account gets the answer production would. Delete it with
 * `deleteConnectAccount`.
 */
export async function createUnverifiedConnectAccount(
  stripe: StripeClient,
  userId: string
): Promise<string> {
  const account = await stripe.accounts.create({
    controller: {
      stripe_dashboard: { type: 'express' },
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'stripe',
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    country: 'GB',
    metadata: {
      codex_user_id: userId,
      ...stripeEnvMetadata(E2E_STRIPE_ENVIRONMENT),
    },
  });
  if (account.charges_enabled) {
    throw new Error(
      `Connect account ${account.id} can take charges before onboarding`
    );
  }
  return account.id;
}

export async function deleteConnectAccount(
  stripe: StripeClient,
  accountId: string
): Promise<void> {
  const deleted = await stripe.accounts.del(accountId);
  if (!deleted.deleted) {
    throw new Error(`Connect account ${accountId} was not deleted`);
  }
}
