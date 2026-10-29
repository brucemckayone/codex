/**
 * The daily money sweep (Codex-2hxff.34, .30; batch B data design §2.3, §5.2).
 *
 * Runs on the existing `0 8 * * *` cron, after the agreement sweep and
 * isolated from it. It sends:
 *   - `payouts-waiting`: at most once a London month, to a person whose money
 *     has waited 30 days or more for payouts to be set up and who has had no
 *     reminder in the last 21 days (the guard stops 31 Oct and 1 Nov both
 *     sending);
 *   - `stripe-balance-below-zero`: once per negative episode the daily payout
 *     job recorded on `connect_balances`;
 *   - `stripe-balance-recovered` / `debt-written-off`: once, when that
 *     episode ends.
 *
 * Why here and not in ecom-api, whose job sees the balance: production
 * deploys ecom-api before notifications-api, so an ecom-api sender could call
 * the OLD notifications-api with fields its allowlist doesn't know yet, and
 * they would render blank. Here the sender and the allowlist are one worker.
 * The cost is a day's lag: the job writes the episode, the sweep reads it the
 * same morning in summer (07:00 UTC job, 08:00 UTC sweep) or the next one in
 * winter (both at 08:00 UTC).
 *
 * Every send is claim-then-send, at most once: `INSERT … ON CONFLICT DO
 * NOTHING RETURNING id` on `money_notices`, and only the run that inserted
 * sends, then records `sent_at` or `failed_at`. Nothing is retried: a lost
 * reminder is covered by next month's, a lost balance email by the Studio
 * card. A kind whose template is missing (an environment whose seed has not
 * run) is skipped before anything is claimed, so it never burns a month.
 *
 * Never throws: it runs inside `waitUntil` from `scheduled()`. Errors are
 * logged and counted.
 */

import { isEnvName } from '@codex/agreements';
import {
  and,
  createDbClient,
  type Database,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  messageForLog,
  sql,
} from '@codex/database';
import {
  connectBalances,
  type MoneyNoticeKind,
  moneyNotices,
  users,
} from '@codex/database/schema';
import { TemplateRepository } from '@codex/notifications';
import { ObservabilityClient } from '@codex/observability';
import {
  DEBT_INVOICE_THRESHOLD_CENTS,
  episodeTakeBacks,
  londonDate,
  type WaitingMoney,
  waitingMoney,
} from '@codex/payments';
import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import {
  buildOrgUrlFromEnv,
  type EnvName,
  buildServiceUrl as getServiceUrl,
} from '@codex/urls';
import {
  belowZeroData,
  episodeKey,
  episodeOf,
  greetingName,
  recoveredData,
  type TakeBack,
  waitingReminderData,
  writtenOffData,
} from './money-notice-copy';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A person is reminded once their oldest waiting row is this old (Q5). */
const REMIND_AFTER_DAYS = 30;
/** No second reminder within this many days, whatever the month. */
const REMIND_GUARD_DAYS = 21;
/** How far back an ended episode is still worth an email. */
const ENDED_LOOKBACK_DAYS = 30;
const PAGE_SIZE = 100;
/**
 * 5,000 people a run. The page itself leaves out anyone reminded in the last
 * 21 days, so tomorrow's run starts at the people today's didn't reach
 * (review MED-2: re-paging the same reminded people never reached the rest).
 */
const MAX_PAGES = 50;
/** A claim with neither sent_at nor failed_at after this long was lost mid-send. */
const ORPHANED_CLAIM_MS = 60 * 60 * 1000;
/** How far back an orphaned claim is still reported. */
const ORPHANED_LOOKBACK_DAYS = 30;

/** The kinds this sweep sends, and their templates. */
const TEMPLATE_FOR = {
  payouts_waiting: 'payouts-waiting',
  balance_below_zero: 'stripe-balance-below-zero',
  balance_recovered: 'stripe-balance-recovered',
  balance_written_off: 'debt-written-off',
} as const satisfies Partial<Record<MoneyNoticeKind, string>>;

