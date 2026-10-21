/**
 * Shared helpers for content detail server loads and actions.
 *
 * # Single shared access seam — two routes, one source of truth
 *
 * TWO content-detail routes call these helpers with identical arguments and
 * MUST stay in lockstep. They form ONE access seam — access logic lives here,
 * never per-route:
 *
 *   1. org content     — `routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts`
 *   2. creator content — `routes/_creators/[username]/content/[contentSlug]/+page.server.ts`
 *
 * Each route calls `loadAccessAndProgress(content.id, platform, cookies,
 * content)` in both of its branches — streamed on the free fast-path, awaited
 * on the gated path — so there are four call sites but a single signature.
 * Neither `+page.server.ts` may add its own grant/deny logic; keeping the
 * decision here is what stops the two routes diverging.
 *
 * The fourth argument is the whole policy ROW, not a bare `isFree` boolean:
 * passing one derived flag let a priced row read as public and served its body
 * anonymously (Codex-al9ft). See {@link isPublicContent}.
 *
 * ## WP-2 swap point (Codex-2pryk journeys)
 *
 * The `@codex/access` rewire (canView / canEnterCourse) replaces exactly ONE
 * function — {@link resolveAccessGranted} — with an explicit entitlement
 * resolver. Because both routes reach the grant decision only through that
 * function, the swap rewires both at once and cannot diverge by route. See
 * its doc block for the behaviour that must be preserved through the swap.
 *
 * This module extracts the shared logic:
 * - `loadAccessAndProgress` — parallel fetch of streaming URL + playback progress
 * - `resolveAccessGranted`  — THE access-grant seam (WP-2 swap point)
 * - `handlePurchaseAction`  — Stripe checkout session creation with error handling
 */
import { subscriptionStatusGrantsAccess } from '@codex/constants';
import type { Cookies } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import type { SubscriptionContext, SubscriptionTier } from '$lib/types';
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
  /**
   * True when the `/stream` call failed in a way that carries no access
   * verdict (network, timeout, a 5xx), so nothing is known about entitlement.
   * `hasAccess` still fails CLOSED for gated content, but the view must not
   * claim a paywall: it says the check failed and asks for a refresh
   * (Codex-h3ipg). False on a grant, a 403 denial, and media not ready.
   */
  accessCheckFailed: boolean;
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

/**
 * Empty subscription-context fallback used by content detail loaders when
 * the content does not require a subscription (any content with no tier gate —
 * `includedInTierId == null`). Both the org and creators content
 * detail loaders return this exact 5-field shape — extracted here so the
 * shape can only drift in one place. Truth-source for the field set is
 * `SubscriptionContext` in `$lib/types`.
 *
 * The `.catch` branch of the gated `loadSubscriptionContext()` call computes
 * `requiresSubscription` from content state, so it stays inline rather than
 * sharing this constant.
 *
 * Shape pinned by `content-detail.test.ts` so the field set can only drift in
 * one place (originally the removed iter-027 F3 denoise proof).
 */
export const EMPTY_SUB_CONTEXT: SubscriptionContext = {
  requiresSubscription: false,
  hasSubscription: false,
  subscriptionCoversContent: false,
  currentSubscription: null,
  tiers: [],
};

/**
 * Fallback used by content detail loaders when the `loadAccessAndProgress()`
 * await itself rejects. A rejected load says nothing about entitlement, so
 * this is a FAILED check rather than a denial: `hasAccess` stays false (fail
 * closed) and `accessCheckFailed` is true, so the view asks for a refresh
 * instead of showing a paywall (Codex-h3ipg). Everything else is absent.
 *
 * The fast path (public content + authenticated user) spreads it with
 * `hasAccess: isPublic`, because public content stays readable either way.
 *
 * Shape pinned by `content-detail.test.ts` so the field set can only drift in
 * one place (originally the removed iter-027 F3 denoise proof).
 */
export const ACCESS_CHECK_FAILED_RESULT: AccessAndProgress = {
  hasAccess: false,
  streamingUrl: null,
  waveformUrl: null,
  readyVariants: null,
  expiresAt: null,
  revocationReason: null,
  accessCheckFailed: true,
  progress: null,
};

/**
 * The policy fields publicness depends on. Structural subset, every field
 * optional/nullable, so a full `ContentWithRelations` row satisfies it without
 * a cast. Mirrors `ContentAccessPolicyRow` in
 * `packages/access/src/services/content-access/access-decision.ts` — the two
 * MUST recognise the same gates.
 */
