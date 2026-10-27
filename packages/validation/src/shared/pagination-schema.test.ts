/**
 * `clampPageParam` (Codex-osuqt): a server load forwards a URL's `?page=` to
 * the API, which refuses a page it cannot list with a 400 the page logs as its
 * own contract bug. So whatever a visitor puts in the URL, the clamped page
 * must parse.
 */
import { describe, expect, it } from 'vitest';
import {
  clampPageParam,
  PAGINATION_MAX_PAGE,
  paginationSchema,
} from './pagination-schema';

describe('clampPageParam', () => {
  it.each([
    ['1001', PAGINATION_MAX_PAGE],
    ['999999', PAGINATION_MAX_PAGE],
    ['0', 1],
    ['-5', 1],
    ['abc', 1],
    ['', 1],
    [null, 1],
    ['2.7', 2],
    ['7', 7],
  ])('clamps %j to page %i', (raw, expected) => {
    const page = clampPageParam(raw);

    expect(page).toBe(expected);
    expect(paginationSchema.safeParse({ page }).success).toBe(true);
  });

  it('keeps the last page the schema accepts', () => {
    expect(
      paginationSchema.safeParse({ page: PAGINATION_MAX_PAGE }).success
    ).toBe(true);
    expect(
      paginationSchema.safeParse({ page: PAGINATION_MAX_PAGE + 1 }).success
    ).toBe(false);
  });
});
