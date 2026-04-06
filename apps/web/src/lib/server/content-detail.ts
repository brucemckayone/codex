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
import { createServerApi } from './api';
import { ApiError } from './errors';

interface AccessAndProgress {
  hasAccess: boolean;
  streamingUrl: string | null;
  progress: {
    positionSeconds: number;
    durationSeconds: number;
    completed: boolean;
  } | null;
}

/**
 * Fetch streaming URL and playback progress for an authenticated user.
 *
 * Returns `{ hasAccess, streamingUrl, progress }`.
 * Gracefully handles 403 / network errors by returning hasAccess=false.
 */
export async function loadAccessAndProgress(
  contentId: string,
  platform: App.Platform | undefined,
  cookies: Cookies
): Promise<AccessAndProgress> {
  const api = createServerApi(platform, cookies);

  const [streamResult, progressResult] = await Promise.all([
    api.access.getStreamingUrl(contentId).catch(() => null),
    api.access.getProgress(contentId).catch(() => null),
  ]);

  const hasAccess = !!streamResult?.streamingUrl;
  const streamingUrl = streamResult?.streamingUrl ?? null;
  const progress = progressResult
    ? {
        positionSeconds: progressResult.positionSeconds,
        durationSeconds: progressResult.durationSeconds,
        completed: progressResult.completed,
      }
    : null;

  return { hasAccess, streamingUrl, progress };
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
      return fail(409, {
        checkoutError: 'You already have access to this content.',
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
