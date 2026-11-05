/**
 * The editor's moving background (Codex-61zsk.73, #20b): where a still
 * render (the canvas, a thumbnail, the Moving swatch) draws a Moving band,
 * it paints the studio's own frame of the org's shader (`shaderStill`) in
 * place of the glow, under the proven veil (`styles/surfaces.css`). Only
 * where the live page would show that frame: the org has a shader, the page
 * keeps the org's colours (03 X11), and the frame was drawn in the theme the
 * band is in. Anywhere else, and until the frame is copied, the glow.
 */

import { paintableColour } from '$lib/brand-editor/ground';
import { shaderStill } from '$lib/components/ui/ShaderHero/shader-still.svelte';
import type { BrandTokenOverrides } from '$lib/page-builder';

/**
 * The page sets its own colours. The org's shader draws in the ORG's, so
 * such a page shows the glow, which follows the page's, rather than clash
 * (03 X11). Fonts alone leave the shader's colours as they are, and so does a
 * colour the page does not paint (`paintableColour`).
 */
export function ownsColours(
  overrides: BrandTokenOverrides | null | undefined
): boolean {
  return Boolean(
    paintableColour(overrides?.primaryColor) ||
      paintableColour(overrides?.secondaryColor)
  );
}

/**
 * The frame to paint, as a CSS image (`--lp-shader-still`), or undefined for
 * the glow. Reactive: read in a `$derived`, it follows each new copy. A
 * render with no `theme` follows the viewer's, which is not known here, so
 * it keeps the glow.
 */
export function atmosphereStill(band: StillBand): string | undefined {
  if (!paintsStill(band)) return undefined;
  const still = shaderStill.current;
  return still?.theme === band.theme ? `url("${still.url}")` : undefined;
}

interface StillBand {
  theme: 'light' | 'dark' | undefined;
  orgShader: boolean;
  brandOverrides: BrandTokenOverrides | null | undefined;
}

/**
 * Whether a render could paint the frame at all, once one is copied. Only
 * such a render asks for it (`shaderStill.want`): each copy is a
 * full-viewport draw, so the studio copies again after a brand change only
 * for a render that would show it.
 */
export function paintsStill(band: StillBand): boolean {
  return (
    band.orgShader && Boolean(band.theme) && !ownsColours(band.brandOverrides)
  );
}
