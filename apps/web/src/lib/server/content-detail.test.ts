/**
 * Content-detail shared access seam (Codex-2pryk.1.3 · CE-3).
 *
 * These helpers are the SINGLE access seam feeding both content-detail routes
 * (org `_org/[slug]/(space)/content/[contentSlug]` + creator
 * `_creators/[username]/content/[contentSlug]`). The suite pins the
 * behaviour-preserving contract so the WP-2 `@codex/access` rewire, which
 * replaces `resolveAccessGranted`, has a regression net:
 *   - `isPublicAccessType` — only `free` is publicly readable;
 *   - `resolveAccessGranted` — a resolved `/stream` response grants access,
 *     INCLUDING a written article whose `streamingUrl` is null; a thrown call
 *     (null result) denies, except media not ready, which the worker raises
 *     only after access passed (Codex-h3ipg);
 *   - `classifyStreamFailure` — only a 403 is a denial; anything unrecognised
 *     is a failed check, never a grant;
 *   - the shared fallback constants keep a stable field set so drift is caught
 *     in one place.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ createServerApi: vi.fn() }));

import { createServerApi } from './api';
import {
  ACCESS_CHECK_FAILED_RESULT,
  classifyStreamFailure,
  EMPTY_SUB_CONTEXT,
  isPublicContent,
  loadAccessAndProgress,
  loadSubscriptionContext,
  resolveAccessGranted,
} from './content-detail';
import { ApiError } from './errors';

/** A non-null `/stream` payload — only its presence matters to the seam. */
type StreamResult = NonNullable<Parameters<typeof resolveAccessGranted>[0]>;

describe('isPublicContent', () => {
  it('treats free content (isFree=true, no gate) as publicly readable', () => {
    expect(isPublicContent({ isFree: true })).toBe(true);
  });

  it('gates non-free content (isFree=false) behind the access check', () => {
    // Purchasable / follower / tier / team content all report isFree=false and
    // must fall through to the authenticated access check (WP-1 §6.1).
    expect(isPublicContent({ isFree: false })).toBe(false);
  });

  it('is not public for null / undefined isFree', () => {
    expect(isPublicContent({ isFree: null })).toBe(false);
    expect(isPublicContent({ isFree: undefined })).toBe(false);
    expect(isPublicContent({})).toBe(false);
  });

  // ── Codex-al9ft: the predicate reads the WHOLE policy, and fails CLOSED ──
  // `isFree` alone used to decide whether `renderContentBody()` runs
  // UNAUTHENTICATED. A row carrying a gate AND `isFree: true` is a contradiction
  // that `@codex/access` resolves as DENIED, so this must resolve it the same
  // way. These are not hypothetical shapes: `priceCents` was absent from both
  // `ContentService.create`'s isFree derivation and `update`'s `effHasGate`
  // clamp, so a price-only payload persisted exactly the first row below, and a
  // PATCH clearing `isPurchasable` rewrote a correct row into it.
  describe('a gate present alongside isFree:true is NOT public', () => {
    it('a priced row is not public (the al9ft leak)', () => {
      expect(isPublicContent({ isFree: true, priceCents: 1999 })).toBe(false);
    });

    it('a purchasable row is not public', () => {
      expect(isPublicContent({ isFree: true, isPurchasable: true })).toBe(
        false
      );
    });

    it('a tier-gated row is not public', () => {
      expect(
        isPublicContent({ isFree: true, includedInTierId: 'tier-1' })
      ).toBe(false);
    });

    it('a follower-gated row is not public', () => {
      expect(isPublicContent({ isFree: true, isFollowerGated: true })).toBe(
        false
      );
    });

    it('a team-only row is not public', () => {
      expect(isPublicContent({ isFree: true, isTeamOnly: true })).toBe(false);
    });

    it('a course-only row is not public', () => {
      expect(isPublicContent({ isFree: true, courseOnly: true })).toBe(false);
    });

    it('priceCents of 0 or null is not a gate', () => {
      // Only a POSITIVE price gates — mirrors @codex/access's
      // `(priceCents ?? 0) > 0`. A zero/null price on free content is normal.
      expect(isPublicContent({ isFree: true, priceCents: 0 })).toBe(true);
      expect(isPublicContent({ isFree: true, priceCents: null })).toBe(true);
    });
  });
});

describe('resolveAccessGranted (WP-2 swap point)', () => {
  it('denies when the /stream call threw (null result)', () => {
    // A thrown getStreamingUrl (403 / network / 5xx) is captured as null.
    expect(resolveAccessGranted(null)).toBe(false);
  });

  it('grants when /stream resolved with a signed streaming URL', () => {
    const withMedia = {
      streamingUrl: 'https://cdn.example/x.m3u8',
    } as unknown as StreamResult;
    expect(resolveAccessGranted(withMedia)).toBe(true);
  });

  it('grants when /stream resolved with a null URL (written article)', () => {
    // HARDENING-critical: a successful access check with no media to sign
    // (written content) still means the user may view. Must not regress.
    const writtenArticle = {
      streamingUrl: null,
    } as unknown as StreamResult;
    expect(resolveAccessGranted(writtenArticle)).toBe(true);
  });

  it('matches the ACCESS_CHECK_FAILED_RESULT fallback on a failed call', () => {
    // The routes fall back to ACCESS_CHECK_FAILED_RESULT when the await
    // rejects; its hasAccess must agree with the seam's verdict on a failure.
    expect(resolveAccessGranted(null, new Error('network'))).toBe(
      ACCESS_CHECK_FAILED_RESULT.hasAccess
    );
  });

  it('grants when /stream threw MEDIA_NOT_READY (access passed first)', () => {
    // Codex-h3ipg: the worker raises this only after assertStreamingAccess
    // passed, so an entitled viewer must not see a paywall.
    const notReady = new ApiError(422, 'not ready', 'MEDIA_NOT_READY');
    expect(resolveAccessGranted(null, notReady)).toBe(true);
  });

  it('denies a 403 and any other failure', () => {
    expect(resolveAccessGranted(null, new ApiError(403, 'denied'))).toBe(false);
    expect(resolveAccessGranted(null, new ApiError(500, 'boom'))).toBe(false);
    expect(resolveAccessGranted(null, new TypeError('fetch failed'))).toBe(
      false
    );
  });
});

