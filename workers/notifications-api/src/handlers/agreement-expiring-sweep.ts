/**
 * Agreement-Expiring-Soon Cron Handler (Codex-tugez)
 *
 * Closes the WP-5 deferral. A daily Cloudflare Worker cron scans active
 * revenue-share agreements approaching their term-end and fires the
 * `agreement-expiring-soon` email to BOTH parties (the creator named on
 * the row + the first active owner of the org).
 *
 * Idempotency: after a successful dispatch the handler marks the row's
 * `expiring_soon_email_sent_at` so re-running the sweep does NOT re-send.
 * Per-row failures are logged + counted, but do NOT short-circuit the
 * sweep — the next row still gets a fair shot.
 *
 * A row left unmarked is tried the next morning, one SIDE at a time: each
 * email carries `agreementId` and `side` in its data, which the email log
 * keeps, and a side the log shows sent (or in flight) is not sent again
 * (`makeAlreadySent`, the fee step's `foundSent` pattern). So when the
 * owner's email fails after the creator's went, the next morning sends the
 * owner's alone, not the creator's again (final review #4).
 *
 * Time (Codex-2hxff.100): each send waits SEND_TIMEOUT_MS at most, and no
 * row starts after SENDS_TIME_BUDGET_MS from the wake, so the money sweep
 * and the fee step after this one keep their time. A row is marked only
 * after its sends, so a row timed out or not reached is tried the next
 * morning. A timed-out send may still have gone; if it reached the email
 * log, that side is not sent again.
 *
 * Error handling: NEVER throws. The function is invoked from
 * `scheduled()` inside a `waitUntil` chain — if we throw, the cron
 * invocation crashes mid-cycle and skips its observability logging.
 * All errors are logged via ObservabilityClient and counted in the
 * returned tally.
 */

import {
  AgreementService,
  type AgreementWithShare,
  buildAgreementEmailLink,
  isEnvName,
} from '@codex/agreements';
import {
  and,
  createDbClient,
  type Database,
  eq,
  gte,
  inArray,
  messageForLog,
  sql,
} from '@codex/database';
import { emailAuditLogs } from '@codex/database/schema';
import { ObservabilityClient } from '@codex/observability';
import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import { type EnvName, buildServiceUrl as getServiceUrl } from '@codex/urls';
import { runScheduledFeeNoticesSweep } from './fee-notices-sweep';
import { runScheduledMoneyNoticesSweep } from './money-notices-sweep';
import { SEND_TIMEOUT_MS, SENDS_TIME_BUDGET_MS } from './send-limits';

/**
 * Default warning lead time — fire the email when an agreement is within
 * this many days of `effective_until`. 30 days lines up with the typical
 * monthly billing cycle so renewal/renegotiation has at least one full
 * cycle to land before lapse.
 */
const DEFAULT_DAYS_AHEAD = 30;

const TEMPLATE = 'agreement-expiring-soon';

/** Which party an agreement's expiry email is for. */
type AgreementSide = 'creator' | 'owner';

/** Is this side's email for this agreement already in the email log? */
type AlreadySent = (args: {
  to: string;
  agreementId: string;
  side: AgreementSide;
  /** No email about the agreement can predate this. */
  since: Date;
}) => Promise<boolean>;

export interface RunAgreementExpiringSweepDeps {
  /** Pre-constructed DB client (per-request HTTP client) */
  db: Database;
  /** Observability client (PII-redacted) */
  obs: ObservabilityClient;
  /**
   * The env name. It builds each recipient's email link (the owner's org
   * Studio, the creator's negotiation), so the scheduled handler skips the
   * sweep when `env.ENVIRONMENT` is not one `@codex/urls` can route.
   */
  environment: EnvName;
  /** HMAC secret for worker-to-worker /internal/send call */
  workerSecret: string;
  /** Notifications-api base URL (resolved via getServiceUrl) */
  notificationsUrl: string;
  /** Optional override for the lead time (mainly for tests) */
  daysAhead?: number;
  /** Now override (testing only) */
  now?: Date;
  /**
   * Mailer thunk — injected for unit-testability. Default sends via
   * worker-to-worker fetch to notifications-api /internal/send.
   */
  mailer?: (params: {
    to: string;
    toName?: string;
    templateName: 'agreement-expiring-soon';
    category: 'transactional';
    userId?: string;
    organizationId?: string | null;
    data: Record<string, string | number | boolean>;
  }) => Promise<void>;
  /** Real time, for the send budget (testing only). */
  clock?: () => number;
  /**
   * When the 08:00 invocation started (ms since the epoch): the send budget
   * counts from it. Default: the sweep's own start.
   */
  wakeStartedAt?: number;
  /** Testing only. */
  sendTimeoutMs?: number;
  /** The email-log lookup (testing only). Default: {@link makeAlreadySent}. */
  alreadySent?: AlreadySent;
}

