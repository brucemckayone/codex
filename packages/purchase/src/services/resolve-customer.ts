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
 *      Customers tagged by ANOTHER environment are never adopted — production
 *      and local dev share one Stripe sandbox (Codex-2hxff.5). Nor is another
 *      person's (Codex-2hxff.23): one tagged with another `codex_user_id`, or
 *      one another users row holds, deleted users included. Deleting an
 *      account keeps its Stripe Customer, real email and all, as the payment
 *      record; whoever signs up with that email next gets a Customer of
 *      their own.
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

import {
  isForeignStripeEnvironment,
  stripeEnvMetadata,
} from '@codex/constants';
import type { Database, DatabaseWs } from '@codex/database';
import { users } from '@codex/database/schema';
import { and, eq, isNull } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  InternalServiceError,
  NotFoundError,
  PaymentProcessingError,
} from '../errors';
import { findUsersByStripeCustomerId } from './stripe-customer-integrity';

/**
 * The slice of `ObservabilityClient` the helper logs through, structural so
 * `@codex/purchase` need not depend on `@codex/observability`.
 */
interface CustomerResolutionLogger {
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface ResolveCustomerDeps {
  /**
   * HTTP or WebSocket Drizzle client. Accepts the union so the helper can
   * be called from any service in the Codex platform (purchase, subscription,
   * ecom webhooks) without transport-specific re-wiring. The helper only
   * uses `.query.users.findFirst`, `.select().from().where()` and
   * `.update(...).set(...).returning()`, which are present on both clients.
   */
  db: Database | DatabaseWs;
  stripe: Stripe;
  /**
   * Receives a skipped email candidate (ids only) and a Stripe failure (its
   * message, which never reaches the client; the thrown error carries the
   * `errorId` that finds it). Services pass their `obs`. Required: without
   * it the client would get an errorId that no log line holds.
   */
  obs: CustomerResolutionLogger;
}

export interface ResolveCustomerInput {
  userId: string;
  email: string;
  /**
   * The calling worker's environment (`ServiceConfig.environment`). A new
   * Customer is tagged with it, and a Customer another environment tagged is
   * never adopted by email (Codex-2hxff.5).
   */
  environment: string;
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
 *   - PaymentProcessingError if Stripe list/create fails. Its context carries
 *     an `errorId`, never Stripe's message: that goes to `deps.obs`.
 *   - InternalServiceError if the DB update raced AND the re-read found no id
 *     (indicates database corruption — shouldn't happen in practice).
 */
export async function resolveOrCreateCustomer(
  deps: ResolveCustomerDeps,
  input: ResolveCustomerInput
): Promise<string> {
  return resolveCustomer(deps, input, `codex:resolve-customer:${input.userId}`);
}

/**
 * The oldest email candidate that is this user's to adopt (Codex-2hxff.23):
 * untagged or tagged with this user, and held by no other users row. A
 * deleted user still holds theirs: it is the record of what they paid. Each
 * one skipped is logged by id; the holders' emails are never read out.
 */
async function firstAdoptableCustomer(
  { db, obs }: ResolveCustomerDeps,
  userId: string,
  candidates: Stripe.Customer[]
): Promise<Stripe.Customer | undefined> {
  for (const customer of candidates) {
    const taggedUserId = customer.metadata.codex_user_id;
    if (taggedUserId && taggedUserId !== userId) {
      obs.warn('Stripe Customer with this email is tagged for another user', {
        userId,
        stripeCustomerId: customer.id,
        taggedUserId,
      });
      continue;
    }
    const holders = await findUsersByStripeCustomerId(db, customer.id);
    const otherHolderIds = holders
      .map((holder) => holder.userId)
      .filter((holderId) => holderId !== userId);
    if (otherHolderIds.length > 0) {
      obs.warn('Stripe Customer with this email is held by another user', {
        userId,
        stripeCustomerId: customer.id,
        holderUserIds: otherHolderIds,
      });
      continue;
    }
    return customer;
  }
  return undefined;
}

/**
 * `resolveOrCreateCustomer`, with the create's idempotency key chosen by the
 * caller: stale recovery needs one of its own (`withStaleCustomerRecovery`).
 */
async function resolveCustomer(
  deps: ResolveCustomerDeps,
  input: ResolveCustomerInput,
  createIdempotencyKey: string
): Promise<string> {
  const { db, stripe, obs } = deps;
  const { userId, email, environment, metadata } = input;

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
  // historical duplicates — we take the oldest adoptable one by `created`
  // for determinism.
  let resolvedCustomerId: string;
  try {
    const existing = await stripe.customers.list({ email, limit: 10 });
    // The same email can hold a Customer in each environment — never take
    // another environment's. Untagged (pre-tagging) Customers stay adoptable.
    const candidates = existing.data
      .filter(
        (customer) =>
          !isForeignStripeEnvironment(customer.metadata, environment)
      )
      .sort((a, b) => a.created - b.created);
    const adoptable = await firstAdoptableCustomer(deps, userId, candidates);

    if (adoptable) {
      resolvedCustomerId = adoptable.id;
    } else {
      // ── 3. Create new Stripe Customer ──────────────────────
      // Idempotency key scoped to userId (on stale recovery, to the stale id
      // too) so concurrent calls dedup to a single Customer. Stripe honors
      // the key for 24h; the DB persist below is what closes the window
      // after that.
      const created = await stripe.customers.create(
        {
          email,
          metadata: {
            codex_user_id: userId,
            ...stripeEnvMetadata(environment),
            ...metadata,
          },
        },
        { idempotencyKey: createIdempotencyKey }
      );
      resolvedCustomerId = created.id;
    }
  } catch (error) {
    if (isStripeError(error)) {
      // The context is sent to the client: Stripe's message stays in the log.
      const errorId = crypto.randomUUID();
      obs.error('Stripe Customer could not be resolved or created', {
        errorId,
        userId,
        stripeType: error.type,
        stripeCode: (error as { code?: string }).code,
        error: error.message,
      });
      throw new PaymentProcessingError(
        'Failed to resolve or create Stripe Customer',
        { userId, errorId }
      );
    }
    throw error;
  }

  // ── 4. Persist, race-safe ────────────────────────────────────
  // Conditional UPDATE: only write if stripe_customer_id is still NULL. If
  // another concurrent call persisted first, `returning` is empty and we
  // re-read to return their value — both callers converge on the same id
  // (Stripe's idempotency key guarantees they received the same Customer).
  // Note: .returning() (no columns object) works across both the HTTP and
  // WebSocket Drizzle clients; the column-selector overload is typed
  // differently on each, which breaks the Database | DatabaseWs union.
  const persisted = await db
    .update(users)
    .set({ stripeCustomerId: resolvedCustomerId })
    .where(and(eq(users.id, userId), isNull(users.stripeCustomerId)))
    .returning();

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

/**
 * Stripe rejected a request because the `customer:` parameter referenced an
 * id that does not exist (deleted in the Stripe dashboard, or — in dev —
 * a seed value that never resolved against Stripe). The narrow signature
 * `code === 'resource_missing'` + `param === 'customer'` keeps the predicate
 * scoped to *this specific* failure mode; broader matching would mask
 * unrelated bugs (missing price, missing payment method, etc.).
 */
export function isStaleCustomerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const e = error as { code?: unknown; param?: unknown };
  return e.code === 'resource_missing' && e.param === 'customer';
}

/**
 * Hook fired when a stale customer id is detected and recovery kicks in.
 * Callers wire this to `obs.warn(...)` so production gets a paper trail
 * without forcing `@codex/purchase` to depend on `@codex/observability`.
 */
export interface StaleCustomerRecoveryEvent {
  userId: string;
  staleCustomerId: string;
  stripeCode: string | undefined;
}

export interface WithStaleCustomerRecoveryOptions {
  onStaleRecovery?: (event: StaleCustomerRecoveryEvent) => void;
}

/**
 * Wrap a Stripe call that needs a `customer:` id, with one-shot self-healing
 * when the cached `users.stripe_customer_id` is stale.
 *
 * Flow:
 *   1. Resolve a customer id via `resolveOrCreateCustomer`.
 *   2. Invoke `call(customerId)`.
 *   3. If Stripe replies `resource_missing` for `customer`, NULL out the
 *      cached id, mint a fresh one (the helper now sees a NULL cache and
 *      goes through the email-match-or-create path, creating under a key
 *      named for the stale id), and retry the call exactly once.
 *
 * A second `resource_missing` on the retry indicates a different problem
 * and propagates normally — we do not loop on customer creation.
 *
 * Used by both subscription checkout (`SubscriptionService`) and one-time
 * purchase / billing-portal flows (`PurchaseService`). Centralising here
 * means any future `customer:` call site gets the same recovery for free.
 *
 * @see Codex-49gev — `resolveOrCreateCustomer` cache invariant
 */
export async function withStaleCustomerRecovery<T>(
  deps: ResolveCustomerDeps,
  input: ResolveCustomerInput,
  call: (customerId: string) => Promise<T>,
  options?: WithStaleCustomerRecoveryOptions
): Promise<T> {
  const { db } = deps;
  const { userId } = input;

  let customerId = await resolveOrCreateCustomer(deps, input);
  try {
    return await call(customerId);
  } catch (error) {
    if (!isStaleCustomerError(error)) {
      throw error;
    }

    const staleCustomerId = customerId;
    options?.onStaleRecovery?.({
      userId,
      staleCustomerId,
      stripeCode: (error as { code?: string }).code,
    });

    await db
      .update(users)
      .set({ stripeCustomerId: null })
      .where(eq(users.id, userId));

    // A create key of its own. Under the first one Stripe would replay, for
    // 24h, the Customer that has just proved missing (Codex-2hxff.23). Keyed
    // on the stale id, it stays deterministic for concurrent recoveries.
    customerId = await resolveCustomer(
      deps,
      input,
      `codex:resolve-customer:${userId}:after:${staleCustomerId}`
    );
    return await call(customerId);
  }
}
