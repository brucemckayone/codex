/**
 * Internal routes (worker-to-worker), mounted at the root: each path is the
 * constant its caller uses.
 *
 * POST /internal/content/media-ready: a media item changed (its transcode
 * finished or failed for good, or the maintenance run found it settled), so
 * settle the drafts scheduled to publish when it is ready (Codex-a6ofh.2.8).
 *
 * Security: HMAC worker auth (X-Worker-Signature + X-Worker-Timestamp),
 * enforced by procedure(). Worker routes take no rate limit.
 */

import {
  CONTENT_TYPES,
  ERROR_CODES,
  MEDIA_TYPES,
  PRICE_LIMITS,
  type PublishBlockedReason,
} from '@codex/constants';
import type { SettledDraft, SettleOutcome } from '@codex/content';
import { messageForLog } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import { buildOrgUrlFromEnv, type EnvName, isEnvName } from '@codex/urls';
import { mediaReadyBodySchema } from '@codex/validation';
import {
  CONTENT_MEDIA_READY_ROUTE,
  procedure,
  sendEmailToWorker,
} from '@codex/worker-utils';
import { Hono } from 'hono';
import {
  bumpOrgContentVersion,
  fanContentInvalidation,
} from './content-invalidation';

const app = new Hono<HonoEnv>();

type MediaKind = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];

const mediaKindOf = (draft: SettledDraft): MediaKind =>
  draft.contentType === CONTENT_TYPES.AUDIO
    ? MEDIA_TYPES.AUDIO
    : MEDIA_TYPES.VIDEO;

/** The lowest price a piece can sell at, as the email words it ("£1"). */
const MIN_PRICE = `£${(PRICE_LIMITS.MIN_CENTS / 100).toFixed(
  PRICE_LIMITS.MIN_CENTS % 100 === 0 ? 0 : 2
)}`;

/**
 * Why a piece didn't go live, one sentence for its creator's email (owner,
 * 2026-11-07). Every reason a schedule can end with has one, so a new
 * refusal code fails the typecheck here until it is worded.
 */
const NOT_LIVE_REASON: Record<
  PublishBlockedReason,
  (kind: MediaKind) => string
> = {
  [ERROR_CODES.CREATOR_CONNECT_REQUIRED]: () =>
    "it earns money, and your payouts aren't set up yet.",
  [ERROR_CODES.TIER_REQUIRED_TO_PUBLISH]: () =>
    "it's for subscribers, but it isn't in any plan.",
  [ERROR_CODES.PRICE_REQUIRED]: () =>
    `it's for sale, but its price is under ${MIN_PRICE}.`,
  [ERROR_CODES.NOT_ON_ORG_TEAM]: () =>
    "you're no longer on the team of the organisation it belongs to.",
  [ERROR_CODES.MEDIA_FAILED]: (kind) => `its ${kind} couldn't be processed.`,
  [ERROR_CODES.MEDIA_DELETED]: (kind) => `its ${kind} was deleted.`,
  [ERROR_CODES.MEDIA_REQUIRED]: (kind) => `it has no ${kind} attached.`,
  [ERROR_CODES.MEDIA_NOT_READY]: (kind) => `its ${kind} isn't ready yet.`,
  [ERROR_CODES.BODY_REQUIRED]: () => 'it has nothing to read yet.',
  [ERROR_CODES.THUMBNAIL_MEDIA_DELETED]: () =>
    'its thumbnail is a frame of a video that was deleted.',
};

/**
 * The piece's public page and its Publish step: an org piece on its org's
 * subdomain, a personal one on `creators`. Built from the environment NAME,
 * never a configured host: staging's single-label hosts make a host-derived
 * org link land on production (Codex-a9kn0). The route shapes are
 * `buildContentUrl` / `buildCreatorContentUrl`'s, which resolve against a
 * page's URL and so can't build an email's absolute link.
 *
 * Null for an org piece whose org slug wasn't read (see settledFrom): no
 * link beats one into the personal studio, which opens it out of its org.
 */
function linksFor(env: EnvName, draft: SettledDraft) {
  if (draft.organizationId && !draft.organizationSlug) return null;
  const on = (path: string) =>
    buildOrgUrlFromEnv(env, draft.organizationSlug ?? 'creators', path);
  const editUrl = on(`/studio/content/${draft.id}/edit?step=publish`);
  // A personal piece opens under its creator's handle; without one, in the
  // studio.
  const contentUrl = draft.organizationSlug
    ? on(`/content/${draft.slug}`)
    : draft.creator.username
      ? on(`/@${draft.creator.username}/content/${draft.slug}`)
      : editUrl;
  return { contentUrl, editUrl };
}

/**
 * "Is live", or "didn't go live" with the reason, to the creator of one
 * settled draft. None for a file the creator deleted (the editor says why,
 * owner). None without a link to give, logged with ids, since none is ever
 * re-sent. Never throws.
 */
