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
  PageOffer,
  PageSection,
  PageSeo,
  SectionDesign,
  SectionProps,
} from '@codex/shared-types';
import { browser } from '$app/environment';
import { createSection, findSectionDefinition } from './section-catalog';

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

// ── Undo / redo (section-model history) ───────────────────────────────────────
// snapshot() captures `pending` BEFORE a discrete action; snapshotEdit() coalesces
// a burst of typing into ONE step (mirrors the prototype's snap()/snapEdit()).
// Scoped to the section model — the same scope the prototype's history covers.

const history = $state<{ undo: PageBuilderState[]; redo: PageBuilderState[] }>({
  undo: [],
  redo: [],
});
const MAX_HISTORY = 80;
let burstTimer: ReturnType<typeof setTimeout> | null = null;

function clearHistory(): void {
  history.undo = [];
  history.redo = [];
  if (burstTimer) {
    clearTimeout(burstTimer);
    burstTimer = null;
  }
}

/** Capture the pre-mutation `pending` as one undo step (a discrete action). */
function snapshot(): void {
  if (!state.pending) return;
  history.undo.push(clone(state.pending));
  if (history.undo.length > MAX_HISTORY) history.undo.shift();
  history.redo = [];
}

/** Capture once per typing burst — coalesces keystrokes into a single step. */
function snapshotEdit(): void {
  if (burstTimer) {
    clearTimeout(burstTimer);
  } else {
    snapshot();
  }
  burstTimer = setTimeout(() => {
    burstTimer = null;
  }, 600);
}

/** Re-focus a valid section after a history swap replaced the section list. */
function ensureSelection(): void {
  if (!state.pending) return;
  if (!state.pending.sections.some((s) => s.id === state.selectedSectionId)) {
    state.selectedSectionId = firstSectionId(state.pending);
  }
}

/** Step back one discrete edit (Cmd/Ctrl+Z). */
function undo(): void {
  if (!state.pending || history.undo.length === 0) return;
  // Seal any in-flight typing burst so it is its own step before walking back.
  if (burstTimer) {
    clearTimeout(burstTimer);
    burstTimer = null;
  }
  history.redo.push(clone(state.pending));
  const prev = history.undo.pop();
  if (prev) state.pending = prev;
  ensureSelection();
}

/** Re-apply the last undone edit (Cmd/Ctrl+Shift+Z / Ctrl+Y). */
function redo(): void {
  if (!state.pending || history.redo.length === 0) return;
  history.undo.push(clone(state.pending));
  const next = history.redo.pop();
  if (next) state.pending = next;
  ensureSelection();
}

// ── Actions ───────────────────────────────────────────────────────────────

/**
 * Begin a builder session for a persisted page. Seeds `saved`/`pending` from the
 * loaded draft, restoring an in-flight `pending` from sessionStorage when it
 * matches this page (crash recovery), and focuses the first section.
 */
function open(pageId: string, saved: PageBuilderState): void {
  initEffects();
  clearHistory();
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
  clearHistory();
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
  snapshotEdit();
  state.pending.sections[i].props = props;
}

/** Set a single key within a section's props bag (the config editor's per-field write). */
function setSectionProp(id: string, key: string, value: unknown): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  snapshotEdit();
  state.pending.sections[i].props = {
    ...state.pending.sections[i].props,
    [key]: value,
  };
}

/** Flip a section on/off (§4.1 toggleable). */
function toggleSection(id: string): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  snapshot();
  state.pending.sections[i].enabled = !state.pending.sections[i].enabled;
}

/**
 * Insert a new section of `type` (seeded from the catalogue with its default
 * variant + placeholder copy) and focus it. Inserts AFTER `afterId` when given
 * (the add-picker/canvas "add after this" affordance), else appends. Returns the
 * new section's id so the caller can scroll/focus it. The renderer skips unknown
 * types, so `type` is a plain string (matches the contract).
 */
function addSection(type: string, afterId?: string): string {
  if (!state.pending) return '';
  snapshot();
  const section = createSection(type, makeId);
  const from = afterId ? indexOf(afterId) : -1;
  const at = from >= 0 ? from + 1 : state.pending.sections.length;
  state.pending.sections.splice(at, 0, section);
  state.selectedSectionId = section.id;
  return section.id;
}

/**
 * Duplicate a section in place (inserted directly after the source, focused).
 * The copy gets a fresh id and a " copy"-suffixed display name. Returns the new
 * id, or '' when the source is absent.
 */
function duplicateSection(id: string): string {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return '';
  snapshot();
  const src = state.pending.sections[i];
  const baseName =
    src.name ?? findSectionDefinition(src.type)?.label ?? src.type;
  const copy: PageSection = {
    ...clone(src),
    id: makeId(),
    name: `${baseName} copy`,
  };
  state.pending.sections.splice(i + 1, 0, copy);
  state.selectedSectionId = copy.id;
  return copy.id;
}

