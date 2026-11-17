/**
 * A late win racing a re-run of its unfinished loss, on two connections
 * (Codex-2hxff.70; late-win data design §4.1, §4.8; plan risk 5).
 *
 * The hourly reconcile re-runs a loss that never finished. Its purchase step
 * (`processLostDispute`) reads the dispute under a share lock, still lost, and
 * writes the purchase in the same transaction. A late win that lands after
 * that read must wait for its commit: its record's write on the dispute row
 * conflicts with the share lock. Its restore then runs after, finds the
 * purchase the loss refunded, and restores it. Both take the dispute, then
 * the purchase: the late win's lock order, so they cannot deadlock.
 *
 * No sequential case can reach the window between the loss's read and its
 * write. This one holds the purchase's row in a transaction of its own, so
 * the loss parks there, then starts the late win. With the share lock the
 * win's record waits on the loss; without it the win records and restores
 * first (its restore parks behind the purchase, never on the dispute), and
 * the loss's refund lands on a won sale.
 *
 * The same harness as dispute-pause-race.integration.test.ts. Real DB. Every
 * row hangs off this file's own organisation and users, and is deleted in
 * afterAll.
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
 * A connection of the test's own, used one statement at a time, so every
 * statement the code runs on it lands on the backend whose pid is read here.
 * A lock wait on it gives up after 10s, so a regression cannot hang the
 * suite.
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

describe('a late win racing a re-run of its loss', () => {
  let db: Database;
  let buyerId: string;
  let creatorId: string;
  let orgId: string;
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    [buyerId, creatorId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values({
          name: 'Late Win Lock Org',
          slug: createUniqueSlug('late-win-lock'),
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

  function serviceOn(on: Database): PurchaseService {
    return new PurchaseService(
      { db: on, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
  }

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

  it('a late win recorded while the loss is between its dispute read and its purchase write waits for the loss to commit; its restore then undoes it', async () => {
    const item = takeFirst(
      await db
        .insert(content)
        .values(
          createTestContentInput(creatorId, {
            organizationId: orgId,
            contentType: 'written',
            slug: createUniqueSlug('late-win-lock'),
          })
        )
        .returning()
    );
    const tag = uid();
    const paymentIntentId = `pi_lwlock_${tag}`;
    const stripeDisputeId = `dp_lwlock_${tag}`;
    disputeIds.push(stripeDisputeId);
    const service = serviceOn(db);
    const purchase = await service.completePurchase(paymentIntentId, {
      contentId: item.id,
      customerId: buyerId,
      organizationId: orgId,
      amountPaidCents: 1000,
      currency: 'gbp',
    });
    const record = (status: string, on: PurchaseService) =>
      on.recordDispute({
        stripeDisputeId,
        stripeChargeId: `ch_lwlock_${tag}`,
        paymentIntentId,
        amountCents: 1000,
        currency: 'gbp',
        status,
        reason: 'fraudulent',
        stripeCreatedAt: new Date(),
      });
    // The chargeback opened and was lost; its handling never finished.
    await record('needs_response', service);
    await service.processDispute(paymentIntentId, { stripeDisputeId });
    await record('lost', service);

    const loser = await ownConnection();
    const winner = await ownConnection();
    let loss = track(Promise.resolve());
    let win = track(Promise.resolve());
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // The purchase's row: what the loss writes after its dispute read.
        await tx
          .select({ id: purchases.id })
          .from(purchases)
          .where(eq(purchases.id, purchase.id))
          .for('update');
        const holder = await backendPid(tx);
        // The reconcile's re-run of the loss: it reads the dispute, still
        // lost, and parks on the purchase.
        loss = track(
          serviceOn(loser.db).processLostDispute(
            paymentIntentId,
            1000,
            stripeDisputeId
          )
        );
        await untilWaiting(loser.pid, holder, 'purchases', loss);
        // The webhook's late win: its record waits on the loss's share lock.
        const winService = serviceOn(winner.db);
        win = track(
          record('won', winService).then(() =>
            winService.restoreAfterLateWin(stripeDisputeId)
          )
        );
        await untilWaiting(winner.pid, loser.pid, 'disputes', win);
      });

      expect(await loss.outcome).toMatchObject({ accessEnded: true });
      expect(await win.outcome).toMatchObject({ outcome: 'restored' });
    } finally {
      await Promise.all([loss.outcome, win.outcome]);
      await Promise.all([loser.cleanup(), winner.cleanup()]);
    }

    const [after] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchase.id));
    expect(after).toMatchObject({
      status: 'completed',
      refundedAt: null,
      disputedAt: null,
    });
    const [access] = await db
      .select()
      .from(contentAccess)
      .where(
        and(
          eq(contentAccess.userId, buyerId),
          eq(contentAccess.contentId, item.id)
        )
      );
    expect(access?.deletedAt).toBeNull();
    const [grant] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.sourceRef, purchase.id));
    expect(grant?.revokedAt).toBeNull();
  });
});
