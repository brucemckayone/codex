/**
 * Reactive backing store for the `uploadThumbnailForm` remote `form()` stand-in
 * used by ThumbnailUpload.svelte.test.ts.
 *
 * Lives in its own `.svelte.ts` module because `uploadThumbnailForm.result` must
 * be a REACTIVE source: without it the `$effect` in ThumbnailUpload never
 * re-runs, and the "a result produced after mount DOES fire the toast" case
 * would pass vacuously (no toast, for the wrong reason). Only `.svelte.ts` /
 * `.svelte.js` modules get rune compilation.
 *
 * This module deliberately exports FUNCTIONS rather than the mock object
 * itself. The consuming `vi.mock` factory builds its own object whose `result`
 * getter calls {@link currentResult}, so nothing reads this module's bindings at
 * factory-evaluation time. That keeps the mock correct no matter what order the
 * test file's imports end up in — import sorters reorder them freely, and an
 * eagerly-read binding would otherwise land in its TDZ.
 */

export type MockUploadResult =
  | { success: true; thumbnailUrl: string }
  | { success: false; error: string };

/**
 * The persisted result. This models the exact defect under test: a `form()` is
 * a MODULE-LEVEL singleton, so `result` outlives any single component mount and
 * is already populated when the next page mounts a fresh ThumbnailUpload.
 */
const store = $state<{ result: MockUploadResult | undefined }>({
  result: undefined,
});

/** Read the current result. Called from the mock's `result` getter. */
export function currentResult(): MockUploadResult | undefined {
  return store.result;
}

/** Populate `result` as if a submission had just resolved. */
export function emitResult(next: MockUploadResult): void {
  store.result = next;
}

/**
 * Seed `result` WITHOUT any component mounted — i.e. leave behind the residue
 * of an upload that happened on a previous page.
 */
export const seedStaleResult = emitResult;

/** Clear the singleton between tests so cases cannot leak into each other. */
export function resetResult(): void {
  store.result = undefined;
}
