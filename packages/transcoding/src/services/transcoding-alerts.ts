/**
 * Transcoding emails (Codex-l2c48.6).
 *
 * - A video that fails for good: the creator (the existing
 *   `transcoding-failed` template) and the owner
 *   (`transcoding-owner-alert`). Callers pass only the row a guarded UPDATE
 *   just failed, so it is sent once however many times a webhook is
 *   delivered.
 * - A setup fault that stops every upload: the owner only, at most ONCE per
 *   fault per UTC day (owner decision, 2026-10-25). Any check that finds one
 *   may report it, the hourly run included; the ledger keeps the rest of the
 *   day quiet. This class decides WHETHER an outcome is a fault.
 *
 * Nothing for an upload that is only waiting, or one that was abandoned
 * (`notify: false`).
 *
 * The owner is an ADDRESS, the platform's support mailbox, never an account
 * (owner decision, 2026-10-27, Codex-l2c48.10). Production had no
 * `platform_owner` account, so every owner alert was dropped; and giving the
 * owner's own account that role would lock it out of the studio, whose
 * routes admit only `creator` and `admin` (the role check is exact).
 *
 * NEVER THROWS, and never delays its caller: the lookups and the send run
 * after the response, through `waitUntil`. The row is the source of truth;
 * an email is an observation of it.
 */

import {
  MAX_TRANSCODING_ATTEMPTS,
  PLATFORM_SUPPORT_EMAIL,
  type TranscodingErrorCategory,
  toTranscodingErrorCode,
  transcodingErrorInfo,
} from '@codex/constants';
import { messageForLog } from '@codex/database';
import { users } from '@codex/database/schema';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { buildCreatorsUrl } from '@codex/urls';
import type { TranscodingOwnerAlertData } from '@codex/validation';
import { and, eq, isNull } from 'drizzle-orm';
import type { RunPodDispatchOutcome } from '../dispatch';
import { GIVE_UP_AFTER_MS } from '../maintenance-rules';
import { isPassingFailure, type RunPodApiFailureReason } from '../runpod-api';
import type { EndpointWakeOutcome } from './transcoding-service';

/** Matches `sendEmailToWorker`'s params, so the registry wires it directly. */
export type TranscodingMailer = (params: {
  to: string;
  toName?: string;
  templateName: 'transcoding-failed' | 'transcoding-owner-alert';
  category: 'transactional';
  userId?: string;
  data: Record<string, string | number | boolean>;
}) => void;

/**
 * Remembers which setup faults were mailed today. `claim` is true for the
 * first claim of a key, false after. The registry backs it with KV.
 */
export interface AlertLedger {
  claim(key: string): Promise<boolean>;
}

interface TranscodingAlertsConfig extends ServiceConfig {
  mailer: TranscodingMailer;
  /** Absolute web-app base for the creator's Retry link (`WEB_APP_URL`). */
  webAppUrl?: string;
  /** Post-response work the request's DB pool waits for. */
  waitUntil: (promise: Promise<unknown>) => void;
  /** Absent: every setup fault is mailed (and that is logged). */
  ledger?: AlertLedger;
}

/** A row a guarded UPDATE has just moved to `failed`, as it returned it. */
export interface FailedMedia {
  id: string;
  title: string;
  creatorId: string;
  transcodingAttempts: number;
  transcodingErrorCode: string | null;
  transcodingError: string | null;
}

type Contact = { id: string; name: string; email: string };
type SendContext = { event: string } & Record<string, unknown>;

/** What the creator is told, by the kind of failure (owner-approved copy). */
const CREATOR_COPY: Readonly<Record<TranscodingErrorCategory, string>> = {
  file: "We couldn't convert this file: it may be damaged, or in a format we can't read. Re-export it (an .mp4 or .mov works best) and upload it again.",
  timeout:
    'Processing took longer than we allow for a video of this length. Please try again; if it happens again, contact support.',
  internal:
    "Something went wrong on our side while processing your video. Please try again. We've been told.",
  service:
    'Our video processor was unavailable for too long, so we stopped waiting. Please try again.',
  // A setup fault that outlasted the wait reads the same to a creator.
  config:
    'Our video processor was unavailable for too long, so we stopped waiting. Please try again.',
  // Never sent: `upload` is the one notify:false category. Here only so the
  // table covers every category.
  upload: '',
};

/** How the owner's summary names the kind of failure. */
const CATEGORY_LABEL: Readonly<Record<TranscodingErrorCategory, string>> = {
  file: 'the file',
  timeout: 'took too long',
  internal: 'our side',
  service: 'transcoder unavailable',
  config: 'setup',
  // Never sent (see CREATOR_COPY).
  upload: 'upload never finished',
};

/** The handler's own text, as much as an email needs. */
const OWNER_DETAIL_MAX_LENGTH = 1000;

