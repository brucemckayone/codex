/**
 * Brand Editor Store (Svelte 5 Runes)
 *
 * Module-level reactive state for the floating brand editor panel.
 * Uses $state/$derived/$effect — NOT svelte/store.
 *
 * CSS injection happens automatically via $effect when pending values change.
 * sessionStorage persistence happens via $effect for crash recovery.
 */

import { browser } from '$app/environment';
import {
  clearBrandVars,
  injectBrandVars,
  loadGoogleFont,
} from './css-injection';
import { getBreadcrumb, LEVELS } from './levels';
import type {
  BrandEditorState,
  BrandPreset,
  LevelId,
  PanelState,
  ThemeColorField,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'codex:brand-editor';

// ── Internal State ────────────────────────────────────────────────────────

const state = $state<{
  panel: PanelState;
  orgId: string | null;
  saved: BrandEditorState | null;
  pending: BrandEditorState | null;
  level: LevelId;
  // Scoped preview context — 'which palette am I editing'. Applied as
  // data-editing-theme on .org-layout; independent of the user's global
  // theme preference (Codex-9u8wg + Codex-z91af).
  editingTheme: 'light' | 'dark';
}>({
  panel: 'closed',
  orgId: null,
  saved: null,
  pending: null,
  level: 'home',
  editingTheme: 'light',
});

// ── Derived State ─────────────────────────────────────────────────────────

const isOpen = $derived(state.panel === 'open');
const isMinimized = $derived(state.panel === 'minimized');
const isClosed = $derived(state.panel === 'closed');

const isDirty = $derived.by(() => {
  if (!state.saved || !state.pending) return false;
  return JSON.stringify(state.saved) !== JSON.stringify(state.pending);
});

const currentLevel = $derived(LEVELS[state.level]);
const breadcrumbs = $derived(getBreadcrumb(state.level));

// ── Effects ───────────────────────────────────────────────────────────────
// Wrapped in $effect.root() because module-level $effect needs an explicit
// root — it runs at import time, outside any component lifecycle.

let effectsInitialized = false;

function initEffects() {
  if (effectsInitialized) return;
  effectsInitialized = true;

  $effect.root(() => {
    // CSS injection — runs whenever pending values change
    $effect(() => {
      if (!browser || !state.pending) return;
      injectBrandVars(state.pending);

      // Load fonts if specified — light (fields) AND the per-theme dark
      // variants (darkTokenOverrides) so previewing dark loads its font file.
      if (state.pending.fontBody) loadGoogleFont(state.pending.fontBody);
      if (state.pending.fontHeading) loadGoogleFont(state.pending.fontHeading);
      const darkBody = state.pending.darkTokenOverrides?.['font-body'];
      const darkHeading = state.pending.darkTokenOverrides?.['font-heading'];
      if (darkBody) loadGoogleFont(darkBody);
      if (darkHeading) loadGoogleFont(darkHeading);
    });

    // sessionStorage persistence — crash recovery
    $effect(() => {
      if (!browser || !state.orgId || !state.pending) return;
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            orgId: state.orgId,
            pending: state.pending,
            level: state.level,
          })
        );
      } catch {
        // sessionStorage full or unavailable — silently ignore
      }
    });
  });
}

// ── Actions ───────────────────────────────────────────────────────────────

