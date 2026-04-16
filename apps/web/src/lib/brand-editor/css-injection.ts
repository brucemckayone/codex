import { browser } from '$app/environment';
import type { BrandEditorState, CssVarMapping } from './types';

/**
 * CSS Variable Injection
 *
 * Maps BrandEditorState fields to the raw --brand-* CSS custom properties
 * that org-brand.css reads to derive the full palette via OKLCH relative colors.
 *
 * The org-brand.css file derives ~50 tokens from these 7 input variables:
 *   --brand-color      → primary, interactive, focus, text-on-brand
 *   --brand-secondary   → secondary palette
 *   --brand-accent      → accent palette
 *   --brand-bg           → surface, text, border (if explicitly set)
 *   --brand-radius       → radius scale
 *   --brand-density      → spacing scale
 *   --brand-font-body    → body text font
 *   --brand-font-heading → heading font
 */

/** Override keys that get --brand- prefix (consumed by org-brand.css rules).
 *  All other override keys get --color- prefix (direct token replacement). */
const BRAND_PREFIX_KEYS = new Set([
  'text-scale',
  'heading-weight',
  'body-weight',
  'shadow-scale',
  'shadow-color',
  // Heading color — consumed by org-brand.css heading selector
  'heading-color',
  // Hero layout — logo scale consumed by hero CSS via var()
  'hero-logo-scale',
  // Hero text and color tokens (WP-02)
  'hero-text',
  'hero-text-muted',
  'hero-title-color',
  'hero-title-blend',
  'hero-cta-bg',
  'hero-cta-text',
  'hero-glass-tint',
  'hero-glass-text',
  'hero-border-tint',
  // Player chrome tokens (WP-03)
  'player-text',
  'player-text-secondary',
  'player-text-muted',
  'player-surface',
  'player-surface-hover',
  'player-surface-active',
  'player-border',
  'player-overlay',
  'player-overlay-heavy',
  // Glass morphism
  'glass-tint',
  // Card interaction (WP-05)
  'card-hover-scale',
  'card-image-hover-scale',
  // Typography style
  'text-transform-label',
  // Shader hero configuration — consumed by ShaderHero component via getComputedStyle
  'shader-preset',
  'shader-intensity',
  'shader-grain',
  'shader-vignette',
  // Suture
  'shader-curl',
  'shader-dissipation',
  'shader-advection',
  'shader-force',
  // Ether
  'shader-rotation-speed',
  'shader-complexity',
  'shader-zoom',
  'shader-glow',
  'shader-scale',
  'shader-aberration',
  // Warp
  'shader-warp-strength',
  'shader-light-angle',
  'shader-speed',
  'shader-detail',
  'shader-contrast',
  'shader-invert',
  // Ripple
  'shader-wave-speed',
  'shader-damping',
  'shader-ripple-size',
  'shader-refraction',
  // Pulse
  'shader-pulse-damping',
  'shader-wave-scale',
  'shader-cam-height',
  'shader-cam-target',
  'shader-specular',
  'shader-impulse-size',
  'shader-pulse-color',
  // Ink
  'shader-ink-diffusion',
  'shader-ink-advection',
  'shader-ink-drop-size',
  'shader-ink-evaporation',
  'shader-ink-curl',
  // Topo
  'shader-topo-line-count',
  'shader-topo-line-width',
  'shader-topo-speed',
  'shader-topo-scale',
  'shader-topo-elevation',
  'shader-topo-octaves',
  // Nebula
  'shader-nebula-density',
  'shader-nebula-speed',
  'shader-nebula-scale',
  'shader-nebula-depth',
  'shader-nebula-wind',
  'shader-nebula-stars',
  // Turing
  'shader-turing-feed',
  'shader-turing-kill',
  'shader-turing-da',
  'shader-turing-db',
  'shader-turing-speed',
  // Silk
  'shader-silk-fold-scale',
  'shader-silk-fold-depth',
  'shader-silk-speed',
  'shader-silk-softness',
  'shader-silk-sheen',
  'shader-silk-lining',
  // Glass
  'shader-glass-cell-size',
  'shader-glass-border',
  'shader-glass-drift',
  'shader-glass-glow',
  'shader-glass-light',
  // Film
  'shader-film-scale',
  'shader-film-speed',
  'shader-film-bands',
  'shader-film-shift',
  'shader-film-ripple',
  // Flux
  'shader-flux-poles',
  'shader-flux-line-density',
  'shader-flux-line-width',
  'shader-flux-strength',
  'shader-flux-speed',
  // Lava
  'shader-lava-crack-scale',
  'shader-lava-crack-width',
  'shader-lava-glow',
  'shader-lava-speed',
  'shader-lava-crust',
  'shader-lava-heat',
  // Caustic
  'shader-caustic-scale',
  'shader-caustic-speed',
  'shader-caustic-iterations',
  'shader-caustic-brightness',
  'shader-caustic-ripple',
  // Physarum
  'shader-physarum-diffusion',
  'shader-physarum-decay',
  'shader-physarum-deposit',
  'shader-physarum-sensor',
  'shader-physarum-turn',
  // Rain
  'shader-rain-density',
  'shader-rain-speed',
  'shader-rain-size',
  'shader-rain-refraction',
  'shader-rain-blur',
  // Frost
  'shader-frost-growth',
  'shader-frost-branch',
  'shader-frost-symmetry',
  'shader-frost-melt',
  'shader-frost-glow',
  // Glow
  'shader-glow-count',
  'shader-glow-pulse',
  'shader-glow-size',
  'shader-glow-drift',
  'shader-glow-trail',
  'shader-glow-depth',
  // Life
  'shader-life-inner',
  'shader-life-outer',
  'shader-life-birth',
  'shader-life-death',
  'shader-life-speed',
  // Mycelium
  'shader-mycelium-growth',
  'shader-mycelium-branch',
  'shader-mycelium-spread',
  'shader-mycelium-pulse',
  'shader-mycelium-thickness',
  // Aurora
  'shader-aurora-layers',
  'shader-aurora-speed',
  'shader-aurora-height',
  'shader-aurora-spread',
  'shader-aurora-shimmer',
  // Tendrils
  'shader-tendrils-scale',
  'shader-tendrils-speed',
  'shader-tendrils-steps',
  'shader-tendrils-curl',
  'shader-tendrils-fade',
  // Pollen
  'shader-pollen-density',
  'shader-pollen-size',
  'shader-pollen-fibres',
  'shader-pollen-drift',
  'shader-pollen-depth',
  'shader-pollen-bokeh',
  // Growth
  'shader-growth-speed',
  'shader-growth-noise',
  'shader-growth-scale',
  'shader-growth-width',
  'shader-growth-glow',
  // Geode
  'shader-geode-bands',
  'shader-geode-warp',
  'shader-geode-cavity',
  'shader-geode-speed',
  'shader-geode-sparkle',
  // Lenia
  'shader-lenia-radius',
  'shader-lenia-growth',
  'shader-lenia-width',
  'shader-lenia-speed',
  'shader-lenia-dt',
  // Ocean
  'shader-ocean-caustic-scale',
  'shader-ocean-sand-scale',
  'shader-ocean-speed',
  'shader-ocean-shadow',
  'shader-ocean-ripple',
  // Bismuth
  'shader-bismuth-terraces',
  'shader-bismuth-warp',
  'shader-bismuth-iridescence',
  'shader-bismuth-speed',
  'shader-bismuth-edge',
  // Pearl
  'shader-pearl-displacement',
  'shader-pearl-speed',
  'shader-pearl-fresnel',
  'shader-pearl-specular',
  // Vortex
  'shader-vortex-speed',
  'shader-vortex-density',
  'shader-vortex-twist',
  'shader-vortex-rings',
  'shader-vortex-spiral',
  // Gyroid
  'shader-gyroid-scale1',
  'shader-gyroid-scale2',
  'shader-gyroid-speed',
  'shader-gyroid-density',
  'shader-gyroid-thickness',
  // Waves
  'shader-waves-height',
  'shader-waves-speed',
  'shader-waves-chop',
  'shader-waves-foam',
  'shader-waves-depth',
  // Clouds
  'shader-clouds-cover',
  'shader-clouds-speed',
  'shader-clouds-scale',
  'shader-clouds-dark',
  'shader-clouds-light',
  // Fracture
  'shader-fracture-cuts',
  'shader-fracture-speed',
  'shader-fracture-border',
  'shader-fracture-shadow',
  'shader-fracture-fill',
  // Julia
  'shader-julia-zoom',
  'shader-julia-speed',
  'shader-julia-iterations',
  'shader-julia-radius',
  'shader-julia-saturation',
  // Vapor
  'shader-vapor-density',
  'shader-vapor-speed',
  'shader-vapor-scale',
  'shader-vapor-warmth',
  'shader-vapor-glow',
  // Tunnel
  'shader-tunnel-speed',
  'shader-tunnel-fractal',
  'shader-tunnel-radius',
  'shader-tunnel-brightness',
  'shader-tunnel-twist',
  // Plasma
  'shader-plasma-speed',
  'shader-plasma-bands',
  'shader-plasma-pressure',
  'shader-plasma-turn',
  'shader-plasma-diffusion',
  // Flow
  'shader-flow-curl',
  'shader-flow-advection',
  'shader-flow-smoothing',
  'shader-flow-contrast',
  'shader-flow-field-speed',
  // Spore
  'shader-spore-sensor-angle',
  'shader-spore-sensor-offset',
  'shader-spore-step-size',
  'shader-spore-rotation',
  'shader-spore-decay',
  // Logo SDF
  'shader-logo-url',
]);

