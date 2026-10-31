/**
 * The fee in force at a sale's own time (Codex-2hxff.33; batch C1 Part B data
 * design §1.3, §1.4; docs/payments/architecture.md WP4, `feeResolver(at)`).
 *
 * Fees are dated versions (`fee_config_versions`, one live version per
 * `fee_changes` row). Each level (the platform, an organisation, a creator in
 * an organisation) has a list of its dated, not voided, live versions; the
 * one in force at `at` is the newest with `effective_from <= at`. The levels
 * then layer column by column, creator over organisation over platform over
 * the `FEES` constants, exactly as `FeeConfigService` always has.
 *
 * Every sale passes its own `at` (checkout start for a purchase,
 * `invoice.created` for a subscription payment), as the agreement resolver
 * does, so a late or replayed webhook splits with the fee of its own time.
 *
 * Also here, because admin-api (the write), notifications-api (the daily
 * run) and Studio all need the same answer: how a write classifies (a cut, a
 * rise, or an edit to a waiting rise, F1/F2/F9), when a rise starts (the
 * first UK midnight at least 30 days after the last person is told), and the
 * worked £10 example the email gives.
 */

import { FEES } from '@codex/constants';
import type { DatabaseClient } from '@codex/database';
import { feeChanges, feeConfigVersions } from '@codex/database/schema';
import { and, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeeContext = 'subscription' | 'one_off';

/** Resolved fees for one kind of sale: every value set. */
export interface FeeValues {
  platformFeePercent: number;
  orgFeePercent: number;
  minPlatformFeeCents: number;
  minTransferCents: number;
}

/** A level's own values. NULL inherits the level above (never on the platform). */
export interface FeeVersionValues {
  platformFeePercent: number | null;
  oneOffOrgFeePercent: number | null;
  subscriptionOrgFeePercent: number | null;
  orgFeePercent: number | null;
  minPlatformFeeCents: number | null;
  minTransferCents: number | null;
}

export interface DatedFeeVersion extends FeeVersionValues {
  changeId: string;
  /** ISO 8601. The list is cached in KV, so it round-trips as JSON. */
  effectiveFrom: string;
}

/** What one level's cache slot holds. */
export interface FeeVersionList {
  /** Dated, not voided, live versions, newest `effectiveFrom` first. */
  versions: DatedFeeVersion[];
  /**
   * A rise at this level is waiting for its date. notifications-api sets that
   * date and can't invalidate the cache, so such a list is cached for an
   * hour, not the usual time (data design §5).
   */
  waiting: boolean;
}

export type FeeLevel =
  | { scope: 'platform' }
  | { scope: 'org'; organizationId: string }
  | { scope: 'creator'; organizationId: string; creatorId: string };

/** Reads one level's list: straight from the database, or through a cache. */
export type FeeVersionReader = (level: FeeLevel) => Promise<FeeVersionList>;

/** A level's resolved fees for both kinds of sale (what a write compares). */
export interface LevelFees {
  oneOff: FeeValues;
  subscription: FeeValues;
}

type Queryable =
  | DatabaseClient
  | Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

// ─── Levels ──────────────────────────────────────────────────────────────────

/**
 * A level's id, the same one `FeeConfigService` has always cached under:
 * `platform`, `org:<orgId>`, `override:<orgId>:<creatorId>`.
 */
export function feeLevelKey(level: FeeLevel): string {
  switch (level.scope) {
    case 'platform':
      return 'platform';
    case 'org':
      return `org:${level.organizationId}`;
    case 'creator':
      return `override:${level.organizationId}:${level.creatorId}`;
  }
}

/** The SQL that picks one level's `fee_changes` rows. */
export function feeLevelWhere(level: FeeLevel): SQL {
  switch (level.scope) {
    case 'platform':
      return sql`${feeChanges.scope} = 'platform'`;
    case 'org':
      return and(
        eq(feeChanges.scope, 'org'),
        eq(feeChanges.organizationId, level.organizationId)
      ) as SQL;
    case 'creator':
      return and(
        eq(feeChanges.scope, 'creator'),
        eq(feeChanges.organizationId, level.organizationId),
        eq(feeChanges.creatorId, level.creatorId)
      ) as SQL;
  }
}

// ─── Reading versions ────────────────────────────────────────────────────────

const versionColumns = {
  changeId: feeConfigVersions.changeId,
  effectiveFrom: feeChanges.effectiveFrom,
  platformFeePercent: feeConfigVersions.platformFeePercent,
  oneOffOrgFeePercent: feeConfigVersions.oneOffOrgFeePercent,
  subscriptionOrgFeePercent: feeConfigVersions.subscriptionOrgFeePercent,
  orgFeePercent: feeConfigVersions.orgFeePercent,
  minPlatformFeeCents: feeConfigVersions.minPlatformFeeCents,
  minTransferCents: feeConfigVersions.minTransferCents,
};

/** Dated, not voided, live: the versions a sale can resolve to. */
const DATED_LIVE = and(
  isNotNull(feeChanges.effectiveFrom),
  isNull(feeChanges.voidedAt),
  isNull(feeConfigVersions.supersededAt)
);

/** A rise still waiting for its emails. */
export const WAITING_RISE = and(
  eq(feeChanges.kind, 'rise'),
  isNull(feeChanges.voidedAt),
  isNull(feeChanges.effectiveFrom)
);

type VersionRow = Omit<DatedFeeVersion, 'effectiveFrom'> & {
  effectiveFrom: Date | null;
};

function toDated(row: VersionRow): DatedFeeVersion {
  return {
    changeId: row.changeId,
    // DATED_LIVE filtered the NULLs out.
    effectiveFrom: (row.effectiveFrom ?? new Date(0)).toISOString(),
    platformFeePercent: row.platformFeePercent,
    oneOffOrgFeePercent: row.oneOffOrgFeePercent,
    subscriptionOrgFeePercent: row.subscriptionOrgFeePercent,
    orgFeePercent: row.orgFeePercent,
    minPlatformFeeCents: row.minPlatformFeeCents,
    minTransferCents: row.minTransferCents,
  };
}

/** One level's list, from the database. */
export async function readFeeVersions(
  db: Queryable,
  level: FeeLevel
): Promise<FeeVersionList> {
  const where = feeLevelWhere(level);
  const [rows, waiting] = await Promise.all([
    db
      .select(versionColumns)
      .from(feeConfigVersions)
      .innerJoin(feeChanges, eq(feeChanges.id, feeConfigVersions.changeId))
      .where(and(where, DATED_LIVE))
      .orderBy(desc(feeChanges.effectiveFrom), desc(feeChanges.createdAt)),
    db
      .select({ id: feeChanges.id })
      .from(feeChanges)
      .where(and(where, WAITING_RISE))
      .limit(1),
  ]);
  return { versions: rows.map(toDated), waiting: waiting.length > 0 };
}

/** Every level of one scope, in one query each, keyed by `feeLevelKey`. */
export async function readFeeVersionsByLevel(
  db: Queryable,
  scope: 'org' | 'creator',
  filter?: SQL
): Promise<Map<string, FeeVersionList>> {
  const where = and(eq(feeChanges.scope, scope), filter);
  const [rows, waiting] = await Promise.all([
    db
      .select({
        ...versionColumns,
        organizationId: feeChanges.organizationId,
        creatorId: feeChanges.creatorId,
      })
      .from(feeConfigVersions)
      .innerJoin(feeChanges, eq(feeChanges.id, feeConfigVersions.changeId))
      .where(and(where, DATED_LIVE))
      .orderBy(desc(feeChanges.effectiveFrom), desc(feeChanges.createdAt)),
    db
      .select({
        organizationId: feeChanges.organizationId,
        creatorId: feeChanges.creatorId,
      })
      .from(feeChanges)
      .where(and(where, WAITING_RISE)),
  ]);
  const keyOf = (row: {
    organizationId: string | null;
    creatorId: string | null;
  }): string | null => {
    if (row.organizationId === null) return null;
    if (scope === 'org') {
      return feeLevelKey({ scope, organizationId: row.organizationId });
    }
    if (row.creatorId === null) return null;
    return feeLevelKey({
      scope,
      organizationId: row.organizationId,
      creatorId: row.creatorId,
    });
  };
  const lists = new Map<string, FeeVersionList>();
  const listFor = (key: string): FeeVersionList => {
    let list = lists.get(key);
    if (!list) {
      list = { versions: [], waiting: false };
      lists.set(key, list);
    }
    return list;
  };
  for (const row of rows) {
    const key = keyOf(row);
    if (key) listFor(key).versions.push(toDated(row));
  }
  for (const row of waiting) {
    const key = keyOf(row);
    if (key) listFor(key).waiting = true;
  }
  return lists;
}

/** A reader straight from the database (no cache). */
export function dbFeeVersionReader(db: Queryable): FeeVersionReader {
  return (level) => readFeeVersions(db, level);
}

/** The version in force at `at`: the newest dated no later than it. */
export function versionInForce(
  list: FeeVersionList | undefined,
  at: Date
): DatedFeeVersion | null {
  if (!list) return null;
  const t = at.getTime();
  for (const version of list.versions) {
    if (Date.parse(version.effectiveFrom) <= t) return version;
  }
  return null;
}

// ─── Layering ────────────────────────────────────────────────────────────────

/** The code constants: what a level with no version resolves to. */
export function codeDefaultFees(ctx: FeeContext): FeeValues {
  return {
    platformFeePercent: FEES.PLATFORM_PERCENT,
    orgFeePercent:
      ctx === 'subscription' ? FEES.SUBSCRIPTION_ORG_PERCENT : FEES.ORG_PERCENT,
    minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
    minTransferCents: 0,
  };
}

/** The platform's full values with no version: the code constants. */
export const CODE_DEFAULT_PLATFORM: Readonly<FeeVersionValues> = Object.freeze({
  platformFeePercent: FEES.PLATFORM_PERCENT,
  oneOffOrgFeePercent: FEES.ORG_PERCENT,
  subscriptionOrgFeePercent: FEES.SUBSCRIPTION_ORG_PERCENT,
  orgFeePercent: null,
  minPlatformFeeCents: FEES.MIN_PLATFORM_FEE_CENTS,
  minTransferCents: 0,
});

/**
 * Layer the levels for one kind of sale: the platform's values over the code
 * constants, then each override over the result, column by column. A NULL
 * (or a missing level) inherits.
 */
export function layerFees(
  ctx: FeeContext,
  platform: FeeVersionValues | null,
  ...overrides: Array<FeeVersionValues | null>
): FeeValues {
  const base = codeDefaultFees(ctx);
  let fees: FeeValues = platform
    ? {
        platformFeePercent:
          platform.platformFeePercent ?? base.platformFeePercent,
        orgFeePercent:
          (ctx === 'subscription'
            ? platform.subscriptionOrgFeePercent
            : platform.oneOffOrgFeePercent) ?? base.orgFeePercent,
        minPlatformFeeCents:
          platform.minPlatformFeeCents ?? base.minPlatformFeeCents,
        minTransferCents: platform.minTransferCents ?? base.minTransferCents,
      }
    : base;
  for (const override of overrides) {
    if (!override) continue;
    fees = {
      platformFeePercent:
        override.platformFeePercent ?? fees.platformFeePercent,
      orgFeePercent: override.orgFeePercent ?? fees.orgFeePercent,
      minPlatformFeeCents:
        override.minPlatformFeeCents ?? fees.minPlatformFeeCents,
      minTransferCents: override.minTransferCents ?? fees.minTransferCents,
    };
  }
  return fees;
}

/** Both kinds of sale at once, for a write's comparison. */
export function layerLevelFees(
  platform: FeeVersionValues | null,
  ...overrides: Array<FeeVersionValues | null>
): LevelFees {
  return {
    oneOff: layerFees('one_off', platform, ...overrides),
    subscription: layerFees('subscription', platform, ...overrides),
  };
}

/**
 * The fees in force at `at`. With an organisation, the creator's override in
 * it (when a creator is given) and the organisation's values layer over the
 * platform's; with none, the platform's alone (an orgless sale).
 */
export async function resolveFeesAt(
  read: FeeVersionReader,
  params: {
    organizationId?: string | null;
    creatorId?: string | null;
    ctx: FeeContext;
    at: Date;
  }
): Promise<FeeValues> {
  const { organizationId, creatorId, ctx, at } = params;
  const [platform, org, creator] = await Promise.all([
    read({ scope: 'platform' }),
    organizationId ? read({ scope: 'org', organizationId }) : null,
    organizationId && creatorId
      ? read({ scope: 'creator', organizationId, creatorId })
      : null,
  ]);
  return layerFees(
    ctx,
    versionInForce(platform, at),
    org ? versionInForce(org, at) : null,
    creator ? versionInForce(creator, at) : null
  );
}

// ─── Classifying a write (F1, F2, F9) ────────────────────────────────────────

export type FeeWriteOutcome =
  /** No waiting rise, nothing higher than today: dated now, nobody told. */
  | 'cut'
  /** No waiting rise, something higher (F1: the whole change waits). */
  | 'rise'
  /** A waiting rise, and this write is today's fees exactly: the rise is off. */
  | 'cancelled'
  /** A waiting rise, and this write is below today's somewhere, above nowhere. */
  | 'cut_below_today'
  /** A waiting rise made smaller (F2): same change, same date or clock. */
  | 'smaller'
  /** A waiting rise restated with no figure changed: same change, no email. */
  | 'same_as_waiting'
  /** Higher than the waiting rise somewhere: it's replaced, a new 30 days. */
  | 'bigger';

const COMPARED: ReadonlyArray<keyof FeeValues> = [
  'platformFeePercent',
  'orgFeePercent',
  'minPlatformFeeCents',
  'minTransferCents',
];

/**
 * Whether `next` is higher and/or lower than `prev` anywhere, over every
 * value of both kinds of sale. The minimum transfer counts too (F9), and so
 * does any value cleared back to an inherited higher one.
 */
export function compareLevelFees(
  next: LevelFees,
  prev: LevelFees
): { higher: boolean; lower: boolean } {
  let higher = false;
  let lower = false;
  for (const ctx of ['oneOff', 'subscription'] as const) {
    for (const key of COMPARED) {
      if (next[ctx][key] > prev[ctx][key]) higher = true;
      if (next[ctx][key] < prev[ctx][key]) lower = true;
    }
  }
  return { higher, lower };
}

/**
 * Data design §1.3's table. T is in force now, P the waiting rise at this
 * level (or null), N this write applied over P if there is one, else over T.
 */
export function classifyFeeWrite(
  t: LevelFees,
  p: LevelFees | null,
  n: LevelFees
): FeeWriteOutcome {
  const againstToday = compareLevelFees(n, t);
  if (!p) return againstToday.higher ? 'rise' : 'cut';
  if (!againstToday.higher) {
    return againstToday.lower ? 'cut_below_today' : 'cancelled';
  }
  const againstWaiting = compareLevelFees(n, p);
  if (againstWaiting.higher) return 'bigger';
  return againstWaiting.lower ? 'smaller' : 'same_as_waiting';
}

// ─── When a rise starts ──────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** A rise applies to sales this long after the last person is told. */
export const FEE_RISE_NOTICE_DAYS = 30;

const londonParts_ = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function wallClock(at: Date): number {
  const parts: Record<string, number> = {};
  for (const part of londonParts_.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0
  );
}

/** 00:00 London on a London calendar date (month 1-12; day may overflow). */
function londonMidnightOn(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day);
  // The clocks change at 01:00 UTC, so midnight's offset is the guess's.
  return new Date(guess - (wallClock(new Date(guess)) - guess));
}