export interface ContentPublicnessPolicy {
  isFree?: boolean | null;
  isPurchasable?: boolean | null;
  priceCents?: number | null;
  includedInTierId?: string | null;
  isFollowerGated?: boolean | null;
  isTeamOnly?: boolean | null;
  courseOnly?: boolean | null;
}

/**
 * Free content is publicly readable — the body and metadata render for
 * everyone regardless of auth. The media stream still requires an
 * authenticated user (because signed R2 URLs are issued per-user), but the
 * page shell should not be gated behind that.
 *
 * Gated content keeps the body behind the authenticated access check:
 * anonymous visitors see the paywall teaser, signed-in users fall through to
 * `loadAccessAndProgress` which asks the backend authoritatively.
 *
 * # Why this reads the WHOLE policy and not just `isFree` (Codex-al9ft)
 *
 * This predicate decides whether `renderContentBody()` runs UNAUTHENTICATED, so
 * a false positive puts the full article body in the anonymous SSR payload and
 * in view-source. It used to be `isFree === true` alone, which trusted a single
 * derived boolean to summarise six gates. It did not: `@codex/access`'s paid arm
 * is `(priceCents ?? 0) > 0` and never reads `isFree`, while
 * `ContentService.create`/`update` derived `isFree` from the FLAG gates only —
 * omitting `priceCents`. A price-only row therefore came back `isFree: true`
 * and its body was served publicly while the gate denied every stream request.
 *
 * Those derivations are fixed, but this predicate deliberately does NOT rely on
 * that: it requires `isFree` to be true AND no gate to be present, so a row
 * already in the database with the divergent shape — which a code fix upstream
 * cannot reach — still reads as non-public here. Fail CLOSED on disagreement.
 */
export function isPublicContent(policy: ContentPublicnessPolicy): boolean {
  if (policy.isFree !== true) return false;
  return !(
    policy.isPurchasable === true ||
    (policy.priceCents ?? 0) > 0 ||
    policy.includedInTierId != null ||
    policy.isFollowerGated === true ||
    policy.isTeamOnly === true ||
    policy.courseOnly === true
  );
}

/** The server-side API surface returned by `createServerApi`. */
type ServerApi = ReturnType<typeof createServerApi>;

/**
 * Resolved payload of the access worker's `/stream` endpoint
 * (`api.access.getStreamingUrl`). Threaded through {@link resolveAccessGranted}
 * as `StreamResult | null`, where `null` means the call threw. Why it threw is
 * read by {@link classifyStreamFailure}.
 */
type StreamResult = Awaited<ReturnType<ServerApi['access']['getStreamingUrl']>>;

/**
 * What a thrown `/stream` call says about access (Codex-h3ipg):
 * - `denied`: a 403 `AccessDeniedError`, the only real "no".
 * - `not-ready`: a 422 `MEDIA_NOT_READY`. The worker throws it from
 *   `resolveStreamableMedia`, which runs only AFTER `assertStreamingAccess`
 *   passed, so it means "granted, nothing playable yet". The ordering is pinned
 *   by `content-access-not-ready-after-decision.integration.test.ts` in
 *   `@codex/access`; this reading fails OPEN if that order ever flips.
 * - `unknown`: anything else (network, timeout, 5xx, an unrecognised 4xx). The
 *   R2 signing and content-type failures that also follow the decision arrive
 *   as a generic 500 and cannot be told apart from an outage, so they land here
 *   and fail closed.
 */
export type StreamFailure = 'denied' | 'not-ready' | 'unknown';

export function classifyStreamFailure(error: unknown): StreamFailure {
  if (ApiError.isApiError(error)) {
    if (error.status === 403) return 'denied';
    if (error.status === 422 && error.code === 'MEDIA_NOT_READY') {
      return 'not-ready';
    }
  }
  return 'unknown';
}

