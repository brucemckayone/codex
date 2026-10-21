/**
 * How wide a benefits grid card's picture is drawn, as `sizes`, so it fetches
 * from its srcset the file its card needs (Codex-61zsk.66). A card is one of
 * the row's `--_n` (BenefitsBlock's grid): one alone, two from 36rem, then
 * three or four from 60rem, which Soft holds to two for four tiles and three
 * for seven or eight. Each width is the column's at most (`columnSize`).
 */
import { columnSize } from '../../../page-images';

export function gridCardSizes(count: number, style?: string): string {
  if (count <= 1) return columnSize();
  const soft = style === 'soft';
  const wide =
    count === 4
      ? soft
        ? 2
        : 4
      : count === 7 || count === 8
        ? soft
          ? 3
          : 4
        : [3, 5, 6, 9].includes(count)
          ? 3
          : 2;
  return `(min-width: 60rem) ${columnSize(1 / wide)}, (min-width: 36rem) ${columnSize(0.5)}, ${columnSize()}`;
}
