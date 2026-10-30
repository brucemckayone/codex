import { describe, expect, it } from 'vitest';
import { gridCardSizes } from './grid-sizes';

/** A card `vw` of the window wide from 60rem, and `rem` once the column stops at 82rem. */
const at = (rem: string, vw: string) =>
  `(min-width: 82rem) ${rem}, (min-width: 60rem) ${vw}, (min-width: 36rem) 50vw, 100vw`;
/** Two to a row from 36rem up: the 60rem step would say what the 36rem one does. */
const HALVES = '(min-width: 82rem) 41rem, (min-width: 36rem) 50vw, 100vw';

describe('gridCardSizes (Codex-61zsk.66)', () => {
  it('one card spans the column', () => {
    expect(gridCardSizes(1)).toBe('(min-width: 82rem) 82rem, 100vw');
  });

  it('follows the grid: three or four to a row from 60rem, two from 36rem', () => {
    expect(gridCardSizes(2)).toBe(HALVES);
    expect(gridCardSizes(3)).toBe(at('27.33rem', '33.33vw'));
    expect(gridCardSizes(4)).toBe(at('20.5rem', '25vw'));
    expect(gridCardSizes(7)).toBe(at('20.5rem', '25vw'));
  });

  // Soft's column is the narrowest, so its grid holds four tiles two by two
  // and seven or eight in threes (BenefitsBlock's Soft rule).
  it('under Soft, four sit two to a row and seven or eight three', () => {
    expect(gridCardSizes(4, 'soft')).toBe(HALVES);
    expect(gridCardSizes(8, 'soft')).toBe(at('27.33rem', '33.33vw'));
    expect(gridCardSizes(3, 'soft')).toBe(at('27.33rem', '33.33vw'));
  });
});
