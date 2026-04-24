/**
 * resolveOrCreateCustomer — integration tests (Codex-49gev).
 *
 * Real DB via setupTestDatabase, Stripe mocked. Covers the three resolution
 * paths (cached id, reuse existing Customer, create new Customer), the
 * race-safe conditional UPDATE, and the error envelopes (NotFoundError for
 * missing/deleted users, PaymentProcessingError for Stripe failures).
 */

import * as schema from '@codex/database/schema';
import {
  cleanupDatabase,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NotFoundError, PaymentProcessingError } from '../errors';
import { resolveOrCreateCustomer } from '../services/resolve-customer';

type StripeCustomersList = Stripe.Customer[];

/** Build a minimal Stripe.Customer shape for list/create mock returns. */
function mockStripeCustomer(
  id: string,
  email: string,
  created: number
): Stripe.Customer {
  return {
    id,
    object: 'customer',
    email,
    created,
    metadata: {},
  } as Stripe.Customer;
}

describe('resolveOrCreateCustomer', () => {
  let db: Database;
  let mockStripe: Stripe;
  let customersList: ReturnType<typeof vi.fn>;
  let customersCreate: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase(db);
    await teardownTestDatabase();
  });

  beforeEach(() => {
    customersList = vi.fn();
    customersCreate = vi.fn();
    mockStripe = {
      customers: {
        list: customersList,
        create: customersCreate,
      },
    } as unknown as Stripe;
  });

  // ── Cached id path ────────────────────────────────────────────

  it('returns cached stripe_customer_id without calling Stripe', async () => {
    const cachedId = `cus_cached_${createUniqueSlug()}`;
    const [userId] = await seedTestUsers(db, 1, { stripeCustomerId: cachedId });

    const result = await resolveOrCreateCustomer(
      { db, stripe: mockStripe },
      { userId, email: 'cached@example.com' }
    );

    expect(result).toBe(cachedId);
    expect(customersList).not.toHaveBeenCalled();
    expect(customersCreate).not.toHaveBeenCalled();
  });

  // ── Reuse-existing path ──────────────────────────────────────

  it('reuses existing Stripe Customer and persists id when email matches', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const existingId = `cus_existing_${createUniqueSlug()}`;
    customersList.mockResolvedValue({
      data: [mockStripeCustomer(existingId, user.email, 1_700_000_000)],
    });

    const result = await resolveOrCreateCustomer(
      { db, stripe: mockStripe },
      { userId, email: user.email }
    );

    expect(result).toBe(existingId);
    expect(customersCreate).not.toHaveBeenCalled();

    // Persisted to DB
    const [row] = await db
      .select({ stripeCustomerId: schema.users.stripeCustomerId })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(row.stripeCustomerId).toBe(existingId);
  });

  it('picks the oldest Customer when multiple email matches exist', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const oldestId = `cus_oldest_${createUniqueSlug()}`;
    customersList.mockResolvedValue({
      data: [
        // Newer timestamp first — list() pagination order isn't guaranteed
        mockStripeCustomer(
          `cus_newer_${createUniqueSlug()}`,
          user.email,
          1_800_000_000
        ),
        mockStripeCustomer(oldestId, user.email, 1_500_000_000),
        mockStripeCustomer(
          `cus_mid_${createUniqueSlug()}`,
          user.email,
          1_700_000_000
        ),
      ] satisfies StripeCustomersList,
    });

    const result = await resolveOrCreateCustomer(
      { db, stripe: mockStripe },
      { userId, email: user.email }
    );

    expect(result).toBe(oldestId);
  });

  // ── Create-new path ──────────────────────────────────────────

  it('creates a new Stripe Customer with deterministic idempotency key', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const newId = `cus_created_${createUniqueSlug()}`;
    customersList.mockResolvedValue({ data: [] });
    customersCreate.mockResolvedValue(
      mockStripeCustomer(newId, user.email, 1_900_000_000)
    );

    const result = await resolveOrCreateCustomer(
      { db, stripe: mockStripe },
      { userId, email: user.email, metadata: { source: 'checkout' } }
    );

    expect(result).toBe(newId);

    // Verify idempotency key + metadata merge
    expect(customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        email: user.email,
        metadata: expect.objectContaining({
          codex_user_id: userId,
          source: 'checkout',
        }),
      }),
      expect.objectContaining({
        idempotencyKey: `codex:resolve-customer:${userId}`,
      })
    );

    // Persisted to DB
    const [row] = await db
      .select({ stripeCustomerId: schema.users.stripeCustomerId })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(row.stripeCustomerId).toBe(newId);
  });

  it('always stamps codex_user_id in metadata even when caller provides none', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const newId = `cus_meta_${createUniqueSlug()}`;
    customersList.mockResolvedValue({ data: [] });
    customersCreate.mockResolvedValue(
      mockStripeCustomer(newId, user.email, 1_900_000_000)
    );

    await resolveOrCreateCustomer(
      { db, stripe: mockStripe },
      { userId, email: user.email }
    );

    const [[args]] = customersCreate.mock.calls;
    expect(args.metadata).toEqual({ codex_user_id: userId });
  });

  // ── Race-safety / idempotency ────────────────────────────────

  it('returns the winner id when a concurrent caller already persisted', async () => {
    // Arrange: user starts with NULL, but simulate a race by having the row
    // already contain a winner id at the moment we attempt the conditional
    // UPDATE. We do this by stamping the id between the create-mock and the
    // DB persist — the fastest way in a single-process test is to pre-stamp
    // it and assert the helper's fallback re-read returns that value.
    const winnerId = `cus_winner_${createUniqueSlug()}`;
    const [userId] = await seedTestUsers(db, 1, { stripeCustomerId: winnerId });
    // Clear then re-set to mimic "winner just wrote" state without going
    // through Stripe twice: set back to NULL first to enter the Stripe branch,
    // then stamp winnerId after the mock returns but before the conditional
    // update runs. We do this by using a vi.fn that side-effects the DB.
    await db
      .update(schema.users)
      .set({ stripeCustomerId: null })
      .where(eq(schema.users.id, userId));

    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const loserId = `cus_loser_${createUniqueSlug()}`;
    customersList.mockResolvedValue({ data: [] });
    customersCreate.mockImplementation(async () => {
      // Simulate the winning concurrent caller persisting first.
      await db
        .update(schema.users)
        .set({ stripeCustomerId: winnerId })
        .where(eq(schema.users.id, userId));
      return mockStripeCustomer(loserId, user.email, 1_900_000_000);
    });

    const result = await resolveOrCreateCustomer(
      { db, stripe: mockStripe },
      { userId, email: user.email }
    );

    // Winner id is returned, not the loser's freshly-created one.
    expect(result).toBe(winnerId);

    // DB reflects the winner
    const [row] = await db
      .select({ stripeCustomerId: schema.users.stripeCustomerId })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(row.stripeCustomerId).toBe(winnerId);
  });

  // ── Error paths ──────────────────────────────────────────────

  it('throws NotFoundError when user does not exist', async () => {
    await expect(
      resolveOrCreateCustomer(
        { db, stripe: mockStripe },
        { userId: 'nonexistent-user-id', email: 'nobody@example.com' }
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when user is soft-deleted', async () => {
    const [userId] = await seedTestUsers(db, 1);
    await db
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, userId));

    await expect(
      resolveOrCreateCustomer(
        { db, stripe: mockStripe },
        { userId, email: 'deleted@example.com' }
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(customersList).not.toHaveBeenCalled();
  });

  it('wraps Stripe list failures in PaymentProcessingError', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const stripeErr = Object.assign(new Error('API unreachable'), {
      type: 'StripeConnectionError',
    });
    customersList.mockRejectedValue(stripeErr);

    await expect(
      resolveOrCreateCustomer(
        { db, stripe: mockStripe },
        { userId, email: user.email }
      )
    ).rejects.toBeInstanceOf(PaymentProcessingError);
  });

  it('wraps Stripe create failures in PaymentProcessingError', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    customersList.mockResolvedValue({ data: [] });
    const stripeErr = Object.assign(
      new Error('Card declined (odd for .create)'),
      {
        type: 'StripeCardError',
      }
    );
    customersCreate.mockRejectedValue(stripeErr);

    await expect(
      resolveOrCreateCustomer(
        { db, stripe: mockStripe },
        { userId, email: user.email }
      )
    ).rejects.toBeInstanceOf(PaymentProcessingError);
  });

  it('re-throws non-Stripe errors unchanged (no wrapping)', async () => {
    const [userId] = await seedTestUsers(db, 1);
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const plainErr = new Error('network blip — not a Stripe error');
    customersList.mockRejectedValue(plainErr);

    await expect(
      resolveOrCreateCustomer(
        { db, stripe: mockStripe },
        { userId, email: user.email }
      )
    ).rejects.toBe(plainErr);
  });
});
