/**
 * Org content checkout success load — what a failed verify becomes.
 *
 * Every failure is logged. A 5xx, a network failure (including the client's
 * own 408 timeout) or a 429 rate limit is transient: the page stays pending
 * and retries. Any other 4xx will not change on retry, so the load reports
 * `verifyFailed` and the page shows its error state.
 *
 * Unlock on arrival (Codex-2hxff.22): a paid session with no record of ours
 * (`recording`) also streams the completion (`unlock`); any other state does
 * not call it. A failed completion is logged and resolves to null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/server/errors';

const { verifyMock, completeMock, warnMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  completeMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    checkout: { verify: verifyMock, complete: completeMock },
  }),
}));
vi.mock('$lib/observability', () => ({ logger: { warn: warnMock } }));

type LoadInput = Parameters<typeof import('../+page.server').load>[0];
type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

function makeEvent() {
  return {
    url: new URL(
      'http://of-blood-and-bones.lvh.me:3000/checkout/success?session_id=cs_test_abc&contentSlug=rootwork'
    ),
    locals: { user: { id: 'user-1' } },
    parent: async () => ({ org: { id: 'org-1', name: 'Of Blood and Bones' } }),
    platform: {},
    cookies: {},
    setHeaders: vi.fn(),
    depends: vi.fn(),
  } as unknown as LoadInput;
}

async function loadWith(failure: unknown) {
  verifyMock.mockRejectedValueOnce(failure);
  const { load } = await import('../+page.server');
  return (await load(makeEvent())) as LoadData;
}

describe('org checkout success load — a failed verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['a 5xx', new ApiError(503, 'Service unavailable'), 503],
    ['the client timeout', new ApiError(408, 'timed out'), 408],
    ['a rate limit', new ApiError(429, 'Too many requests'), 429],
    ['a network failure', new TypeError('fetch failed'), undefined],
  ])('%s is pending: retried, and logged', async (_label, failure, status) => {
    const data = await loadWith(failure);

    expect(data.verification).toBeNull();
    expect(data.verifyFailed).toBe(false);
    expect(data.contentSlug).toBe('rootwork');
    expect(warnMock).toHaveBeenCalledWith('checkout-success: verify failed', {
      sessionId: 'cs_test_abc',
      status,
      transient: true,
      error: (failure as Error).message,
    });
  });

  it.each([
    ['not this user’s session', 403],
    ['no such session', 400],
  ])('a 4xx (%s) is final: the error state, and logged', async (_label, status) => {
    const data = await loadWith(new ApiError(status, 'Refused'));

    expect(data.verification).toBeNull();
    expect(data.verifyFailed).toBe(true);
    expect(warnMock).toHaveBeenCalledWith('checkout-success: verify failed', {
      sessionId: 'cs_test_abc',
      status,
      transient: false,
      error: 'Refused',
    });
  });

  it('a successful verify is passed through, not failed', async () => {
    const verification = { sessionStatus: 'open', state: 'open' };
    verifyMock.mockResolvedValueOnce(verification);
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    expect(data.verification).toEqual(verification);
    expect(data.verifyFailed).toBe(false);
    expect(warnMock).not.toHaveBeenCalled();
  });
});

describe('org checkout success load — unlock on arrival (Codex-2hxff.22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paid with no record of ours: the completion is asked for once, and streamed', async () => {
    const unlocked = { sessionStatus: 'complete', state: 'unlocked' };
    verifyMock.mockResolvedValueOnce({
      sessionStatus: 'complete',
      state: 'recording',
    });
    completeMock.mockResolvedValueOnce(unlocked);
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    expect(data.verification?.state).toBe('recording');
    expect(completeMock).toHaveBeenCalledOnce();
    expect(completeMock).toHaveBeenCalledWith('cs_test_abc');
    await expect(data.unlock).resolves.toEqual(unlocked);
  });

  it.each([
    'unlocked',
    'duplicate',
    'refunded',
    'paused',
    'open',
    'expired',
    'unpaid',
  ])('%s: nothing to record, so no completion', async (state) => {
    verifyMock.mockResolvedValueOnce({ sessionStatus: 'complete', state });
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    expect(data.unlock).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('a failed completion is logged and resolves to null, never a rejection', async () => {
    verifyMock.mockResolvedValueOnce({
      sessionStatus: 'complete',
      state: 'recording',
    });
    completeMock.mockRejectedValueOnce(new ApiError(503, 'Not yet'));
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    await expect(data.unlock).resolves.toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      'checkout-success: completion on arrival failed',
      {
        sessionId: 'cs_test_abc',
        status: 503,
        transient: true,
        error: 'Not yet',
      }
    );
  });

  it('a failed verify asks for no completion', async () => {
    const data = await loadWith(new ApiError(503, 'Service unavailable'));

    expect(data.unlock).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });
});
