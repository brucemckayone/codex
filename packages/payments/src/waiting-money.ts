/**
 * Money waiting for a payee to set up payouts (Codex-2hxff.34, Q5). Design:
 * batch B data design §5.1.
 *
 * One shared read, so Studio's "Set up payouts" banner and the monthly
 * `payouts-waiting` email can never disagree: the same rows, the same total,
 * the same organisations.
 *
 * A row is waiting when it is `pending` for `connect_not_ready` or
 * `connect_restricted`, has a person (a `no_owner` row has none), and its
 * payee's account cannot be paid right now. A payee whose account is payable
 * now is the drain's, not ours: the next hourly run pays it.
 *
 * Each row counts what the drain would pay: its amount less its done
 * `pending_reduction` steps (a partial refund before it was paid). Every
 * payee row type is counted (`creator_payout`, `creator_payout_to_owner`,
 * `organization_fee`), so an organisation's owner is reminded of the
 * organisation's share too, which goes to their one payout account.
 */

import type { DatabaseClient } from '@codex/database';
import {
  moneyNotices,
  organizations,
  payoutReversals,
  payouts,
  stripeConnectAccounts,
} from '@codex/database/schema';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  type SQL,
  sql,
} from 'drizzle-orm';

/** Why the payee can't be paid: the sentence the banner and the email pick. */
export type WaitingSetup = 'not_started' | 'incomplete' | 'paused';

/** One organisation's waiting money, for one of the payee's roles in it. */
export interface WaitingOrganisation {
  /** Null for a creator's own sale with no organisation. */
  organizationId: string | null;
  name: string | null;
  /**
   * The organisation's own share, paid to its owner (`organization_fee`,
   * `creator_payout_to_owner`); false for the payee's creator share.
   */
  asOwner: boolean;
  cents: number;
  oldestAt: Date;
}

export interface WaitingMoney {
  userId: string;
  totalCents: number;
  /** The oldest waiting row's `created_at`, across every organisation. */
  oldestAt: Date;
  /** Largest first. */
  organisations: WaitingOrganisation[];
  setup: WaitingSetup;
}

/** One person: the Studio banner. */
export interface WaitingMoneyForUser {
  userId: string;
}

/** A page of people whose oldest waiting row is at or before `olderThan`: the monthly sweep. */
export interface WaitingMoneyPage {
  olderThan: Date;
  /** The last user id of the previous page; null for the first. */
  afterUserId: string | null;
  limit: number;
  /**
   * Leave out anyone with a `payouts_waiting` notice claimed at or after
   * this: the reminder's 21-day guard, in the page itself, so a capped run
   * never re-pages people it can't send to (notices review MED-2).
   */
  notRemindedSince?: Date;
}

const WAITING_REASONS = ['connect_not_ready', 'connect_restricted'] as const;

/** What the drain would pay for one row: its amount less its done reductions. */
const rowCents = sql`${payouts.amountCents} - COALESCE((
  SELECT SUM(${payoutReversals.amountCents})
  FROM ${payoutReversals}
  WHERE ${payoutReversals.payoutId} = ${payouts.id}
    AND ${payoutReversals.kind} = 'pending_reduction'
    AND ${payoutReversals.status} = 'done'
), 0)`;

/**
 * The §5.1 conditions. The account join is on the payee's ONE current
 * account; a payee who has none is `not_started`.
 */
function waitingConditions(): SQL[] {
  return [
    eq(payouts.status, 'pending'),
    inArray(payouts.reason, [...WAITING_REASONS]),
    isNotNull(payouts.userId),
    // Payable now: the drain has it. COALESCE, because a missing account
    // makes the AND NULL, and NOT NULL is NULL, which WHERE drops.
    sql`NOT COALESCE(${stripeConnectAccounts.chargesEnabled} AND ${stripeConnectAccounts.payoutsEnabled}, false)`,
  ];
}

/**
 * The person's oldest waiting row, by the same conditions: the key of their
 * waiting episode (§5.3). Once the money drains, the next waiting row starts
 * a new episode with a new oldest row. Null when nothing is waiting.
 */
export async function oldestWaitingPayoutId(
  db: DatabaseClient,
  userId: string
): Promise<string | null> {
  const [oldest] = await db
    .select({ id: payouts.id })
    .from(payouts)
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.userId, payouts.userId)
    )
    .where(and(...waitingConditions(), eq(payouts.userId, userId)))
    .orderBy(asc(payouts.createdAt), asc(payouts.id))
    .limit(1);
  return oldest?.id ?? null;
}

