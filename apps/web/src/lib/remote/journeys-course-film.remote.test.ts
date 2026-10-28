// @vitest-environment node

/**
 * `requestCourseFilm` (owner P10, "Full film unless it's paid"): the command
 * behind the public sales page's `requestFilm`.
 *
 * It forwards the org, course and film the page names to the worker's public
 * minter, and hands back the playlist URL and when its links run out (so the
 * player renews it in time), or null when the film may only play its 30s
 * preview. The eligibility is the worker's; what this pins is the
 * wire: the arguments, the contract shape, and that a film the press cannot
 * ask for is refused before any worker call.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseFilmStream = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({ access: { courseFilmStream } })),
}));

/**
 * Each remote runs its handler on the schema-parsed input, as SvelteKit does,
 * so a value the schema refuses never reaches the worker.
 */
vi.mock('$app/server', () => {
  const remote =
    (type: string) =>
    (...args: unknown[]) => {
      const fn = args[args.length - 1] as (input: unknown) => unknown;
      const schema = args.length > 1 ? args[0] : undefined;
      const wrapped = (input: unknown) =>
        fn(
          schema
            ? (schema as { parse: (v: unknown) => unknown }).parse(input)
            : input
        );
      return Object.assign(wrapped, { __: { type } });
    };
  return {
    command: vi.fn(remote('command')),
    form: vi.fn(remote('form')),
    query: vi.fn(remote('query')),
    getRequestEvent: vi.fn(() => ({ platform: { env: {} }, cookies: {} })),
  };
});

const { requestCourseFilm } = await import('./journeys.remote');

const ORG_ID = '1a000000-0000-4000-8000-000000000001';
const COURSE_ID = '2b000000-0000-4000-8000-000000000002';

beforeEach(() => {
  courseFilmStream.mockReset();
});

describe('requestCourseFilm', () => {
  it('asks the minter for that org, course and film, and returns the URL and its expiry', async () => {
    courseFilmStream.mockResolvedValue({
      playlistUrl: 'https://api.test/films/hls/master.m3u8?token=t',
      expiresAt: '2026-10-28T10:10:00.000Z',
    });

    const result = await requestCourseFilm({
      organizationId: ORG_ID,
      courseId: COURSE_ID,
      film: 'guide',
    });

    expect(courseFilmStream).toHaveBeenCalledWith(ORG_ID, COURSE_ID, 'guide');
    expect(result).toEqual({
      playlistUrl: 'https://api.test/films/hls/master.m3u8?token=t',
      expiresAt: '2026-10-28T10:10:00.000Z',
    });
  });

  it('passes the preview-only answer through as null', async () => {
    courseFilmStream.mockResolvedValue(null);
    expect(
      await requestCourseFilm({
        organizationId: ORG_ID,
        courseId: COURSE_ID,
        film: 'intro',
      })
    ).toBeNull();
  });

  it('refuses the hero, which a press never asks for, before calling the worker', async () => {
    await expect(
      Promise.resolve().then(() =>
        requestCourseFilm({
          organizationId: ORG_ID,
          courseId: COURSE_ID,
          film: 'hero' as 'intro',
        })
      )
    ).rejects.toThrow();
    expect(courseFilmStream).not.toHaveBeenCalled();
  });
});
