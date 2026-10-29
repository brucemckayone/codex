/**
 * How wide a benefits grid card's picture is drawn, as `sizes`, so it fetches
 * from its srcset the file its card needs (Codex-61zsk.66). A card is one of
 * the row's `--_n` (BenefitsBlock's grid): one alone, two from 36rem, then
 * three or four from 60rem, which Soft holds to two for four tiles and three
 * for seven or eight. Each width is the column's at most (`columnSizes`).
 */
import { columnSizes } from '../../../page-images';

/** How many cards share a row from 60rem. */
function rowOf(count: number, soft: boolean): number {
  if (count === 4) return soft ? 2 : 4;
  if (count === 7 || count === 8) return soft ? 3 : 4;
  if ([3, 5, 6, 9].includes(count)) return 3;
  return 2;
}

export function gridCardSizes(count: number, style?: string): string {
  if (count <= 1) return columnSizes();
  return columnSizes(1, [
    [60, 1 / rowOf(count, style === 'soft')],
    [36, 0.5],
  ]);
}
