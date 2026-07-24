/**
 * Per-page brand overrides → CSS custom properties (Codex-2pryk.3.1 · WP-3).
 *
 * D6: "inherit by default, override per-page." The org's brand is injected once
 * on `.org-layout` (`_org/[slug]/+layout.svelte`) as the raw `--brand-*` inputs
 * that `org-brand.css` derives ~50 semantic `--color-*` tokens from via OKLCH
 * relative colour. A journey page with `brandOverrides` renders inside a NESTED
 * `[data-org-brand]` wrapper carrying ONLY the overridden `--brand-*` inputs:
 *   - set inputs re-derive the palette for that subtree;
 *   - unset inputs INHERIT the org's values (CSS custom properties inherit), so
 *     the derivation rules recompute against the layered inputs.
 * That is the whole override mechanism — no JS, no per-token recomputation here.
 *
 * SSR-pure: this returns a declaration STRING for the wrapper's `style`
 * attribute (server-rendered), NOT a DOM mutation. It reuses the canonical
 * `tokenOverridesToCssVars` / `darkTokenOverridesToCssVars` from the brand
 * editor (the single source of truth for the per-key `--brand-`/`--color-`
 * prefix split) and hand-maps the 8 core inputs per `css-injection.ts` (the
 * field→`--brand-*` map documented at its head).
 *
 * INERT: imports only the brand editor's pure serialisers + a type — never the
 * studio editor UI — so it stays inside the CE-4 PUBLIC_LIB_ROOT boundary.
 */
import {
  darkTokenOverridesToCssVars,
  tokenOverridesToCssVars,
} from '$lib/brand-editor';
import type { BrandTokenOverrides } from '$lib/page-builder';

/**
 * The 8 core raw inputs `org-brand.css` reads (css-injection.ts:11-18, :351-384).
 * Light values live on the top-level override fields; the dark colour variants
 * ride `darkOverrides` and emit as `--brand-*-dark` (read via the CSS fallback
 * chain `var(--brand-color-dark, var(--brand-color))`).
 */
const CORE_LIGHT: Record<string, string> = {
  primaryColor: '--brand-color',
  secondaryColor: '--brand-secondary',
  accentColor: '--brand-accent',
  backgroundColor: '--brand-bg',
  fontBody: '--brand-font-body',
  fontHeading: '--brand-font-heading',
};

const CORE_DARK: Record<string, string> = {
  primaryColor: '--brand-color-dark',
  secondaryColor: '--brand-secondary-dark',
  accentColor: '--brand-accent-dark',
  backgroundColor: '--brand-bg-dark',
};

const FONT_FIELDS = new Set(['fontBody', 'fontHeading']);

/**
 * Font-family values must be quoted when they contain whitespace/commas so the
 * emitted `--brand-font-*` value composes cleanly into org-brand.css's
 * `var(--brand-font-body, 'Inter'), …` stack. Mirrors the brand editor's
 * `quoteFamily`. Idempotent — an already-quoted value is left untouched.
 */
function quoteFamily(value: string): string {
  const v = value.trim();
  if (v.startsWith('"') || v.startsWith("'")) return v;
  return /[\s,]/.test(v) ? `"${v}"` : v;
}

/**
 * Build the `--brand-*` / `--color-*` map for a page's brand overrides. Returns
 * an empty object when nothing is set (caller then skips the wrapper entirely).
 * Exported for unit testing the mapping in isolation.
 */
export function brandOverridesToCssVars(
  overrides: BrandTokenOverrides | null | undefined
): Record<string, string> {
  if (!overrides) return {};
  const out: Record<string, string> = {};

  // ── Core light inputs (colours + fonts) ──
  for (const [field, prop] of Object.entries(CORE_LIGHT)) {
    const value = (overrides as Record<string, unknown>)[field];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    out[prop] = FONT_FIELDS.has(field) ? quoteFamily(value) : value;
  }

  // ── Numeric inputs: radius + density feed the radius/spacing scales ──
  if (typeof overrides.radius === 'number') {
    out['--brand-radius'] = String(overrides.radius);
  }
  if (typeof overrides.density === 'number') {
    out['--brand-density'] = String(overrides.density);
  }

  // ── Dark colour variants (read via the -dark fallback chain) ──
  if (overrides.darkOverrides) {
    for (const [field, prop] of Object.entries(CORE_DARK)) {
      const value = (overrides.darkOverrides as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value.trim().length === 0) continue;
      out[prop] = value;
    }
  }

  // ── Fine-tune token overrides (canonical prefix split + null-skip) ──
  if (overrides.tokenOverrides) {
    Object.assign(out, tokenOverridesToCssVars(overrides.tokenOverrides));
  }
  if (overrides.darkTokenOverrides) {
    Object.assign(
      out,
      darkTokenOverridesToCssVars(overrides.darkTokenOverrides)
    );
  }

  return out;
}

/**
 * Serialise a page's brand overrides to a `style`-attribute declaration string,
 * or `undefined` when nothing is overridden (so the caller renders a plain
 * wrapper that inherits the org brand and adds no redundant `data-org-brand`).
 */
export function brandOverridesToStyleAttr(
  overrides: BrandTokenOverrides | null | undefined
): string | undefined {
  const vars = brandOverridesToCssVars(overrides);
  const entries = Object.entries(vars);
  if (entries.length === 0) return undefined;
  return entries.map(([prop, value]) => `${prop}: ${value}`).join('; ');
}

/**
 * The per-page logo, if the override sets one. Not a CSS var — surfaced
 * separately so the hero/header can swap the org logo for a page-specific one.
 */
export function brandOverrideLogo(
  overrides: BrandTokenOverrides | null | undefined
): string | undefined {
  const logo = overrides?.logoUrl;
  return typeof logo === 'string' && logo.trim().length > 0 ? logo : undefined;
}
