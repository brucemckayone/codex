/**
 * Journey dashboard — server gate (Codex-aectb).
 *
 * The dashboard `load` is the ENFORCING half of the course entitlement gate: it
 * resolves slug→course, asks `resolveCanEnterCourse`, and either renders the
 * member portal or 303s to the public sales page. Only the PURE decision
 * (`evaluateCourseGate`) had coverage; the load — the I/O, the ordering, the
 * redirect target, and the failure mode — had none. This locks all four.
 *
 * WHY THE PAIR MATTERS: the sell page now redirects the OTHER way (entitled →
 * dashboard), so the two surfaces point at each other. The invariant that keeps
 * that loop-free is ONLY REDIRECT ON A POSITIVE, CONFIDENT SIGNAL; ON DOUBT,
 * RENDER WHERE YOU ARE — here expressed as `.catch(() => false)`, which routes a
 * failed lookup to sales (where it RENDERS) rather than 500ing.
 *
 * `@sveltejs/kit` is deliberately NOT mocked: the real `redirect()` and `error()`
 * THROW, so a load that reaches its `return` proves no redirect fired. A
 * hand-rolled `redirect` spy that only records its arguments would let the
 * guarded code run on and every assertion below would pass vacuously.
 *
 * Lives in `__tests__/` (not a `+`-prefixed route file — SvelteKit reserves
 * those); mirrors the sibling sales-page load test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CourseDashboardData,
  JourneyCourseSummary,
} from '$lib/journeys/types';

const MOCK_COURSE = {
  id: '00000000-0000-4000-8000-0000000000c0',
  slug: 'rootwork',
  title: 'Rootwork',
  organizationSlug: 'acme',
} satisfies JourneyCourseSummary;

/**
 * The rollup the load hands to the view. Opaque to the load itself — it is
 * returned verbatim — so this fixture only has to satisfy the contract.
 */
const MOCK_DASHBOARD = {
  course: MOCK_COURSE,
  enrollment: {
    courseId: MOCK_COURSE.id,
    enrolledAt: '2026-06-01T09:00:00.000Z',
    lastActivityAt: null,
    completedAt: null,
  },
  stages: [],
  completions: [],
} satisfies CourseDashboardData;

const {
  resolveCourseBySlugMock,
  resolveCanEnterCourseMock,
  fetchCourseDashboardMock,
} = vi.hoisted(() => ({
  resolveCourseBySlugMock: vi.fn(),
  resolveCanEnterCourseMock: vi.fn(),
  fetchCourseDashboardMock: vi.fn(),
}));

// The member-surface web→worker boundary. Mocked so the gate's structure,
// ordering, and failure mode are tested without a content-api round-trip.
vi.mock('$lib/server/journeys/round-d-seam', () => ({
  resolveCourseBySlug: resolveCourseBySlugMock,
  resolveCanEnterCourse: resolveCanEnterCourseMock,
  fetchCourseDashboard: fetchCourseDashboardMock,
}));

// NOTE: `$lib/journeys/gate` is intentionally NOT mocked — the load must be
// tested against the REAL `evaluateCourseGate`, because that shared pure
// function is precisely what makes the sell↔dashboard pair loop-free.

type LoadInput = Parameters<typeof import('../+page.server').load>[0];

type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

function makeEvent(journeySlug: string, user: { id: string } | null = null) {
  const depends = vi.fn();
  const event = {
    params: { slug: 'acme', journeySlug },
    parent: async () => ({ org: { slug: 'acme' }, user }),
    depends,
    url: new URL(`http://acme.lvh.me:3000/journeys/${journeySlug}/dashboard`),
    // Present so the load can build a round-d-seam context (the seam is mocked).
    platform: {},
    cookies: {},
    locals: user ? { user } : {},
  } as unknown as LoadInput;
  return { event, depends };
}

describe('journey dashboard +page.server load', () => {
  /**
   * Where a non-entitled visitor lands. Root-relative because the org slug lives
   * in the hostname (we are already on acme.lvh.me) — an absolute URL here would
   * be a cross-origin regression.
   */
  const SALES_URL = '/journeys/rootwork';

  beforeEach(() => {
    vi.clearAllMocks();
    resolveCourseBySlugMock.mockResolvedValue(MOCK_COURSE);
    resolveCanEnterCourseMock.mockResolvedValue(true);
    fetchCourseDashboardMock.mockResolvedValue(MOCK_DASHBOARD);
  });

  it('renders the portal for an entitled member', async () => {
    const { load } = await import('../+page.server');
    const { event, depends } = makeEvent('rootwork', { id: 'user-1' });

    // Resolving at all proves no redirect fired — the real `redirect()` throws.
    const data = (await load(event)) as LoadData;

    expect(data.dashboard).toBe(MOCK_DASHBOARD);
    expect(resolveCanEnterCourseMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      MOCK_COURSE.id
    );
    expect(depends).toHaveBeenCalledWith('app:auth');
  });

  it('303s a signed-in visitor who is NOT entitled to the sales page', async () => {
    resolveCanEnterCourseMock.mockResolvedValueOnce(false);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'window-shopper' });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: SALES_URL,
    });
  });

  it('never reads progress data for a non-entitled visitor', async () => {
    resolveCanEnterCourseMock.mockResolvedValueOnce(false);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'window-shopper' });

    await expect(load(event)).rejects.toMatchObject({ status: 303 });

    // Gate ordering is the security property: the redirect fires BEFORE the
    // enrollment/rollup read, so a non-entitled user never receives progress.
    expect(fetchCourseDashboardMock).not.toHaveBeenCalled();
  });

  it('303s an anonymous visitor to the sales page', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork'); // no session

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: SALES_URL,
    });
    // No session ⇒ nothing to ask the resolver about.
    expect(resolveCanEnterCourseMock).not.toHaveBeenCalled();
  });

  it('303s to sales — never 500s — when the entitlement resolver THROWS', async () => {
    // `resolveCanEnterCourse` reaches a worker through the shared `request()`
    // helper, which throws `ApiError` on a timeout or any non-2xx. Uncaught, that
    // was a 500 on a surface with a perfectly good fallback.
    resolveCanEnterCourseMock.mockRejectedValueOnce(new Error('access down'));
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'user-1' });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: SALES_URL,
    });
  });

  it('404s when no course resolves for the slug', async () => {
    resolveCourseBySlugMock.mockResolvedValueOnce(null);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('ghost-course', { id: 'user-1' });

    // Nothing to sell ⇒ 404, not a redirect to a sales page that does not exist.
    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });

  it('404s when the rollup is missing despite a passing gate', async () => {
    fetchCourseDashboardMock.mockResolvedValueOnce(null);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'user-1' });

    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });

  it('falls back to the route slug in the sales URL when the course has none', async () => {
    resolveCourseBySlugMock.mockResolvedValueOnce({
      ...MOCK_COURSE,
      slug: null,
    } satisfies JourneyCourseSummary);
    resolveCanEnterCourseMock.mockResolvedValueOnce(false);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork', { id: 'window-shopper' });

    // The redirect is built from the ROUTE param, so it round-trips to the URL
    // the visitor asked for rather than dead-ending on a null slug.
    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: SALES_URL,
    });
  });
});
