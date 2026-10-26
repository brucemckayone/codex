/**
 * In-course player: a course lesson paused by a payment dispute
 * (Codex-2hxff.60, owner decision 2026-10-24).
 *
 * The player's gate is the can-enter read. It refuses a course whose purchase
 * or subscription is disputed, and the gate's fallback is the course's sales
 * page. The owner decided a course lesson keeps the dispute notice, so when
 * the refusal carries a `disputeHold` the load sends the reader to the
 * lesson's content page, which shows the notice with no Buy or Subscribe.
 * Every other refusal still goes to the sales page.
 *
 * `@sveltejs/kit` is deliberately NOT mocked: the real `redirect()` and
 * `error()` THROW, so a load that reaches its `return` proves no redirect
 * fired (the dashboard test's convention).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JourneyCourseSummary } from '$lib/journeys/types';

const MOCK_COURSE = {
  id: '00000000-0000-4000-8000-0000000000c0',
  slug: 'rootwork',
  title: 'Rootwork',
  organizationSlug: 'acme',
} satisfies JourneyCourseSummary;

const MOCK_PRACTICE = {
  course: MOCK_COURSE,
  stage: { id: 'stage-1', name: 'Ground' },
  practice: { contentId: 'content-1', contentType: 'written' },
  streamingUrl: null,
  waveformUrl: null,
  bodyHtml: '<p>Lesson</p>',
  bodyUnavailable: false,
  initialProgressSeconds: 0,
  playlist: [],
  completions: [],
};

const REFUSED = { canEnter: false, disputeHold: null };

const {
  resolveCourseBySlugMock,
  resolveCourseEntryMock,
  resolveCanViewMock,
  fetchCourseDashboardMock,
  fetchInCoursePracticeMock,
} = vi.hoisted(() => ({
  resolveCourseBySlugMock: vi.fn(),
  resolveCourseEntryMock: vi.fn(),
  resolveCanViewMock: vi.fn(),
  fetchCourseDashboardMock: vi.fn(),
  fetchInCoursePracticeMock: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger: mockLogger }));

vi.mock('$lib/server/journeys/round-d-seam', () => ({
  resolveCourseBySlug: resolveCourseBySlugMock,
  resolveCourseEntry: resolveCourseEntryMock,
  resolveCanView: resolveCanViewMock,
  fetchCourseDashboard: fetchCourseDashboardMock,
  fetchInCoursePractice: fetchInCoursePracticeMock,
}));

type LoadInput = Parameters<typeof import('../+page.server').load>[0];

const setHeadersMock = vi.fn();

function makeEvent(user: { id: string } | null) {
  return {
    params: { slug: 'acme', journeySlug: 'rootwork', contentSlug: 'grounding' },
    parent: async () => ({ org: { id: 'org-1', slug: 'acme' }, user }),
    depends: vi.fn(),
    setHeaders: setHeadersMock,
    url: new URL(
      'http://acme.lvh.me:3000/journeys/rootwork/practice/grounding'
    ),
    platform: {},
    cookies: {},
    locals: user ? { user } : {},
  } as unknown as LoadInput;
}

describe('in-course player +page.server load: a payment dispute', () => {
  const SALES_URL = '/journeys/rootwork';
  const LESSON_URL = '/content/grounding';

  beforeEach(() => {
    vi.clearAllMocks();
    resolveCourseBySlugMock.mockResolvedValue(MOCK_COURSE);
    resolveCourseEntryMock.mockResolvedValue(REFUSED);
    resolveCanViewMock.mockResolvedValue(true);
    fetchCourseDashboardMock.mockResolvedValue(null);
    fetchInCoursePracticeMock.mockResolvedValue(MOCK_PRACTICE);
  });

  it.each([
    'purchase_dispute',
    'subscription_dispute',
  ] as const)('a %s on the course sends the reader to the lesson page, not the sales page', async (reason) => {
    resolveCourseEntryMock.mockResolvedValueOnce({
      canEnter: false,
      disputeHold: reason,
    });
    const { load } = await import('../+page.server');

    await expect(load(makeEvent({ id: 'user-1' }))).rejects.toMatchObject({
      status: 303,
      location: LESSON_URL,
    });
    expect(resolveCourseEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      MOCK_COURSE.id
    );
  });

  it('any other refusal still goes to the sales page', async () => {
    const { load } = await import('../+page.server');

    await expect(load(makeEvent({ id: 'user-1' }))).rejects.toMatchObject({
      status: 303,
      location: SALES_URL,
    });
  });

  it('an anonymous visitor goes to the sales page with no entry read', async () => {
    const { load } = await import('../+page.server');

    await expect(load(makeEvent(null))).rejects.toMatchObject({
      status: 303,
      location: SALES_URL,
    });
    expect(resolveCourseEntryMock).not.toHaveBeenCalled();
  });

  it('an entitled member plays the lesson', async () => {
    resolveCourseEntryMock.mockResolvedValueOnce({
      canEnter: true,
      disputeHold: null,
    });
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent({ id: 'user-1' }))) as {
      practice: typeof MOCK_PRACTICE;
    };
    expect(data.practice.practice.contentId).toBe('content-1');
    // A paid lesson is stored nowhere (Codex-hyz1c).
    expect(setHeadersMock).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-store',
    });
  });

  it('a failed dashboard read still plays the lesson, and is logged', async () => {
    resolveCourseEntryMock.mockResolvedValueOnce({
      canEnter: true,
      disputeHold: null,
    });
    fetchCourseDashboardMock.mockRejectedValueOnce(new Error('dashboard down'));
    const { load } = await import('../+page.server');

    const data = (await load(makeEvent({ id: 'user-1' }))) as {
      stageGloss: string | null;
    };

    expect(data.stageGloss).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Course dashboard not loaded',
      expect.objectContaining({
        courseId: MOCK_COURSE.id,
        error: 'dashboard down',
      })
    );
  });
});
