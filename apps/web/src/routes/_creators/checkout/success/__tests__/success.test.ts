/**
 * Creator content checkout success load — what a failed verify becomes.
 *
 * The same rule as the org /checkout/success: every failure is logged; a 5xx,
 * a network failure (including the client's own 408 timeout) or a 429 rate
 * limit is transient and retried; any other 4xx reports `verifyFailed`, and
 * the page shows its error state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/server/errors';

const { verifyMock, warnMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ checkout: { verify: verifyMock } }),
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