export interface ExpiringSweepResult {
  agreementsScanned: number;
  emailsSent: number;
  /** Sides not sent again: the email log shows an earlier morning sent them. */
  emailsAlreadySent: number;
  agreementsMarked: number;
  errors: number;
  /** The send budget ran out: the rows not reached go the next morning. */
  budgetSpent: boolean;
}

/**
 * Format a basis-points share (0–10000) as a display string ("30%").
 */
function formatSharePercent(sharePercentBasisPoints: number): string {
  const asPercent = sharePercentBasisPoints / 100;
  return Number.isInteger(asPercent)
    ? `${asPercent}%`
    : `${asPercent.toFixed(2)}%`;
}

/**
 * Map the schema's revenue_type enum to the human-readable label
 * embedded in the email body. Matches AgreementService.formatRevenueTypeLabel.
 */
function formatRevenueTypeLabel(revenueType: string): string {
  return revenueType === 'subscription' ? 'subscription' : 'content-purchase';
}

/**
 * Render the original term length from (effectiveFrom, effectiveUntil).
 * Used for the "Original term: N months" line in the email body —
 * matches AgreementService.estimateTermMonths so the rendered copy is
 * consistent with the other lifecycle templates.
 */
function estimateTermMonths(
  effectiveFrom: Date | null,
  effectiveUntil: Date | null
): string {
  if (!effectiveFrom || !effectiveUntil) return 'Indefinite';
  const ms = effectiveUntil.getTime() - effectiveFrom.getTime();
  if (ms <= 0) return 'Indefinite';
  const months = Math.round(ms / (1000 * 60 * 60 * 24 * 30.44));
  if (months <= 0) return 'Indefinite';
  return months === 1 ? '1 month' : `${months} months`;
}

/**
 * ISO date (YYYY-MM-DD) — locale-neutral, machine-readable. Matches
 * AgreementService.formatDate so the rendered copy lines up across
 * lifecycle and expiry emails.
 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the email data payload for the agreement-expiring-soon template.
 * Centralised so both recipients (creator + owner) receive a
 * consistent payload; only `recipientName` and `otherPartyName` swap.
 */
function buildEmailPayload(args: {
  recipientName: string;
  otherPartyName: string;
  orgName: string;
  agreement: AgreementWithShare;
  deepLinkUrl: string;
}): Record<string, string | number | boolean> {
  const { recipientName, otherPartyName, orgName, agreement, deepLinkUrl } =
    args;
  // The accepted proposal's share, as every payment path reads it
  // (Codex-2hxff.19 AGR-08), never the legacy org-fee column. A missing
  // proposal pays nothing, so it is quoted as 0;
  // `AgreementService.findExpiringAgreements` has already logged that row at
  // error, with an errorId.
  const sharePercent = agreement.creatorSharePercent ?? 0;
  return {
    recipientName,
    orgName,
    otherPartyName,
    sharePercentDisplay: formatSharePercent(sharePercent),
    revenueTypeLabel: formatRevenueTypeLabel(agreement.revenueType),
    termMonthsDisplay: estimateTermMonths(
      agreement.effectiveFrom,
      agreement.effectiveUntil
    ),
    expiryDate: agreement.effectiveUntil
      ? formatDate(agreement.effectiveUntil)
      : 'Indefinite',
    deepLinkUrl,
  };
}

/**
 * Default mailer — POSTs to notifications-api /internal/send via the
 * shared worker HMAC. Awaits the fetch so we can mark the row only
 * after delivery acks. Throwing here surfaces back into the per-row
 * try/catch in `runAgreementExpiringSweep` and increments `errors`.
 */
