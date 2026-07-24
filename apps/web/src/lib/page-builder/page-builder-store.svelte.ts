/**
 * Page-builder store (Svelte 5 runes) — Codex-2pryk.3.3 · WP-5.
 *
 * The `saved` / `pending` runes spine for the journey/page builder, cloned from
 * `$lib/brand-editor/brand-editor-store.svelte.ts`. The studio builder mutates
 * `pending` (add / reorder / toggle a {@link PageSection}, edit its props, edit
 * page meta + brand overrides); a route `$effect` streams the pending draft to
 * the live-preview iframe over the `codex:page-preview:v1` bridge
 * ({@link ../page-builder/page-preview-bridge}). Inside the framed public page
 * the applier drives THIS store's `pending` (a SEPARATE realm's module
 * instance), so copy / order / toggle edits go live with NO reload — exactly as
 * `brandEditor.applyPreviewVars` does for brand tokens (SPEC §9).
 *
 * PUBLIC-SAFE PLACEMENT: this lives under `$lib/page-builder` (a CE-4
 * public-lib scan root, `apps/web/scripts/check-brand-editor-boundary.mjs`) so
 * the framed public journey page (WP-3) can import the applier + read `pending`
 * without pulling heavy editor UI into the public chunk. It therefore uses only
 * runes + sessionStorage and imports NO `$lib/components/*` — mirroring why the
 * brand store lives in `$lib/brand-editor`, not `$lib/components/brand-editor`.
 *
 * Uses $state/$derived/$effect — NOT svelte/store. Module-level $effect needs an
 * explicit `$effect.root()`, wired lazily on first `open`/`applyPreviewState`.
 */

import type {
  PageBuilderState,
  PageSection,
  SectionProps,
} from '@codex/shared-types';
import { browser } from '$app/environment';

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'codex:page-builder';

// ── ID factory (injectable for tests) ───────────────────────────────────────
// Defaults to crypto.randomUUID (present in the SvelteKit + Node runtimes).
let makeId: () => string = () => crypto.randomUUID();

/** Override the section-id factory (tests inject a deterministic sequence). */
function setIdFactory(fn: () => string): void {
  makeId = fn;
}

// ── Internal State ────────────────────────────────────────────────────────

const state = $state<{
  /** The persisted draft last loaded/saved — the diff baseline for `isDirty`. */
  saved: PageBuilderState | null;
  /** The editable draft the rail mutates and the preview bridge streams. */
  pending: PageBuilderState | null;
  /** Persisted page row id — the crash-recovery scope. null in a preview frame. */
  pageId: string | null;
  /** Which section the rail's config editor is focused on. */
  selectedSectionId: string | null;
  /** Whether a builder/preview session is active (mirrors brandEditor.isOpen). */
  isOpen: boolean;
}>({
  saved: null,
  pending: null,
  pageId: null,
  selectedSectionId: null,
  isOpen: false,
});

// ── Derived State ─────────────────────────────────────────────────────────

const isDirty = $derived.by(() => {
  if (!state.saved || !state.pending) return false;
  return JSON.stringify(state.saved) !== JSON.stringify(state.pending);
});

const sections = $derived<PageSection[]>(state.pending?.sections ?? []);

const selectedSection = $derived.by<PageSection | null>(
  () => sections.find((s) => s.id === state.selectedSectionId) ?? null
);

// ── Effects ───────────────────────────────────────────────────────────────
// Wrapped in $effect.root() because module-level $effect needs an explicit
// root — it runs at import time, outside any component lifecycle.

let effectsInitialized = false;

function initEffects(): void {
  if (effectsInitialized) return;
  effectsInitialized = true;

  $effect.root(() => {
    // sessionStorage crash-recovery. Guarded on `pageId`, so a PREVIEW-frame
    // session (applyPreviewState sets no pageId) never writes — the framed page
    // and a real editor share this origin's sessionStorage.
    $effect(() => {
      if (!browser || !state.pageId || !state.pending) return;
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            pageId: state.pageId,
            pending: state.pending,
            selectedSectionId: state.selectedSectionId,
          })
        );
      } catch {
        // sessionStorage full/unavailable — crash recovery is best-effort.
      }
    });
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Structural deep-clone that survives `$state` proxies (via snapshot). */
function clone<T>(value: T): T {
  return structuredClone($state.snapshot(value)) as T;
}

/** Index of a section by id in the pending draft, or -1. */
function indexOf(id: string): number {
  return state.pending?.sections.findIndex((s) => s.id === id) ?? -1;
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * Begin a builder session for a persisted page. Seeds `saved`/`pending` from the
 * loaded draft, restoring an in-flight `pending` from sessionStorage when it
 * matches this page (crash recovery), and focuses the first section.
 */
function open(pageId: string, saved: PageBuilderState): void {
  initEffects();
  state.pageId = pageId;
  state.saved = clone(saved);

  if (browser) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const restored = JSON.parse(raw) as {
          pageId?: string;
          pending?: PageBuilderState;
          selectedSectionId?: string | null;
        };
        if (restored.pageId === pageId && restored.pending) {
          state.pending = restored.pending;
          state.selectedSectionId =
            restored.selectedSectionId ?? firstSectionId(restored.pending);
          state.isOpen = true;
          return;
        }
      }
    } catch {
      // Corrupt persisted state — fall through to a clean clone.
    }
  }

  state.pending = clone(saved);
  state.selectedSectionId = firstSectionId(state.pending);
  state.isOpen = true;
}