type SweepKind = keyof typeof TEMPLATE_FOR;
type MoneyTemplate = (typeof TEMPLATE_FOR)[SweepKind];

export interface MoneyMailerParams {
  to: string;
  toName?: string;
  templateName: MoneyTemplate;
  category: 'transactional';
  userId: string;
  organizationId: null;
  data: Record<string, string | number | boolean>;
}

export type MoneyMailer = (params: MoneyMailerParams) => Promise<void>;

export interface RunMoneyNoticesSweepDeps {
  db: Database;
  obs: ObservabilityClient;
  /** Builds the Earnings link in every email. */
  environment: EnvName;
  workerSecret: string;
  notificationsUrl: string;
  /** Now override (testing only). */
  now?: Date;
  /** Default: worker-to-worker POST to this worker's /internal/send. */
  mailer?: MoneyMailer;
  /** Default: a live global template of that name exists. */
  templateExists?: (name: MoneyTemplate) => Promise<boolean>;
  /** Testing only. */
  pageSize?: number;
  /** Testing only. */
  maxPages?: number;
}

export interface MoneyNoticesSweepResult {
  remindersSent: number;
  balanceEmailsSent: number;
  /** Claimed, then the send failed: recorded as failed, not retried. */
  sendsFailed: number;
  /** Kinds skipped because their template is missing. */
  skippedKinds: SweepKind[];
  /** Claims found lost between the claim and the send (reported, not resent). */
  orphanedClaims: number;
  errors: number;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function makeDefaultMailer(deps: {
  notificationsUrl: string;
  workerSecret: string;
}): MoneyMailer {
  return async (params) => {
    const res = await workerFetch(
      `${deps.notificationsUrl}/internal/send`,
      { method: 'POST', body: JSON.stringify(params) },
      deps.workerSecret
    );
    if (!res.ok) {
      throw new Error(
        `notifications-api /internal/send returned ${res.status}`
      );
    }
  };
}

interface SweepContext {
  db: Database;
  obs: ObservabilityClient;
  mailer: MoneyMailer;
  now: Date;
  dashboardUrl: string;
  pageSize: number;
  maxPages: number;
  result: MoneyNoticesSweepResult;
}

interface Recipient {
  id: string;
  name: string | null;
  email: string;
}

/** Claim the notice; null when another run (or an earlier day) holds it. */
async function claim(
  ctx: SweepContext,
  userId: string,
  kind: SweepKind,
  periodKey: string,
  amountCents: number | null
): Promise<string | null> {
  const [row] = await ctx.db
    .insert(moneyNotices)
    .values({ userId, kind, periodKey, amountCents })
    .onConflictDoNothing({
      target: [moneyNotices.userId, moneyNotices.kind, moneyNotices.periodKey],
    })
    .returning({ id: moneyNotices.id });
  return row?.id ?? null;
}

/** Send a claimed notice once, and record how it went. */
async function sendClaimed(
  ctx: SweepContext,
  noticeId: string,
  kind: SweepKind,
  to: Recipient,
  data: Record<string, string>
): Promise<boolean> {
  try {
    await ctx.mailer({
      to: to.email,
      toName: to.name ?? undefined,
      templateName: TEMPLATE_FOR[kind],
      category: 'transactional',
      userId: to.id,
      organizationId: null,
      data,
    });
  } catch (error) {
    ctx.result.sendsFailed += 1;
    ctx.obs.error('money notice send failed; it is not retried', {
      errorId: crypto.randomUUID(),
      kind,
      moneyNoticeId: noticeId,
      error: messageForLog(error),
    });
    await ctx.db
      .update(moneyNotices)
      .set({ failedAt: new Date() })
      .where(eq(moneyNotices.id, noticeId))
      .catch((markError: unknown) => {
        ctx.result.errors += 1;
        ctx.obs.error('money notice failure could not be recorded', {
          errorId: crypto.randomUUID(),
          kind,
          moneyNoticeId: noticeId,
          error: messageForLog(markError),
        });
      });
    return false;
  }
  try {
    await ctx.db
      .update(moneyNotices)
      .set({ sentAt: new Date() })
      .where(eq(moneyNotices.id, noticeId));
  } catch (markError) {
    // The email went; only its record is missing. The claim still stops a
    // second send.
    ctx.result.errors += 1;
    ctx.obs.error('money notice sent, but its sent_at could not be recorded', {
      errorId: crypto.randomUUID(),
      kind,
      moneyNoticeId: noticeId,
      error: messageForLog(markError),
    });
  }
  ctx.obs.info('money notice sent', { kind, moneyNoticeId: noticeId });
  return true;
}

async function recipientsOf(
  db: Database,
  userIds: string[]
): Promise<Map<string, Recipient>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
  return new Map(rows.map((row) => [row.id, row]));
}

