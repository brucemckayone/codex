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
  originalTheme: string | null;
  editingTheme: 'light' | 'dark';
}>({
  panel: 'closed',
  orgId: null,
  saved: null,
  pending: null,
  level: 'home',
  originalTheme: null,
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

      // Load fonts if specified
      if (state.pending.fontBody) loadGoogleFont(state.pending.fontBody);
      if (state.pending.fontHeading) loadGoogleFont(state.pending.fontHeading);
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

  // Capture current theme for restoration on close
  if (browser) {
    state.originalTheme =
      document.documentElement.getAttribute('data-theme') ?? 'light';
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
  if (browser && state.originalTheme) {
    document.documentElement.setAttribute('data-theme', state.originalTheme);
  }
  clearBrandVars();
  clearStorage();
  state.panel = 'closed';
  state.pending = null;
  state.saved = null;
  state.orgId = null;
  state.level = 'home';
  state.originalTheme = null;
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

  // Hero layout (presets can set the hero layout variant)
  if (preset.heroLayout) {
    state.pending.heroLayout = preset.heroLayout;
  }
}

function setThemePreview(theme: 'light' | 'dark'): void {
  if (!browser) return;
  document.documentElement.setAttribute('data-theme', theme);
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
  get originalTheme() {
    return state.originalTheme;
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
  discard,
  getSavePayload,
  markSaved,
};