function makeDefaultMailer(deps: {
  notificationsUrl: string;
  workerSecret: string;
  timeoutMs: number;
}) {
  return async (params: {
    to: string;
    toName?: string;
    templateName: 'agreement-expiring-soon';
    category: 'transactional';
    userId?: string;
    organizationId?: string | null;
    data: Record<string, string | number | boolean>;
  }): Promise<void> => {
    const url = `${deps.notificationsUrl}/internal/send`;
    const body = JSON.stringify(params);
    const res = await workerFetch(
      url,
      // A timeout rejects the fetch: the row is not marked, as on an error,
      // and the next morning asks the email log whether that side went.
      { method: 'POST', body, signal: AbortSignal.timeout(deps.timeoutMs) },
      deps.workerSecret
    );
    if (!res.ok) {
      throw new Error(
        `notifications-api /internal/send returned ${res.status}`
      );
    }
  };
}

/**
 * Is this side's email for this agreement already in the email log, sent or
 * in flight? The fee step's `foundSent`: template, recipient and status,
 * then the agreement id and the side in the row's metadata, each quoted
 * with its key so no id matches as a prefix of another. The send path
 * stores the email data verbatim as metadata, and the template's data
 * schema drops both keys before the render, so they never reach the email.
 *
 * Bounded by the agreement's own creation (less a minute, as `foundSent`
 * allows), before which no email about it can exist, so the
 * (recipient_email, template_name, created_at) index scans a range.
 *
 * One-time transition: an email sent before this release carries no
 * `agreementId`, so an agreement whose owner side failed before the deploy
 * may email its creator once more, on the first morning after release.
 */
function makeAlreadySent(db: Database): AlreadySent {
  return async ({ to, agreementId, side, since }) => {
    const [row] = await db
      .select({ id: emailAuditLogs.id })
      .from(emailAuditLogs)
      .where(
        and(
          eq(emailAuditLogs.templateName, TEMPLATE),
          eq(emailAuditLogs.recipientEmail, to),
          inArray(emailAuditLogs.status, ['success', 'pending']),
          gte(emailAuditLogs.createdAt, since),
          sql`strpos(${emailAuditLogs.metadata}, ${`"agreementId":"${agreementId}"`}) > 0`,
          sql`strpos(${emailAuditLogs.metadata}, ${`"side":"${side}"`}) > 0`
        )
      )
      .limit(1);
    return row !== undefined;
  };
}

/**
 * Run the sweep. Returns the aggregate counters; logs and swallows the
 * top-level error path so the cron invocation cannot crash.
 *
 * Per-row work:
 *   1. find candidate agreements (active, expiring within `daysAhead`,
 *      not yet marked as sent)
 *   2. for each row: look up the first active owner, send TWO emails
 *      (creator + owner) via the mailer thunk, skipping a side the email
 *      log shows an earlier morning sent, and mark the row as sent
 *   3. on per-row failure: log + count, continue to the next row
 *
 * If no active owner exists for an org (orphan), the creator-side
 * email still fires and the row is still marked — the cron must not
 * loop forever on a single bad row.
 */
