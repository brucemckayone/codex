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
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ createServerApi: vi.fn() }));

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trackError: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger: mockLogger }));

import { createServerApi } from './api';
import {
  ACCESS_CHECK_FAILED_RESULT,
  type ContentPublicnessPolicy,
  classifyStreamFailure,
  EMPTY_SUB_CONTEXT,
  isPublicContent,
  loadAccessAndProgress,
  loadAccessWithBody,
  loadRelatedContent,
  loadSubscriptionContext,
  resolveAccessGranted,
} from './content-detail';
import { ApiError } from './errors';

// The detail pages' "more from" strip (Codex-osuqt review): read through the
// server API so no remote-query cache carries it, every item without its raw
// body, and a failure logged rather than swallowed.
describe('loadRelatedContent', () => {
  const apiWith = (getPublicContent: ReturnType<typeof vi.fn>) =>
    ({ content: { getPublicContent } }) as unknown as Parameters<
      typeof loadRelatedContent
    >[0];
  const sent = (getPublicContent: ReturnType<typeof vi.fn>) =>
    Object.fromEntries(
      (getPublicContent.mock.calls[0]?.[0] as URLSearchParams).entries()
    );

  it("lists the org's newest five, each without its raw body", async () => {
    const getPublicContent = vi.fn().mockResolvedValue({
      items: [{ id: 'r1', contentBody: 'text', contentBodyJson: { a: 1 } }],
    });

    const items = await loadRelatedContent(apiWith(getPublicContent), {
      orgId: 'o1',
    });

    expect(sent(getPublicContent)).toEqual({
      orgId: 'o1',
      sort: 'newest',
      limit: '5',
    });
    expect(items).toEqual([
      { id: 'r1', contentBody: null, contentBodyJson: null },
    ]);
  });

  // The creator page's piece has no org, so an org-scoped strip never made a
  // request there and always rendered empty.
  it("lists a creator's newest five for a piece with no org", async () => {
    const getPublicContent = vi.fn().mockResolvedValue({ items: [] });

    await loadRelatedContent(apiWith(getPublicContent), { creatorId: 'u1' });

    expect(sent(getPublicContent)).toEqual({
      creatorId: 'u1',
      sort: 'newest',
      limit: '5',
    });
  });

  it('logs an outage as a warning and stays empty instead of rejecting', async () => {
    const getPublicContent = vi
      .fn()
      .mockRejectedValue(new ApiError(503, 'unavailable'));

    expect(
      await loadRelatedContent(apiWith(getPublicContent), { orgId: 'o1' })
    ).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Related content not loaded',
      expect.objectContaining({ orgId: 'o1', status: 503 })
    );
  });

  it('logs a 400 from our own request as an error, naming the field', async () => {
    const details = [{ path: 'query.creatorId', message: 'Invalid user id' }];
    const getPublicContent = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, 'Invalid request data', 'VALIDATION_ERROR', details)
      );

    await loadRelatedContent(apiWith(getPublicContent), { creatorId: 'u1' });

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Related content not loaded',
      expect.objectContaining({ creatorId: 'u1', status: 400, details })
    );
  });
});

/** A non-null `/stream` payload — only its presence matters to the seam. */
type StreamResult = NonNullable<Parameters<typeof resolveAccessGranted>[0]>;

// The rule's truth table lives with the rule, in @codex/constants
// (`public-content.test.ts`, Codex-039vo). The seam only re-exports it, and this
// pins that it is the shared function, not a second copy that could drift.
describe('isPublicContent', () => {
  it('is the @codex/constants rule, shared with the public content API', async () => {
    const constants = await import('@codex/constants');
    expect(isPublicContent).toBe(constants.isPublicContent);
  });
});

/** A full access policy (every gate present), open unless overridden. */
function policy(
  overrides: Partial<ContentPublicnessPolicy> = {}
): ContentPublicnessPolicy {
  return {
    isFree: true,
    isPurchasable: false,
    priceCents: null,
    includedInTierId: null,
    isFollowerGated: false,
    isTeamOnly: false,
    courseOnly: false,
    ...overrides,
  };
}

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
  const paid = policy({ isFree: false, priceCents: 900 });

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
    const result = await loadAccessAndProgress(
      'c1',
      undefined,
      cookies,
      policy()
    );
    expect(result).toMatchObject({ hasAccess: true, accessCheckFailed: true });
  });
});

