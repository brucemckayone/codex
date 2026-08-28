/**
 * Reactive test double for `$lib/remote/categories.remote` (Codex-1g5lh.7).
 *
 * The real module imports `$app/server`, so it cannot load in jsdom at all —
 * and the behaviour under test is what the PAGE does when a form result lands,
 * not what the server does to produce one. Every export the categories page
 * imports is stubbed here, with `form()` results held in `$state` so a test can
 * land a completed create / update / upload and watch the page's `$effect` react
 * exactly as it does in production.
 *
 * `createResult` deliberately starts UNDEFINED, matching a browser tab that has
 * never submitted this form. `seedCreateResult()` exists for the opposite case:
 * a remote `form()` is a module singleton whose `result` survives navigation, so
 * a test can pre-load a stale result and mount the page on top of it.
 *
 * The form doubles get their SURFACE from `createFakeRemoteForm()` — the
 * repo's single transcription of kit's client form runtime — and only their
 * `pending` / `result` from the state below. See `formDouble()`.
 *
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

import {
  createFakeRemoteForm,
  type FakeRemoteForm,
} from '$tests/utils/fake-remote-form.svelte';

export interface MockCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  coverImageKey: string | null;
  coverImageUrl: string | null;
  sortOrder: number;
}

export type CreateResult =
  | { success: true; category: MockCategory }
  | { success: false; error: string }
  | undefined;

export type UpdateResult =
  | { success: true; category: MockCategory }
  | { success: false; error: string }
  | undefined;

export type CoverResult =
  | { success: true; categoryId: string; coverImageUrl: string | null }
  | { success: false; error: string }
  | undefined;

const state = $state<{
  list: MockCategory[];
  listError: unknown;
  createPending: number;
  createResult: CreateResult;
  updatePending: number;
  updateResult: UpdateResult;
  coverPending: number;
  coverResult: CoverResult;
}>({
  list: [],
  listError: undefined,
  createPending: 0,
  createResult: undefined,
  updatePending: 0,
  updateResult: undefined,
  coverPending: 0,
  coverResult: undefined,
});

// ── query() ─────────────────────────────────────────────────────────────
/** One object per call site is fine — the page reads `.current` / `.error`. */
export function getCategories(_organizationId: string) {
  return {
    get current() {
      return state.list;
    },
    get error() {
      return state.listError;
    },
    refresh: async () => {},
  };
}

export function getPublicCategories(_organizationId: string) {
  return {
    get current() {
      return state.list;
    },
    error: undefined,
  };
}

// ── form() ──────────────────────────────────────────────────────────────
/** `__reset()` for every kit instance handed out below. */
const kitResets: Array<() => void> = [];

/**
 * One `form()` double.
 *
 * `createFakeRemoteForm()` supplies kit's real client-form SURFACE: `method`,
 * `action`, the symbol-keyed default submit attachment that a bare
 * `{...form}` spread installs, the `fields.<name>.as(type)` proxy — and
 * `enhance(callback)`, which returns the COMPLETE replacement spread. That last
 * one is not optional decoration. The page pipes the EDIT form through
 * `keepValuesOnSave()` (Codex-1g5lh.2), which is a thin wrapper over
 * `enhance()`, so a double lacking the method makes `+page.svelte` throw
 * `form.enhance is not a function` while its `<script>` runs — before any
 * markup exists, which is why every case in the suite fails identically rather
 * than one assertion going red.
 *
 * `pending` and `result` are then re-pointed at the module state above: these
 * tests land a COMPLETED submission directly (`landCreateSuccess()`) instead of
 * driving one through the DOM, because the behaviour under test is what the
 * page's `$effect` does with a result, not how the result was produced.
 *
 * Delegating keeps ONE transcription of kit's form runtime in the repo. A
 * second hand-rolled `enhance()` here is exactly how the two drift apart.
 *
 * ENUMERABILITY IS PART OF THE CONTRACT. A real instance exposes only `method`,
 * `action` and the symbol-keyed attachment enumerably — everything else is
 * installed with `Object.defineProperties`, so `<form {...form}>` puts exactly
 * three things on the element. Declare `fields` / `result` / `enhance` as plain
 * object literal keys instead and Svelte spreads them onto the `<form>` as
 * ATTRIBUTES: the `fields` proxy answers every `get` with an object, so jsdom's
 * DOMString conversion calls the proxy's "toString" and dies on `object is not
 * a function`. Hence defineProperties here too.
 */
