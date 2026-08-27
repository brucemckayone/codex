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
 * A `.svelte.ts` module (runes compiled), NOT a `*.test.*` file → never
 * collected as a suite.
 */

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
export const createCategoryForm = {
  method: 'POST',
  action: '?/createCategoryForm',
  onsubmit: () => {},
  get pending() {
    return state.createPending;
  },
  get result() {
    return state.createResult;
  },
  fields: {},
};

export const updateCategoryForm = {
  method: 'POST',
  action: '?/updateCategoryForm',
  onsubmit: () => {},
  get pending() {
    return state.updatePending;
  },
  get result() {
    return state.updateResult;
  },
  fields: {},
};

export const uploadCategoryCoverForm = {
  method: 'POST',
  action: '?/uploadCategoryCoverForm',
  enctype: 'multipart/form-data',
  onsubmit: () => {},
  get pending() {
    return state.coverPending;
  },
  get result() {
    return state.coverResult;
  },
  fields: {
    cover: {
      as: (_type: string) => ({ type: 'file', name: 'cover' }),
    },
  },
};

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
}
