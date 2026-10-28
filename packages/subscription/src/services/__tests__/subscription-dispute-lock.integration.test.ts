/**
 * A win racing a re-run of a subscription chargeback's pause, on two
 * connections (Codex-2hxff.58, review round 2).
 *
 * The hourly reconcile re-runs an open chargeback's pause. The pause reads the
 * dispute under a share lock and writes `disputed_at` in the same transaction,
 * so a win that lands after its read waits for its commit, and the win's
 * restore then clears it. No sequential case can reach the window between the
 * read and the write. This one holds the subscription's row in a transaction
 * of its own, so the pause parks there, then starts the win. With the lock the
 * win's record waits on the pause; without it the win records and restores at
 * once, finds nothing to restore, and the pause then writes: the subscriber of
 * a won dispute is locked out for good.
 *
 * The same harness as
 * packages/purchase/src/__tests__/dispute-pause-race.integration.test.ts.
 * Real DB. Every row hangs off this file's own organisation and subscriber,
 * and is deleted in afterAll.
 */

import { randomUUID } from 'node:crypto';
import { createPerRequestDbClient } from '@codex/database';
import {
  disputes,
  organizations,
  subscriptions,
  subscriptionTiers,
  users,
} from '@codex/database/schema';
import { PurchaseService } from '@codex/purchase';
import {
  createMockStripe,
  createTestMoneyDeps,
  createTestOrganizationInput,
  createTestSubscriptionInput,
  createTestTierInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SubscriptionService } from '../subscription-service';

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

describe('a subscription dispute pause racing a win, on two connections', () => {
  let db: Database;
  let service: SubscriptionService;
  let subscriberId: string;
  let orgId: string;
  let tierId: string;
  const disputeIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new SubscriptionService(
      { db, environment: 'test', ...createTestMoneyDeps() },
      createMockStripe()
    );
    [subscriberId] = await seedTestUsers(db, 1);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(
          createTestOrganizationInput({ slug: createUniqueSlug('sub-lock') })
        )
        .returning()
    ).id;
    tierId = takeFirst(
      await db
        .insert(subscriptionTiers)
        .values(createTestTierInput(orgId))
        .returning()
    ).id;
  });

  // Disputes hold payouts in global drains and sweeps; none may outlive the
  // file. Subscriptions restrict their user and organisation, so go first.
  afterAll(async () => {
    if (disputeIds.length > 0) {
      await db
        .delete(disputes)
        .where(inArray(disputes.stripeDisputeId, disputeIds));
    }
    await db
      .delete(subscriptions)
      .where(eq(subscriptions.userId, subscriberId));
    await db
      .delete(subscriptionTiers)
      .where(eq(subscriptionTiers.organizationId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));
    await db.delete(users).where(eq(users.id, subscriberId));
    await teardownTestDatabase();
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
    const sub = takeFirst(
      await db
        .insert(subscriptions)
        .values(createTestSubscriptionInput(subscriberId, orgId, tierId))
        .returning()
    );
    const tag = uid();
    const input = {
      stripeDisputeId: `dp_lock_${tag}`,
      chargeId: `ch_lock_${tag}`,
      paymentIntentId: null,
    };
    disputeIds.push(input.stripeDisputeId);
    // An open chargeback, already linked to the subscription.
    await db.insert(disputes).values({
      stripeDisputeId: input.stripeDisputeId,
      stripeChargeId: input.chargeId,
      subscriptionId: sub.id,
      amountCents: 499,
      currency: 'gbp',
      status: 'needs_response',
      stripeCreatedAt: new Date(),
    });
    const pauser = await ownConnection();
    const winner = await ownConnection();
    let pause = track(Promise.resolve());
    let win = track(Promise.resolve());
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '10s'`);
        // The subscription's row: what the pause writes after its read.
        await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.id, sub.id))
          .for('update');
        const holder = await backendPid(tx);
        // The reconcile's re-run: it reads the chargeback, still open, and
        // parks on the subscription.
        pause = track(
          new SubscriptionService(
            { db: pauser.db, environment: 'test', ...createTestMoneyDeps() },
            createMockStripe()
          ).pauseForDispute(input)
        );
        await untilWaiting(pauser.pid, holder, 'subscriptions', pause);
        // The webhook's win: its record waits on the pause's read.
        const record = new PurchaseService(
          { db: winner.db, environment: 'test', ...createTestMoneyDeps() },
          createMockStripe()
        );
        win = track(
          record
            .recordDispute({
              stripeDisputeId: input.stripeDisputeId,
              stripeChargeId: input.chargeId,
              paymentIntentId: null,
              amountCents: 499,
              currency: 'gbp',
              status: 'won',
              reason: 'fraudulent',
              stripeCreatedAt: new Date(),
            })
            .then(() => service.restoreAfterDispute(input))
        );
        await untilWaiting(winner.pid, pauser.pid, 'disputes', win);
      });

      expect(await pause.outcome).toMatchObject({ kind: 'tier', id: sub.id });
      expect(await win.outcome).toMatchObject({ restored: true });
    } finally {
      await Promise.all([pause.outcome, win.outcome]);
      await Promise.all([pauser.cleanup(), winner.cleanup()]);
    }
    const [row] = await db
      .select({ disputedAt: subscriptions.disputedAt })
      .from(subscriptions)
      .where(eq(subscriptions.id, sub.id));
    expect(row?.disputedAt).toBeNull();
  });
});