// ─── The monthly reminder ───────────────────────────────────────────────────

async function sendWaitingReminders(ctx: SweepContext): Promise<void> {
  const olderThan = new Date(ctx.now.getTime() - REMIND_AFTER_DAYS * DAY_MS);
  const guardSince = new Date(ctx.now.getTime() - REMIND_GUARD_DAYS * DAY_MS);
  const periodKey = londonDate(ctx.now).slice(0, 7);
  const { pageSize, maxPages } = ctx;
  let afterUserId: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    // Anyone reminded in the last 21 days is left out of the page itself.
    const people: WaitingMoney[] = await waitingMoney(ctx.db, {
      olderThan,
      afterUserId,
      limit: pageSize,
      notRemindedSince: guardSince,
    });
    if (people.length === 0) return;
    afterUserId = people[people.length - 1]?.userId ?? null;
    const recipients = await recipientsOf(
      ctx.db,
      people.map((p) => p.userId)
    );

    for (const person of people) {
      try {
        const to = recipients.get(person.userId);
        if (!to) continue;
        const noticeId = await claim(
          ctx,
          person.userId,
          'payouts_waiting',
          periodKey,
          person.totalCents
        );
        if (!noticeId) continue;
        const data = waitingReminderData(
          person,
          greetingName(to.name),
          ctx.dashboardUrl
        );
        if (await sendClaimed(ctx, noticeId, 'payouts_waiting', to, data)) {
          ctx.result.remindersSent += 1;
        }
      } catch (error) {
        ctx.result.errors += 1;
        ctx.obs.error('payouts-waiting reminder failed for one person', {
          errorId: crypto.randomUUID(),
          userId: person.userId,
          error: messageForLog(error),
        });
      }
    }
    if (people.length < pageSize) return;
  }
  ctx.obs.warn('payouts-waiting: page cap reached; the rest go tomorrow', {
    maxPages,
    pageSize,
  });
}

// ─── The balance emails ─────────────────────────────────────────────────────

async function sendBelowZero(
  ctx: SweepContext,
  enabled: ReadonlySet<SweepKind>
): Promise<void> {
  if (!enabled.has('balance_below_zero')) return;
  const open = await ctx.db
    .select({
      stripeAccountId: connectBalances.stripeAccountId,
      userId: connectBalances.userId,
      availableCents: connectBalances.availableCents,
      negativeSince: connectBalances.negativeSince,
      negativeAfter: connectBalances.negativeAfter,
    })
    .from(connectBalances)
    .where(sql`${connectBalances.negativeSince} IS NOT NULL`);
  if (open.length === 0) return;

  const ids = [...new Set(open.map((row) => row.userId))];
  const [recipients, noticed] = await Promise.all([
    recipientsOf(ctx.db, ids),
    ctx.db
      .select({ periodKey: moneyNotices.periodKey })
      .from(moneyNotices)
      .where(
        and(
          eq(moneyNotices.kind, 'balance_below_zero'),
          inArray(moneyNotices.userId, ids)
        )
      ),
  ]);
  const alreadyNoticed = new Set(noticed.map((n) => n.periodKey));

  for (const row of open) {
    try {
      const since = row.negativeSince;
      const available = row.availableCents;
      // The job sets both together; a row without them is not an episode.
      if (since === null || available === null || available >= 0) continue;
      const key = episodeKey(row.stripeAccountId, since, row.negativeAfter);
      if (alreadyNoticed.has(key)) continue;
      const to = recipients.get(row.userId);
      if (!to) continue;
      const owed = -available;
      // The one rule Studio's below-zero card reads too, so they agree.
      const takeBacks = await episodeTakeBacks(ctx.db, {
        userId: row.userId,
        negativeSince: since,
        negativeAfter: row.negativeAfter,
      });
      const noticeId = await claim(
        ctx,
        row.userId,
        'balance_below_zero',
        key,
        owed
      );
      if (!noticeId) continue;
      const data = belowZeroData({
        userName: greetingName(to.name),
        availableCents: available,
        negativeSince: since,
        takeBacks,
        dashboardUrl: ctx.dashboardUrl,
      });
      if (await sendClaimed(ctx, noticeId, 'balance_below_zero', to, data)) {
        ctx.result.balanceEmailsSent += 1;
      }
    } catch (error) {
      ctx.result.errors += 1;
      ctx.obs.error('stripe-balance-below-zero failed for one account', {
        errorId: crypto.randomUUID(),
        stripeAccountId: row.stripeAccountId,
        error: messageForLog(error),
      });
    }
  }
}

