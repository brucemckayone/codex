/**
 * resolveOrCreateCustomer: whose Customer an email match may adopt
 * (Codex-2hxff.23, PAY-22 / PAY-23), and the stale-recovery create key.
 *
 * Real DB, Stripe mocked. Deleting an account keeps its Stripe Customer, real
 * email included, so whoever signs up with that email next must get a
 * Customer of their own rather than the deleted person's payment record.
 *
 * The local test DB is shared with other sessions, so this file never calls
 * `cleanupDatabase`: every row it makes is a user it seeds, tracked here and
 * deleted in afterAll.
 */

import * as schema from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { PaymentProcessingError } from '../errors';
import {
  resolveOrCreateCustomer,
  withStaleCustomerRecovery,
} from '../services/resolve-customer';

/** The calling worker's environment in these tests (Codex-2hxff.5). */
const ENV = 'test';

function stripeCustomer(
  id: string,
  created: number,
  metadata: Record<string, string> = {}
): Stripe.Customer {
  return { id, object: 'customer', created, metadata } as Stripe.Customer;
}

let db: Database;
/** Every user this file seeds, deleted in afterAll. */
const seededUserIds: string[] = [];

beforeAll(() => {
  db = setupTestDatabase();
});

afterAll(async () => {
  if (seededUserIds.length > 0) {
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, seededUserIds));
  }
  await teardownTestDatabase();
});

describe('resolveOrCreateCustomer: adopting by email (Codex-2hxff.23)', () => {
  let customersList: Mock;
  let customersCreate: Mock;
  let stripe: Stripe;
  let obs: { warn: Mock; error: Mock };

  /** A live user with no Customer yet, and their email. */
  async function seedBuyer(): Promise<{ userId: string; email: string }> {
    const [userId] = await seedTestUsers(db, 1);
    seededUserIds.push(userId);
    const { email } = takeFirst(
      await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    );
    return { userId, email };
  }

  async function storedCustomerId(userId: string): Promise<string | null> {
    const row = takeFirst(
      await db
        .select({ stripeCustomerId: schema.users.stripeCustomerId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    );
    return row.stripeCustomerId;
  }

  beforeEach(() => {
    customersList = vi.fn();
    customersCreate = vi.fn();
    stripe = {
      customers: { list: customersList, create: customersCreate },
    } as unknown as Stripe;
    obs = { warn: vi.fn(), error: vi.fn() };
  });

  it("does not adopt a Customer tagged with another user's codex_user_id", async () => {
    const { userId, email } = await seedBuyer();
    const theirs = `cus_theirs_${createUniqueSlug()}`;
    const fresh = `cus_fresh_${createUniqueSlug()}`;
    customersList.mockResolvedValue({
      data: [
        stripeCustomer(theirs, 1_500_000_000, {
          codex_user_id: 'someone-else',
        }),
      ],
    });
    customersCreate.mockResolvedValue(stripeCustomer(fresh, 1_900_000_000));

    const result = await resolveOrCreateCustomer(
      { db, stripe, obs },
      { userId, email, environment: ENV }
    );

    expect(result).toBe(fresh);
    expect(customersCreate).toHaveBeenCalledTimes(1);
    expect(await storedCustomerId(userId)).toBe(fresh);
    // Logged by id only: the email never reaches the log.
    expect(obs.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userId,
        stripeCustomerId: theirs,
        taggedUserId: 'someone-else',
      })
    );
    expect(JSON.stringify(obs.warn.mock.calls)).not.toContain(email);
  });

  it('does not adopt a Customer a soft-deleted user still holds', async () => {
    const held = `cus_held_${createUniqueSlug()}`;
    const [deletedUserId] = await seedTestUsers(db, 1, {
      stripeCustomerId: held,
    });
    seededUserIds.push(deletedUserId);
    await db
      .update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, deletedUserId));

    const { userId, email } = await seedBuyer();
    const fresh = `cus_fresh_${createUniqueSlug()}`;
    // Untagged, as a Customer from before tagging would be: only the users
    // row shows it is somebody's.
    customersList.mockResolvedValue({
      data: [stripeCustomer(held, 1_500_000_000)],
    });
    customersCreate.mockResolvedValue(stripeCustomer(fresh, 1_900_000_000));

    const result = await resolveOrCreateCustomer(
      { db, stripe, obs },
      { userId, email, environment: ENV }
    );

    expect(result).toBe(fresh);
    expect(await storedCustomerId(userId)).toBe(fresh);
    // The deleted user keeps theirs.
    expect(await storedCustomerId(deletedUserId)).toBe(held);
    expect(obs.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userId,
        stripeCustomerId: held,
        holderUserIds: [deletedUserId],
      })
    );
    expect(JSON.stringify(obs.warn.mock.calls)).not.toContain(email);
  });

  it('adopts an untagged Customer no one holds', async () => {
    const { userId, email } = await seedBuyer();
    const unclaimed = `cus_unclaimed_${createUniqueSlug()}`;
    customersList.mockResolvedValue({
      data: [stripeCustomer(unclaimed, 1_500_000_000)],
    });

    const result = await resolveOrCreateCustomer(
      { db, stripe, obs },
      { userId, email, environment: ENV }
    );

    expect(result).toBe(unclaimed);
    expect(customersCreate).not.toHaveBeenCalled();
    expect(await storedCustomerId(userId)).toBe(unclaimed);
    expect(obs.warn).not.toHaveBeenCalled();
  });

  it("adopts a Customer tagged with this user's own id, skipping an older one that is not theirs", async () => {
    const { userId, email } = await seedBuyer();
    const theirs = `cus_theirs_${createUniqueSlug()}`;
    const mine = `cus_mine_${createUniqueSlug()}`;
    customersList.mockResolvedValue({
      data: [
        stripeCustomer(mine, 1_700_000_000, { codex_user_id: userId }),
        stripeCustomer(theirs, 1_500_000_000, {
          codex_user_id: 'someone-else',
        }),
      ],
    });

    const result = await resolveOrCreateCustomer(
      { db, stripe, obs },
      { userId, email, environment: ENV }
    );

    expect(result).toBe(mine);
    expect(customersCreate).not.toHaveBeenCalled();
  });

  it("keeps Stripe's message out of the client-facing context and logs it with an errorId", async () => {
    const { userId, email } = await seedBuyer();
    const stripeError = Object.assign(
      new Error(`No such customer email: ${email}`),
      { type: 'StripeInvalidRequestError', code: 'resource_missing' }
    );
    customersList.mockRejectedValue(stripeError);

    const thrown = await resolveOrCreateCustomer(
      { db, stripe, obs },
      { userId, email, environment: ENV }
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(PaymentProcessingError);
    const context = (thrown as PaymentProcessingError).context ?? {};
    expect(JSON.stringify(context)).not.toContain(stripeError.message);
    expect(context).not.toHaveProperty('stripeError');
    expect(context.errorId).toEqual(expect.any(String));
    expect(obs.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        errorId: context.errorId,
        error: stripeError.message,
      })
    );
  });
});

