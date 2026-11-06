import { describe, expect, it } from 'vitest';
import {
  contentSlugFromTitle,
  freeSlugCandidates,
  isTitleSlug,
} from './content-slug';

describe('contentSlugFromTitle', () => {
  it.each([
    ['Svelte runes: a deep dive', 'svelte-runes-a-deep-dive'],
    ['Crème brûlée, à la maison', 'creme-brulee-a-la-maison'],
    ['  --Spaced   out--  ', 'spaced-out'],
    ['Track 01 (live)', 'track-01-live'],
  ])('%s gives %s', (title, slug) => {
    expect(contentSlugFromTitle(title, 'video')).toBe(slug);
  });

  it('a title with nothing to keep gives the fallback', () => {
    expect(contentSlugFromTitle('🎧 ✨ !!', 'audio')).toBe('audio');
    expect(contentSlugFromTitle('東京の夜', 'written')).toBe('written');
  });

  it('stops at 80 characters, never on a hyphen', () => {
    const slug = contentSlugFromTitle(`${'a'.repeat(79)} b c`, 'video');
    expect(slug).toBe('a'.repeat(79));
    expect(contentSlugFromTitle('word '.repeat(40), 'video').length).toBe(79);
  });
});

describe('isTitleSlug', () => {
  it("is the title's own slug, or that one numbered free", () => {
    expect(isTitleSlug('report', 'Report', 'video')).toBe(true);
    expect(isTitleSlug('report-2', 'Report', 'video')).toBe(true);
    expect(isTitleSlug('report-5', 'Report', 'video')).toBe(true);
  });

  it('is not a slug a creator typed, even one ending like a free one', () => {
    expect(isTitleSlug('report-202411', 'Report', 'video')).toBe(false);
    expect(isTitleSlug('report-6', 'Report', 'video')).toBe(false);
    expect(isTitleSlug('monthly-report', 'Report', 'video')).toBe(false);
    expect(isTitleSlug('reports', 'Report', 'video')).toBe(false);
  });
});

describe('freeSlugCandidates', () => {
  it('tries the slug, -2 to -5, then once with a random suffix', () => {
    const tries = freeSlugCandidates('report');
    expect(tries.slice(0, 5)).toEqual([
      'report',
      'report-2',
      'report-3',
      'report-4',
      'report-5',
    ]);
    expect(tries).toHaveLength(6);
    expect(tries[5]).toMatch(/^report-[0-9a-f]{6}$/);
  });
});