async function sendEpisodeEnded(
  ctx: SweepContext,
  enabled: ReadonlySet<SweepKind>
): Promise<void> {
  if (
    !enabled.has('balance_recovered') &&
    !enabled.has('balance_written_off')
  ) {
    return;
  }
  const since = new Date(ctx.now.getTime() - ENDED_LOOKBACK_DAYS * DAY_MS);
  const ended = await ctx.db
    .select({
      stripeAccountId: connectBalances.stripeAccountId,
      userId: connectBalances.userId,
      availableCents: connectBalances.availableCents,
      clearedAt: connectBalances.clearedAt,
      clearedReason: connectBalances.clearedReason,
      // What was still owed at the last check before it ended: what Stripe
      // collected from the platform, so what was written off.
      clearedOwedCents: connectBalances.clearedOwedCents,
    })
    .from(connectBalances)
    .where(
      and(
        gte(connectBalances.clearedAt, since),
        // Negative again: that episode is the one that matters now.
        sql`${connectBalances.negativeSince} IS NULL`
      )
    );
  if (ended.length === 0) return;

  const ids = [...new Set(ended.map((row) => row.userId))];
  const [recipients, notices] = await Promise.all([
    recipientsOf(ctx.db, ids),
    ctx.db
      .select({
        userId: moneyNotices.userId,
        kind: moneyNotices.kind,
        periodKey: moneyNotices.periodKey,
        amountCents: moneyNotices.amountCents,
        createdAt: moneyNotices.createdAt,
      })
      .from(moneyNotices)
      .where(
        and(
          inArray(moneyNotices.userId, ids),
          inArray(moneyNotices.kind, [
            'balance_below_zero',
            'balance_recovered',
            'balance_written_off',
          ])
        )
      )
      .orderBy(desc(moneyNotices.createdAt)),
  ]);

  for (const row of ended) {
    try {
      const clearedAt = row.clearedAt;
      if (clearedAt === null) continue;
      const kind: SweepKind =
        row.clearedReason === 'stripe_collected'
          ? 'balance_written_off'
          : 'balance_recovered';
      if (!enabled.has(kind)) continue;
      // The episode is the one its below-zero email named: the latest for
      // this account claimed before it ended. A person never told it went
      // below zero is not told it recovered.
      const belowZero = notices.find(
        (n) =>
          n.kind === 'balance_below_zero' &&
          n.userId === row.userId &&
          n.periodKey.startsWith(`${row.stripeAccountId}:`) &&
          n.createdAt.getTime() <= clearedAt.getTime()
      );
      if (!belowZero) continue;
      const key = belowZero.periodKey;
      if (notices.some((n) => n.kind === kind && n.periodKey === key)) continue;
      const to = recipients.get(row.userId);
      if (!to) continue;

      // The episode's take-back, for the cause line (M9, M10): the window
      // the below-zero email used, from its key, so both name the same one.
      const episode = episodeOf(key);
      const takeBacks: TakeBack[] = episode
        ? await episodeTakeBacks(ctx.db, { userId: row.userId, ...episode })
        : [];

      let data: Record<string, string>;
      let amount: number | null;
      if (kind === 'balance_written_off') {
        amount = row.clearedOwedCents;
        if (amount === null) {
          // B1's clearing write records the figure; without it there is no
          // true amount to state, so nothing is sent.
          ctx.obs.warn(
            'debt-written-off skipped: no written-off figure on record',
            {
              errorId: crypto.randomUUID(),
              stripeAccountId: row.stripeAccountId,
            }
          );
          continue;
        }
        if (amount > DEBT_INVOICE_THRESHOLD_CENTS) {
          // Over £50 is not written off (§14, Q4): the clearing write adds it
          // to `collected_owed_cents`, and Creator debts holds the person as
          // `to_invoice` until invoices ship (AMENDMENT 2). "You don't owe
          // it" would be false.
          ctx.obs.info(
            'debt-written-off not sent: over £50, held for invoice',
            {
              stripeAccountId: row.stripeAccountId,
            }
          );
          continue;
        }
        data = writtenOffData({
          userName: greetingName(to.name),
          writtenOffCents: amount,
          availableCents: row.availableCents ?? 0,
          negativeSince: episode?.negativeSince ?? clearedAt,
          takeBacks,
          dashboardUrl: ctx.dashboardUrl,
        });
      } else {
        amount = row.availableCents;
        data = recoveredData({
          userName: greetingName(to.name),
          availableCents: row.availableCents ?? 0,
          leftCents: belowZero.amountCents,
          takeBacks,
          dashboardUrl: ctx.dashboardUrl,
        });
      }
      const noticeId = await claim(ctx, row.userId, kind, key, amount);
      if (!noticeId) continue;
      if (await sendClaimed(ctx, noticeId, kind, to, data)) {
        ctx.result.balanceEmailsSent += 1;
      }
    } catch (error) {
      ctx.result.errors += 1;
      ctx.obs.error('balance episode-ended email failed for one account', {
        errorId: crypto.randomUUID(),
        stripeAccountId: row.stripeAccountId,
        error: messageForLog(error),
      });
    }
  }
}

