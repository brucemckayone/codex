/**
 * Apply an axis mix to the brand-editor store.
 *
 * The write-path behind the Guided "Mix" tab, which is the low-granularity
 * counterpart to the fine-tune rail. Instead of asking an admin what
 * `--brand-heading-weight` should be, it asks whether their typography is
 * "Editorial" or "Grotesk" and composes the twenty-odd tokens that answer
 * implies — including both theme variants of every contrast-critical colour.
 *
 * WHY IT COMPOSES RATHER THAN SETS
 * --------------------------------
 * A mix is not a preset: the palette stays whatever the admin has already
 * chosen (a preset, a seed colour, colours pulled from their logo). So this
 * reads the CURRENT palette off `brandEditor.pending`, pairs it with the three
 * requested axis ids, and runs the same `composePreset` the built-in presets
 * use. That is what makes a mixed look as complete as a preset — same code
 * path, same coverage, same AA guarantee — rather than a partial overlay that
 * inherits stale keys from whatever was clicked before it.
 *
 * It then hands the result to `brandEditor.applyPreset`, whose spread-merge
 * (Codex-oqv3r) preserves the `player-*` fine-tunes presets deliberately never
 * write while letting the composed keys win.
 */

import {
  type AtmosphereAxisId,
  BRAND_DEFAULT_ACCENT,
  BRAND_DEFAULT_PRIMARY,
  BRAND_DEFAULT_SECONDARY,
  brandEditor,
  composePreset,
  type FormAxisId,
  type PresetAxisPoint,
  type PresetPalette,
  type TypeAxisId,
} from '$lib/brand-editor';
import { hexToOklch, oklchToHex } from '$lib/brand-editor/oklch-math';

/**
 * A dark-theme primary for a palette that has not declared one.
 *
 * Presets author this by hand because inversion is a design decision. A mix
 * has no author to ask, so derive it: hold the hue and chroma, and move
 * lightness to the far side of mid-grey. A colour picked to read on white is
 * otherwise reused verbatim on near-black, which is the same class of bug as
 * the heading-colour fallback this system exists to prevent.
 */
function deriveDarkPrimary(primaryHex: string): string {
  const oklch = hexToOklch(primaryHex);
  if (!oklch) return primaryHex;
  // Light primaries (l >= 0.5) darken slightly; dark ones lift substantially,
  // which is the direction that actually needs the help.
  const target = oklch.l < 0.5 ? Math.min(0.82, oklch.l + 0.34) : oklch.l;
  return oklchToHex(target, oklch.c, oklch.h);
}

/** Read the palette currently in the store, filling only what is absent. */
export function currentPalette(): PresetPalette {
  const pending = brandEditor.pending;
  const primary = pending?.primaryColor ?? BRAND_DEFAULT_PRIMARY;
  const background = pending?.backgroundColor ?? null;
  const dark = pending?.darkOverrides ?? null;

  return {
    primary,
    secondary: pending?.secondaryColor ?? BRAND_DEFAULT_SECONDARY,
    accent: pending?.accentColor ?? BRAND_DEFAULT_ACCENT,
    background,
    darkPrimary: dark?.primaryColor ?? deriveDarkPrimary(primary),
    // Only consulted when `background` is set — see composePreset's note on
    // the `[data-org-bg]` gate.
    darkBackground: dark?.backgroundColor ?? '#0A0A0A',
    // The admin's own primary carries the brand hue; `composePreset` moves its
    // lightness until it clears AA on each theme's surface.
    headingIntent: primary,
  };
}

/** The axis point implied by the store's current token overrides, if any. */
export function applyMix(axes: PresetAxisPoint): void {
  const composed = composePreset({
    id: `mix.${axes.type}.${axes.form}.${axes.atmosphere}`,
    name: 'Custom mix',
    description: 'Mixed in the guided editor',
    palette: currentPalette(),
    ...axes,
  });
  brandEditor.applyPreset(composed);
}

export type { AtmosphereAxisId, FormAxisId, TypeAxisId };
