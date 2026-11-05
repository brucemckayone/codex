import { describe, expect, it } from 'vitest';
import { contentSlugFromTitle } from './content-slug';

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
