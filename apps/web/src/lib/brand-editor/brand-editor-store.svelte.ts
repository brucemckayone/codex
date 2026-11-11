/**
 * Brand Editor Store (Svelte 5 Runes)
 *
 * Module-level reactive state for the floating brand editor panel.
 * Uses $state/$derived/$effect — NOT svelte/store.
 *
 * CSS injection happens automatically via $effect when pending values change.
 * An unsaved brand is kept in sessionStorage for crash recovery (see below).
 */

import { browser } from '$app/environment';
import { canonicalJson, hash } from '$lib/utils/fingerprint';
import {
  clearBrandVars,
  injectBrandVars,
  loadGoogleFont,
} from './css-injection';
import { getBreadcrumb, isLevelId, LEVELS } from './levels';
import type {
  BrandEditorState,
  BrandPreset,
  LevelId,
  PanelState,
  ThemeColorField,
} from './types';

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'codex:brand-editor';

// ── Crash recovery ────────────────────────────────────────────────────────
// The tab keeps its unsaved brand in sessionStorage, so a reload or a crash
// does not lose it. A draft is only safe to restore over the brand it was
// edited FROM: once someone has saved the brand since, the draft is stale,
// and one Save would write the older brand over the newer one. So the row
// carries a fingerprint of the saved brand it was written against, and `open`
// restores it only when that still matches what the server holds. This is
// the page editor's rule (page-builder-store) (Codex-0keaj).

/** What {@link open} did with the tab's crash-recovery row. */
export type RecoveryOutcome = 'none' | 'restored' | 'discarded';

interface RecoveryRow {
  orgId: string;
  /**
   * {@link fingerprint} of the saved brand the draft was edited from. Absent
   * from a row an older editor wrote, which is then never restored.
   */
  baseline?: string;
  pending: BrandEditorState;
  level?: unknown;
}

/** An upper-cased hex, or null for none, as the server stores a colour. */
function storedColour(value: string | null): string | null {
  return value?.trim().toUpperCase() || null;
}

/**
 * A saved brand's fingerprint, taken the way the SERVER hands the brand back,
 * so a brand this tab saved matches its own next load. Save is lossy in known
 * ways, each normalised here:
 * - colours are trimmed and upper-cased (`hexColorSchema`); empty is null;
 * - fonts are trimmed; empty is null;
 * - a radius or density of 0 reads back as the default (`|| 0.5`, `|| 1`);
 * - an empty dark token map is not sent, so it reads back as null, and an
 *   empty token map reads back as `{}`;
 * - an unset hero layout reads back as 'default';
 * - stored JSON does not keep key order.
 *
 * The logo is left out. Save never sends it (the logo control commits on
 * pick), so the server's is always current, and a draft never brings one.
 */
function fingerprint(brand: BrandEditorState): string {
  return hash(
    canonicalJson({
      ...brand,
      logoUrl: undefined,
      primaryColor: storedColour(brand.primaryColor) ?? '#C24129',
      secondaryColor: storedColour(brand.secondaryColor),
      accentColor: storedColour(brand.accentColor),
      backgroundColor: storedColour(brand.backgroundColor),
      fontBody: brand.fontBody?.trim() || null,
      fontHeading: brand.fontHeading?.trim() || null,
      radius: Number(brand.radius) || 0.5,
      density: Number(brand.density) || 1,
      tokenOverrides: brand.tokenOverrides ?? {},
      darkTokenOverrides:
        brand.darkTokenOverrides &&
        Object.keys(brand.darkTokenOverrides).length > 0
          ? brand.darkTokenOverrides
          : null,
      heroLayout: brand.heroLayout || 'default',
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A map of string (or null) values: the token and dark-colour overrides. */
function isTextMap(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((v) => v === null || typeof v === 'string')
  );
}

function isTextOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

/** Every field of {@link BrandEditorState}, so a restored draft is one. */
function isBrandEditorState(value: unknown): value is BrandEditorState {
  if (!isRecord(value)) return false;
  return (
    typeof value.primaryColor === 'string' &&
    isTextOrNull(value.secondaryColor) &&
    isTextOrNull(value.accentColor) &&
    isTextOrNull(value.backgroundColor) &&
    isTextOrNull(value.fontBody) &&
    isTextOrNull(value.fontHeading) &&
    Number.isFinite(value.radius) &&
    Number.isFinite(value.density) &&
    isTextOrNull(value.logoUrl) &&
    isTextMap(value.tokenOverrides) &&
    (value.darkOverrides === null || isTextMap(value.darkOverrides)) &&
    (value.darkTokenOverrides === null ||
      isTextMap(value.darkTokenOverrides)) &&
    typeof value.heroLayout === 'string'
  );
}

function isRecoveryRow(value: unknown): value is RecoveryRow {
  return (
    isRecord(value) &&
    typeof value.orgId === 'string' &&
    (value.baseline === undefined || typeof value.baseline === 'string') &&
    isBrandEditorState(value.pending)
  );
}

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

/** Moves only when `saved` does, never once per edit. */
const savedFingerprint = $derived(
  state.saved ? fingerprint(state.saved) : null
);

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

    // sessionStorage crash recovery. Guarded on `orgId`, so a preview frame
    // (applyPreviewVars) never writes a row.
    $effect(() => {
      if (!browser || !state.orgId || !state.pending) return;
      // Only UNSAVED work gets a row. A clean one could only restore the saved
      // brand, or, once someone saved over it, a stale copy: an editor left
      // open untouched used to revert another admin's save on reload + Save.
      if (!isDirty || !savedFingerprint) {
        clearStorage();
        return;
      }
      const row: RecoveryRow = {
        orgId: state.orgId,
        baseline: savedFingerprint,
        pending: state.pending,
        level: state.level,
      };
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(row));
      } catch {
        // sessionStorage full or unavailable: crash recovery is best-effort.
      }
    });
  });
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * Open the editor on `saved`, then restore the tab's unsaved draft of this
 * org's brand if it has one that is still safe to restore (see
 * {@link recover}). Returns what happened to that draft, for the caller to say.
 */
