/**
 * Autosave controller (docs/design/landing-builder/01-contract.md §7, WP-7a).
 *
 * Contract §7: a DRAFT page autosaves ~1.5s after the last change ("Saving… /
 * Saved / Couldn't save — Retry"). A PUBLISHED page never pushes edits live on
 * every keystroke — changes accumulate and the editor's primary button
 * becomes "Publish changes" instead. This controller enforces exactly that
 * split: it schedules `save()` for a draft and never for a published page,
 * while still tracking `hasUnpublishedChanges` so the caller can drive that
 * button.
 *
 * A FACTORY, not a module singleton like `page-builder-store.svelte.ts`'s
 * `pageBuilder` — the new editor creates one per open builder session and
 * calls `dispose()` on teardown, so `createAutosave()` is meant to be called
 * from a component's own initialisation (where any runes it touches are owned
 * by that component's lifecycle), never at module scope.
 *
 * `save` is a narrow port, not a direct call to `saveBuilderDraft()`
 * (`builder-save.ts`): the caller adapts that function's
 * `BuilderSaveResult` discriminated union into this module's plain
 * `{ ok, message? }`. `saveBuilderDraft` never throws by its own contract, but
 * `save()` is still wrapped in try/catch here in case an adapter does.
 *
 * NOTIFICATION IS PULL, NOT PUSH: `isDirty`/`isPublished`/`isPublished` are
 * plain functions read on demand, and this controller does not watch the
 * store reactively via its own `$effect` — the caller decides when something
 * counts as "a change" and calls {@link AutosaveController.notifyChange}. That
 * keeps this module effect-free (no `$effect.root()` bookkeeping to get
 * wrong) and lets one draft-only edit (e.g. typing) and one page-meta edit
 * both reach the same seam without this module needing to know how many
 * different mutators the store has.
 */

import { browser } from '$app/environment';
import * as m from '$paraglide/messages';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutosaveSaveResult {
  ok: boolean;
  message?: string;
}

export interface AutosaveDeps {
  /** Is there anything to save right now? Read fresh on every check. */
  isDirty(): boolean;
  /** Is the page live? Gates whether a change schedules an autosave at all. */
  isPublished(): boolean;
  /** Persist the current draft. Should not throw; caught here regardless. */
  save(): Promise<AutosaveSaveResult>;
  /** Debounce window after the last change, before `save()` runs. Default 1500. */
  debounceMs?: number;
}

