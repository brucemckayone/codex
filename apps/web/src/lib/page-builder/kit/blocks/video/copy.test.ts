import { describe, expect, it } from 'vitest';
import { filmLength } from './copy';

describe('filmLength: the length a press plays (Codex-61zsk.73)', () => {
  it('gives a film that plays in full its own length', () => {
    expect(filmLength({ full: true, seconds: 124 })).toBe('2:04');
  });

  it('says a preview is one, so the line never promises the film', () => {
    expect(filmLength({ full: false, seconds: 30 })).toBe('0:30 preview');
  });

  it('says nothing when the length is not known', () => {
    expect(filmLength({ full: true, seconds: null })).toBeUndefined();
    expect(filmLength(null)).toBeUndefined();
  });
});
