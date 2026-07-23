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
 *     (null result) denies. This is the historical "getStreamingUrl-throws"
 *     gate that must survive the swap;
 *   - the shared fallback constants keep a stable field set so drift is caught
 *     in one place.
 */
import { describe, expect, it } from 'vitest';
import {
  DENIED_ACCESS_RESULT,
  EMPTY_SUB_CONTEXT,
  isPublicAccessType,
  loadSubscriptionContext,
  resolveAccessGranted,
} from './content-detail';

/** A non-null `/stream` payload — only its presence matters to the seam. */
type StreamResult = NonNullable<Parameters<typeof resolveAccessGranted>[0]>;

describe('isPublicAccessType', () => {
  it('treats only "free" content as publicly readable', () => {
    expect(isPublicAccessType('free')).toBe(true);
  });

  it.each([
    'paid',
    'followers',
    'subscribers',
    'team',
  ])('gates "%s" content behind the access check', (accessType) => {
    expect(isPublicAccessType(accessType)).toBe(false);
  });

  it('is not public for null / undefined / empty accessType', () => {
    expect(isPublicAccessType(null)).toBe(false);
    expect(isPublicAccessType(undefined)).toBe(false);
    expect(isPublicAccessType('')).toBe(false);
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

  it('matches the DENIED_ACCESS_RESULT fallback on the denied branch', () => {
    // The routes fall back to DENIED_ACCESS_RESULT when the await rejects;
    // its hasAccess must agree with the seam's null (denied) verdict.
    expect(resolveAccessGranted(null)).toBe(DENIED_ACCESS_RESULT.hasAccess);
  });
});

describe('shared fallback shapes', () => {
  it('DENIED_ACCESS_RESULT is fully absent/denied', () => {
    expect(DENIED_ACCESS_RESULT).toEqual({
      hasAccess: false,
      streamingUrl: null,
      waveformUrl: null,
      readyVariants: null,
      expiresAt: null,
      revocationReason: null,
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

  it('returns the empty context for free content with no minimum tier', async () => {
    // No accessType === "subscribers" and no minimumTierId → the function
    // short-circuits before ever touching the API, and the inline literal it
    // returns must stay identical to EMPTY_SUB_CONTEXT.
    const ctx = await loadSubscriptionContext(
      'org-1',
      null,
      undefined,
      unusedCookies,
      'free'
    );
    expect(ctx).toEqual(EMPTY_SUB_CONTEXT);
  });
});
