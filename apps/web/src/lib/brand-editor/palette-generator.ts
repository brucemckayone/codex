/**
 * Palette Generator
 *
 * Generates harmonious secondary/accent colors from a primary seed
 * using OKLCH hue rotation. Maintains lightness, reduces chroma for
 * secondary, and clamps to sRGB gamut.
 */

import { clampToGamut, hexToOklch, oklchToHex } from './oklch-math';

export type PaletteStrategy =
  | 'complementary'
  | 'analogous'
  | 'split-complementary'
  | 'triadic';

export interface PaletteResult {
  secondary: string;
  accent: string;
}

const STRATEGIES: Record<
  PaletteStrategy,
  { label: string; secondaryOffset: number; accentOffset: number }
> = {
  complementary: {
    label: 'Complementary',
    secondaryOffset: 180,
    accentOffset: 180,
  },
  analogous: { label: 'Analogous', secondaryOffset: 30, accentOffset: -30 },
  'split-complementary': {
    label: 'Split Complementary',
    secondaryOffset: 150,
    accentOffset: 210,
  },
  triadic: { label: 'Triadic', secondaryOffset: 120, accentOffset: 240 },
};

export const PALETTE_STRATEGIES = Object.entries(STRATEGIES).map(
  ([id, { label }]) => ({
    id: id as PaletteStrategy,
    label,
  })
);

/** Wrap hue to 0-360 range. */
function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

/**
 * Generate a palette from a primary hex color.
 * Returns secondary and accent hex colors using OKLCH hue rotation.
 */
export function generatePalette(
  primaryHex: string,
  strategy: PaletteStrategy
): PaletteResult {
  const oklch = hexToOklch(primaryHex);
  if (!oklch) {
    return { secondary: '#737373', accent: '#F59E0B' };
  }

  const { l, c, h } = oklch;
  const strat = STRATEGIES[strategy];

  // Secondary: same lightness, 80% chroma, rotated hue
  const secOklch = clampToGamut(l, c * 0.8, wrapHue(h + strat.secondaryOffset));
  const secondary = oklchToHex(secOklch.l, secOklch.c, secOklch.h);

  // Accent: same lightness, full chroma, rotated hue
  const accOklch = clampToGamut(l, c, wrapHue(h + strat.accentOffset));
  const accent = oklchToHex(accOklch.l, accOklch.c, accOklch.h);

  return { secondary, accent };
}
