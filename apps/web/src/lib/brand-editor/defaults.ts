/**
 * Brand Editor — default colour fallbacks.
 *
 * These are the hex values used when an org has not yet set a brand
 * colour. They are the single source of truth for the "unbranded"
 * baseline and are shared by BrandEditorHome (swatches / palette seed)
 * and BrandEditorColors (section fallbacks).
 *
 * Kept as literals rather than CSS tokens because palette generation,
 * OKLCH derivation, and the Home swatches need plain strings — the
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