/**
 * The account's state, as the banner and the email word it: none is
 * `not_started`, `onboarding` is `incomplete`, and anything else that can't
 * be paid (restricted, disabled, or charges or payouts off) is `paused`.
 */
export function waitingSetupOf(
  account: { status: string } | null
): WaitingSetup {
  if (!account) return 'not_started';
  if (account.status === 'onboarding') return 'incomplete';
  return 'paused';
}

/**
 * The money waiting for setup: one person's (`{ userId }`, null when
 * nothing is waiting), or a page of people for the monthly sweep, ordered by
 * user id.
 */
export function waitingMoney(
  db: DatabaseClient,
  input: WaitingMoneyForUser
): Promise<WaitingMoney | null>;
export function waitingMoney(
  db: DatabaseClient,
  input: WaitingMoneyPage
): Promise<WaitingMoney[]>;
export async function waitingMoney(
  db: DatabaseClient,
  input: WaitingMoneyForUser | WaitingMoneyPage
): Promise<WaitingMoney | null | WaitingMoney[]> {
  if ('userId' in input) {
    const [one] = await readWaiting(db, [input.userId]);
    return one ?? null;
  }
  const userIds = await pageOfPeople(db, input);
  return readWaiting(db, userIds);
}

/** The people on one sweep page: their oldest waiting row is old enough. */
async function pageOfPeople(
  db: DatabaseClient,
  { olderThan, afterUserId, limit, notRemindedSince }: WaitingMoneyPage
): Promise<string[]> {
  const conditions = waitingConditions();
  if (afterUserId !== null) conditions.push(gt(payouts.userId, afterUserId));
  if (notRemindedSince) {
    // idx_money_notices_recent (user_id, kind, created_at desc).
    conditions.push(sql`NOT EXISTS (
      SELECT 1 FROM ${moneyNotices}
      WHERE ${moneyNotices.userId} = ${payouts.userId}
        AND ${moneyNotices.kind} = 'payouts_waiting'
        AND ${moneyNotices.createdAt} >= ${notRemindedSince}
    )`);
  }
  const rows = await db
    .select({ userId: payouts.userId })
    .from(payouts)
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.userId, payouts.userId)
    )
    .where(and(...conditions))
    .groupBy(payouts.userId)
    .having(
      and(
        sql`MIN(${payouts.createdAt}) <= ${olderThan}`,
        sql`SUM(${rowCents}) > 0`
      )
    )
    .orderBy(asc(payouts.userId))
    .limit(limit);
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId]));
}

async function readWaiting(
  db: DatabaseClient,
  userIds: string[]
): Promise<WaitingMoney[]> {
  if (userIds.length === 0) return [];
  const asOwner = sql<boolean>`${payouts.payoutType} <> 'creator_payout'`;
  const rows = await db
    .select({
      userId: payouts.userId,
      organizationId: payouts.organizationId,
      name: organizations.name,
      asOwner,
      cents: sql<number>`SUM(${rowCents})::int`,
      oldestAt: sql<Date>`MIN(${payouts.createdAt})`,
      accountStatus: stripeConnectAccounts.status,
      accountId: stripeConnectAccounts.id,
    })
    .from(payouts)
    .leftJoin(
      stripeConnectAccounts,
      eq(stripeConnectAccounts.userId, payouts.userId)
    )
    .leftJoin(organizations, eq(organizations.id, payouts.organizationId))
    .where(and(...waitingConditions(), inArray(payouts.userId, userIds)))
    .groupBy(
      payouts.userId,
      payouts.organizationId,
      organizations.name,
      asOwner,
      stripeConnectAccounts.id,
      stripeConnectAccounts.status
    );

  const byUser = new Map<string, WaitingMoney>();
  for (const row of rows) {
    if (row.userId === null || row.cents <= 0) continue;
    const oldestAt = new Date(row.oldestAt);
    let person = byUser.get(row.userId);
    if (!person) {
      person = {
        userId: row.userId,
        totalCents: 0,
        oldestAt,
        organisations: [],
        setup: waitingSetupOf(
          row.accountId === null ? null : { status: row.accountStatus ?? '' }
        ),
      };
      byUser.set(row.userId, person);
    }
    person.totalCents += row.cents;
    if (oldestAt < person.oldestAt) person.oldestAt = oldestAt;
    person.organisations.push({
      organizationId: row.organizationId,
      name: row.name,
      asOwner: row.asOwner,
      cents: row.cents,
      oldestAt,
    });
  }

  const people = [...byUser.values()];
  for (const person of people) {
    person.organisations.sort(
      (a, b) => b.cents - a.cents || (a.name ?? '').localeCompare(b.name ?? '')
    );
  }
  return people.sort((a, b) =>
    a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  );
}