describe('withStaleCustomerRecovery: the recovery create key (Codex-2hxff.23)', () => {
  it('creates the replacement under a key of its own, not the first one Stripe would replay', async () => {
    const [userId] = await seedTestUsers(db, 1);
    seededUserIds.push(userId);
    const { email } = takeFirst(
      await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    );

    const first = `cus_first_${createUniqueSlug()}`;
    const replacement = `cus_replacement_${createUniqueSlug()}`;
    const customersCreate = vi
      .fn()
      .mockResolvedValueOnce(stripeCustomer(first, 1_800_000_000))
      .mockResolvedValueOnce(stripeCustomer(replacement, 1_900_000_000));
    const stripe = {
      customers: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: customersCreate,
      },
    } as unknown as Stripe;

    // The first Customer turns out to be gone at Stripe.
    const call = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('No such customer'), {
          code: 'resource_missing',
          param: 'customer',
        })
      )
      .mockResolvedValueOnce('session');

    const result = await withStaleCustomerRecovery(
      { db, stripe, obs: { warn: vi.fn(), error: vi.fn() } },
      { userId, email, environment: ENV },
      call
    );

    expect(result).toBe('session');
    expect(call).toHaveBeenNthCalledWith(1, first);
    expect(call).toHaveBeenNthCalledWith(2, replacement);

    const keys = customersCreate.mock.calls.map(
      ([, options]) => (options as { idempotencyKey: string }).idempotencyKey
    );
    expect(keys).toEqual([
      `codex:resolve-customer:${userId}`,
      `codex:resolve-customer:${userId}:after:${first}`,
    ]);

    const row = takeFirst(
      await db
        .select({ stripeCustomerId: schema.users.stripeCustomerId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
    );
    expect(row.stripeCustomerId).toBe(replacement);
  });
});
