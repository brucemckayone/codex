/**
 * Public journey sales page — server load (Codex-2pryk.3.1 · WP-3).
 *
 * Locks the shell+stream contract:
 *   - the course page is AWAITED (SEO / first paint);
 *   - the sell-preview is STREAMED as a bare, `.catch()`-guarded promise off the
 *     critical path (a media-resolver failure degrades to null, never rejects
 *     the load);
 *   - a missing published page → 404.
 *
 * The `../journey-data` seam is mocked so the load's shell/stream wiring is
 * tested in isolation from the (currently mocked) data source. Neon-free.
 *
 * Lives in `__tests__/` (not a `+`-prefixed route file — SvelteKit reserves
 * those); mirrors the explore page-load test precedent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_COURSE_PAGE, MOCK_SELL_PREVIEW } from '../journey-page.mock';

const { getCoursePageMock, resolveSellPreviewMock } = vi.hoisted(() => ({
  getCoursePageMock: vi.fn(),
  resolveSellPreviewMock: vi.fn(),
}));

vi.mock('../journey-data', () => ({
  getCoursePage: getCoursePageMock,
  resolveSellPreview: resolveSellPreviewMock,
}));

vi.mock('$lib/server/cache', () => ({
  CACHE_HEADERS: {
    PRIVATE: { 'cache-control': 'private, no-store' },
    DYNAMIC_PUBLIC: { 'cache-control': 'public, max-age=60' },
  },
}));

type LoadInput = Parameters<typeof import('../+page.server').load>[0];

// `load` is typed `PageServerLoad`, whose return union includes `void`; this
// load always resolves to the data object (or throws), so filter `void` off the
// awaited union for the property assertions below.
type LoadData = Extract<
  Awaited<ReturnType<typeof import('../+page.server').load>>,
  object
>;

function makeEvent(journeySlug: string) {
  const setHeaders = vi.fn();
  const depends = vi.fn();
  const event = {
    params: { slug: 'acme', journeySlug },
    parent: async () => ({}),
    setHeaders,
    depends,
    url: new URL(`http://acme.lvh.me:3000/journeys/${journeySlug}`),
  } as unknown as LoadInput;
  return { event, setHeaders, depends };
}

describe('journey sales +page.server load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoursePageMock.mockResolvedValue(MOCK_COURSE_PAGE);
    resolveSellPreviewMock.mockResolvedValue(MOCK_SELL_PREVIEW);
  });

  it('awaits the course page and returns it for first paint / SEO', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(getCoursePageMock).toHaveBeenCalledWith({ slug: 'rootwork' });
    expect(data.coursePage).toBe(MOCK_COURSE_PAGE);
    expect(data.orgSlug).toBe('acme');
  });

  it('registers the version-cache dependency and commits a cache header', async () => {
    const { load } = await import('../+page.server');
    const { event, setHeaders, depends } = makeEvent('rootwork');

    await load(event);

    expect(depends).toHaveBeenCalledWith('cache:versions');
    expect(setHeaders).toHaveBeenCalledTimes(1);
  });

  it('streams the sell-preview as a promise (off the critical path)', async () => {
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    expect(data.sellPreview).toBeInstanceOf(Promise);
    await expect(data.sellPreview).resolves.toBe(MOCK_SELL_PREVIEW);
    expect(resolveSellPreviewMock).toHaveBeenCalledWith({
      pageId: MOCK_COURSE_PAGE.page.id,
      courseId: MOCK_COURSE_PAGE.course.id,
    });
  });

  it('.catch()-guards the streamed preview so a resolver failure degrades to null', async () => {
    resolveSellPreviewMock.mockRejectedValueOnce(
      new Error('media resolver down')
    );
    const { load } = await import('../+page.server');
    const { event } = makeEvent('rootwork');

    const data = (await load(event)) as LoadData;

    // The load already returned; the streamed promise must not reject.
    await expect(data.sellPreview).resolves.toBeNull();
  });

  it('throws 404 when no published page matches the slug', async () => {
    getCoursePageMock.mockResolvedValueOnce(null);
    const { load } = await import('../+page.server');
    const { event } = makeEvent('does-not-exist');

    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });
});