export interface AutosaveController {
  readonly status: AutosaveStatus;
  readonly lastSavedAt: Date | null;
  readonly errorMessage: string | undefined;
  /**
   * Published AND dirty — drives the "Publish changes" button (contract §7).
   * A live getter over `deps`, not a snapshot: it is always in sync with the
   * store without this controller needing its own reactive subscription.
   */
  readonly hasUnpublishedChanges: boolean;
  /**
   * Tell the controller something changed. A draft (re)starts the debounce
   * window; a published page only refreshes `hasUnpublishedChanges` (a live
   * getter, so there is nothing to "refresh") and never schedules a save.
   * Call this from every mutation site, or from one `$effect` in the caller
   * that watches the store's dirty flag — this controller has no way to
   * notice a change on its own.
   */
  notifyChange(): void;
  /**
   * Save immediately, bypassing the debounce (Publish / Preview). Rides an
   * already-running autosave instead of starting a second, concurrent one.
   * After {@link dispose} it saves nothing and says so (`ok: false`): the
   * caller would otherwise report a save that never happened.
   */
  flush(): Promise<AutosaveSaveResult>;
  /** Re-attempt after an error. No-op while a save is already in flight. */
  retry(): void;
  /**
   * Drop a scheduled save and any follow-up queued behind the running one.
   * Unlike {@link dispose} the controller stays usable, and a save already in
   * flight still lands — it cannot be recalled. For a caller that must stop
   * saving NOW (another tab saved this page), and gates its own later calls.
   */
  cancel(): void;
  /** Stop scheduling saves and clear timers. Call on teardown. */
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 1500;

export function createAutosave(deps: AutosaveDeps): AutosaveController {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const state = $state<{
    status: AutosaveStatus;
    lastSavedAt: Date | null;
    errorMessage: string | undefined;
  }>({
    status: 'idle',
    lastSavedAt: null,
    errorMessage: undefined,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * The WHOLE running chain (one save, plus any follow-up the loop below
   * picks up) — non-null for its entire lifetime, from the first `save()`
   * call to the point nothing is left queued. `flush()` and `retry()` only
   * ever need to check "is a chain running", never "which attempt is this".
   */
  let inFlight: Promise<AutosaveSaveResult> | null = null;
  /** A change arrived while `inFlight` was set — picked up once the current
   *  attempt settles, so at most one extra save ever queues (never two
   *  concurrent, and never one per keystroke that arrived mid-save). */
  let queuedAnotherSave = false;
  let disposed = false;

  function clearDebounce(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  /** One save attempt. Never throws; settles `status`/`lastSavedAt`/`errorMessage`. */
  async function attemptSave(): Promise<AutosaveSaveResult> {
    state.status = 'saving';
    state.errorMessage = undefined;
    let result: AutosaveSaveResult;
    try {
      result = await deps.save();
    } catch (err) {
      result = {
        ok: false,
        message: err instanceof Error ? err.message : 'Could not save',
      };
    }
    if (disposed) return result;
    if (result.ok) {
      state.status = 'saved';
      state.lastSavedAt = new Date();
    } else {
      state.status = 'error';
      state.errorMessage = result.message ?? 'Could not save';
    }
    return result;
  }

  /**
   * Run `attemptSave()`, then keep re-running it while a change queued
   * during the previous attempt — `inFlight` stays set for every iteration
   * and is cleared only once the loop finds nothing queued, which is what
   * lets {@link flush}/{@link retry} treat "a chain is running" as one
   * simple truthy check instead of racing a reassignment.
   */
  async function runChain(): Promise<AutosaveSaveResult> {
    let result = await attemptSave();
    while (!disposed && queuedAnotherSave) {
      queuedAnotherSave = false;
      result = await attemptSave();
    }
    inFlight = null;
    return result;
  }

  function startChain(): Promise<AutosaveSaveResult> {
    const promise = runChain();
    inFlight = promise;
    return promise;
  }

  function notifyChange(): void {
    if (disposed || deps.isPublished()) return;
    if (inFlight) {
      queuedAnotherSave = true;
      return;
    }
    state.status = 'pending';
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void startChain();
    }, debounceMs);
  }

  function flush(): Promise<AutosaveSaveResult> {
    if (disposed) {
      return Promise.resolve({
        ok: false,
        message: m.studio_page_editor_closed_unsaved(),
      });
    }
    clearDebounce();
    // Ride the chain already running — it already covers any follow-up
    // queued behind it — rather than starting a competing save.
    return inFlight ?? startChain();
  }

  function retry(): void {
    if (disposed || inFlight) return;
    void startChain();
  }

  function cancel(): void {
    clearDebounce();
    queuedAnotherSave = false;
    // A scheduled save that will never run is not "Saving…".
    if (state.status === 'pending') state.status = 'idle';
  }

  function dispose(): void {
    disposed = true;
    clearDebounce();
    queuedAnotherSave = false;
  }

  return {
    get status() {
      return state.status;
    },
    get lastSavedAt() {
      return state.lastSavedAt;
    },
    get errorMessage() {
      return state.errorMessage;
    },
    get hasUnpublishedChanges() {
      return deps.isPublished() && deps.isDirty();
    },
    notifyChange,
    flush,
    retry,
    cancel,
    dispose,
  };
}

/**
 * `beforeunload` guard: prompts only when `shouldBlock()` is true at the
 * moment the browser is about to unload — evaluated fresh on every unload
 * attempt, not captured once at registration. Returns a cleanup that removes
 * the listener; call it on teardown alongside {@link AutosaveController.dispose}.
 *
 * Standalone rather than a method on {@link createAutosave}'s return value:
 * "unsaved changes" for the unload prompt is usually broader than this one
 * controller's own `hasUnpublishedChanges` (a draft with a pending autosave
 * counts too), so the caller composes the predicate from whatever it has —
 * typically `() => pageBuilder.isDirty || autosave.hasUnpublishedChanges`.
 */
export function guardUnload(shouldBlock: () => boolean): () => void {
  if (!browser) return () => {};
  const handler = (event: BeforeUnloadEvent) => {
    if (!shouldBlock()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}
