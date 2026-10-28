/**
 * A win racing a re-run of a chargeback's opening (Codex-2hxff.58, review
 * round 2). The hourly reconcile re-runs an open chargeback. If the dispute is
 * won between the reconcile's record of it and its pause, the pause must not
 * undo the win: the buyer of a won sale would otherwise be locked out for good,
 * with nothing left to restore them.
 *
 * Real DB. Every row hangs off this file's own organisation and users, and is
 * deleted in afterAll.
 *
 * The last case is the two-connection race the pause's share lock exists for,
 * which no sequential case can reach: the pause has read the dispute, still
 * open, and not yet written, when the win lands. It holds the sale's row in a
 * transaction of its own, so the pause parks between its read and its write,
 * then starts the win. With the lock the win's record waits on the pause;
 * without it the win records and restores at once, finds nothing to restore,
 * and the pause then writes.
 */

import { randomUUID } from 'node:crypto';
import { createPerRequestDbClient } from '@codex/database';
import {
  content,
  contentAccess,
  disputes,
  entitlements,
  organizations,
  purchases,
  users,
} from '@codex/database/schema';
import {
  createMockStripe,
  createTestContentInput,
  createTestMoneyDeps,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurchaseService } from '../services/purchase-service';

const uid = () => randomUUID().slice(0, 8);

/** Work started in the background. Its outcome is its value, or its error. */
interface Tracked {
  outcome: Promise<unknown>;
  settled: () => { value: unknown } | undefined;
}

function track(work: Promise<unknown>): Tracked {
  let settled: { value: unknown } | undefined;
  const outcome = work.then(
    (value) => value,
    (error: unknown) => error
  );
  void outcome.then((value) => {
    settled = { value };
  });
  return { outcome, settled: () => settled };
}

async function backendPid(conn: Pick<Database, 'execute'>): Promise<number> {
  const { rows } = await conn.execute(sql`select pg_backend_pid() as pid`);
  return Number((rows[0] as { pid: unknown } | undefined)?.pid);
}

/**
 * A connection of the test's own: a pool of its own, used one statement at a
 * time, so it only ever opens one client, and every statement the code runs
 * on it lands on the backend whose pid is read here. A lock wait on it gives
 * up after 10s, so a regression cannot hang the suite.
 */
async function ownConnection() {
  const { db: conn, cleanup } = createPerRequestDbClient({
    DB_METHOD: process.env.DB_METHOD,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: process.env.DATABASE_URL_LOCAL_PROXY,
    NODE_ENV: process.env.NODE_ENV,
  });
  await conn.execute(sql`set lock_timeout = '10s'`);
  return { db: conn, pid: await backendPid(conn), cleanup };
}

