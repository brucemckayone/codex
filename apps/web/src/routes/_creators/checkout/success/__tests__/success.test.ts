/**
 * Creator content checkout success load — what a failed verify becomes.
 *
 * The same rule as the org /checkout/success: every failure is logged; a 5xx,
 * a network failure (including the client's own 408 timeout) or a 429 rate
 * limit is transient and retried; any other 4xx reports `verifyFailed`, and
 * the page shows its error state. A paid session with no record of ours
 * streams the completion on arrival, as there (Codex-2hxff.22).
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
      'http://creators.lvh.me:3000/checkout/success?session_id=cs_test_abc&username=ellie&contentSlug=rootwork'
    ),
    locals: { user: { id: 'user-1' } },
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

describe('creator checkout success load — a failed verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['a 5xx', new ApiError(500, 'Internal'), 500],
    ['the client timeout', new ApiError(408, 'timed out'), 408],
    ['a rate limit', new ApiError(429, 'Too many requests'), 429],
    ['a network failure', new TypeError('fetch failed'), undefined],
  ])('%s is pending: retried, and logged', async (_label, failure, status) => {
    const data = await loadWith(failure);

    expect(data.verification).toBeNull();
    expect(data.verifyFailed).toBe(false);
    expect(data.username).toBe('ellie');
    expect(warnMock).toHaveBeenCalledWith(
      'creator-checkout-success: verify failed',
      {
        sessionId: 'cs_test_abc',
        status,
        transient: true,
        error: (failure as Error).message,
      }
    );
  });

  it.each([
    ['not this user’s session', 403],
    ['no such session', 400],
  ])('a 4xx (%s) is final: the error state, and logged', async (_label, status) => {
    const data = await loadWith(new ApiError(status, 'Refused'));

    expect(data.verification).toBeNull();
    expect(data.verifyFailed).toBe(true);
    expect(warnMock).toHaveBeenCalledWith(
      'creator-checkout-success: verify failed',
      {
        sessionId: 'cs_test_abc',
        status,
        transient: false,
        error: 'Refused',
      }
    );
  });
});

describe('creator checkout success load — unlock on arrival (Codex-2hxff.22)', () => {
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

    expect(completeMock).toHaveBeenCalledWith('cs_test_abc');
    await expect(data.unlock).resolves.toEqual(unlocked);
  });

  it('a session already recorded asks for no completion', async () => {
    verifyMock.mockResolvedValueOnce({
      sessionStatus: 'complete',
      state: 'unlocked',
    });
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    expect(data.unlock).toBeNull();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('a failed completion is logged and resolves to null', async () => {
    verifyMock.mockResolvedValueOnce({
      sessionStatus: 'complete',
      state: 'recording',
    });
    completeMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    await expect(data.unlock).resolves.toBeNull();
    expect(warnMock).toHaveBeenCalledWith(
      'creator-checkout-success: completion on arrival failed',
      expect.objectContaining({ sessionId: 'cs_test_abc', transient: true })
    );
  });
});
