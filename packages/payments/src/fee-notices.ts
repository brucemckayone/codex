/**
 * Who a fee rise is waiting for, and when it starts (Codex-2hxff.33; batch C1
 * Part B data design §1.5, §1.6).
 *
 * - `affectedPayees` (F3): everyone whose take on a sale falls under a
 *   change, resolved with the same layering every sale uses. The daily run
 *   lists them on its first morning and adds joiners on later ones (F8).
 * - `dateRiseIfAllTold` (F4, step 4): once nobody on a rise's first list is
 *   still waiting (`due`, `failed`, `unknown`), the rise is dated the first UK
 *   midnight at least 30 days after the last of them was told. The daily run
 *   and support's "told another way" both call it, in their own transaction.
 */

import type { DatabaseClient } from '@codex/database';
import {
  type FeeNoticeRole,
  type FeeNoticeRoleValues,
  feeChangeNotices,
  feeChanges,
  feeConfigVersions,
  organizationMemberships,
  organizations,
  users,
} from '@codex/database/schema';
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import {
  CODE_DEFAULT_PLATFORM,
  type FeeValues,
  type FeeVersionList,
  type FeeVersionValues,
  feeLevelKey,
  feeRiseStartAfter,
  type LevelFees,
  layerLevelFees,
  readFeeVersions,
  readFeeVersionsByLevel,
  versionInForce,
} from './fee-versions';

type Queryable =
  | DatabaseClient
  | Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** The change a list is made for: its level and its live version. */
export interface FeeChangeForList {
  id: string;
  scope: 'platform' | 'org' | 'creator';
  organizationId: string | null;
  creatorId: string | null;
}

export interface AffectedPayee {
  userId: string;
  /** Only the roles whose take falls. */
  roles: FeeNoticeRole[];
  before: FeeNoticeRoleValues[];
  after: FeeNoticeRoleValues[];
}

/** The membership roles that can be paid a creator share. */
const PAYABLE_ROLES = ['owner', 'admin', 'creator'] as const;

const CREATOR_VALUES: ReadonlyArray<keyof FeeValues> = [
  'platformFeePercent',
  'orgFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
];
/**
 * An owner is paid the organisation's share (and, on their own content, the
 * creator's too), so an organisation fee rise never pays them less: only
 * Codex's fee, its minimum and the minimum transfer can. Under a creator's
 * own override the minimum transfer is that creator's, not the owner's.
 */
const OWNER_VALUES: ReadonlyArray<keyof FeeValues> = [
  'platformFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
];
const OWNER_VALUES_UNDER_OVERRIDE: ReadonlyArray<keyof FeeValues> = [
  'platformFeePercent',
  'minPlatformFeeCents',
];
/** A creator's own sales have no organisation slice. */
const ORGLESS_VALUES = OWNER_VALUES;

function rises(
  before: LevelFees,
  after: LevelFees,
  keys: ReadonlyArray<keyof FeeValues>
): boolean {
  for (const ctx of ['oneOff', 'subscription'] as const) {
    for (const key of keys) {
      if (after[ctx][key] > before[ctx][key]) return true;
    }
  }
  return false;
}

