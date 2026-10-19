/**
 * Studio membership gate — a FAILED read is a retryable 503, not an eviction
 * (Codex-61zsk.22).
 *
 * Seen twice at a load average near 30: a signed-in owner navigating to their
 * own studio landed on `/?error=access_denied`. The gate caught a failed
 * membership read and handed back `role: null`, which is also the endpoint's
 * answer for a genuine non-member, so a backend blip read as "not a member".
 *
 * The endpoint admits non-members on purpose and answers them 200 with
 * `role: null`, so the two cases are separable here: a resolved `null` is an
 * answer (redirect), a rejection is a failure (503). The non-member and
 * `member` cases are asserted too, so a load that simply stopped redirecting
 * cannot pass the failure case.
 */

import { isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMyMembership = vi.hoisted(() => vi.fn());

// `$lib/remote/org.remote` builds a remote `query()` at module scope, which
// needs SvelteKit app hooks a unit test has no access to.
vi.mock('$lib/remote/org.remote', () => ({
  getMyOrganizations: vi.fn(async () => []),
}));
vi.mock('$lib/server/api', () => ({
  createServerApi: () => ({
    org: { getMyMembership },
    content: { list: vi.fn(async () => ({ pagination: { total: 0 } })) },
  }),
}));
vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { load } = await import('../+layout.server');

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
  slug: 'studio-alpha',
};

type LoadEvent = Parameters<typeof load>[0];

function runLoad() {
  return load({
    locals: { user: { id: 'u1', name: 'Creator', email: 'c@example.test' } },
    parent: async () => ({ org: ORG }),
    depends: vi.fn(),
    platform: {},
    cookies: {},
    setHeaders: vi.fn(),
    url: new URL('http://studio-alpha.lvh.me:3010/studio'),
  } as unknown as LoadEvent);
}

/** What the load threw, or `undefined` when it returned. */
async function thrownBy(run: () => unknown): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('studio membership gate', () => {
  beforeEach(() => {
    getMyMembership.mockReset();
  });

  it('answers a failed membership read with a 503, not the access-denied redirect', async () => {
    getMyMembership.mockRejectedValue(new Error('upstream timed out'));

    const thrown = await thrownBy(runLoad);

    expect(isRedirect(thrown)).toBe(false);
    expect(isHttpError(thrown, 503)).toBe(true);
  });

  it('still redirects a genuine non-member, whose read answers role: null', async () => {
    getMyMembership.mockResolvedValue({ role: null, joinedAt: null });

    const thrown = await thrownBy(runLoad);

    expect(isRedirect(thrown)).toBe(true);
    expect(isRedirect(thrown) && thrown.location).toBe('/?error=access_denied');
    // The read-after-write retry (Codex-jko8i) re-read before giving up.
    expect(getMyMembership.mock.calls.length).toBeGreaterThan(1);
  });

  it('still redirects a plain member, who has no studio', async () => {
    getMyMembership.mockResolvedValue({ role: 'member', joinedAt: null });

    const thrown = await thrownBy(runLoad);

    expect(isRedirect(thrown) && thrown.location).toBe('/?error=access_denied');
  });

  it('lets the owner in', async () => {
    getMyMembership.mockResolvedValue({ role: 'owner', joinedAt: null });

    const data = await runLoad();

    expect(data).toMatchObject({ userRole: 'owner', org: { id: ORG.id } });
  });
});