function open(orgId: string, saved: BrandEditorState): void {
  initEffects();
  state.orgId = orgId;
  state.saved = structuredClone(saved);
  state.level = 'home';

  // Seed editingTheme from the user's current theme preference so the
  // editor opens viewing the palette they're actually in. Falls back
  // to 'light' when the attribute is absent (e.g., SSR bootstrap).
  if (browser) {
    const docTheme = document.documentElement.getAttribute('data-theme');
    state.editingTheme = docTheme === 'dark' ? 'dark' : 'light';
    // Apply the scoped preview attribute so the dark palette renders
    // on .org-layout without touching <html data-theme> (Codex-9u8wg).
    setThemePreview(state.editingTheme);
  }

  // Try to restore pending state from sessionStorage (crash recovery)
  if (browser) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const restored = JSON.parse(raw);
        if (restored.orgId === orgId && restored.pending) {
          // Merge server-saved tokenOverrides into restored state
          // so fine-tune values persist even if sessionStorage is stale
          if (
            saved.tokenOverrides &&
            Object.keys(saved.tokenOverrides).length > 0
          ) {
            restored.pending.tokenOverrides = {
              ...saved.tokenOverrides,
              ...(restored.pending.tokenOverrides ?? {}),
            };
          }
          if (saved.darkOverrides && !restored.pending.darkOverrides) {
            restored.pending.darkOverrides = saved.darkOverrides;
          }
          // Codex-wwedk: same merge pattern for darkTokenOverrides — preserve
          // server values for keys the in-flight session hasn't touched.
          if (
            saved.darkTokenOverrides &&
            Object.keys(saved.darkTokenOverrides).length > 0
          ) {
            restored.pending.darkTokenOverrides = {
              ...saved.darkTokenOverrides,
              ...(restored.pending.darkTokenOverrides ?? {}),
            };
          } else if (
            !restored.pending.darkTokenOverrides &&
            saved.darkTokenOverrides
          ) {
            restored.pending.darkTokenOverrides = saved.darkTokenOverrides;
          }
          state.pending = restored.pending;
          state.level = restored.level ?? 'home';
          state.panel = 'open';
          return;
        }
      }
    } catch {
      // Corrupt data — ignore
    }
  }

  state.pending = structuredClone(saved);
  state.panel = 'open';
}

function close(): void {
  // Scoped preview lived on .org-layout[data-editing-theme] — drop it
  // on close so the layout falls back cleanly to the user's global theme
  // preference (Codex-z91af: no more stale originalTheme restore).
  if (browser) {
    document
      .querySelector('.org-layout')
      ?.removeAttribute('data-editing-theme');
  }
  clearBrandVars();
  clearStorage();
  state.panel = 'closed';
  state.pending = null;
  state.saved = null;
  state.orgId = null;
  state.level = 'home';
  state.editingTheme = 'light';
}

function minimize(): void {
  state.panel = 'minimized';
}

function expand(): void {
  state.panel = 'open';
}

function navigateTo(level: LevelId): void {
  state.level = level;
}

function navigateBack(): void {
  const parent = LEVELS[state.level].parent;
  if (parent) state.level = parent;
}

function updateField<K extends keyof BrandEditorState>(
  field: K,
  value: BrandEditorState[K]
): void {
  if (!state.pending) return;
  state.pending[field] = value;
}

function applyPreset(preset: BrandPreset): void {
  if (!state.pending) return;
  const { values } = preset;

  // Base values (existing behaviour)
  state.pending.primaryColor = values.primaryColor;
  state.pending.secondaryColor = values.secondaryColor;
  state.pending.accentColor = values.accentColor;
  state.pending.backgroundColor = values.backgroundColor;
  state.pending.fontBody = values.fontBody;
  state.pending.fontHeading = values.fontHeading;
  state.pending.radius = values.radius;
  state.pending.density = values.density;

  // Dark overrides (presets can bundle dark theme colours)
  state.pending.darkOverrides = values.darkOverrides ?? null;

  // Token overrides: MERGE preset keys over existing user fine-tunes.
  // Preset keys win on conflict (the preset author chose that value).
  // Keys the preset doesn't touch (e.g. shadow-scale, body-weight, hero-hide-*)
  // are preserved so fine-tune configuration survives preset browsing
  // (fix for Codex-oqv3r — previously wholesale-replaced, wiping ~30 keys).
  state.pending.tokenOverrides = {
    ...(state.pending.tokenOverrides ?? {}),
    ...(preset.tokenOverrides ?? {}),
  };

  // Codex-wwedk: same merge pattern for darkTokenOverrides. Presets can
  // bundle a parallel dark map so a single click sets both light and dark
  // token values without clobbering keys the preset doesn't touch.
  if (preset.darkTokenOverrides) {
    state.pending.darkTokenOverrides = {
      ...(state.pending.darkTokenOverrides ?? {}),
      ...preset.darkTokenOverrides,
    };
  }

  // Hero layout (presets can set the hero layout variant)
  if (preset.heroLayout) {
    state.pending.heroLayout = preset.heroLayout;
  }
}