export async function runAgreementExpiringSweep(
  deps: RunAgreementExpiringSweepDeps
): Promise<ExpiringSweepResult> {
  const { db, obs, environment, daysAhead = DEFAULT_DAYS_AHEAD, now } = deps;
  const clock = deps.clock ?? Date.now;
  const sendsUntil = (deps.wakeStartedAt ?? clock()) + SENDS_TIME_BUDGET_MS;

  const result: ExpiringSweepResult = {
    agreementsScanned: 0,
    emailsSent: 0,
    emailsAlreadySent: 0,
    agreementsMarked: 0,
    errors: 0,
    budgetSpent: false,
  };

  try {
    const service = new AgreementService({ db, environment });
    const candidates = await service.findExpiringAgreements({
      daysAhead,
      now,
    });

    result.agreementsScanned = candidates.length;

    const mailer =
      deps.mailer ??
      makeDefaultMailer({
        notificationsUrl: deps.notificationsUrl,
        workerSecret: deps.workerSecret,
        timeoutMs: deps.sendTimeoutMs ?? SEND_TIMEOUT_MS,
      });

    const alreadySent = deps.alreadySent ?? makeAlreadySent(db);

    /**
     * One side's email, unless the email log shows an earlier morning sent
     * it. Its data carries `agreementId` and `side`, which is how the log
     * finds it then.
     */
    async function sendSide(
      agreement: AgreementWithShare,
      side: AgreementSide,
      to: { id: string; email: string; name: string },
      data: Record<string, string | number | boolean>
    ): Promise<void> {
      const since = new Date(agreement.createdAt.getTime() - 60 * 1000);
      const agreementId = agreement.id;
      if (await alreadySent({ to: to.email, agreementId, side, since })) {
        result.emailsAlreadySent += 1;
        return;
      }
      await mailer({
        to: to.email,
        toName: to.name,
        templateName: TEMPLATE,
        category: 'transactional',
        userId: to.id,
        organizationId: agreement.organizationId,
        data: { ...data, agreementId, side },
      });
      result.emailsSent += 1;
    }

    for (const row of candidates) {
      // Before the row, never between its two emails, so the budget leaves
      // no row half-sent. A row whose owner email fails after the creator's
      // went is half-sent all the same: the next morning finds the
      // creator's in the email log and sends the owner's alone.
      if (clock() >= sendsUntil) {
        result.budgetSpent = true;
        obs.warn(
          'agreement-expiring-soon: the send budget ran out; the rest go tomorrow',
          { agreementsMarked: result.agreementsMarked }
        );
        break;
      }
      let creatorEmailSent = false;
      try {
        const ownerContact = await service.getFirstActiveOwnerContact(
          row.agreement.organizationId
        );
        // Creator-side email: counterparty is the owner (or a placeholder
        // when the org is orphaned).
        await sendSide(
          row.agreement,
          'creator',
          row.creator,
          buildEmailPayload({
            recipientName: row.creator.name,
            otherPartyName: ownerContact?.name ?? 'The other party',
            orgName: row.orgName,
            agreement: row.agreement,
            // The agreement's thread, by its accepted proposal; the list
            // when that link is missing (Codex-2hxff.20 AGR-10).
            deepLinkUrl: buildAgreementEmailLink(environment, {
              side: 'creator',
              proposalId: row.agreement.currentProposalId,
            }),
          })
        );
        creatorEmailSent = true;

        // Owner-side email — only when an active owner exists. Orphan
        // orgs (no active owner row) skip this branch but the creator
        // email + row marking still proceed.
        if (ownerContact) {
          await sendSide(
            row.agreement,
            'owner',
            ownerContact,
            buildEmailPayload({
              recipientName: ownerContact.name,
              otherPartyName: row.creator.name,
              orgName: row.orgName,
              agreement: row.agreement,
              deepLinkUrl: buildAgreementEmailLink(environment, {
                side: 'owner',
                orgSlug: row.orgSlug,
              }),
            })
          );
        } else {
          obs.warn(
            'agreement-expiring-soon: no active owner for org, sent creator-side only',
            { organizationId: row.agreement.organizationId }
          );
        }

        await service.markExpiringSoonSent(row.agreement.id);
        result.agreementsMarked += 1;
      } catch (rowError) {
        result.errors += 1;
        obs.error('agreement-expiring-soon per-row dispatch failed', {
          agreementId: row.agreement.id,
          organizationId: row.agreement.organizationId,
          // The creator's email went (this morning or an earlier one), so
          // the next morning sends only the owner's.
          creatorEmailSent,
          error: messageForLog(rowError),
        });
      }
    }

    obs.info('agreement-expiring-soon cron completed', {
      daysAhead,
      ...result,
    });

    return result;
  } catch (error) {
    obs.error('agreement-expiring-soon cron failed at top level', {
      error: messageForLog(error),
    });
    return result;
  }
}

/**
 * Scheduled-handler entry point. Constructs Database + Observability
 * from env, validates required env vars (logs and exits cleanly on
 * missing config), and delegates to `runAgreementExpiringSweep`.
 *
 * Split out of `dispatchScheduled` so the env-validation and
 * construction step reads separately from the cron routing. NOT exported:
 * the docblock here used to claim it was exposed "so the test suite can
 * drive it", but the suite drives `runAgreementExpiringSweep` with
 * injected deps instead and never imported this one.
 */
