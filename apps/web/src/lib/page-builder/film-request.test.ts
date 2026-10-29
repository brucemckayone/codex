/**
 * `createFilmRequester` (owner P10): the sales page's `requestFilm` ALWAYS
 * settles and never rejects. The player waits on it with the film loading, so
 * a refusal, a failure, a throw and a hang must each end as `null`, the 30s
 * preview.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFilmRequester,
  createOrgFilmRequester,
  FILM_REQUEST_TIMEOUT_MS,
} from './film-request';

const IDS = {
  organizationId: '1a000000-0000-4000-8000-000000000001',
  courseId: '2b000000-0000-4000-8000-000000000002',
};
const STREAM = { playlistUrl: 'https://api.test/films/hls/master.m3u8?t=1' };

describe('createFilmRequester', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once per press for that org, course and film, and hands back the stream', async () => {
    const ask = vi.fn().mockResolvedValue(STREAM);
    const requestFilm = createFilmRequester(IDS, ask);

    expect(await requestFilm('reel')).toEqual(STREAM);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith({ ...IDS, film: 'reel' });
  });

  it('passes a refusal through as null', async () => {
    const requestFilm = createFilmRequester(
      IDS,
      vi.fn().mockResolvedValue(null)
    );
    expect(await requestFilm('intro')).toBeNull();
  });

  it('turns a rejection and a synchronous throw into null', async () => {
    const rejecting = createFilmRequester(
      IDS,
      vi.fn().mockRejectedValue(new Error('500'))
    );
    const throwing = createFilmRequester(
      IDS,
      vi.fn(() => {
        throw new Error('called during render');
      })
    );
    expect(await rejecting('guide')).toBeNull();
    expect(await throwing('guide')).toBeNull();
  });

  it('settles as null when the request hangs, and ignores a late answer', async () => {
    let answer: (value: typeof STREAM) => void = () => {};
    const ask = vi.fn(
      () =>
        new Promise<typeof STREAM>((resolve) => {
          answer = resolve;
        })
    );
    const pending = createFilmRequester(IDS, ask)('intro');

    await vi.advanceTimersByTimeAsync(FILM_REQUEST_TIMEOUT_MS);
    expect(await pending).toBeNull();
    answer(STREAM);
    expect(await pending).toBeNull();
  });

  it('asks nothing for a page with no organisation', async () => {
    const ask = vi.fn();
    const requestFilm = createFilmRequester(
      { organizationId: undefined, courseId: IDS.courseId },
      ask
    );
    expect(await requestFilm('intro')).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});

// The org landing's intro film (Codex-376dl) settles by the same rule.
describe('createOrgFilmRequester', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once per press for that org, and hands back the stream', async () => {
    const ask = vi.fn().mockResolvedValue(STREAM);
    const requestFilm = createOrgFilmRequester(IDS.organizationId, ask);

    expect(await requestFilm()).toEqual(STREAM);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith({ organizationId: IDS.organizationId });
  });

  it('turns a refusal, a rejection and a synchronous throw into null', async () => {
    const answers = [
      vi.fn().mockResolvedValue(null),
      vi.fn().mockRejectedValue(new Error('500')),
      vi.fn(() => {
        throw new Error('called during render');
      }),
    ];
    for (const ask of answers) {
      expect(
        await createOrgFilmRequester(IDS.organizationId, ask)()
      ).toBeNull();
    }
  });

  it('settles as null when the request hangs', async () => {
    const pending = createOrgFilmRequester(
      IDS.organizationId,
      vi.fn(() => new Promise<typeof STREAM>(() => {}))
    )();

    await vi.advanceTimersByTimeAsync(FILM_REQUEST_TIMEOUT_MS);
    expect(await pending).toBeNull();
  });
});