// ─── The run ────────────────────────────────────────────────────────────────

/**
 * Claims lost between the claim and the send (a deploy or an isolate kill in
 * between): neither `sent_at` nor `failed_at` an hour on. Nothing resends
 * them, so each is reported with an errorId (review LOW-3). Every kind,
 * including purchase-service's first-sale claim.
 */
async function reportOrphanedClaims(
  db: Database,
  obs: ObservabilityClient,
  now: Date,
  result: MoneyNoticesSweepResult
): Promise<void> {
  const before = new Date(now.getTime() - ORPHANED_CLAIM_MS);
  const after = new Date(now.getTime() - ORPHANED_LOOKBACK_DAYS * DAY_MS);
  const orphans = await db
    .select({
      id: moneyNotices.id,
      kind: moneyNotices.kind,
      createdAt: moneyNotices.createdAt,
    })
    .from(moneyNotices)
    .where(
      and(
        isNull(moneyNotices.sentAt),
        isNull(moneyNotices.failedAt),
        lte(moneyNotices.createdAt, before),
        gte(moneyNotices.createdAt, after)
      )
    )
    .limit(50);
  for (const orphan of orphans) {
    result.orphanedClaims += 1;
    obs.error(
      'money notice claimed but never sent or failed; it is not resent',
      {
        errorId: crypto.randomUUID(),
        moneyNoticeId: orphan.id,
        kind: orphan.kind,
        claimedAt: orphan.createdAt.toISOString(),
      }
    );
  }
}