/** The CSS variable mappings from editor state to --brand-* properties. */
const CSS_VAR_MAPPINGS: CssVarMapping[] = [
  {
    property: '--brand-color',
    getValue: (s) => s.primaryColor,
  },
  {
    property: '--brand-secondary',
    getValue: (s) => s.secondaryColor ?? undefined,
  },
  {
    property: '--brand-accent',
    getValue: (s) => s.accentColor ?? undefined,
  },
  {
    property: '--brand-bg',
    getValue: (s) => s.backgroundColor ?? undefined,
  },
  {
    property: '--brand-radius',
    getValue: (s) => `${s.radius}rem`,
  },
  {
    property: '--brand-density',
    getValue: (s) => String(s.density),
  },
  {
    property: '--brand-font-body',
    getValue: (s) => (s.fontBody ? `'${s.fontBody}'` : undefined),
  },
  {
    property: '--brand-font-heading',
    getValue: (s) => (s.fontHeading ? `'${s.fontHeading}'` : undefined),
  },
];

/** CSS properties set by the base CSS_VAR_MAPPINGS (not token overrides). */
const BASE_VAR_PROPS = new Set(CSS_VAR_MAPPINGS.map((m) => m.property));

/** Dark mode var props — also not token overrides. */
const DARK_VAR_PROPS = new Set([
  '--brand-color-dark',
  '--brand-secondary-dark',
  '--brand-accent-dark',
  '--brand-bg-dark',
]);