function firstSectionId(page: PageBuilderState): string | null {
  return page.sections[0]?.id ?? null;
}

/** End the session and clear crash-recovery state. */
function close(): void {
  clearStorage();
  state.saved = null;
  state.pending = null;
  state.pageId = null;
  state.selectedSectionId = null;
  state.isOpen = false;
}

/** Focus a section in the rail's config editor (null clears the selection). */
function selectSection(id: string | null): void {
  state.selectedSectionId = id;
}

/** Set a top-level page-meta field (title / slug / status / subjectId / …). */
function updateMeta<K extends keyof PageBuilderState>(
  field: K,
  value: PageBuilderState[K]
): void {
  if (!state.pending) return;
  state.pending[field] = value;
}

/** Replace one section's props wholesale (merge is the caller's choice). */
function setSectionProps(id: string, props: SectionProps): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  state.pending.sections[i].props = props;
}

/** Set a single key within a section's props bag (the config editor's per-field write). */
function setSectionProp(id: string, key: string, value: unknown): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  state.pending.sections[i].props = {
    ...state.pending.sections[i].props,
    [key]: value,
  };
}

/** Flip a section on/off (§4.1 toggleable). */
function toggleSection(id: string): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  state.pending.sections[i].enabled = !state.pending.sections[i].enabled;
}

/**
 * Append a new section of `type` (empty props, enabled) and focus it. Returns
 * the new section's id so the caller can scroll/focus it. The WP-3 renderer
 * skips unknown types, so `type` is a plain string (matches the contract).
 */
function addSection(type: string): string {
  if (!state.pending) return '';
  const section: PageSection = { id: makeId(), type, enabled: true, props: {} };
  state.pending.sections.push(section);
  state.selectedSectionId = section.id;
  return section.id;
}

/** Remove a section; re-focus a neighbour so the editor never points at nothing. */
function removeSection(id: string): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  state.pending.sections.splice(i, 1);
  if (state.selectedSectionId === id) {
    const next = state.pending.sections[i] ?? state.pending.sections[i - 1];
    state.selectedSectionId = next?.id ?? null;
  }
}

/** Reorder a section one slot up (-1) or down (+1); a no-op at the ends. */
function moveSection(id: string, direction: -1 | 1): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  const target = i + direction;
  if (target < 0 || target >= state.pending.sections.length) return;
  const list = state.pending.sections;
  [list[i], list[target]] = [list[target], list[i]];
}

/** Merge a partial brand-override patch into `pending.brandOverrides`. */
function updateBrandOverrides(
  patch: NonNullable<PageBuilderState['brandOverrides']>
): void {
  if (!state.pending) return;
  state.pending.brandOverrides = {
    ...(state.pending.brandOverrides ?? {}),
    ...patch,
  };
}

/** Revert every pending edit to the last saved draft. */
function discard(): void {
  if (!state.saved) return;
  state.pending = clone(state.saved);
  state.selectedSectionId = firstSectionId(state.pending);
  clearStorage();
}

/**
 * Revert ONE section to its saved value, leaving other pending edits intact
 * (mirrors `brandEditor.resetField`). No-op when the section is new (absent from
 * `saved`) or already equal to saved.
 */
function resetSection(id: string): void {
  if (!state.pending || !state.saved) return;
  const savedSection = state.saved.sections.find((s) => s.id === id);
  const i = indexOf(id);
  if (!savedSection || i < 0) return;
  state.pending.sections[i] = clone(savedSection);
}

/**
 * Apply an inbound preview snapshot inside the framed public page (driven by the
 * postMessage bridge). Sets `pending` + opens so the framed renderer re-derives
 * its output. Deliberately sets NO `pageId`, so the sessionStorage effect stays
 * inert in a preview frame (mirrors `brandEditor.applyPreviewVars`). Pure applier
 * — it never posts a message, so it cannot echo back to the sender.
 */
function applyPreviewState(page: PageBuilderState): void {
  initEffects();
  state.pending = page;
  state.isOpen = true;
}

/** The payload to persist — a plain (non-proxy) deep snapshot of `pending`. */
function getSavePayload(): PageBuilderState | null {
  return state.pending ? clone(state.pending) : null;
}

/** Mark the current pending draft as the new saved baseline (post-persist). */
function markSaved(): void {
  if (!state.pending) return;
  state.saved = clone(state.pending);
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

export const pageBuilder = {
  // Reactive getters
  get isOpen() {
    return state.isOpen;
  },
  get isDirty() {
    return isDirty;
  },
  get pageId() {
    return state.pageId;
  },
  get saved() {
    return state.saved;
  },
  get pending() {
    return state.pending;
  },
  get sections() {
    return sections;
  },
  get selectedSectionId() {
    return state.selectedSectionId;
  },
  get selectedSection() {
    return selectedSection;
  },

  // Actions
  open,
  close,
  selectSection,
  updateMeta,
  setSectionProps,
  setSectionProp,
  toggleSection,
  addSection,
  removeSection,
  moveSection,
  updateBrandOverrides,
  discard,
  resetSection,
  applyPreviewState,
  getSavePayload,
  markSaved,

  // Test seam — deterministic section ids.
  setIdFactory,
};