describe('classifyStreamFailure (Codex-h3ipg)', () => {
  it('reads only a 403 as a denial', () => {
    expect(classifyStreamFailure(new ApiError(403, 'denied'))).toBe('denied');
    expect(
      classifyStreamFailure(
        new ApiError(403, 'revoked', 'ACCESS_DENIED', { reason: 'refund' })
      )
    ).toBe('denied');
  });

  it('reads a 422 MEDIA_NOT_READY as not ready', () => {
    expect(
      classifyStreamFailure(new ApiError(422, 'x', 'MEDIA_NOT_READY'))
    ).toBe('not-ready');
  });

  it('never grants on a status or a code alone', () => {
    // Both halves are needed: a 422 validation failure is not a grant, and
    // neither is the code on another status.
    expect(
      classifyStreamFailure(new ApiError(422, 'x', 'VALIDATION_ERROR'))
    ).toBe('unknown');
    expect(classifyStreamFailure(new ApiError(422, 'x'))).toBe('unknown');
    expect(
      classifyStreamFailure(new ApiError(500, 'x', 'MEDIA_NOT_READY'))
    ).toBe('unknown');
  });

  it('reads an outage, a 5xx or an unknown throw as a failed check', () => {
    expect(classifyStreamFailure(new ApiError(500, 'x'))).toBe('unknown');
    expect(classifyStreamFailure(new ApiError(503, 'x'))).toBe('unknown');
    expect(classifyStreamFailure(new ApiError(404, 'x'))).toBe('unknown');
    expect(classifyStreamFailure(new TypeError('fetch failed'))).toBe(
      'unknown'
    );
    expect(classifyStreamFailure(null)).toBe('unknown');
    expect(
      classifyStreamFailure({ status: 422, code: 'MEDIA_NOT_READY' })
    ).toBe('unknown');
  });
});

describe('shared fallback shapes', () => {
  it('ACCESS_CHECK_FAILED_RESULT is closed, absent, and marked failed', () => {
    expect(ACCESS_CHECK_FAILED_RESULT).toEqual({
      hasAccess: false,
      streamingUrl: null,
      waveformUrl: null,
      readyVariants: null,
      expiresAt: null,
      revocationReason: null,
      accessCheckFailed: true,
      progress: null,
    });
  });

  it('EMPTY_SUB_CONTEXT requires no subscription', () => {
    expect(EMPTY_SUB_CONTEXT).toEqual({
      requiresSubscription: false,
      hasSubscription: false,
      subscriptionCoversContent: false,
      currentSubscription: null,
      tiers: [],
    });
  });
});

describe('loadSubscriptionContext (non-subscriber early return)', () => {
  type Cookies = Parameters<typeof loadSubscriptionContext>[3];
  const unusedCookies = {} as unknown as Cookies;

  it('returns the empty context for content with no gating tier', async () => {
    // A null includedInTierId (not tier-gated) short-circuits before ever
    // touching the API, and the inline literal it returns must stay identical
    // to EMPTY_SUB_CONTEXT.
    const ctx = await loadSubscriptionContext(
      'org-1',
      null,
      undefined,
      unusedCookies
    );
    expect(ctx).toEqual(EMPTY_SUB_CONTEXT);
  });
});

describe('loadAccessAndProgress reads WHY /stream failed (Codex-h3ipg)', () => {
  type Cookies = Parameters<typeof loadAccessAndProgress>[2];
  const cookies = {} as unknown as Cookies;
  const paid = { isFree: false, priceCents: 900 };

  function streamThrows(error: unknown) {
    vi.mocked(createServerApi).mockReturnValue({
      access: {
        getStreamingUrl: () => Promise.reject(error),
        getProgress: () => Promise.resolve(null),
      },
    } as unknown as ReturnType<typeof createServerApi>);
  }

  it('grants a viewer whose media is not ready, with nothing to play', async () => {
    streamThrows(new ApiError(422, 'not ready', 'MEDIA_NOT_READY'));
    const result = await loadAccessAndProgress('c1', undefined, cookies, paid);
    expect(result).toMatchObject({
      hasAccess: true,
      streamingUrl: null,
      accessCheckFailed: false,
      revocationReason: null,
    });
  });

  it('denies a 403 without calling it a failed check', async () => {
    streamThrows(
      new ApiError(403, 'revoked', 'ACCESS_DENIED', { reason: 'refund' })
    );
    const result = await loadAccessAndProgress('c1', undefined, cookies, paid);
    expect(result).toMatchObject({
      hasAccess: false,
      accessCheckFailed: false,
      revocationReason: 'refund',
    });
  });

  it('keeps an outage closed but marks the check failed', async () => {
    streamThrows(new ApiError(503, 'unavailable'));
    const result = await loadAccessAndProgress('c1', undefined, cookies, paid);
    expect(result).toMatchObject({ hasAccess: false, accessCheckFailed: true });
  });

  it('keeps public content readable when the check fails', async () => {
    streamThrows(new TypeError('fetch failed'));
    const result = await loadAccessAndProgress('c1', undefined, cookies, {
      isFree: true,
    });
    expect(result).toMatchObject({ hasAccess: true, accessCheckFailed: true });
  });
});