/** Find the org layout element that holds the brand CSS variables. */
export function getOrgLayoutElement(): HTMLElement | null {
  if (!browser) return null;
  return document.querySelector('.org-layout');
}

/**
 * Temporarily preview a font on the live page.
 * Bypasses the brand editor store (no isDirty, no sessionStorage write).
 */
export function previewFont(mode: 'body' | 'heading', family: string): void {
  const el = getOrgLayoutElement();
  if (!el) return;
  const prop =
    mode === 'heading' ? '--brand-font-heading' : '--brand-font-body';
  el.style.setProperty(prop, `'${family}'`);
  loadGoogleFont(family);
}

/**
 * Revert a transient font preview to the store's current value.
 * Call on dropdown close or mouse leave.
 */
export function revertFontPreview(
  mode: 'body' | 'heading',
  currentValue: string | null
): void {
  const el = getOrgLayoutElement();
  if (!el) return;
  const prop =
    mode === 'heading' ? '--brand-font-heading' : '--brand-font-body';
  if (currentValue) {
    el.style.setProperty(prop, `'${currentValue}'`);
  } else {
    el.style.removeProperty(prop);
  }
}

/**
 * Remove inline --color-* and --brand-* override CSS properties from an element.
 * Optionally excludes properties in the provided set (e.g. base brand vars that
 * should be kept by injectBrandVars but removed by clearBrandVars).
 */