function setThemePreview(theme: 'light' | 'dark'): void {
  if (!browser) return;
  // Scope preview to .org-layout, NOT <html>. Writing to the global
  // data-theme attribute would leak into the user's persisted theme
  // preference via localStorage/cookie round-trips (see Codex-9u8wg).
  // CSS consumers in org-brand.css match [data-editing-theme='dark']
  // [data-org-brand] alongside the existing [data-theme='dark'] rule.
  document
    .querySelector('.org-layout')
    ?.setAttribute('data-editing-theme', theme);
}

function setEditingTheme(theme: 'light' | 'dark'): void {
  state.editingTheme = theme;
  setThemePreview(theme);
}

/** Get the effective color for a theme field, respecting the current editing theme. */
function getThemeColor(field: ThemeColorField): string | null {
  if (!state.pending) return null;
  if (
    state.editingTheme === 'dark' &&
    state.pending.darkOverrides?.[field] !== undefined
  ) {
    return state.pending.darkOverrides[field] ?? null;
  }
  return state.pending[field];
}

/** Set a color field, routing to darkOverrides when editing dark theme. */
function setThemeColor(field: ThemeColorField, value: string | null): void {
  if (!state.pending) return;
  if (state.editingTheme === 'dark') {
    const overrides = { ...(state.pending.darkOverrides ?? {}) };
    if (value === null || value === state.pending[field]) {
      // Same as light value or null → remove override (auto-derive)
      delete overrides[field];
    } else {
      overrides[field] = value;
    }
    state.pending.darkOverrides =
      Object.keys(overrides).length > 0 ? overrides : null;
  } else {
    state.pending[field] = value as BrandEditorState[ThemeColorField];
  }
}

/**
 * Codex-wwedk: get the effective token-override value, respecting the
 * editing theme. Falls back to the light value when the dark map has no
 * entry for the key — matches the CSS fallback chain so the editor preview
 * mirrors what visitors see.
 */
function getThemeTokenOverride(key: string): string | null | undefined {
  if (!state.pending) return undefined;
  if (state.editingTheme === 'dark') {
    const dark = state.pending.darkTokenOverrides?.[key];
    if (dark !== undefined) return dark;
  }
  return state.pending.tokenOverrides?.[key];
}

/**
 * Codex-wwedk: set a token-override value, routing to darkTokenOverrides
 * when editing the dark theme. When editing light, writes to tokenOverrides.
 *
 * Setting `value === null` or a value equal to the light value while editing
 * dark removes the dark override (lets the CSS fallback inherit from light).
 */
function setThemeTokenOverride(key: string, value: string | null): void {
  if (!state.pending) return;
  if (state.editingTheme === 'dark') {
    const overrides = { ...(state.pending.darkTokenOverrides ?? {}) };
    const lightValue = state.pending.tokenOverrides?.[key] ?? null;
    if (value === null || value === lightValue) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
    state.pending.darkTokenOverrides =
      Object.keys(overrides).length > 0 ? overrides : null;
  } else {
    const overrides = { ...(state.pending.tokenOverrides ?? {}) };
    if (value === null) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
    state.pending.tokenOverrides = overrides;
  }
}

/**
 * Per-theme FONT accessor. Fonts are single-valued for light (the
 * `fontBody`/`fontHeading` fields) but gain an optional DARK variant stored in
 * `darkTokenOverrides['font-body'|'font-heading']` — mirroring the color/token
 * dark model so a font chosen in one theme no longer overwrites the other.
 * Dark falls back to the light font when unset (matches the CSS fallback).
 */
function getThemeFont(which: 'body' | 'heading'): string | null {
  if (!state.pending) return null;
  const lightValue =
    (which === 'body' ? state.pending.fontBody : state.pending.fontHeading) ??
    null;
  if (state.editingTheme === 'dark') {
    const key = which === 'body' ? 'font-body' : 'font-heading';
    const dark = state.pending.darkTokenOverrides?.[key];
    if (dark != null) return dark;
  }
  return lightValue;
}

