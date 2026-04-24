/**
 * resolveOrCreateCustomer — Q4.2 (Codex-49gev)
 *
 * Lazily populates users.stripe_customer_id on first checkout. Guarantees one
 * Stripe Customer per Codex user across every org, supporting the Q4 epic
 * (Codex-pkqxd) shift from customer-per-user-per-org to customer-per-user.
 *
 * Resolution order:
 *   1. users.stripe_customer_id is set          → return it.
 *   2. Stripe has a Customer with matching email → reuse oldest, persist, return.
 *   3. Neither                                   → create new Customer with a
 *                                                  deterministic idempotency
 *                                                  key, persist, return.
 *
 * Race safety: two concurrent callers for the same user will both hit
 * `stripe.customers.create` with the same idempotency key, so Stripe returns
 * the same Customer to both. The DB write is a conditional UPDATE guarded by
 * `WHERE stripe_customer_id IS NULL`; the loser re-reads and returns the
 * winner's id.
 *
 * @see Codex-cmhnv (column + backfill)
 * @see Codex-ssfes (Q4.3 — swap checkout sessions to customer: <id>)
 */

import type { Database } from '@codex/database';
import { users } from '@codex/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  InternalServiceError,
  NotFoundError,
  PaymentProcessingError,
} from '../errors';

export interface ResolveCustomerDeps {
  db: Database;
  stripe: Stripe;
}

export interface ResolveCustomerInput {
  userId: string;
  email: string;
  /**
   * Extra metadata to merge into the Stripe Customer on create. The caller's
   * keys override `codex_user_id` only if they explicitly set it; prefer
   * leaving it alone so the platform signal stays consistent.
   */
  metadata?: Record<string, string>;
}

/** Stripe errors carry a string `type` property prefixed with "Stripe". */
function isStripeError(error: unknown): error is Error & { type: string } {
  return (
    error instanceof Error &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('Stripe')
  );
}

/**
 * Return the Stripe Customer ID for a Codex user, creating the Customer in
 * Stripe + persisting to users.stripe_customer_id if one does not yet exist.
 *
 * Callers SHOULD swap the result into Checkout Sessions as `customer: <id>`
 * rather than `customer_email: email` — this is the whole point of the Q4 epic.
 *
 * Throws:
 *   - NotFoundError        if the user is missing or soft-deleted.
 *   - PaymentProcessingError if Stripe list/create fails.
 *   - InternalServiceError if the DB update raced AND the re-read found no id
 *     (indicates database corruption — shouldn't happen in practice).
 */
export async function resolveOrCreateCustomer(
  deps: ResolveCustomerDeps,
  input: ResolveCustomerInput
): Promise<string> {
  const { db, stripe } = deps;
  const { userId, email, metadata } = input;

  // ── 1. Cached id? ────────────────────────────────────────────
  const user = await db.query.users.findFirst({
    where: and(eq(users.id, userId), isNull(users.deletedAt)),
    columns: { id: true, stripeCustomerId: true },
  });

  if (!user) {
    throw new NotFoundError('User not found', { userId });
  }

  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  // ── 2. Existing Stripe Customer matching email? ──────────────
  // customers.list is exact-email-filtered + strongly consistent (unlike
  // customers.search which lags indexing). Up to 10 candidates in case of
  // historical duplicates — we pick the oldest by `created` for determinism.
  let resolvedCustomerId: string;
  try {
    const existing = await stripe.customers.list({ email, limit: 10 });

    if (existing.data.length > 0) {
      const oldest = existing.data.reduce((a, b) =>
        a.created <= b.created ? a : b
      );
      resolvedCustomerId = oldest.id;
    } else {
      // ── 3. Create new Stripe Customer ──────────────────────
      // Idempotency key scoped to userId so concurrent calls dedup to a
      // single Customer. Stripe honors the key for 24h; the DB persist below
      // is what closes the window after that.
      const created = await stripe.customers.create(
        {
          email,
          metadata: {
            codex_user_id: userId,
            ...metadata,
          },
        },
        {
          idempotencyKey: `codex:resolve-customer:${userId}`,
        }
      );
      resolvedCustomerId = created.id;
    }
  } catch (error) {
    if (isStripeError(error)) {
      throw new PaymentProcessingError(
        'Failed to resolve or create Stripe Customer',
        {
          userId,
          stripeError: error.message,
          stripeType: error.type,
        }
      );
    }
    throw error;
  }

  // ── 4. Persist, race-safe ────────────────────────────────────
  // Conditional UPDATE: only write if stripe_customer_id is still NULL. If
  // another concurrent call persisted first, `returning` is empty and we
  // re-read to return their value — both callers converge on the same id
  // (Stripe's idempotency key guarantees they received the same Customer).
  const persisted = await db
    .update(users)
    .set({ stripeCustomerId: resolvedCustomerId })
    .where(and(eq(users.id, userId), isNull(users.stripeCustomerId)))
    .returning({ stripeCustomerId: users.stripeCustomerId });

  if (persisted.length > 0) {
    return resolvedCustomerId;
  }

  // Lost the race — the winner's value is authoritative.
  const winner = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { stripeCustomerId: true },
  });
  if (winner?.stripeCustomerId) {
    return winner.stripeCustomerId;
  }

  throw new InternalServiceError(
    'Failed to persist resolved Stripe Customer id',
    { userId, resolvedCustomerId }
  );
}
