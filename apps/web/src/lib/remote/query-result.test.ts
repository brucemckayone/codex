/**
 * `queryErrorMessage` tests (Codex-xo3bl).
 *
 * The bug this replaces: four studio pages read `remoteQuery.error?.message`.
 * SvelteKit rejects a failed remote query with `HttpError`, which carries its
 * text at `.body.message` and has NO top-level `.message` — so every one of
 * those reads returned `undefined`, every error branch stayed unreachable, and
 * the surfaces sat on their loading skeletons while the request had already
 * come back 500. The insights page did this for a course-not-found on EVERY
 * load: seven perpetual "Loading metric" skeletons, no error, no console entry.
 *
 * The first test deliberately builds its `HttpError` by catching SvelteKit's own
 * `error()` rather than hand-rolling `{ status, body }`. A literal would only
 * assert my belief about the shape; catching the real thing means that if
 * SvelteKit ever moves the message, THIS test fails instead of the UI going
 * quiet again.
 */

import { error } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import {
  type FreshReadable,
  isFirstLoad,
  queryErrorMessage,
  readFreshQuery,
} from './query-result';

/** A genuine SvelteKit `HttpError` instance, not a look-alike literal. */
function realHttpError(status: number, message: string): unknown {
  try {
    error(status, message);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('error() did not throw — SvelteKit contract changed');
}

describe('queryErrorMessage', () => {
  it('reads the text out of a real SvelteKit HttpError', () => {
    const httpError = realHttpError(500, 'Course not found');

    // Guard the premise: if this ever gains a top-level `message`, the original
    // `.error?.message` read would have worked and this helper's reason to
    // exist is gone. Pin it so the assumption cannot rot silently.
    expect((httpError as { message?: unknown }).message).toBeUndefined();
    expect((httpError as { body?: { message?: unknown } }).body?.message).toBe(
      'Course not found'
    );

    expect(queryErrorMessage(httpError)).toBe('Course not found');
  });

  it('reads a plain Error, which keeps its text at the top level', () => {
    // The batched-query path rejects with exactly this — a bare Error, no body.
    // A body-only helper would return the fallback here and lose the cause.
    expect(queryErrorMessage(new Error('Failed to execute batch query'))).toBe(
      'Failed to execute batch query'
    );
  });

  it('prefers HttpError.body.message over a top-level message', () => {
    // Some rejections carry both; the server-authored body text is the useful
    // one, so it must win rather than losing to a generic wrapper message.
    expect(
      queryErrorMessage({
        status: 404,
        body: { message: 'Journey course not found' },
        message: 'Internal Error',
      })
    ).toBe('Journey course not found');
  });

  it('returns null for no error, so the result is a sound "did it fail?" test', () => {
    expect(queryErrorMessage(null)).toBeNull();
    expect(queryErrorMessage(undefined)).toBeNull();
  });

  it('never returns null for a present-but-unreadable error', () => {
    // The whole failure mode was a falsy result for a real error. Anything
    // present must produce text, so `{#if message}` can never miss a failure.
    expect(queryErrorMessage({})).not.toBeNull();
    expect(queryErrorMessage({ status: 500 })).not.toBeNull();
    expect(queryErrorMessage({ body: {} })).not.toBeNull();
    expect(queryErrorMessage({ body: null })).not.toBeNull();
    expect(queryErrorMessage({ message: '' })).not.toBeNull();
    expect(queryErrorMessage(0)).not.toBeNull();
    expect(queryErrorMessage(false)).not.toBeNull();
  });

  it('passes a bare string rejection through', () => {
    expect(queryErrorMessage('Course not found')).toBe('Course not found');
  });

  it('uses the caller-supplied fallback for an unreadable error', () => {
    expect(queryErrorMessage({ status: 500 }, 'Insights unavailable')).toBe(
      'Insights unavailable'
    );
    expect(queryErrorMessage('', 'Insights unavailable')).toBe(
      'Insights unavailable'
    );
  });
});

/**
 * `isFirstLoad` (Codex-2hxff.66 review, LOW-2): a query's own `loading` is
 * also true during a refresh, so a page gated on it flashed its loaded content
 * back to skeletons for every Retry and `invalidateAll()`.
 */
describe('isFirstLoad', () => {
  it('is true before the first value or failure lands', () => {
    expect(isFirstLoad({ current: undefined, loading: true })).toBe(true);
  });

  it('is false during a refresh that keeps the last value', () => {
    expect(isFirstLoad({ current: [], loading: true })).toBe(false);
  });

  it('is false once the read failed, even while a retry runs', () => {
    expect(
      isFirstLoad({
        current: undefined,
        loading: true,
        error: { status: 500, body: { message: 'Internal Error' } },
      })
    ).toBe(false);
  });

  it('is false for a query that was never made', () => {
    expect(isFirstLoad(null)).toBe(false);
    expect(isFirstLoad(undefined)).toBe(false);
  });
});

/**
 * `readFreshQuery` (Codex-6sbn1): the media delete trusts this read, so a read
 * the library chip's popover still holds must never be what it gets.
 */
describe('readFreshQuery', () => {
  /** A stand-in for kit's Query: `then` settles with `settle`, `refresh` re-reads. */
  function fakeQuery<T>(state: {
    ready: boolean;
    loading: boolean;
    current: T | undefined;
    settle?: Promise<void>;
    next?: () => T | undefined;
    refreshFails?: unknown;
  }): FreshReadable<T> & { refresh: ReturnType<typeof vi.fn> } {
    const query = {
      ...state,
      refresh: vi.fn(async () => {
        if (state.refreshFails) throw state.refreshFails;
        query.current = state.next?.();
      }),
      // biome-ignore lint/suspicious/noThenProperty: it stands in for kit's thenable Query
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown
      ) =>
        (state.settle ?? Promise.resolve()).then(
          () => resolve(query.current),
          reject
        ),
    };
    return query as unknown as FreshReadable<T> & {
      refresh: ReturnType<typeof vi.fn>;
    };
  }

  it('asks again when the read has landed and is idle: a cached read is stale', async () => {
    const query = fakeQuery({
      ready: true,
      loading: false,
      current: 'old',
      next: () => 'new',
    });
    expect(await readFreshQuery(query)).toBe('new');
    expect(query.refresh).toHaveBeenCalledTimes(1);
  });

  it('a read just made, or in flight, is awaited, not sent twice', async () => {
    const fresh = fakeQuery({ ready: false, loading: true, current: 'now' });
    expect(await readFreshQuery(fresh)).toBe('now');
    expect(fresh.refresh).not.toHaveBeenCalled();

    const reloading = fakeQuery({ ready: true, loading: true, current: 'now' });
    expect(await readFreshQuery(reloading)).toBe('now');
    expect(reloading.refresh).not.toHaveBeenCalled();
  });

  it('rejects when the re-read fails, never handing back the old value', async () => {
    const failure = { status: 500, body: { message: 'x' } };
    const query = fakeQuery({
      ready: true,
      loading: false,
      current: 'old',
      refreshFails: failure,
    });
    await expect(readFreshQuery(query)).rejects.toBe(failure);
  });

  it('rejects when the read fails', async () => {
    const failure = { status: 429, body: { message: 'x' } };
    const query = fakeQuery({
      ready: false,
      loading: true,
      current: undefined,
      settle: Promise.reject(failure),
    });
    await expect(readFreshQuery(query)).rejects.toBe(failure);
  });

  it('rejects when the read answers nothing', async () => {
    const query = fakeQuery<string>({
      ready: false,
      loading: true,
      current: undefined,
    });
    await expect(readFreshQuery(query)).rejects.toThrow(
      'The query answered nothing'
    );
  });
});
