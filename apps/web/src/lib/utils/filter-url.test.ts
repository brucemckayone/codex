import { describe, expect, it } from 'vitest';
import { applyFilterPatch, filterHref } from './filter-url';

const url = (search = '') =>
  new URL(`http://of-blood-and-bones.lvh.me:3000/explore${search}`);

describe('applyFilterPatch', () => {
  it('sets truthy values and deletes null ones', () => {
    const u = applyFilterPatch(url('?type=video'), {
      sort: 'title',
      type: null,
    });
    expect(u.searchParams.get('sort')).toBe('title');
    expect(u.searchParams.has('type')).toBe(false);
  });

  it('treats an empty string as a delete', () => {
    const u = applyFilterPatch(url('?category=ritual'), { category: '' });
    expect(u.searchParams.has('category')).toBe(false);
  });

  it('resets page when any facet changes', () => {
    const u = applyFilterPatch(url('?page=3&sort=oldest'), { type: 'audio' });
    expect(u.searchParams.has('page')).toBe(false);
    // Untouched facets survive.
    expect(u.searchParams.get('sort')).toBe('oldest');
  });

  it('does NOT reset page when only page is patched', () => {
    const u = applyFilterPatch(url('?type=audio'), { page: '2' });
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.get('type')).toBe('audio');
  });

  it('resets page even when a facet is being cleared', () => {
    const u = applyFilterPatch(url('?page=4&type=video'), { type: null });
    expect(u.searchParams.has('page')).toBe(false);
  });

  // ── The regression this module exists for ──────────────────────────────
  // The filter drawer's mobile Apply fires onFilterChange then onSortChange in
  // ONE tick. When each handler rebuilt the URL from the not-yet-advanced page
  // URL, the first write was silently discarded: staging "A-Z" + "Featured
  // only" navigated to ?sort=title with no featured param. Accumulating both
  // patches on one URL is what keeps them.
  it('keeps BOTH facets when two patches accumulate on one URL (lost-update guard)', () => {
    const u = url();
    applyFilterPatch(u, { featured: 'true' });
    applyFilterPatch(u, { sort: 'title' });

    expect(u.searchParams.get('featured')).toBe('true');
    expect(u.searchParams.get('sort')).toBe('title');
  });

  it('keeps three accumulated facets and still drops page once', () => {
    const u = url('?page=5');
    applyFilterPatch(u, { type: 'video' });
    applyFilterPatch(u, { featured: 'true' });
    applyFilterPatch(u, { sort: 'oldest' });

    expect(u.searchParams.get('type')).toBe('video');
    expect(u.searchParams.get('featured')).toBe('true');
    expect(u.searchParams.get('sort')).toBe('oldest');
    expect(u.searchParams.has('page')).toBe(false);
  });

  it('a later patch can clear what an earlier one in the same batch set', () => {
    const u = url();
    applyFilterPatch(u, { type: 'video' });
    applyFilterPatch(u, { type: null });
    expect(u.searchParams.has('type')).toBe(false);
  });

  it('leaves params outside the patch untouched', () => {
    const u = applyFilterPatch(url('?q=fire&creator=luzura'), {
      sort: 'title',
    });
    expect(u.searchParams.get('q')).toBe('fire');
    expect(u.searchParams.get('creator')).toBe('luzura');
  });

  // ── Defaults: the studio list pages' URL_DEFAULTS and the media 'all' ──
  it('deletes a value equal to its default, so the URL stays canonical', () => {
    const u = applyFilterPatch(
      url('?range=7&status=paid'),
      { range: '30' },
      { range: '30', status: 'all' }
    );
    expect(u.searchParams.has('range')).toBe(false);
    expect(u.searchParams.get('status')).toBe('paid');
  });

  it('sets a value that differs from its default', () => {
    const u = applyFilterPatch(url(), { status: 'paid' }, { status: 'all' });
    expect(u.searchParams.get('status')).toBe('paid');
  });

  it('a default applies only to its own key', () => {
    // 'all' is the default for status, not for source.
    const u = applyFilterPatch(url(), { source: 'all' }, { status: 'all' });
    expect(u.searchParams.get('source')).toBe('all');
  });

  it('still resets page when a facet goes back to its default', () => {
    const u = applyFilterPatch(
      url('?page=3&status=paid'),
      { status: 'all' },
      { status: 'all' }
    );
    expect(u.searchParams.has('status')).toBe(false);
    expect(u.searchParams.has('page')).toBe(false);
  });
});

describe('filterHref', () => {
  it('returns the path plus the patched query, without origin or hash', () => {
    const current = url('?type=video&page=2#grid');
    expect(filterHref(current, { sort: 'title' })).toBe(
      '/explore?type=video&sort=title'
    );
  });

  it('returns the bare path when no params are left', () => {
    expect(
      filterHref(url('?status=paid'), { status: 'all' }, { status: 'all' })
    ).toBe('/explore');
  });

  it('leaves the URL it was given untouched', () => {
    // It is handed `page.url`, which must never be mutated.
    const current = url('?type=video&page=2');
    filterHref(current, { type: 'audio' });
    expect(current.search).toBe('?type=video&page=2');
  });
});