/**
 * ── ACCESS-GRANT SEAM · single WP-2 swap point ───────────────────────────
 *
 * Decides whether the authenticated user may view this content. This is the
 * ONE place both content-detail routes resolve "granted?" — see the module
 * header for the two routes and the lockstep contract.
 *
 * BEHAVIOUR: access is inferred from the `/stream` response. A resolved
 * response — *even one whose `streamingUrl` is null* (written articles have no
 * media to sign) — means the backend access check passed; the
 * null-streamingUrl-but-granted case must not regress. A thrown call (captured
 * by the caller as `streamResult === null`) is denied UNLESS
 * {@link classifyStreamFailure} reads it as `not-ready`, which the worker only
 * raises after access passed (Codex-h3ipg). Every other failure stays denied.
 *
 * WP-2 (Codex-2pryk · `@codex/access` rewire) LANDED: the content-api worker's
 * `getStreamingUrl` now gates on the collapsed `canView` entitlement resolver
 * (`ContentAccessService.canView`, which folds the §6.1 policy flags + purchase
 * + subscription-tier + stored `entitlements` grants + course entitlements). So
 * a resolved `/stream` response now reflects `canView === true`, and this seam
 * transitively resolves `canView` for BOTH content routes at once.
 *
 * The resolver is NOT imported here: `@codex/access` is worker-only and must
 * never enter the SSR bundle (see {@link AccessRevocationReason}). It is invoked
 * over the `/stream` API instead — so the single decision point stays in the
 * worker while this remains the single web-side seam both routes reach through.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function resolveAccessGranted(
  streamResult: StreamResult | null,
  streamError: unknown = null
): boolean {
  if (streamResult !== null) return true;
  return classifyStreamFailure(streamError) === 'not-ready';
}

/**
 * Fetch streaming URL and playback progress for an authenticated user.
 *
 * Returns `{ hasAccess, streamingUrl, progress, ... }`. A 403 or a failed call
 * returns hasAccess=false; a failed call also sets `accessCheckFailed`, so the
 * view never shows a paywall it has no verdict for (Codex-h3ipg).
 *
 * Shared verbatim by both content-detail routes (see module header). The
 * access-grant decision is isolated in {@link resolveAccessGranted} — the
 * single WP-2 swap point; everything else here is response assembly.
 *
 * A PUBLIC `policy` short-circuits the result: `hasAccess` is forced to `true`
 * even if the stream fetch fails, so the body stays visible when the stream
 * worker is degraded. Authenticated streaming still runs so we can render the
 * player when the URL is available.
 *
 * Takes the whole policy rather than a bare `isFree` boolean (Codex-al9ft) — a
 * fail-OPEN short-circuit must not be keyed on one derived flag that the
 * authoritative gate never reads. See {@link isPublicContent}.
 */
export async function loadAccessAndProgress(
  contentId: string,
  platform: App.Platform | undefined,
  cookies: Cookies,
  policy?: ContentPublicnessPolicy
): Promise<AccessAndProgress> {
  const api = createServerApi(platform, cookies);

  // Capture the stream rejection separately so we can extract the
  // revocation `reason` from AccessDeniedError without bubbling the error
  // out of the server load. `.catch(() => null)` would swallow the detail
  // — we need the ApiError instance.
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
  // A thrown error is read by `classifyStreamFailure`: media not ready is a
  // grant with nothing to play; anything but a 403 is a check that FAILED.
  // Single access-grant seam (see `resolveAccessGranted`'s doc block).
  const accessGranted = resolveAccessGranted(streamResult, streamError);
  const accessCheckFailed =
    !accessGranted && classifyStreamFailure(streamError) === 'unknown';
  const hasAccess = isPublicContent(policy ?? {}) || accessGranted;
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
    accessCheckFailed,
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
  includedInTierId: string | null,
  platform: App.Platform | undefined,
  cookies: Cookies
): Promise<SubscriptionContext> {
  // Content requires a subscription when it is tier-gated — the WP-1
  // successor of accessType 'subscribers' is a non-null includedInTierId.
  // Any active subscription meeting the tier's sortOrder grants access.
  const isSubscriberContent = includedInTierId != null;

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
  // streaming check grants access for ACCESS_GRANTING_SUBSCRIPTION_STATUSES
  // (active, cancelling, and past_due while Stripe retries). paused /
  // cancelled / incomplete are denied by the DB filter but were previously
  // flagged as "has subscription" here, so the UI showed a Play button that
  // 403s on click.
  const isAccessGranting =
    !!currentSubscription &&
    subscriptionStatusGrantsAccess(currentSubscription.status);
  const hasSubscription = isAccessGranting;
  let subscriptionCoversContent = false;

  if (isAccessGranting && currentSubscription) {
    if (!includedInTierId) {
      subscriptionCoversContent = true;
    } else {
      const contentTier = tiers.find((t) => t.id === includedInTierId);
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
