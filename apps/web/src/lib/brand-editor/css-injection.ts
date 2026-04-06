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
function getOrgLayoutElement(): HTMLElement | null {
  if (!browser) return null;
  return document.querySelector('.org-layout');
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
