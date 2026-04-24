/**
 * Shared helpers for content detail server loads and actions.
 *
 * Both the org content detail (`_org/[slug]/(space)/content/[contentSlug]`)
 * and the creator content detail (`_creators/[username]/content/[contentSlug]`)
 * perform the same authenticated-user access check and purchase checkout flow.
 *
 * This module extracts that duplicated logic:
 * - `loadAccessAndProgress` — parallel fetch of streaming URL + playback progress
 * - `handlePurchaseAction` — Stripe checkout session creation with error handling
 */
import type { Cookies } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import type { CurrentSubscription, SubscriptionTier } from '$lib/types';
import { createServerApi } from './api';
import { ApiError } from './errors';

/**
 * Revocation reasons surfaced from `AccessDeniedError` when a previously-
 * authorised user lost access (subscription cancelled, payment failed,
 * refund, admin revoke). Mirrors the union in
 * `packages/access/src/services/access-revocation.ts` — kept inline here
 * rather than importing so the web app doesn't pull the server-only
 * `@codex/access` package through the SSR bundle.
 */
export type AccessRevocationReason =
  | 'subscription_deleted'
  | 'payment_failed'
  | 'refund'
  | 'admin_revoke';

interface AccessAndProgress {
  hasAccess: boolean;
  streamingUrl: string | null;
  waveformUrl: string | null;
  /**
   * HLS quality variants that finished transcoding for this media item
   * (e.g. `['1080p', '720p', '480p', '360p']`). Null when the stream
   * response did not include the field (written content, pre-transcode
   * media, legacy items without `ready_variants` populated, or denial).
   * Drives the manual quality picker in `VideoPlayer`.
   */
  readyVariants: string[] | null;
  /**
   * ISO 8601 timestamp when the signed streaming/waveform URL expires.
   * Null when the access branch doesn't produce a stream (access denied or
   * call failed). Threaded into the player so it can pre-emptively refresh
   * before the URL dies (Codex-1ywzr). Serialised as string rather than
   * Date because SvelteKit devalue doesn't consistently round-trip Dates
   * through streamed promise boundaries.
   */
  expiresAt: string | null;
  /**
   * Revocation reason extracted from a 403 `AccessDeniedError` response.
   * Null on grant, generic denial (no reason), or any non-revocation error.
   * Drives the contextual `AccessRevokedOverlay` copy on the content page
   * — see Codex-zdf2u.
   */
  revocationReason: AccessRevocationReason | null;
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
  } | null;
}

const REVOCATION_REASONS: ReadonlySet<AccessRevocationReason> = new Set([
  'subscription_deleted',
  'payment_failed',
  'refund',
  'admin_revoke',
]);

function extractRevocationReason(
  error: unknown
): AccessRevocationReason | null {
  if (!ApiError.isApiError(error)) return null;
  if (error.status !== 403) return null;
  const details = error.details;
  if (!details || typeof details !== 'object') return null;
  const reason = (details as { reason?: unknown }).reason;
  if (typeof reason !== 'string') return null;
  return REVOCATION_REASONS.has(reason as AccessRevocationReason)
    ? (reason as AccessRevocationReason)
    : null;
}

export interface SubscriptionContext {
  /** Whether the content requires a subscription tier */
  requiresSubscription: boolean;
  /** Whether the user has an active subscription to this org */
  hasSubscription: boolean;
  /** Whether the user's tier is high enough for this content */
  subscriptionCoversContent: boolean;
  /** The user's current subscription (null if none) */
  currentSubscription: CurrentSubscription | null;
  /** All active tiers for this org (for the subscribe modal) */
  tiers: SubscriptionTier[];
}

/**
 * `accessType` values recognised by the content schema. Mirrors the DB CHECK
 * constraint in packages/database/src/schema/content.ts.
 */
export type ContentAccessType =
  | 'free'
  | 'paid'
  | 'followers'
  | 'subscribers'
  | 'team';

/**
 * Free content is publicly readable — the body and metadata render for
 * everyone regardless of auth. The media stream still requires an
 * authenticated user (because signed R2 URLs are issued per-user), but the
 * page shell should not be gated behind that.
 *
 * All other access types (paid / followers / subscribers / team) keep the
 * body gated behind the authenticated access check: anonymous visitors see
 * the paywall teaser, signed-in users fall through to `loadAccessAndProgress`
 * which asks the backend authoritatively.
 */
export function isPublicAccessType(
  accessType: string | null | undefined
): boolean {
  return accessType === 'free';
}

/**
 * Fetch streaming URL and playback progress for an authenticated user.
 *
 * Returns `{ hasAccess, streamingUrl, progress }`.
 * Gracefully handles 403 / network errors by returning hasAccess=false.
 *
 * `accessType` short-circuits the result for free content: `hasAccess` is
 * forced to `true` even if the stream fetch fails, so the body stays visible
 * when the stream worker is degraded. Authenticated streaming still runs so
 * we can render the player when the URL is available.
 */