function open(orgId: string, saved: BrandEditorState): RecoveryOutcome {
  initEffects();
  state.orgId = orgId;
  state.saved = structuredClone(saved);
  state.pending = structuredClone(saved);
  state.level = 'home';
  state.panel = 'open';

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

  try {
    return recover(orgId, saved);
  } catch {
    // Unreadable row: the saved brand stands.
    clearStorage();
    return 'none';
  }
}

/**
 * Restore the tab's unsaved draft of `orgId`'s brand, but only over the brand
 * it was edited from. A row written against a different saved brand is
 * DISCARDED: someone has saved since, and restoring the draft would let one
 * Save write the older brand over the newer one. A restored draft was edited
 * from exactly this brand, so nothing of the server's is merged into it.
 *
 * The draft never brings its logo. The logo control commits on pick, so the
 * server's logo is current, and Save never sends one.
 */
function recover(orgId: string, saved: BrandEditorState): RecoveryOutcome {
  if (!browser) return 'none';
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return 'none';
  const row: unknown = JSON.parse(raw);
  if (!isRecoveryRow(row)) {
    clearStorage();
    return 'none';
  }
  if (row.orgId !== orgId) return 'none';
  const baseline = fingerprint(saved);
  const draft: BrandEditorState = { ...row.pending, logoUrl: saved.logoUrl };
  // Nothing in it that the saved brand does not already say.
  if (fingerprint(draft) === baseline) return 'none';
  if (row.baseline !== baseline) {
    clearStorage();
    return 'discarded';
  }
  state.pending = draft;
  // A level id the editor no longer has falls back to home.
  state.level = isLevelId(row.level) ? row.level : 'home';
  return 'restored';
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
  // An editor that never opened previewed nothing, so it strips nothing. The
  // brand page closes on destroy even when it left before its query let it
  // open, and clearBrandVars would then strip the org layout's own brand with
  // `isClosed` unchanged, so nothing writes it back (Codex-q01h8).
  if (state.panel !== 'closed') clearBrandVars();
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

/**
 * Codex-cijzb · WP-1.5 — revert a SINGLE field to its saved value, leaving
 * every other pending edit intact. Powers the control-rail change-ledger's
 * per-field Reset. Reuses the same `saved`/`pending` spine as `discard`, but
 * scoped to one key. `$state.snapshot` deep-clones object-valued fields
 * (`tokenOverrides`, `darkOverrides`, `darkTokenOverrides`) so the restored
 * value can never alias the saved reference and drift later.
 *
 * No-op when there is nothing to reset (closed editor) or the field already
 * equals its saved value.
 */
function resetField<K extends keyof BrandEditorState>(field: K): void {
  if (!state.pending || !state.saved) return;
  state.pending[field] = $state.snapshot(
    state.saved[field]
  ) as BrandEditorState[K];
}

function getSavePayload(): BrandEditorState | null {
  return state.pending
    ? ($state.snapshot(state.pending) as BrandEditorState)
    : null;
}

/**
 * The save landed: `saved` becomes what it sent. Pass the payload the save
 * read (`getSavePayload`): an edit made while the save was in flight is not
 * in it, so it stays unsaved, rather than being counted saved and never sent.
 * Without one, the brand as it stands now is taken as saved.
 */
function markSaved(sent?: BrandEditorState): void {
  if (!state.pending) return;
  state.saved = sent
    ? structuredClone(sent)
    : ($state.snapshot(state.pending) as BrandEditorState);
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
  // Codex-cijzb · WP-1.5: per-field revert for the control-rail change-ledger.
  resetField,
  getSavePayload,
  markSaved,
};
