/**
 * `access.courseFilmStream` (owner P10) sends the exact path and query the
 * worker's minter reads, and gives up at its own 6s, below the page's 8s.
 *
 * Both sides mock the seam between them, so nothing else ties the URL this
 * builds to `courseFilmParamsSchema` / `courseFilmQuerySchema`: a renamed key
 * would pass CI on both sides and answer every press with a 400. And a mint
 * slower than the page's wait must end here as a logged 408, not as a silent
 * give-up in the browser.
 */
import {
  courseFilmParamsSchema,
  courseFilmQuerySchema,
} from '@codex/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILM_REQUEST_TIMEOUT_MS } from '$lib/page-builder/film-request';

vi.mock('$lib/observability', () => ({
  logger: {
    startTimer: vi.fn(() => ({ end: vi.fn() })),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// The test setup mocks `$lib/server/api` for every file (src/tests/mocks.ts);
// this one needs the real request().
const { createServerApi } =
  await vi.importActual<typeof import('./api')>('./api');

const ORG_ID = '1a000000-0000-4000-8000-000000000001';
const COURSE_ID = '2b000000-0000-4000-8000-000000000002';

const api = () =>
  createServerApi({ env: {} } as never, { get: vi.fn() } as never);

describe('server API: the course-film mint', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks the path and query the worker route reads', async () => {
    const fetchMock = vi.fn((_url: string | URL | Request) =>
      Promise.resolve(Response.json({ data: null }))
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(
      await api().access.courseFilmStream(ORG_ID, COURSE_ID, 'guide')
    ).toBeNull();

    const [input] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(input), 'http://content-api.test');
    const [, , , courses, courseId, films, film, stream] =
      url.pathname.split('/');
    expect([courses, films, stream]).toEqual(['courses', 'films', 'stream']);
    expect(courseFilmParamsSchema.parse({ courseId, film })).toEqual({
      courseId: COURSE_ID,
      film: 'guide',
    });
    expect(
      courseFilmQuerySchema.parse(Object.fromEntries(url.searchParams))
    ).toEqual({ organizationId: ORG_ID });
  });

  it('gives up at 6s with a 408, before the page stops waiting', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      )
    );

    let outcome: number | 'pending' | 'resolved' = 'pending';
    const settled = api()
      .access.courseFilmStream(ORG_ID, COURSE_ID, 'intro')
      .then(
        () => {
          outcome = 'resolved';
        },
        (err: { status?: number }) => {
          outcome = err.status ?? -1;
        }
      );

    await vi.advanceTimersByTimeAsync(5999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(outcome).toBe(408);
    // And the page is still waiting when it does: its own bound is later.
    expect(FILM_REQUEST_TIMEOUT_MS).toBeGreaterThan(6000);
  });
});