describe('a dispute pause racing a win', () => {
  let db: Database;
  let service: PurchaseService;
  let buyerId: string;
  let creatorId: string;
  let orgId: string;
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new PurchaseService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
    [buyerId, creatorId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Pause Race Org',
          slug: createUniqueSlug('pause-race'),
        })
        .returning()
    ).id;
  });

  afterAll(async () => {
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    await db.delete(entitlements).where(eq(entitlements.userId, buyerId));
    await db.delete(contentAccess).where(eq(contentAccess.userId, buyerId));
    await db.delete(purchases).where(eq(purchases.customerId, buyerId));
    await db.delete(content).where(eq(content.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(inArray(users.id, [buyerId, creatorId]));
    await teardownTestDatabase();
  });

  /** A completed purchase (no charge id, so no payout slices) and its dispute. */
  async function disputedSale() {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('pause-race'),
          })
        )
        .returning()
    );
    const tag = uid();
    const paymentIntentId = `pi_race_${tag}`;
    const stripeDisputeId = `dp_race_${tag}`;
    disputeIds.push(stripeDisputeId);
    await service.completePurchase(paymentIntentId, {
      contentId: item.id,
      customerId: buyerId,
      organizationId: orgId,
      amountPaidCents: 1000,
      currency: 'gbp',
    });
    const record = (status: string, on = service) =>
      on.recordDispute({
        stripeDisputeId,
        stripeChargeId: `ch_race_${tag}`,
        paymentIntentId,
        amountCents: 1000,
        currency: 'gbp',
        status,
        reason: 'fraudulent',
        stripeCreatedAt: new Date(),
      });
    return { contentId: item.id, paymentIntentId, stripeDisputeId, record };
  }

  async function purchaseOf(paymentIntentId: string) {
    return takeFirst(
      await db
        .select()
        .from(purchases)
        .where(eq(purchases.stripePaymentIntentId, paymentIntentId))
    );
  }

  async function hasAccess(sale: {
    contentId: string;
    paymentIntentId: string;
  }) {
    const purchase = await purchaseOf(sale.paymentIntentId);
    const [grant] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.sourceRef, purchase.id));
    const [row] = await db
      .select()
      .from(contentAccess)
      .where(
        and(
          eq(contentAccess.userId, buyerId),
          eq(contentAccess.contentId, sale.contentId)
        )
      );
    return (
      grant?.revokedAt === null &&
      row?.deletedAt === null &&
      (await service.verifyPurchase(sale.contentId, buyerId))
    );
  }

  it("a win recorded between the reconcile's record and its pause: the buyer is not paused, and the caller is told not to block", async () => {
    const sale = await disputedSale();
    // The reconcile records the chargeback, still open…
    await sale.record('needs_response');
    // …and the webhook's win lands before the reconcile's pause.
    await sale.record('won');
    await service.restoreDisputedPurchase(sale.paymentIntentId);

    const paused = await service.processDispute(sale.paymentIntentId, {
      stripeDisputeId: sale.stripeDisputeId,
      disputeReason: 'fraudulent',
    });

    expect(paused).toMatchObject({ accessEnded: false });
    expect((await purchaseOf(sale.paymentIntentId)).disputedAt).toBeNull();
    expect(await hasAccess(sale)).toBe(true);
  });

  it('an open chargeback still pauses the sale, and so does a lost one', async () => {
    for (const status of ['needs_response', 'lost']) {
      const sale = await disputedSale();
      await sale.record(status);

      const paused = await service.processDispute(sale.paymentIntentId, {
        stripeDisputeId: sale.stripeDisputeId,
      });

      expect(paused).toMatchObject({ accessEnded: true });
      expect(
        (await purchaseOf(sale.paymentIntentId)).disputedAt
      ).not.toBeNull();
      expect(await hasAccess(sale)).toBe(false);
    }
  });

  /**
   * Resolve once backend `waiter` waits, in a statement on `table`, on a lock
   * backend `holder` holds. Both are this test's own connections, so a peer
   * session on the shared database cannot satisfy it. Throws if `work`, which
   * runs on `waiter`, settles first: it never waited.
   */
  async function untilWaiting(
    waiter: number,
    holder: number,
    table: string,
    work: Tracked
  ): Promise<void> {
    for (let attempt = 0; attempt < 250; attempt++) {
      const early = work.settled();
      if (early) {
        throw new Error(`settled before it waited on ${table}`, {
          cause: early.value,
        });
      }
      const { rows } = await db.execute(
        sql`select 1 from pg_stat_activity
            where pid = ${waiter}::int
              and ${holder}::int = any(pg_blocking_pids(pid))
              and query ilike ${`%"${table}"%`}`
      );
      if (rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`never waited on ${table}`);
  }

  it("a win recorded while a re-run's pause is between its read and its write waits for the pause to commit, and its restore clears it", async () => {
    const sale = await disputedSale();
    await sale.record('needs_response');
    const pauser = await ownConnection();
    const winner = await ownConnection();
    let pause = track(Promise.resolve());
    let win = track(Promise.resolve());
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // The sale's row: what the pause writes first after its read.
        await tx
          .select({ id: purchases.id })
          .from(purchases)
          .where(eq(purchases.stripePaymentIntentId, sale.paymentIntentId))
          .for('update');
        const holder = await backendPid(tx);
        // The reconcile's re-run: it reads the chargeback, still open, and
        // parks on the sale.
        pause = track(
          new PurchaseService(
            { db: pauser.db, environment: 'test', ...createTestMoneyDeps() },
            createMockStripe()
          ).processDispute(sale.paymentIntentId, {
            stripeDisputeId: sale.stripeDisputeId,
          })
        );
        await untilWaiting(pauser.pid, holder, 'purchases', pause);
        // The webhook's win: its record waits on the pause's read.
        const winService = new PurchaseService(
          { db: winner.db, environment: 'test', ...createTestMoneyDeps() },
          createMockStripe()
        );
        win = track(
          sale
            .record('won', winService)
            .then(() => service.restoreDisputedPurchase(sale.paymentIntentId))
        );
        await untilWaiting(winner.pid, pauser.pid, 'disputes', win);
      });

      expect(await pause.outcome).toMatchObject({ accessEnded: true });
      expect(await win.outcome).toMatchObject({ userId: buyerId });
    } finally {
      await Promise.all([pause.outcome, win.outcome]);
      await Promise.all([pauser.cleanup(), winner.cleanup()]);
    }
    expect((await purchaseOf(sale.paymentIntentId)).disputedAt).toBeNull();
    expect(await hasAccess(sale)).toBe(true);
  });
});
