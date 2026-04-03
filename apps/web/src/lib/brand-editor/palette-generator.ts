/**
 * Palette Generator
 *
 * Generates complete brand palettes from a seed color using OKLCH hue rotation.
 * Inspired by Material Design 3's dynamic color system — a single seed produces
 * harmonious primary, secondary, accent, and background colors.
 *
 * Each strategy generates 2 variations with different lightness/chroma treatments.
 */

import { clampToGamut, hexToOklch, oklchToHex } from './oklch-math';

export type PaletteStrategy =
  | 'complementary'
  | 'analogous'
  | 'split-complementary'
  | 'triadic';

/** A complete palette with all 4 brand colors. */
export interface FullPalette {
  name: string;
  strategy: PaletteStrategy;
  primary: string;
  secondary: string;
  accent: string;
  background: string | null;
}

export interface PaletteResult {
  secondary: string;
  accent: string;
}

const STRATEGY_META: Record<
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
    label: 'Split Comp.',
    secondaryOffset: 150,
    accentOffset: 210,
  },
  triadic: { label: 'Triadic', secondaryOffset: 120, accentOffset: 240 },
};

export const PALETTE_STRATEGIES = Object.entries(STRATEGY_META).map(
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
 * Generate a palette from a primary hex color (legacy — secondary + accent only).
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
  const strat = STRATEGY_META[strategy];

  const secOklch = clampToGamut(l, c * 0.8, wrapHue(h + strat.secondaryOffset));
  const secondary = oklchToHex(secOklch.l, secOklch.c, secOklch.h);

  const accOklch = clampToGamut(l, c, wrapHue(h + strat.accentOffset));
  const accent = oklchToHex(accOklch.l, accOklch.c, accOklch.h);

  return { secondary, accent };
}

/**
 * Generate a complete set of palette options from a seed color.
 * Returns 8 palettes (2 per strategy) — each with primary, secondary, accent, background.
 */
export function generateFullPalettes(seedHex: string): FullPalette[] {
  const oklch = hexToOklch(seedHex);
  if (!oklch) return [];

  const { l, c, h } = oklch;
  const palettes: FullPalette[] = [];

  for (const [stratId, meta] of Object.entries(STRATEGY_META)) {
    const strategy = stratId as PaletteStrategy;

    // Variation 1: Vibrant — full chroma, no background override
    const sec1 = clampToGamut(l, c * 0.8, wrapHue(h + meta.secondaryOffset));
    const acc1 = clampToGamut(l, c, wrapHue(h + meta.accentOffset));
    palettes.push({
      name: `${meta.label}`,
      strategy,
      primary: seedHex,
      secondary: oklchToHex(sec1.l, sec1.c, sec1.h),
      accent: oklchToHex(acc1.l, acc1.c, acc1.h),
      background: null,
    });

    // Variation 2: Muted — reduced chroma, subtle tinted background
    const sec2 = clampToGamut(
      Math.min(l + 0.1, 0.95),
      c * 0.4,
      wrapHue(h + meta.secondaryOffset)
    );
    const acc2 = clampToGamut(
      Math.max(l - 0.1, 0.3),
      c * 0.6,
      wrapHue(h + meta.accentOffset)
    );
    // Tinted background: very high lightness, tiny chroma from the primary hue
    const bg = clampToGamut(0.97, c * 0.05, h);
    palettes.push({
      name: `${meta.label} Soft`,
      strategy,
      primary: seedHex,
      secondary: oklchToHex(sec2.l, sec2.c, sec2.h),
      accent: oklchToHex(acc2.l, acc2.c, acc2.h),
      background: oklchToHex(bg.l, bg.c, bg.h),
    });
  }

  return palettes;
}