export async function loadAccessAndProgress(
  contentId: string,
  platform: App.Platform | undefined,
  cookies: Cookies,
  accessType?: string | null
): Promise<AccessAndProgress> {
  const api = createServerApi(platform, cookies);

  // Capture the stream rejection separately so we can extract the
  // revocation `reason` from AccessDeniedError without bubbling the error
  // out of the server load. `.catch(() => null)` would swallow the detail
  // — we need the ApiError instance.
  type StreamResult = Awaited<ReturnType<typeof api.access.getStreamingUrl>>;
  let streamResult: StreamResult | null = null;
  let streamError: unknown = null;

  const [, progressResult] = await Promise.all([
    api.access
      .getStreamingUrl(contentId)
      .then((r) => {
        streamResult = r;
      })
      .catch((err: unknown) => {
        streamError = err;
      }),
    api.access.getProgress(contentId).catch(() => null),
  ]);

  // A successful response from /stream means the access check passed,
  // even when streamingUrl is null (written articles — no media to sign).
  // Only a thrown error (403 denied, network failure) means no access.
  const accessGranted = streamResult !== null;
  const hasAccess = isPublicAccessType(accessType) || accessGranted;
  const streamingUrl =
    (streamResult as StreamResult | null)?.streamingUrl ?? null;
  const waveformUrl =
    (streamResult as StreamResult | null)?.waveformUrl ?? null;
  // `expiresAt` comes back as an ISO 8601 string from the access worker
  // (JSON-encoded Date). Preserve the string as-is for stable wire format.
  const expiresAt = (streamResult as StreamResult | null)?.expiresAt ?? null;
  // `readyVariants` is optional on the wire — absent for written content,
  // pre-transcode, or legacy items without `ready_variants` populated.
  // Normalise to null so downstream components can branch on truthiness.
  const readyVariants =
    (streamResult as StreamResult | null)?.readyVariants ?? null;
  const revocationReason = accessGranted
    ? null
    : extractRevocationReason(streamError);
  const progress = progressResult
    ? {
        positionSeconds: progressResult.positionSeconds,
        durationSeconds: progressResult.durationSeconds,
        completed: progressResult.completed,
      }
    : null;

  return {
    hasAccess,
    streamingUrl,
    waveformUrl,
    readyVariants,
    expiresAt,
    revocationReason,
    progress,
  };
}

/**
 * Load subscription context for content that may require a tier.
 *
 * Fetches the user's current subscription + org tiers in parallel.
 * Compares tier sortOrder to determine if subscription covers the content.
 */
export async function loadSubscriptionContext(
  orgId: string,
  contentMinimumTierId: string | null,
  platform: App.Platform | undefined,
  cookies: Cookies,
  contentAccessType?: string
): Promise<SubscriptionContext> {
  // Content requires a subscription if accessType is 'subscribers' OR if a minimum tier is set.
  // When accessType is 'subscribers' with no minimumTierId, any active subscription grants access.
  const isSubscriberContent =
    contentAccessType === 'subscribers' || !!contentMinimumTierId;

  if (!isSubscriberContent) {
    return {
      requiresSubscription: false,
      hasSubscription: false,
      subscriptionCoversContent: false,
      currentSubscription: null,
      tiers: [],
    };
  }

  const api = createServerApi(platform, cookies);

  const [currentSubscription, tiers] = await Promise.all([
    api.subscription.getCurrent(orgId).catch(() => null),
    api.tiers.list(orgId).catch(() => [] as SubscriptionTier[]),
  ]);

  // hasSubscription must mirror the backend access filter: the @codex/access
  // streaming check only grants access for status IN (active, cancelling).
  // paused / past_due / cancelled / incomplete are correctly denied by the
  // DB filter but were previously flagged as "has subscription" here, so
  // the UI showed a Play button that 403s on click.
  const isAccessGranting =
    !!currentSubscription &&
    (currentSubscription.status === 'active' ||
      currentSubscription.status === 'cancelling');
  const hasSubscription = isAccessGranting;
  let subscriptionCoversContent = false;

  if (isAccessGranting && currentSubscription) {
    if (!contentMinimumTierId) {
      subscriptionCoversContent = true;
    } else {
      const contentTier = tiers.find((t) => t.id === contentMinimumTierId);
      if (contentTier) {
        subscriptionCoversContent =
          currentSubscription.tier.sortOrder >= contentTier.sortOrder;
      }
    }
  }

  return {
    requiresSubscription: true,
    hasSubscription,
    subscriptionCoversContent,
    currentSubscription,
    tiers,
  };
}

interface PurchaseActionArgs {
  /** The incoming form request */
  request: Request;
  /** Current page URL (used for cancelUrl and origin) */
  url: URL;
  /** Cloudflare platform bindings */
  platform: App.Platform | undefined;
  /** Request cookies (forwarded to API) */
  cookies: Cookies;
  /**
   * Build the Stripe success redirect URL from the page origin.
   * Stripe replaces `{CHECKOUT_SESSION_ID}` at redirect time.
   */
  buildSuccessUrl: (origin: string) => string;
}

/**
 * Handle the purchase form action (Stripe checkout session creation).
 *
 * Shared between org and creator content detail pages. The only difference
 * is how `successUrl` is constructed, which callers provide via
 * `buildSuccessUrl`.
 */
export async function handlePurchaseAction({
  request,
  url,
  platform,
  cookies,
  buildSuccessUrl,
}: PurchaseActionArgs) {
  const api = createServerApi(platform, cookies);
  const formData = await request.formData();
  const contentId = formData.get('contentId');

  if (!contentId || typeof contentId !== 'string') {
    return fail(400, { checkoutError: 'Missing content ID' });
  }

  const successUrl = buildSuccessUrl(url.origin);
  const cancelUrl = url.href;

  try {
    const result = await api.checkout.create({
      contentId,
      successUrl,
      cancelUrl,
    });

    return { sessionUrl: result.sessionUrl };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // 409 = "already have access" — not an error, it's a happy-path
      // outcome the user simply didn't realise. Surface as an info banner
      // with a "Play now" CTA rather than a red alert. Codex-mmju5.
      return fail(409, {
        info: 'You already have access to this content.',
        alreadyOwned: true,
      });
    }

    // Phase 1: Personal content purchase blocked by backend
    if (err instanceof ApiError && err.message?.includes('organization')) {
      return fail(422, {
        checkoutError:
          'Purchases for personal creator content are coming soon. Stay tuned!',
      });
    }

    return fail(500, {
      checkoutError: 'Failed to create checkout session. Please try again.',
    });
  }
}