function emailCreator(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  outcome: SettleOutcome,
  obs?: ObservabilityClient
): void {
  if (
    outcome.kind === 'stopped' &&
    outcome.draft.reason === ERROR_CODES.MEDIA_DELETED
  ) {
    return;
  }
  const { draft } = outcome;
  const templateName =
    outcome.kind === 'live' ? 'content-live' : 'content-not-live';
  const correlation = {
    contentId: draft.id,
    userId: draft.creator.id,
    templateName,
  };
  try {
    const envName = env.ENVIRONMENT;
    const links =
      envName && isEnvName(envName) ? linksFor(envName, draft) : null;
    if (!links) {
      obs?.error('Publish-when-ready email not sent: no link to give', {
        ...correlation,
        environment: envName,
      });
      return;
    }
    const kind = mediaKindOf(draft);
    sendEmailToWorker(env, executionCtx, {
      to: draft.creator.email,
      toName: draft.creator.name ?? undefined,
      templateName,
      category: 'transactional',
      userId: draft.creator.id,
      ...(draft.organizationId ? { organizationId: draft.organizationId } : {}),
      data: {
        userName: draft.creator.name ?? 'there',
        contentTitle: draft.title,
        ...(outcome.kind === 'live'
          ? { mediaKind: kind, contentUrl: links.contentUrl }
          : {
              reason: NOT_LIVE_REASON[outcome.draft.reason](kind),
              editUrl: links.editUrl,
            }),
      },
    });
  } catch (error) {
    obs?.error('Publish-when-ready email not queued', {
      ...correlation,
      error: messageForLog(error),
    });
  }
}

/**
 * What one settled draft changed, refreshed and told as its write commits: a
 * go-live's library fan-out and its org's lists (what a publish by hand
 * bumps, afterContentPublished; each org once a call, `bumped`), and the
 * creator's email. Never throws: each helper swallows and logs its own
 * failure.
 */
function announce(
  env: HonoEnv['Bindings'],
  executionCtx: ExecutionContext,
  outcome: SettleOutcome,
  bumped: Set<string>,
  obs?: ObservabilityClient
): void {
  if (outcome.kind === 'live') {
    const { draft } = outcome;
    fanContentInvalidation(
      env,
      executionCtx,
      draft.id,
      draft.organizationId,
      'content_published',
      obs
    );
    if (draft.organizationId && !bumped.has(draft.organizationId)) {
      bumped.add(draft.organizationId);
      bumpOrgContentVersion(env, executionCtx, draft.organizationId, obs);
    }
  }
  emailCreator(env, executionCtx, outcome, obs);
}

/**
 * POST /internal/content/media-ready (CONTENT_MEDIA_READY_ROUTE) → 204
 *
 * Settles every draft scheduled on the media item by its state now: ready,
 * they go live (every publish rule again); deleted or failed for good, they
 * stop waiting. Then refreshes what each go-live changes, and every org list
 * showing the file (Codex-1szw2), and emails the creators. Safe to repeat:
 * a second call finds nothing left to do.
 *
 * Answered at once, settled after (ctx.background): a caller that gives up
 * waiting would otherwise cancel the settle part-way, drafts live and never
 * announced. Background work gets 30 s after the response; the settle stops
 * starting drafts well inside it, gives up a lock it can't get in 5 s, and
 * hands over each draft as it commits, so even work cut off at the limit
 * has told what it did. What it did is logged here.
 */
app.post(
  CONTENT_MEDIA_READY_ROUTE,
  procedure({
    policy: { auth: 'worker' },
    input: { body: mediaReadyBodySchema },
    successStatus: 204,
    handler: async (ctx) => {
      const { mediaItemId } = ctx.input.body;
      const settleAndAnnounce = async () => {
        const bumped = new Set<string>();
        const settled = await ctx.services.content.settleScheduledForMedia(
          mediaItemId,
          {
            onSettled: (outcome) =>
              announce(ctx.env, ctx.executionCtx, outcome, bumped, ctx.obs),
          }
        );
        // Every org list showing the file, not only the go-lives' own
        // (Codex-1szw2).
        for (const organizationId of settled.liveOrgIds) {
          if (bumped.has(organizationId)) continue;
          bumped.add(organizationId);
          bumpOrgContentVersion(
            ctx.env,
            ctx.executionCtx,
            organizationId,
            ctx.obs
          );
        }
        if (
          settled.wentLive.length > 0 ||
          settled.stopped.length > 0 ||
          settled.retryLater > 0 ||
          settled.more
        ) {
          ctx.obs?.info('Publish when ready: settled', {
            mediaItemId,
            wentLiveIds: settled.wentLive.map((draft) => draft.id),
            stopped: settled.stopped.map(({ id, reason }) => ({ id, reason })),
            retryLater: settled.retryLater,
            more: settled.more,
          });
        }
      };
      ctx.background(
        settleAndAnnounce().catch((error: unknown) => {
          // The settle throws only before its first write: nothing changed,
          // and the maintenance run asks again.
          ctx.obs?.error('Publish when ready: settle failed', {
            mediaItemId,
            error: messageForLog(error),
          });
        })
      );
      return null;
    },
  })
);

export default app;