/**
 * The first UK midnight at least 30 days after `told` (Q1): the day a rise
 * starts when `told` is the last person's notice, and the earliest date an
 * email sent at `told` can name.
 */
export function feeRiseStartAfter(told: Date): Date {
  const due = new Date(told.getTime() + FEE_RISE_NOTICE_DAYS * DAY_MS);
  const wall = new Date(wallClock(due));
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth() + 1;
  const d = wall.getUTCDate();
  const midnight = londonMidnightOn(y, m, d);
  return midnight.getTime() >= due.getTime()
    ? midnight
    : londonMidnightOn(y, m, d + 1);
}

/**
 * The next 08:00 UTC: when notifications-api's daily run sends a new rise's
 * first emails (the cron is `0 8 * * *`, UTC).
 */
export function nextFeeNoticeRunAfter(at: Date): Date {
  const today = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
    8
  );
  return new Date(today > at.getTime() ? today : today + DAY_MS);
}

// ─── The email's worked example ──────────────────────────────────────────────

/**
 * A one-off sale with no revenue-share agreement, split as the purchase path
 * splits it (`calculateRevenueSplit` then `applyMinPlatformFeeFloor`): the
 * platform and organisation fees round up, the floor's shortfall comes from
 * the creator first, then the organisation. An orgless sale has no
 * organisation slice. fees-and-splits.md's table is its test.
 */
export function exampleOneOffSplit(
  fees: FeeValues,
  grossCents: number,
  orgless: boolean
): { platformCents: number; orgCents: number; creatorCents: number } {
  const platform = Math.ceil((grossCents * fees.platformFeePercent) / 10000);
  const pool = grossCents - platform;
  const org = orgless ? 0 : Math.ceil((pool * fees.orgFeePercent) / 10000);
  let creator = grossCents - platform - org;
  let orgCents = org;
  const floor = Math.min(fees.minPlatformFeeCents, grossCents);
  let platformCents = platform;
  if (floor > platform) {
    const shortfall = floor - platform;
    const fromCreator = Math.min(shortfall, creator);
    const fromOrg = Math.min(shortfall - fromCreator, orgCents);
    creator -= fromCreator;
    orgCents -= fromOrg;
    platformCents = floor;
  }
  return { platformCents, orgCents, creatorCents: creator };
}