function formDouble<Result>(
  action: string,
  read: () => { pending: number; result: Result },
  extra: Record<string, unknown> = {}
) {
  const kit = createFakeRemoteForm();
  kitResets.push(() => kit.__reset());

  // The spread surface: `method` and the default submit attachment from kit,
  // this form's own `action`, plus any real extra form attribute (`enctype`).
  const double: Record<string | symbol, unknown> = { ...kit, action, ...extra };

  Object.defineProperties(double, {
    fields: { get: () => kit.fields },
    validate: { value: kit.validate },
    enhance: {
      value: (callback: Parameters<FakeRemoteForm['enhance']>[0]) => ({
        ...kit.enhance(callback),
        action,
      }),
    },
    pending: { get: () => read().pending },
    result: { get: () => read().result },
  });

  return double;
}

export const createCategoryForm = formDouble('?/createCategoryForm', () => ({
  pending: state.createPending,
  result: state.createResult,
}));

export const updateCategoryForm = formDouble('?/updateCategoryForm', () => ({
  pending: state.updatePending,
  result: state.updateResult,
}));

export const uploadCategoryCoverForm = formDouble(
  '?/uploadCategoryCoverForm',
  () => ({ pending: state.coverPending, result: state.coverResult }),
  { enctype: 'multipart/form-data' }
);

// ── command() ───────────────────────────────────────────────────────────
export const deleteCalls: string[] = [];
export const reorderCalls: string[][] = [];

export async function deleteCategory(input: {
  organizationId: string;
  categoryId: string;
}) {
  deleteCalls.push(input.categoryId);
  state.list = state.list.filter((c) => c.id !== input.categoryId);
  return { success: true as const };
}

export async function reorderCategories(input: {
  organizationId: string;
  orderedIds: string[];
}) {
  reorderCalls.push(input.orderedIds);
  return { success: true as const };
}

export async function createCategoryInline() {
  return { success: true as const };
}

// ── test controls ───────────────────────────────────────────────────────
export function setCategories(categories: MockCategory[]): void {
  state.list = categories;
}

/**
 * Land a completed create, the way the real `form()` does: the server refreshes
 * the list query (so the new row appears) and `result` flips to the outcome.
 */
export function landCreateSuccess(category: MockCategory): void {
  state.list = [...state.list, category];
  state.createPending = 0;
  state.createResult = { success: true, category };
}

export function landCreateFailure(error: string): void {
  state.createPending = 0;
  state.createResult = { success: false, error };
}

/**
 * Pre-load a result WITHOUT mounting anything — stands in for the module
 * singleton still holding a prior submission's result when the page mounts.
 */
export function seedCreateResult(result: CreateResult): void {
  state.createResult = result;
}

export function seedUpdateResult(result: UpdateResult): void {
  state.updateResult = result;
}

export function setCreatePending(pending: number): void {
  state.createPending = pending;
}

/** Reset between tests (this module is a singleton across mounts). */
export function reset(): void {
  state.list = [];
  state.listError = undefined;
  state.createPending = 0;
  state.createResult = undefined;
  state.updatePending = 0;
  state.updateResult = undefined;
  state.coverPending = 0;
  state.coverResult = undefined;
  deleteCalls.length = 0;
  reorderCalls.length = 0;
  // The kit doubles are created once per module load, so their internal field
  // state outlives a mount exactly as the real singletons do. Clear it too, or
  // a later test inherits whatever the last one typed.
  for (const resetKit of kitResets) resetKit();
}