async function runScheduledAgreementExpiringSweep(
  env: Bindings,
  deps?: Partial<RunAgreementExpiringSweepDeps>
): Promise<ExpiringSweepResult | null> {
  const obs =
    deps?.obs ??
    new ObservabilityClient(
      'notifications-api',
      env.ENVIRONMENT ?? 'development'
    );

  const environment = deps?.environment ?? env.ENVIRONMENT ?? 'development';

  if (
    !env.DATABASE_URL ||
    !env.WORKER_SHARED_SECRET ||
    !isEnvName(environment)
  ) {
    obs.error('agreement-expiring sweep: missing required env vars, skipping', {
      hasDatabaseUrl: Boolean(env.DATABASE_URL),
      hasWorkerSecret: Boolean(env.WORKER_SHARED_SECRET),
      hasKnownEnvironment: isEnvName(environment),
    });
    return null;
  }

  const db = deps?.db ?? createDbClient(env);
  const notificationsUrl =
    deps?.notificationsUrl ?? getServiceUrl('notifications', env);

  return await runAgreementExpiringSweep({
    db,
    obs,
    environment,
    workerSecret: deps?.workerSecret ?? env.WORKER_SHARED_SECRET,
    notificationsUrl,
    daysAhead: deps?.daysAhead,
    now: deps?.now,
    mailer: deps?.mailer,
    wakeStartedAt: deps?.wakeStartedAt,
  });
}

/**
 * Top-level `scheduled()` dispatcher for the notifications-api Worker.
 *
 * Routes cron invocations by `controller.cron` so this Worker can host
 * multiple schedules (today: just `0 8 * * *`, for the agreement-expiring
 * sweep, then the money sweep, then the fee step; the original weekly-digest
 * stub is left in place but currently unwired).
 *
 * Wraps the sweep in `waitUntil` with `.catch()` so a slow sweep doesn't
 * get killed mid-flight and an unexpected rejection doesn't crash the
 * cron invocation silently.
 */
export function dispatchScheduled(
  controller: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext
): void {
  // Discriminate by cron expression so this Worker can host multiple
  // schedules in the future. For now we accept any cron and route it
  // to the agreement-expiring sweep — there's only one configured.
  const cronExpression = controller.cron;

  if (cronExpression === '0 8 * * *') {
    // The wake's start: every step's send budget counts from it, because the
    // three share the cron's wall (Codex-2hxff.100).
    const startedAt = Date.now();
    ctx.waitUntil(
      runScheduledAgreementExpiringSweep(env, { wakeStartedAt: startedAt })
        .catch((error: unknown) => {
          // runScheduledAgreementExpiringSweep already swallows its own
          // errors and logs via ObservabilityClient — this .catch is the
          // belt-and-braces guard against future refactors that drop the
          // inner try/catch.
          console.error(
            'notifications-api scheduled waitUntil rejected',
            error
          );
        })
        // The money sweep (Codex-2hxff.34, .30) runs after the agreement
        // sweep, on the same wake, and a failure in one never stops the
        // other.
        .then(() => runScheduledMoneyNoticesSweep(env, { startedAt }))
        .catch((error: unknown) => {
          console.error('notifications-api money sweep rejected', error);
        })
        // The fee step (Codex-2hxff.33) runs last, on the same wake: a rise
        // waits for it, so a failure here only moves a date later.
        .then(() => runScheduledFeeNoticesSweep(env, { startedAt }))
        .catch((error: unknown) => {
          new ObservabilityClient(
            'notifications-api',
            env.ENVIRONMENT ?? 'development'
          ).error('notifications-api fee step rejected', {
            errorId: crypto.randomUUID(),
            error: error instanceof Error ? error.message : String(error),
          });
        })
    );
    return;
  }

  // Unknown cron — log and exit. We deliberately do not throw so the
  // cron invocation does not crash.
  const obs = new ObservabilityClient(
    'notifications-api',
    env.ENVIRONMENT ?? 'development'
  );
  obs.warn('notifications-api: unrecognised cron expression', {
    cron: cronExpression,
  });
}