const WAITING_NOTE = `Uploads wait, then give up after ${GIVE_UP_AFTER_MS / 3_600_000} h.`;
const CHECK_SECRETS =
  'Check:    RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in media-api production';

/**
 * A RunPod failure the owner must act on. A passing outage clears up by
 * itself; `unsupported` is a local container, which has no management API.
 */
function isSetupFailure(reason: string): boolean {
  return !isPassingFailure(reason) && reason !== 'unsupported';
}

/**
 * Text bound for a subject line. The renderer refuses any `<` or `>` in a
 * subject (the whole email is then lost), and a line break has no place in
 * one. A creator controls their video's title.
 */
function subjectSafe(text: string): string {
  return text.replace(/\s*[<>\r\n]+\s*/g, ' ').trim();
}

export class TranscodingAlerts extends BaseService {
  private readonly mailer: TranscodingMailer;
  private readonly retryUrl?: string;
  private readonly waitUntil: (promise: Promise<unknown>) => void;
  private readonly ledger?: AlertLedger;

  constructor(config: TranscodingAlertsConfig) {
    super(config);
    this.mailer = config.mailer;
    this.waitUntil = config.waitUntil;
    this.ledger = config.ledger;
    this.retryUrl = this.studioMediaUrl(config.webAppUrl);
  }

  /** A video failed for good: its creator and the owner, once. */
  mediaFailed(media: FailedMedia): void {
    const code = toTranscodingErrorCode(media.transcodingErrorCode);
    if (!transcodingErrorInfo(code).notify) return;
    this.send({ event: 'media_failed', mediaId: media.id, code }, (context) =>
      this.sendFailure(media, context)
    );
  }

  /** A dispatch RunPod refused because of the setup (the code's policy). */
  dispatchRefused(mediaId: string, outcome: RunPodDispatchOutcome): void {
    if (outcome.kind !== 'rejected') return;
    if (!transcodingErrorInfo(outcome.code).alertOwnerOnEntry) return;
    this.setupFault(
      { event: 'dispatch_refused', mediaId },
      {
        headline: 'Uploads are waiting: RunPod refused the setup',
        summary: `RunPod refused a new upload's job as misconfigured. Every upload will be refused the same way until it is fixed. ${WAITING_NOTE}`,
        details: [
          `Media:    ${mediaId}`,
          `RunPod:   ${outcome.detail}`,
          CHECK_SECRETS,
        ].join('\n'),
      }
    );
  }

  /** An endpoint RunPod paused that cannot be raised, or cannot be read. */
  endpointStuck(outcome: EndpointWakeOutcome): void {
    if (outcome.kind !== 'not_raised' && outcome.kind !== 'unknown') return;
    if (!isSetupFailure(outcome.reason)) return;
    this.setupFault(
      { event: 'endpoint_stuck' },
      outcome.kind === 'unknown'
        ? {
            // The endpoint may be awake: only auto-unpause is known broken.
            headline:
              "Auto-unpause is unavailable: RunPod's endpoint settings can't be read",
            summary: `Reading the endpoint failed (${outcome.reason}). If RunPod pauses it, nothing will raise it again, and uploads will wait, then give up after ${GIVE_UP_AFTER_MS / 3_600_000} h.`,
            details:
              'Fix:      give the RunPod key Serverless read/write, and check RUNPOD_ENDPOINT_ID',
          }
        : {
            headline: "Uploads are waiting: the RunPod endpoint can't be woken",
            summary: `${pausedProblem(outcome)} ${WAITING_NOTE}`,
            details:
              'Fix:      give the RunPod key Serverless read/write, or raise max workers in the RunPod console',
          }
    );
  }

  /** The daily keep-alive ping refused for a reason that will not pass. */
  pingRefused(reason: RunPodApiFailureReason): void {
    if (!isSetupFailure(reason)) return;
    this.setupFault(
      { event: 'ping_refused' },
      {
        headline: 'The daily keep-alive ping was refused',
        summary: `RunPod answered the keep-alive ping with ${reason}. Without a request every 7 days RunPod pauses the endpoint.`,
        details: CHECK_SECRETS,
      }
    );
  }

  /** Too many uploads in one hourly check never reached storage. */
  uploadsIncomplete(count: number): void {
    this.setupFault(
      { event: 'uploads_incomplete', count },
      {
        headline: `${count} uploads never finished`,
        summary: `The hourly check found ${count} uploads whose files never reached storage. One or two is someone giving up; this many suggests uploads are breaking.`,
        details: 'Check:    the studio upload flow and the media bucket',
      }
    );
  }

  /** A setup fault: the owner, the first time today. */
  private setupFault(
    context: SendContext,
    data: TranscodingOwnerAlertData
  ): void {
    this.send(context, async () => {
      if (!(await this.firstToday(context.event))) return;
      this.toOwner(context, data);
    });
  }

