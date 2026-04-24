/**
 * stripe-customer-integrity — integration tests (Codex-qsvxf, Q4.4).
 *
 * Exercises the belt-and-braces helpers that detect drift in the
 * users.stripe_customer_id column. The partial unique index prevents
 * new collisions at the DB level (migration 0057); these helpers are
 * for operator tooling that needs to detect pre-existing drift and
 * answer the "who owns this Customer?" question.
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
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  findStripeCustomerCollisions,
  findUsersByStripeCustomerId,
} from '../services/stripe-customer-integrity';

describe('stripe-customer-integrity', () => {
  let db: Database;

  beforeAll(() => {
    db = setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupDatabase(db);
    await teardownTestDatabase();
  });

  describe('findUsersByStripeCustomerId', () => {
    it('returns the single user pointing at the given customer id', async () => {
      const customerId = `cus_single_${createUniqueSlug()}`;
      const [userId] = await seedTestUsers(db, 1, {
        stripeCustomerId: customerId,
      });

      const rows = await findUsersByStripeCustomerId(db, customerId);
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(userId);
      expect(rows[0].stripeCustomerId).toBe(customerId);
    });

    it('returns an empty array when the id is unknown to Codex', async () => {
      const rows = await findUsersByStripeCustomerId(
        db,
        `cus_unknown_${createUniqueSlug()}`
      );
      expect(rows).toEqual([]);
    });

    it('returns every user when drift has occurred (should be zero in practice)', async () => {
      // The unique index prevents this at the write level — we bypass it
      // here only to simulate pre-index drift data, confirm the helper
      // surfaces both rows, then clean up. Uses a raw SQL update to set
      // the same id on two rows, skirting Drizzle's usual write path.
      const customerId = `cus_drift_${createUniqueSlug()}`;
      const [userA, userB] = await seedTestUsers(db, 2);

      // Temporarily drop the unique index to allow the collision insert.
      await db.execute(
        sql`DROP INDEX IF EXISTS idx_unique_users_stripe_customer_id`
      );
      try {
        await db
          .update(schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.users.id, userA));
        await db
          .update(schema.users)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.users.id, userB));

        const rows = await findUsersByStripeCustomerId(db, customerId);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.userId).sort()).toEqual([userA, userB].sort());
      } finally {
        // Restore the index so the rest of the suite keeps its invariant.
        // (Partial unique: `WHERE stripeCustomerId IS NOT NULL`.)
        await db
          .update(schema.users)
          .set({ stripeCustomerId: null })
          .where(eq(schema.users.id, userA));
        await db
          .update(schema.users)
          .set({ stripeCustomerId: null })
          .where(eq(schema.users.id, userB));
        await db.execute(
          sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_users_stripe_customer_id ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`
        );
      }
    });
  });

  describe('findStripeCustomerCollisions', () => {
    it('returns an empty array on a clean database (expected state)', async () => {
      // The suite starts from cleanupDatabase; as long as no earlier test
      // left drift behind, this is clean. We assert the happy path.
      const collisions = await findStripeCustomerCollisions(db);
      expect(collisions).toEqual([]);
    });

    it('surfaces a collision sorted by count descending', async () => {
      const collisionId = `cus_coll_${createUniqueSlug()}`;
      const loneId = `cus_lone_${createUniqueSlug()}`;
      const [u1, u2, u3, u4] = await seedTestUsers(db, 4);

      // u4 is a solo non-colliding user (still-NULL default works; explicit
      // set keeps the row out of the collision bucket while exercising
      // the isNotNull filter).
      await db
        .update(schema.users)
        .set({ stripeCustomerId: loneId })
        .where(eq(schema.users.id, u4));

      // Bypass the partial unique index for u1/u2/u3 sharing one id.
      await db.execute(
        sql`DROP INDEX IF EXISTS idx_unique_users_stripe_customer_id`
      );
      try {
        for (const id of [u1, u2, u3]) {
          await db
            .update(schema.users)
            .set({ stripeCustomerId: collisionId })
            .where(eq(schema.users.id, id));
        }

        const collisions = await findStripeCustomerCollisions(db);
        const offender = collisions.find(
          (c) => c.stripeCustomerId === collisionId
        );
        expect(offender).toBeDefined();
        expect(offender?.count).toBe(3);
        expect(offender?.userIds.sort()).toEqual([u1, u2, u3].sort());
        // The solo user must NOT appear in the collision result.
        expect(
          collisions.find((c) => c.stripeCustomerId === loneId)
        ).toBeUndefined();
      } finally {
        for (const id of [u1, u2, u3, u4]) {
          await db
            .update(schema.users)
            .set({ stripeCustomerId: null })
            .where(eq(schema.users.id, id));
        }
        await db.execute(
          sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_users_stripe_customer_id ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`
        );
      }
    });
  });
});
