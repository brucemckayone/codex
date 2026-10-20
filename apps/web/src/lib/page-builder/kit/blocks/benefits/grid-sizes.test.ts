import { describe, expect, it } from 'vitest';
import { gridCardSizes } from './grid-sizes';

const at = (wide: string) =>
  `(min-width: 60rem) ${wide}, (min-width: 36rem) min(50vw, 41rem), min(100vw, 82rem)`;

describe('gridCardSizes (Codex-61zsk.66)', () => {
  it('one card spans the column', () => {
    expect(gridCardSizes(1)).toBe('min(100vw, 82rem)');
  });

  it('follows the grid: three or four to a row from 60rem, two from 36rem', () => {
    expect(gridCardSizes(2)).toBe(at('min(50vw, 41rem)'));
    expect(gridCardSizes(3)).toBe(at('min(33.33vw, 27.33rem)'));
    expect(gridCardSizes(4)).toBe(at('min(25vw, 20.5rem)'));
    expect(gridCardSizes(7)).toBe(at('min(25vw, 20.5rem)'));
  });

  // Soft's column is the narrowest, so its grid holds four tiles two by two
  // and seven or eight in threes (BenefitsBlock's Soft rule).
  it('under Soft, four sit two to a row and seven or eight three', () => {
    expect(gridCardSizes(4, 'soft')).toBe(at('min(50vw, 41rem)'));
    expect(gridCardSizes(8, 'soft')).toBe(at('min(33.33vw, 27.33rem)'));
    expect(gridCardSizes(3, 'soft')).toBe(at('min(33.33vw, 27.33rem)'));
  });
});