  /**
   * True the first time today this fault is reported. Fails OPEN: when the
   * ledger cannot say, the email goes (a duplicate beats a lost alert).
   */
  private async firstToday(event: string): Promise<boolean> {
    if (!this.ledger) {
      this.obs.warn('transcoding.alert_ledger_unavailable', { event });
      return true;
    }
    const key = `transcoding-alert:${event}:${new Date().toISOString().slice(0, 10)}`;
    try {
      return await this.ledger.claim(key);
    } catch (error) {
      this.obs.warn('transcoding.alert_ledger_failed', {
        event,
        error: messageForLog(error),
      });
      return true;
    }
  }

  private send(
    context: SendContext,
    work: (context: SendContext) => Promise<void>
  ): void {
    this.waitUntil(
      work(context).catch((error: unknown) => {
        this.obs.error('transcoding.alert_failed', {
          ...context,
          error: messageForLog(error),
        });
      })
    );
  }

  /** The creator's email and the owner's are independent: one failing never costs the other. */
  private async sendFailure(
    media: FailedMedia,
    context: SendContext
  ): Promise<void> {
    const code = toTranscodingErrorCode(media.transcodingErrorCode);
    const { category } = transcodingErrorInfo(code);
    let creator: Contact | undefined;
    let creatorLine = `${media.creatorId} (deleted)`;
    try {
      creator = await this.db.query.users.findFirst({
        columns: { id: true, name: true, email: true },
        where: and(eq(users.id, media.creatorId), isNull(users.deletedAt)),
      });
      if (creator) creatorLine = `${creator.name} <${creator.email}>`;
    } catch (error) {
      creatorLine = `${media.creatorId} (lookup failed)`;
      this.obs.error('transcoding.alert_failed', {
        ...context,
        recipient: 'creator',
        error: messageForLog(error),
      });
    }

    if (creator) this.toCreator(creator, media, category, context);

    const detail = (media.transcodingError ?? '').slice(
      0,
      OWNER_DETAIL_MAX_LENGTH
    );
    this.toOwner(context, {
      headline: subjectSafe(`A video failed: ${media.title}`),
      summary: `${creator?.name ?? 'A creator'}'s upload failed: ${code} (${CATEGORY_LABEL[category]}), after ${media.transcodingAttempts} of ${MAX_TRANSCODING_ATTEMPTS} attempts.`,
      details: [
        `Media:    ${media.id}`,
        `Creator:  ${creatorLine}`,
        `Code:     ${code}`,
        `Detail:   ${detail}`,
        `Time:     ${utcMinute(new Date())}`,
      ].join('\n'),
    });
  }

  private toCreator(
    creator: Contact,
    media: FailedMedia,
    category: TranscodingErrorCategory,
    context: SendContext
  ): void {
    if (!this.retryUrl) {
      this.obs.error('transcoding.creator_alert_skipped', {
        ...context,
        reason: 'no usable WEB_APP_URL',
      });
      return;
    }
    this.mail(context, {
      to: creator.email,
      toName: creator.name,
      templateName: 'transcoding-failed',
      category: 'transactional',
      userId: creator.id,
      data: {
        userName: creator.name,
        contentTitle: subjectSafe(media.title),
        errorSummary: CREATOR_COPY[category],
        retryUrl: this.retryUrl,
      },
    });
  }

  /** The support mailbox: an address, so there is nothing to look up. */
  private toOwner(context: SendContext, data: TranscodingOwnerAlertData): void {
    this.mail(
      { ...context, recipient: 'owner' },
      {
        to: PLATFORM_SUPPORT_EMAIL,
        templateName: 'transcoding-owner-alert',
        category: 'transactional',
        data,
      }
    );
  }

  /** One recipient: a throw is logged and never stops the next. */
  private mail(
    context: SendContext,
    params: Parameters<TranscodingMailer>[0]
  ): void {
    try {
      this.mailer(params);
    } catch (error) {
      this.obs.error('transcoding.alert_failed', {
        ...context,
        recipientId: params.userId,
        error: messageForLog(error),
      });
    }
  }

  /** The creator studio's media page, where Retry is. */
  private studioMediaUrl(webAppUrl: string | undefined): string | undefined {
    if (!webAppUrl) return undefined;
    try {
      return buildCreatorsUrl(new URL(webAppUrl), '/studio/media');
    } catch (error) {
      this.obs.error('transcoding.alerts_misconfigured', {
        reason: 'WEB_APP_URL is not a URL',
        error: messageForLog(error),
      });
      return undefined;
    }
  }
}

function pausedProblem(
  outcome: Extract<EndpointWakeOutcome, { kind: 'not_raised' }>
): string {
  return outcome.reason === 'not_permitted'
    ? `The endpoint is paused (max workers ${outcome.from}) and the API key may not change it.`
    : `The endpoint is paused (max workers ${outcome.from}) and raising it failed (${outcome.reason}).`;
}

/** e.g. 2026-10-24 17:02 UTC */
function utcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
