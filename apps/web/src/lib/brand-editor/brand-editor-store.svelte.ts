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
}>({
  panel: 'closed',
  orgId: null,
  saved: null,
  pending: null,
  level: 'home',
  originalTheme: null,
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

// ── Actions ───────────────────────────────────────────────────────────────

function open(orgId: string, saved: BrandEditorState): void {
  state.orgId = orgId;
  state.saved = structuredClone(saved);
  state.level = 'home';

  // Capture current theme for restoration on close
  if (browser) {
    state.originalTheme =
      document.documentElement.getAttribute('data-theme') ?? 'light';
  }

  // Try to restore pending state from sessionStorage
  if (browser) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const restored = JSON.parse(raw);
        if (restored.orgId === orgId && restored.pending) {
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
  state.pending.primaryColor = values.primaryColor;
  state.pending.secondaryColor = values.secondaryColor;
  state.pending.accentColor = values.accentColor;
  state.pending.backgroundColor = values.backgroundColor;
  state.pending.fontBody = values.fontBody;
  state.pending.fontHeading = values.fontHeading;
  state.pending.radius = values.radius;
  state.pending.density = values.density;
}

function setThemePreview(theme: 'light' | 'dark'): void {
  if (!browser) return;
  document.documentElement.setAttribute('data-theme', theme);
}

function discard(): void {
  if (!state.saved) return;
  state.pending = structuredClone(state.saved);
  clearStorage();
}

function getSavePayload(): BrandEditorState | null {
  return state.pending ? structuredClone(state.pending) : null;
}

function markSaved(): void {
  if (!state.pending) return;
  state.saved = structuredClone(state.pending);
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
  discard,
  getSavePayload,
  markSaved,
};