// A gated piece's public row carries no body, so the gated path takes an
// entitled reader's body from the access check (Codex-039vo). Before, it
// rendered the stripped row and every entitled reader got an empty page.
describe('loadAccessWithBody (Codex-039vo)', () => {
  type Cookies = Parameters<typeof loadAccessWithBody>[2];
  const cookies = {} as unknown as Cookies;
  const followers = policy({ isFree: false, isFollowerGated: true });
  const bodyJson = { type: 'doc', content: [] };
  const granted = {
    streamingUrl: null,
    waveformUrl: null,
    expiresAt: '2026-10-23T22:00:00.000Z',
    contentType: 'written',
  };

  beforeEach(() => {
    mockLogger.error.mockClear();
  });

  function streamReturns(response: unknown) {
    const getStreamingUrl = vi.fn(() => Promise.resolve(response));
    vi.mocked(createServerApi).mockReturnValue({
      access: { getStreamingUrl, getProgress: () => Promise.resolve(null) },
    } as unknown as ReturnType<typeof createServerApi>);
    return getStreamingUrl;
  }

  function streamThrows(error: unknown) {
    vi.mocked(createServerApi).mockReturnValue({
      access: {
        getStreamingUrl: () => Promise.reject(error),
        getProgress: () => Promise.resolve(null),
      },
    } as unknown as ReturnType<typeof createServerApi>);
  }

  it('asks /stream for the body and returns it once access is granted', async () => {
    const getStreamingUrl = streamReturns({
      ...granted,
      body: { contentBody: null, contentBodyJson: bodyJson },
    });

    const { access, body } = await loadAccessWithBody(
      'c1',
      undefined,
      cookies,
      followers
    );

    expect(getStreamingUrl).toHaveBeenCalledWith('c1', { includeBody: true });
    expect(access.hasAccess).toBe(true);
    expect(body).toEqual({ contentBody: null, contentBodyJson: bodyJson });
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      'Access granted but /stream returned no body',
      expect.anything()
    );
  });

  it('never puts the raw body on the access result the page returns', async () => {
    streamReturns({
      ...granted,
      body: { contentBody: '# secret', contentBodyJson: null },
    });

    const { access } = await loadAccessWithBody(
      'c1',
      undefined,
      cookies,
      followers
    );

    expect(access).not.toHaveProperty('body');
    expect(JSON.stringify(access)).not.toContain('secret');
  });

  // A content-api behind this web build drops the unknown `include` key, so a
  // grant comes back with no `body`. That must never read as "no body" (the
  // empty page again, silently): it is logged as a contract fault.
  it('a grant with no body field returns no body and logs the fault', async () => {
    streamReturns(granted);

    const { access, body } = await loadAccessWithBody(
      'c1',
      undefined,
      cookies,
      followers
    );

    expect(access.hasAccess).toBe(true);
    expect(body).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Access granted but /stream returned no body',
      { contentId: 'c1' }
    );
  });

  // Accepted and pinned: the worker raises MEDIA_NOT_READY after access
  // passed, so the page reads as granted, but the thrown call carried nothing.
  it('media not ready: granted, with no body until the media is ready', async () => {
    streamThrows(new ApiError(422, 'not ready', 'MEDIA_NOT_READY'));

    const { access, body } = await loadAccessWithBody(
      'c1',
      undefined,
      cookies,
      followers
    );

    expect(access.hasAccess).toBe(true);
    expect(body).toBeNull();
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      'Access granted but /stream returned no body',
      expect.anything()
    );
  });

  // The contract-fault log fires only for a GRANT without a body. A denial or
  // an outage is not that fault: logging them would put an error on every
  // paywall view and bury the real one.
  it('returns no body when access is denied, and logs no fault', async () => {
    streamThrows(new ApiError(403, 'denied', 'ACCESS_DENIED'));

    const { access, body } = await loadAccessWithBody(
      'c1',
      undefined,
      cookies,
      followers
    );

    expect(access.hasAccess).toBe(false);
    expect(body).toBeNull();
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      'Access granted but /stream returned no body',
      expect.anything()
    );
  });

  it('an outage is a failed check with no body, and logs no fault', async () => {
    streamThrows(new ApiError(500, 'boom'));

    const { access, body } = await loadAccessWithBody(
      'c1',
      undefined,
      cookies,
      followers
    );

    expect(access).toMatchObject({ hasAccess: false, accessCheckFailed: true });
    expect(body).toBeNull();
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      'Access granted but /stream returned no body',
      expect.anything()
    );
  });

  it('the fast path (loadAccessAndProgress) never asks for the body', async () => {
    const getStreamingUrl = streamReturns(granted);

    await loadAccessAndProgress('c1', undefined, cookies, policy());

    expect(getStreamingUrl).toHaveBeenCalledWith('c1', { includeBody: false });
  });
});