function removeOverrideVars(el: HTMLElement, excludeProps?: Set<string>): void {
  const toRemove: string[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (
      (prop.startsWith('--color-') || prop.startsWith('--brand-')) &&
      (!excludeProps || !excludeProps.has(prop))
    ) {
      toRemove.push(prop);
    }
  }
  for (const prop of toRemove) {
    el.style.removeProperty(prop);
  }
}

/**
 * Inject brand editor state as CSS custom properties on the org layout element.
 * The CSS engine (org-brand.css) derives the full palette automatically.
 */
export function injectBrandVars(state: BrandEditorState): void {
  const el = getOrgLayoutElement();
  if (!el) return;

  // Ensure the brand attribute is set so org-brand.css rules activate
  if (!el.hasAttribute('data-org-brand')) {
    el.setAttribute('data-org-brand', '');
  }

  for (const mapping of CSS_VAR_MAPPINGS) {
    const value = mapping.getValue(state);
    if (value !== undefined) {
      el.style.setProperty(mapping.property, value);
    } else {
      el.style.removeProperty(mapping.property);
    }
  }

  // Handle background attribute separately
  if (state.backgroundColor) {
    if (!el.hasAttribute('data-org-bg')) {
      el.setAttribute('data-org-bg', '');
    }
  } else {
    el.removeAttribute('data-org-bg');
  }

  // Clear any stale token override CSS properties from previous injection passes.
  // This ensures removed overrides don't linger on the inline style.
  // Exclude base brand vars and dark mode vars — they were just set above.
  const preservedProps = new Set([...BASE_VAR_PROPS, ...DARK_VAR_PROPS]);
  removeOverrideVars(el, preservedProps);

  // Inject token overrides from fine-tune panels
  const overrides = state.tokenOverrides ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    const prop = BRAND_PREFIX_KEYS.has(key)
      ? `--brand-${key}`
      : `--color-${key}`;
    el.style.setProperty(prop, value);
  }

  // Inject dark mode overrides (consumed by dark-mode rules in org-brand.css)
  const darkVarMap: Record<string, string> = {
    primaryColor: '--brand-color-dark',
    secondaryColor: '--brand-secondary-dark',
    accentColor: '--brand-accent-dark',
    backgroundColor: '--brand-bg-dark',
  };
  for (const [field, prop] of Object.entries(darkVarMap)) {
    const darkVal =
      state.darkOverrides?.[field as keyof typeof state.darkOverrides];
    if (darkVal) {
      el.style.setProperty(prop, darkVal);
    } else {
      el.style.removeProperty(prop);
    }
  }
}

/**
 * Inject token overrides (from server-loaded tokenOverrides JSON) as CSS
 * custom properties on the given element.
 *
 * Used by the org layout on initial page load so that shader-* and other
 * override keys are available to ShaderHero (via getComputedStyle) before
 * the brand editor is ever opened.
 *
 * Keys in BRAND_PREFIX_KEYS become `--brand-{key}`, all others become
 * `--color-{key}` — same mapping as injectBrandVars uses for live preview.
 */
export function injectTokenOverrides(
  el: HTMLElement,
  overrides: Record<string, string | null>
): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value == null) continue;
    const prop = BRAND_PREFIX_KEYS.has(key)
      ? `--brand-${key}`
      : `--color-${key}`;
    el.style.setProperty(prop, value);
  }
}

/**
 * Remove all previously injected token override CSS properties from an element.
 * Call before re-injecting to ensure removed overrides don't linger.
 */
export function clearTokenOverrides(el: HTMLElement): void {
  removeOverrideVars(el, new Set([...BASE_VAR_PROPS, ...DARK_VAR_PROPS]));
}

/**
 * Remove all brand editor CSS overrides, reverting to server-loaded values.
 * Called when the editor closes without saving.
 */
export function clearBrandVars(): void {
  const el = getOrgLayoutElement();
  if (!el) return;

  for (const mapping of CSS_VAR_MAPPINGS) {
    el.style.removeProperty(mapping.property);
  }

  // Remove all token override CSS vars previously set (no exclusions — clear everything)
  removeOverrideVars(el);
}

/**
 * Load a Google Font dynamically by injecting a <link> element.
 * Idempotent — skips if the font is already loaded.
 */
export function loadGoogleFont(family: string): void {
  if (!browser || !family) return;

  const id = `brand-font-${family.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}
