/**
 * Brand Editor — default colour fallbacks.
 *
 * These are the hex values used when an org has not yet set a brand
 * colour. They are the single source of truth for the "unbranded"
 * baseline and are shared by the Guided palette seed and BrandEditorColors
 * (section fallbacks).
 *
 * Kept as literals rather than CSS tokens because palette generation,
 * OKLCH derivation, and the seed swatches need plain strings — the
 * tokens that derive from `--brand-color` only exist once the editor
 * is wired up, and these fallbacks feed the editor, not the other way.
 */
export const BRAND_DEFAULT_PRIMARY = '#6366F1';
export const BRAND_DEFAULT_SECONDARY = '#737373';
export const BRAND_DEFAULT_ACCENT = '#F59E0B';
export const BRAND_DEFAULT_BACKGROUND = '#FFFFFF';

/**
 * Default surface colour for the Pulse shader preset. Consumed by
 * BrandEditorHeroEffects `DEFAULTS['shader-pulse-color']` and surfaces
 * where the pulse colour is rendered without an explicit override.
 */
export const SHADER_DEFAULT_PULSE_COLOR = '#d10000';

/**
 * Seed palette for the shader colour pickers.
 *
 * These are the same four colours `getShaderConfig()` falls back to when an org
 * has no brand palette at all, expressed as hex — the RGB triples there are
 * `[0.486, 0.227, 0.929]` etc., which round-trip to exactly these values. They
 * are only what the pickers *show* before a creator touches them; the shader
 * itself uses the org's brand colours until `shader-use-custom-colors` is
 * enabled, so changing these cannot alter how any existing org renders.
 *
 * Keep the two in sync: if the fallback triples in `shader-config.ts` change,
 * change these too, or the pickers will open on a colour the shader would not
 * actually have used.
 */
export const SHADER_DEFAULT_PALETTE = {
  primary: '#7c3aed',
  secondary: '#ec4899',
  accent: '#f59e0b',
  bg: '#0f172a',
} as const;
