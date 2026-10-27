/**
 * Org tier subscription success load — what a failed verify becomes.
 *
 * Every failure is logged. A 5xx, a network failure (including the client's
 * own 408 timeout) or a 429 rate limit is transient: the page stays pending
 * and retries. Any other 4xx — not this user's session, or no such session —
 * will not change on retry, so the load reports `verifyFailed` and the page
 * shows its error state.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/server/errors';

const { verifyMock, warnMock } = vi.hoisted(() => ({
  verifyMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({ subscription: { verify: verifyMock } }),
}));
vi.mock('$lib/observability', () => ({ logger: { warn: warnMock } }));

type LoadInput = Parameters<typeof import('../+page.server').load>[0];
type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

const ORG = { id: 'org-1', name: 'Of Blood and Bones' };

function makeEvent() {
  return {
    url: new URL(
      'http://of-blood-and-bones.lvh.me:3000/subscription/success?session_id=cs_test_abc'
    ),
    locals: { user: { id: 'user-1' } },
    parent: async () => ({ org: ORG }),
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

describe('subscription success load — a failed verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['a 5xx', new ApiError(500, 'Kept subscription missing'), 500],
    [
      'the client timeout',
      new ApiError(408, 'timed out', 'REQUEST_TIMEOUT'),
      408,
    ],
    ['a rate limit', new ApiError(429, 'Too many requests'), 429],
    ['a network failure', new TypeError('fetch failed'), undefined],
  ])('%s is pending: retried, and logged', async (_label, failure, status) => {
    const data = await loadWith(failure);

    expect(data.verification).toBeNull();
    expect(data.verifyFailed).toBe(false);
    expect(warnMock).toHaveBeenCalledWith(
      'subscription-success: verify failed',
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
  ])('a 4xx (%s) is final: no retry, and logged', async (_label, status) => {
    const data = await loadWith(new ApiError(status, 'Refused'));

    expect(data.verification).toBeNull();
    expect(data.verifyFailed).toBe(true);
    expect(warnMock).toHaveBeenCalledWith(
      'subscription-success: verify failed',
      {
        sessionId: 'cs_test_abc',
        status,
        transient: false,
        error: 'Refused',
      }
    );
  });

  it('a successful verify is passed through, not failed', async () => {
    const verification = { sessionStatus: 'open' };
    verifyMock.mockResolvedValueOnce(verification);
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent())) as LoadData;

    expect(data.verification).toEqual(verification);
    expect(data.verifyFailed).toBe(false);
    expect(warnMock).not.toHaveBeenCalled();
  });
});