/** Switch a section's layout composition (§4.1 "options per component"). */
function setSectionVariant(id: string, variant: string): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  snapshot();
  state.pending.sections[i].variant = variant;
}

/**
 * Set the PAGE's look — the whole nine-axis bundle the preset picker writes
 * (`docs/design/journey-sections/02-axis-contract.md` A21).
 *
 * Whole-bundle rather than per-axis because a preset IS a coherent set: writing
 * five of nine axes would leave the page half in one look and half in another,
 * which is the incoherence the preset exists to prevent. Per-axis freedom lives
 * at the SECTION level ({@link setSectionDesignAxis}), where a deliberate
 * exception (a vast hero over a compact FAQ) is good design.
 */
function setPageDesign(design: SectionDesign): void {
  if (!state.pending) return;
  snapshot();
  state.pending.design = { ...design };
}

/**
 * Override ONE axis on ONE section, or clear that override with `undefined`.
 *
 * Clearing DELETES the key rather than storing `undefined`, and drops the whole
 * `design` bag once it is empty, so "inherited" is represented by absence — the
 * shape `resolveDesign` already resolves and the shape a page stored before the
 * axes existed already has. A stored `{ width: undefined }` would serialise to
 * `{}` through the save anyway, so absence is also the only round-trip-stable
 * representation.
 */
function setSectionDesignAxis<A extends keyof SectionDesign>(
  id: string,
  axis: A,
  value: SectionDesign[A] | undefined
): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  snapshot();
  const section = state.pending.sections[i];
  const next: SectionDesign = { ...(section.design ?? {}) };
  if (value === undefined) {
    delete next[axis];
  } else {
    next[axis] = value;
  }
  if (Object.keys(next).length === 0) {
    delete section.design;
  } else {
    section.design = next;
  }
}

/** Move a section to an absolute index (the drag-reorder drop target). */
function moveSectionTo(id: string, toIndex: number): void {
  const from = indexOf(id);
  if (from < 0 || !state.pending) return;
  const list = state.pending.sections;
  const to = Math.max(0, Math.min(toIndex, list.length - 1));
  if (from === to) return;
  snapshot();
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
}

/** Remove a section; re-focus a neighbour so the editor never points at nothing. */
function removeSection(id: string): void {
  const i = indexOf(id);
  if (i < 0 || !state.pending) return;
  snapshot();
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
  snapshot();
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

/**
 * Merge a partial SEO patch into `pending.seo` (the SEO panel's write).
 *
 * PERSISTED as of Codex-2j8nq: migration 0090 added `landing_pages.seo` jsonb,
 * `pageSeoSchema` declares the key on the `.strict()` save body, and
 * `saveJourneyPage` writes it. Before that this had no consumer and
 * `PageSeoPanel` disabled its two fields rather than accept keystrokes the save
 * would discard under a "Page saved" toast.
 *
 * A MERGE, not a replace, so the panel can write `title` and `description`
 * independently. Clearing a field is the EMPTY STRING (which persists), never
 * deleting the key — the public head falls back with `||`, so an empty override
 * resumes deriving from the page title / course lede, while an ABSENT `seo` is
 * what the service reads as "leave the stored bag alone".
 */
function updateSeo(patch: Partial<PageSeo>): void {
  if (!state.pending) return;
  state.pending.seo = { ...(state.pending.seo ?? {}), ...patch };
}

/** Merge a partial offer patch into `pending.offer` (Pricing builder mode). */
function updateOffer(patch: Partial<PageOffer>): void {
  if (!state.pending) return;
  state.pending.offer = { ...(state.pending.offer ?? {}), ...patch };
}

/** Revert every pending edit to the last saved draft. */
function discard(): void {
  if (!state.saved) return;
  state.pending = clone(state.saved);
  state.selectedSectionId = firstSectionId(state.pending);
  clearStorage();
  clearHistory();
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
  snapshot();
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
  clearHistory();
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
  get canUndo() {
    return history.undo.length > 0;
  },
  get canRedo() {
    return history.redo.length > 0;
  },

  // Actions
  open,
  close,
  undo,
  redo,
  selectSection,
  updateMeta,
  setSectionProps,
  setSectionProp,
  toggleSection,
  addSection,
  duplicateSection,
  setSectionVariant,
  setPageDesign,
  setSectionDesignAxis,
  removeSection,
  moveSection,
  moveSectionTo,
  updateBrandOverrides,
  updateSeo,
  updateOffer,
  discard,
  resetSection,
  applyPreviewState,
  getSavePayload,
  markSaved,

  // Test seam — deterministic section ids.
  setIdFactory,
};