/**
 * Set a font, routing to `darkTokenOverrides` when editing dark. A dark value
 * equal to the light font (or null) clears the dark override so dark inherits
 * light via the CSS fallback chain. Editing light writes the base field.
 */
function setThemeFont(which: 'body' | 'heading', value: string | null): void {
  if (!state.pending) return;
  if (state.editingTheme === 'dark') {
    const key = which === 'body' ? 'font-body' : 'font-heading';
    const lightValue =
      (which === 'body' ? state.pending.fontBody : state.pending.fontHeading) ??
      null;
    const overrides = { ...(state.pending.darkTokenOverrides ?? {}) };
    if (value === null || value === lightValue) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
    state.pending.darkTokenOverrides =
      Object.keys(overrides).length > 0 ? overrides : null;
  } else if (which === 'body') {
    state.pending.fontBody = value;
  } else {
    state.pending.fontHeading = value;
  }
  if (value && browser) loadGoogleFont(value);
}

/**
 * Codex-cijzb · WP-1.4 — apply an inbound preview snapshot inside the framed
 * public page (driven by the postMessage bridge, `brand-preview-bridge.ts`).
 *
 * Drives the WP-1.1 injection seam directly:
 *   - sets `pending` so the injection $effect (initEffects) re-runs
 *     `injectBrandVars(pending)`, emitting `--brand-*` onto `.org-layout`;
 *   - opens the panel so the layout's `isOpen ? pending : server` bindings
 *     (logo, hero-layout, hero-visibility toggles, shader gate) read `pending`.
 * No reload is needed for any field.
 *
 * Deliberately does NOT set `orgId`: the sessionStorage crash-recovery $effect
 * is guarded on `orgId`, so a preview frame never pollutes a real editor
 * session's storage (both share this origin's sessionStorage). This is a pure
 * applier — it never posts a message, so it cannot echo back to the sender.
 */
function applyPreviewVars(vars: BrandEditorState): void {
  initEffects();
  state.pending = vars;
  state.panel = 'open';
}

function discard(): void {
  if (!state.saved) return;
  state.pending = $state.snapshot(state.saved) as BrandEditorState;
  clearStorage();
}

function getSavePayload(): BrandEditorState | null {
  return state.pending
    ? ($state.snapshot(state.pending) as BrandEditorState)
    : null;
}

function markSaved(): void {
  if (!state.pending) return;
  state.saved = $state.snapshot(state.pending) as BrandEditorState;
  clearStorage();
}

function clearStorage(): void {
  if (!browser) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

// ── Exports ───────────────────────────────────────────────────────────────

export const brandEditor = {
  // Reactive getters (read via property access in templates/effects)
  get panel() {
    return state.panel;
  },
  get isOpen() {
    return isOpen;
  },
  get isMinimized() {
    return isMinimized;
  },
  get isClosed() {
    return isClosed;
  },
  get isDirty() {
    return isDirty;
  },
  get orgId() {
    return state.orgId;
  },
  get saved() {
    return state.saved;
  },
  get pending() {
    return state.pending;
  },
  get level() {
    return state.level;
  },
  get currentLevel() {
    return currentLevel;
  },
  get breadcrumbs() {
    return breadcrumbs;
  },
  get editingTheme() {
    return state.editingTheme;
  },

  // Actions
  open,
  close,
  minimize,
  expand,
  navigateTo,
  navigateBack,
  updateField,
  applyPreset,
  setThemePreview,
  setEditingTheme,
  getThemeColor,
  setThemeColor,
  // Codex-wwedk: per-theme tokenOverride routing (parallel to setThemeColor).
  getThemeTokenOverride,
  setThemeTokenOverride,
  // Per-theme fonts (dark variant via darkTokenOverrides).
  getThemeFont,
  setThemeFont,
  // Codex-cijzb · WP-1.4: apply an inbound live-preview snapshot in the iframe.
  applyPreviewVars,
  discard,
  getSavePayload,
  markSaved,
};
