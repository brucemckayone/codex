import { presetLabel } from '$lib/brand-editor/hero-fx-presets';
import {
  type LivePresetId,
  resolvePresetId,
} from '$lib/components/ui/ShaderHero/shader-config';

/** What immersive mode paints when neither the piece nor its org names a shader. */
export const IMMERSIVE_FALLBACK_PRESET: LivePresetId = 'flow';

/**
 * The shader immersive mode paints for an audio piece (owner, 2026-11-19):
 *
 * 1. the piece's own shader, when it has one;
 * 2. else the org's brand shader — the one its hero runs;
 * 3. else `flow`.
 *
 * `'none'` counts as no shader at both steps. Immersive mode is a fullscreen
 * overlay with nothing behind it, so a piece always gets something to draw,
 * and a piece with no shader of its own reads as part of its org rather than
 * a fixed platform default. Both ids go through `resolvePresetId`, so a cut
 * preset (on an old content row or brand) paints its survivor.
 *
 * PURE: the caller reads the brand's preset (`getBrandPresetId`, which needs
 * the org layout in the DOM) and passes it in. On the creator route
 * (`routes/_creators/[username]/content/...`) there is no `.org-layout`, so
 * the brand's preset reads as null there and a piece with no shader of its
 * own plays `flow`.
 */
export function immersivePreset(
  piecePreset: string | null | undefined,
  brandPreset: string | null | undefined
): LivePresetId {
  for (const candidate of [piecePreset, brandPreset]) {
    const id = resolvePresetId(candidate);
    if (id && id !== 'none') return id;
  }
  return IMMERSIVE_FALLBACK_PRESET;
}

/**
 * In words, what a piece with no shader of its own plays: "your brand's
 * shader", or the fallback's name (Flow) where the brand has none. Worded from
 * `immersivePreset`'s own answer, so the studio's copy (the None card, the
 * preview's note) cannot promise one shader and play another. PURE.
 */
export function noShaderPlays(brandPreset: string | null | undefined): string {
  const plays = immersivePreset(null, brandPreset);
  if (plays === resolvePresetId(brandPreset)) return "your brand's shader";
  return presetLabel(plays);
}