/** The kinds whose template exists, checked once per run before any claim. */
async function enabledKinds(
  deps: RunMoneyNoticesSweepDeps,
  result: MoneyNoticesSweepResult
): Promise<Set<SweepKind>> {
  const repository = new TemplateRepository(deps.db);
  const exists =
    deps.templateExists ??
    (async (name: MoneyTemplate) =>
      (await repository.findTemplate(name, null, null)) !== null);
  const enabled = new Set<SweepKind>();
  for (const kind of Object.keys(TEMPLATE_FOR) as SweepKind[]) {
    if (await exists(TEMPLATE_FOR[kind])) {
      enabled.add(kind);
    } else {
      result.skippedKinds.push(kind);
      deps.obs.warn('money sweep: template missing, kind skipped', {
        kind,
        templateName: TEMPLATE_FOR[kind],
      });
    }
  }
  return enabled;
}

export async function runMoneyNoticesSweep(
  deps: RunMoneyNoticesSweepDeps
): Promise<MoneyNoticesSweepResult> {
  const result: MoneyNoticesSweepResult = {
    remindersSent: 0,
    balanceEmailsSent: 0,
    sendsFailed: 0,
    skippedKinds: [],
    orphanedClaims: 0,
    errors: 0,
  };
  const now = deps.now ?? new Date();
  try {
    await reportOrphanedClaims(deps.db, deps.obs, now, result).catch(
      (error: unknown) => {
        result.errors += 1;
        deps.obs.error('money sweep: the orphaned-claim check failed', {
          errorId: crypto.randomUUID(),
          error: messageForLog(error),
        });
      }
    );
    const enabled = await enabledKinds(deps, result);
    const ctx: SweepContext = {
      db: deps.db,
      obs: deps.obs,
      mailer:
        deps.mailer ??
        makeDefaultMailer({
          notificationsUrl: deps.notificationsUrl,
          workerSecret: deps.workerSecret,
        }),
      now,
      pageSize: deps.pageSize ?? PAGE_SIZE,
      maxPages: deps.maxPages ?? MAX_PAGES,
      dashboardUrl: buildOrgUrlFromEnv(
        deps.environment,
        'creators',
        '/studio/earnings'
      ),
      result,
    };
    // Each part is isolated: one failing never stops the others.
    const parts: Array<[string, () => Promise<void>]> = [
      [
        'payouts-waiting',
        () =>
          enabled.has('payouts_waiting')
            ? sendWaitingReminders(ctx)
            : Promise.resolve(),
      ],
      ['balance-below-zero', () => sendBelowZero(ctx, enabled)],
      ['balance-episode-ended', () => sendEpisodeEnded(ctx, enabled)],
    ];
    for (const [part, run] of parts) {
      try {
        await run();
      } catch (error) {
        result.errors += 1;
        deps.obs.error('money sweep part failed', {
          errorId: crypto.randomUUID(),
          part,
          error: messageForLog(error),
        });
      }
    }
    deps.obs.info('money sweep completed', { ...result });
  } catch (error) {
    result.errors += 1;
    deps.obs.error('money sweep failed at top level', {
      errorId: crypto.randomUUID(),
      error: messageForLog(error),
    });
  }
  return result;
}

/**
 * Scheduled entry point: builds the clients from env, skips cleanly on
 * missing config, and runs the sweep.
 */
export async function runScheduledMoneyNoticesSweep(
  env: Bindings
): Promise<MoneyNoticesSweepResult | null> {
  const obs = new ObservabilityClient(
    'notifications-api',
    env.ENVIRONMENT ?? 'development'
  );
  const environment = env.ENVIRONMENT ?? 'development';
  if (
    !env.DATABASE_URL ||
    !env.WORKER_SHARED_SECRET ||
    !isEnvName(environment)
  ) {
    obs.error('money sweep: missing required env vars, skipping', {
      errorId: crypto.randomUUID(),
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      hasWorkerSecret: Boolean(env.WORKER_SHARED_SECRET),
      hasKnownEnvironment: isEnvName(environment),
    });
    return null;
  }
  return runMoneyNoticesSweep({
    db: createDbClient(env),
    obs,
    environment,
    workerSecret: env.WORKER_SHARED_SECRET,
    notificationsUrl: getServiceUrl('notifications', env),
  });
}