/** The change's live version: what its level becomes. */
async function liveVersionOf(
  db: Queryable,
  changeId: string
): Promise<FeeVersionValues | null> {
  const [row] = await db
    .select({
      platformFeePercent: feeConfigVersions.platformFeePercent,
      oneOffOrgFeePercent: feeConfigVersions.oneOffOrgFeePercent,
      subscriptionOrgFeePercent: feeConfigVersions.subscriptionOrgFeePercent,
      orgFeePercent: feeConfigVersions.orgFeePercent,
      minPlatformFeeCents: feeConfigVersions.minPlatformFeeCents,
      minTransferCents: feeConfigVersions.minTransferCents,
    })
    .from(feeConfigVersions)
    .where(
      and(
        eq(feeConfigVersions.changeId, changeId),
        isNull(feeConfigVersions.supersededAt)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Everyone whose take on a sale falls under `change` (F3), with their fees
 * before and after per role. It covers every active admin and creator of the
 * organisations in the change's reach (each can be paid a creator share),
 * every organisation owner (as the owner), and, for a platform change, every
 * creator account for their sales with no organisation. A person shielded by
 * their own organisation or creator setting resolves to the same fee before
 * and after, so they are skipped; so is an owner when only the organisation
 * fee rises. Revenue-share agreements are not consulted: the terms promise
 * notice of the fee, and any sale an agreement doesn't cover still pays it.
 *
 * `now` is when "before" is read: the fees in force at that moment.
 * `onlyUserId` narrows it to one person (Studio's read of their own note).
 */
export async function affectedPayees(
  db: Queryable,
  change: FeeChangeForList,
  now: Date,
  options: { onlyUserId?: string } = {}
): Promise<AffectedPayee[]> {
  const version = await liveVersionOf(db, change.id);
  if (!version) return [];

  const orgFilter: SQL | undefined = change.organizationId
    ? eq(feeChanges.organizationId, change.organizationId)
    : undefined;
  const [platformList, orgLists, creatorLists] = await Promise.all([
    readFeeVersions(db, { scope: 'platform' }),
    readFeeVersionsByLevel(db, 'org', orgFilter),
    readFeeVersionsByLevel(db, 'creator', orgFilter),
  ]);

  const memberWhere: SQL[] = [
    eq(organizationMemberships.status, 'active'),
    inArray(organizationMemberships.role, [...PAYABLE_ROLES]),
    isNull(users.deletedAt),
    isNull(organizations.deletedAt),
  ];
  if (change.organizationId) {
    memberWhere.push(
      eq(organizationMemberships.organizationId, change.organizationId)
    );
  }
  if (options.onlyUserId) {
    memberWhere.push(eq(organizationMemberships.userId, options.onlyUserId));
  }
  if (change.scope === 'creator' && change.creatorId) {
    // The creator themself, and the owner whose share of their sales moves.
    const self = or(
      eq(organizationMemberships.userId, change.creatorId),
      eq(organizationMemberships.role, 'owner')
    );
    if (self) memberWhere.push(self);
  }
  const [members, orgless] = await Promise.all([
    db
      .select({
        userId: organizationMemberships.userId,
        organizationId: organizationMemberships.organizationId,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMemberships.organizationId)
      )
      .where(and(...memberWhere)),
    change.scope === 'platform'
      ? db
          .select({ userId: users.id })
          .from(users)
          .where(
            and(
              eq(users.role, 'creator'),
              isNull(users.deletedAt),
              options.onlyUserId ? eq(users.id, options.onlyUserId) : undefined
            )
          )
      : Promise.resolve([] as Array<{ userId: string }>),
  ]);

  const platformNow =
    versionInForce(platformList, now) ?? CODE_DEFAULT_PLATFORM;
  const orgNow = (orgId: string) =>
    versionInForce(
      orgLists.get(feeLevelKey({ scope: 'org', organizationId: orgId })),
      now
    );
  const creatorNow = (orgId: string, creatorId: string) =>
    versionInForce(
      creatorLists.get(
        feeLevelKey({ scope: 'creator', organizationId: orgId, creatorId })
      ) as FeeVersionList | undefined,
      now
    );
  /** Each level as it is now, with the change's level replaced by its version. */
  const after = {
    platform: change.scope === 'platform' ? version : platformNow,
    org: (orgId: string) =>
      change.scope === 'org' && change.organizationId === orgId
        ? version
        : orgNow(orgId),
    creator: (orgId: string, creatorId: string) =>
      change.scope === 'creator' &&
      change.organizationId === orgId &&
      change.creatorId === creatorId
        ? version
        : creatorNow(orgId, creatorId),
  };

  const byUser = new Map<string, AffectedPayee>();
  const add = (
    userId: string,
    role: FeeNoticeRole,
    before: LevelFees,
    afterFees: LevelFees
  ) => {
    let payee = byUser.get(userId);
    if (!payee) {
      payee = { userId, roles: [], before: [], after: [] };
      byUser.set(userId, payee);
    }
    payee.roles.push(role);
    payee.before.push({ ...role, ...before });
    payee.after.push({ ...role, ...afterFees });
  };

  for (const member of members) {
    const orgId = member.organizationId;
    // An owner is weighed once, as the owner: the organisation fee only
    // moves their own money from one hat to the other, so an org fee rise
    // never pays them less (F3).
    const asCreator =
      member.role !== 'owner' &&
      (change.scope !== 'creator' || member.userId === change.creatorId);
    if (asCreator) {
      const before = layerLevelFees(
        platformNow,
        orgNow(orgId),
        creatorNow(orgId, member.userId)
      );
      const afterFees = layerLevelFees(
        after.platform,
        after.org(orgId),
        after.creator(orgId, member.userId)
      );
      if (rises(before, afterFees, CREATOR_VALUES)) {
        add(
          member.userId,
          { organizationId: orgId, as: 'creator' },
          before,
          afterFees
        );
      }
    }
    if (member.role === 'owner') {
      const underOverride = change.scope === 'creator' && change.creatorId;
      const before = underOverride
        ? layerLevelFees(
            platformNow,
            orgNow(orgId),
            creatorNow(orgId, change.creatorId as string)
          )
        : layerLevelFees(platformNow, orgNow(orgId));
      const afterFees = underOverride
        ? layerLevelFees(
            after.platform,
            after.org(orgId),
            after.creator(orgId, change.creatorId as string)
          )
        : layerLevelFees(after.platform, after.org(orgId));
      const keys = underOverride ? OWNER_VALUES_UNDER_OVERRIDE : OWNER_VALUES;
      if (rises(before, afterFees, keys)) {
        add(
          member.userId,
          { organizationId: orgId, as: 'owner' },
          before,
          afterFees
        );
      }
    }
  }
  if (orgless.length > 0) {
    const before = layerLevelFees(platformNow);
    const afterFees = layerLevelFees(after.platform);
    if (rises(before, afterFees, ORGLESS_VALUES)) {
      for (const { userId } of orgless) {
        add(userId, { organizationId: null, as: 'creator' }, before, afterFees);
      }
    }
  }
  return [...byUser.values()];
}

// ─── Setting the date ────────────────────────────────────────────────────────

/** States in which a person on the list still holds the date. */
export const FEE_NOTICE_OPEN_STATES = ['due', 'failed', 'unknown'] as const;

/**
 * A notice tried this recently may still be held by a daily run, so the
 * run's claim hands it to no other run (overlapping runs), and a `failed`
 * one tried this recently may be in flight (`feeNoticeMayHaveTold`).
 */
export const FEE_NOTICE_RECLAIM_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * THE rule for a notice whose email told, or MAY have told, its person
 * ("unconfirmed, retried, or failed mid-retry": owner, 2026-11-09). One
 * predicate for every place that asks, so they can't drift: the first cut's
 * smaller emails and the second cut's restarts (`queueSmallerFeeNotices`),
 * and a void's "it's off" emails (purchase's `voidPending`). Told, or maybe:
 *   - `sent` or `told_another_way`: told;
 *   - `unknown`: a send with no answer, which may have gone;
 *   - `due` after a try (attempts > 0): a run cut off after sending, or a
 *     send in flight now (the claim adds the try before it sends);
 *   - `failed`, tried within FEE_NOTICE_RECLAIM_AFTER_MS: the claim leaves a
 *     retried notice `failed` (it adds the try and stamps attempted_at with
 *     the run's clock), and one tried that recently may still be held by a
 *     run, its retry in flight with an earlier figure, or cut off after it
 *     went.
 * The window trades this way: a refusal that already finished looks the same
 * in the row, so its person may get one short email about a rise they never
 * saw, which the owner accepted over missing a killed run's retry that went.
 * Never tried (`due`, no attempts) is not told, nor is `not_needed`. The
 * columns are the table's own, so it reads the row a FROM names and an
 * ON CONFLICT DO UPDATE's existing row alike.
 */
export function feeNoticeMayHaveTold(now: Date): SQL {
  const heldSince = new Date(now.getTime() - FEE_NOTICE_RECLAIM_AFTER_MS);
  return sql`(${feeChangeNotices.state} IN ('sent', 'told_another_way', 'unknown')
    OR (${feeChangeNotices.state} = 'due' AND ${feeChangeNotices.attempts} > 0)
    OR (${feeChangeNotices.state} = 'failed' AND ${feeChangeNotices.attemptedAt} > ${heldSince}::timestamptz))`;
}

/**
 * Q2 (A): a waiting rise made smaller owes one short email to everyone its
 * announcement told, or may have told (`feeNoticeMayHaveTold`): one in
 * flight carries the earlier figure. One person's alone when `userId` is
 * given (the daily step, for an email it sent with figures read before the
 * cut). A smaller email told, or maybe told, starts a new round at `now`:
 * the step's email-log check is tied to the round, so the last round's
 * email can't count as this one's (review cycle 3, N1; Codex-2hxff.104). So
 * does one set aside (`not_needed`), which would send nothing more. One that
 * surely didn't go (failed and done, or never tried) keeps its round: its
 * next send carries the new figure anyway.
 */
export async function queueSmallerFeeNotices(
  db: Queryable,
  input: { changeId: string; now: Date; userId?: string }
): Promise<void> {
  const { changeId, now, userId } = input;
  await db.execute(sql`
    INSERT INTO ${feeChangeNotices}
      (change_id, user_id, kind, on_list, roles, before_values, after_values, state)
    SELECT change_id, user_id, 'smaller', false, roles, '[]'::jsonb, '[]'::jsonb, 'due'
    FROM ${feeChangeNotices}
    WHERE change_id = ${changeId}
      AND kind = 'announce'
      AND ${feeNoticeMayHaveTold(now)}
      ${userId === undefined ? sql`` : sql`AND user_id = ${userId}`}
    ON CONFLICT (change_id, user_id, kind) DO UPDATE
      SET state = 'due', attempts = 0, attempted_at = NULL, accepted_at = NULL,
          last_reason = NULL, last_error = NULL, alert_error_id = NULL,
          created_at = ${now}, updated_at = ${now}
      WHERE ${feeNoticeMayHaveTold(now)} OR ${feeChangeNotices.state} = 'not_needed'
  `);
}

export type DateRiseOutcome =
  | { dated: true; effectiveFrom: Date }
  | {
      dated: false;
      reason: 'not_waiting' | 'not_listed' | 'still_waiting';
      /** On the list and not yet told. */
      waitingFor: number;
      /** The change's date when it already had one. */
      effectiveFrom: Date | null;
    };

/**
 * Step 4 of the daily run (data design §1.5), also run by support's "told
 * another way" (§1.6). Call it inside the caller's transaction: it locks the
 * change row, so the run and a mark can't both date it.
 *
 * When the change is a rise with its first list made, not voided and not yet
 * dated, and no `announce` notice on that list is still due, failed or
 * unknown, it is dated the first UK midnight at least 30 days after the
 * latest `accepted_at` or `told_at` on the list (the list's own run time when
 * the list was empty). Joiners (`on_list = false`) never hold it (F8).
 */
export async function dateRiseIfAllTold(
  tx: Queryable,
  changeId: string
): Promise<DateRiseOutcome> {
  const [change] = await tx
    .select({
      kind: feeChanges.kind,
      effectiveFrom: feeChanges.effectiveFrom,
      voidedAt: feeChanges.voidedAt,
      firstRunAt: feeChanges.firstRunAt,
    })
    .from(feeChanges)
    .where(eq(feeChanges.id, changeId))
    .for('update');
  if (
    !change ||
    change.kind !== 'rise' ||
    change.voidedAt !== null ||
    change.effectiveFrom !== null
  ) {
    return {
      dated: false,
      reason: 'not_waiting',
      waitingFor: 0,
      effectiveFrom: change?.effectiveFrom ?? null,
    };
  }
  if (change.firstRunAt === null) {
    return {
      dated: false,
      reason: 'not_listed',
      waitingFor: 0,
      effectiveFrom: null,
    };
  }
  const onList = and(
    eq(feeChangeNotices.changeId, changeId),
    eq(feeChangeNotices.kind, 'announce'),
    eq(feeChangeNotices.onList, true)
  );
  const [counts] = await tx
    .select({
      open: sql<number>`count(*) FILTER (WHERE ${inArray(feeChangeNotices.state, [...FEE_NOTICE_OPEN_STATES])})`.mapWith(
        Number
      ),
      lastTold:
        sql<Date | null>`max(GREATEST(${feeChangeNotices.acceptedAt}, ${feeChangeNotices.toldAt})) FILTER (WHERE ${inArray(feeChangeNotices.state, ['sent', 'told_another_way'])})`.mapWith(
          (value: unknown) => (value === null ? null : new Date(String(value)))
        ),
    })
    .from(feeChangeNotices)
    .where(onList);
  const open = counts?.open ?? 0;
  if (open > 0) {
    return {
      dated: false,
      reason: 'still_waiting',
      waitingFor: open,
      effectiveFrom: null,
    };
  }
  const effectiveFrom = feeRiseStartAfter(
    counts?.lastTold ?? change.firstRunAt
  );
  await tx
    .update(feeChanges)
    .set({ effectiveFrom })
    .where(eq(feeChanges.id, changeId));
  return { dated: true, effectiveFrom };
}
