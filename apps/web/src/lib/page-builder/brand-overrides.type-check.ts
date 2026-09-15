/**
 * Compile-time drift guard: `BrandTokenOverrides` ↔ `BrandEditorState`
 * (Codex-2pryk.2.1 · WP-0).
 *
 * `BrandTokenOverrides` (`@codex/shared-types`) is the per-page brand-override
 * contract (D6). It is a STANDALONE structural mirror of the brand editor's
 * editable state (`BrandEditorState`, `$lib/brand-editor`) — every field made
 * optional — because a cross-worker package cannot import an apps/web `$lib` type.
 *
 * This module is the ONE place both types are importable, so it enforces that
 * mirror at COMPILE TIME rather than by convention. If a future edit to EITHER
 * type diverges on a shared key — a value type changes, or a shared field is
 * added or dropped — the `Assert<… extends true>` applications below stop
 * compiling and `pnpm typecheck` FAILS. The brand editor is actively evolving
 * (Codex-cijzb), so a doc-note "keep in sync" is too weak; this is the gate.
 *
 * TYPE-ONLY: it imports only the brand-editor *types*, never its components, so
 * the CE-4 public-bundle import-boundary gate stays green. It emits no runtime.
 *
 * WHEN THIS GUARD FAILS: re-align `BrandTokenOverrides`
 * (`packages/shared-types/src/journeys.ts`) with `BrandEditorState`
 * (`apps/web/src/lib/brand-editor/types.ts`) so the shared keys match again — do
 * NOT weaken the guard.
 */

import type { BrandTokenOverrides } from '@codex/shared-types';
import type { BrandEditorState } from '$lib/brand-editor';

/** Mutual assignability — structural equality for our purposes. */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Compiles only when `T` is exactly `true`. Catches both `false` (all keys
 * diverge) and the mixed `boolean` (some keys diverge) — a plain
 * `const x: T = true` would accept `boolean` and miss the partial-divergence case.
 */
type Assert<T extends true> = T;

/** Keys the override mirror and the editor state share. */
type SharedKey = keyof BrandTokenOverrides & keyof BrandEditorState;

/**
 * (1) The mirror declares EXACTLY the editor's editable keys. Adding or dropping
 * a shared field makes the key sets diverge and fails compilation here.
 */
export type _AssertBrandOverrideKeysMirrorEditor = Assert<
  Equal<keyof BrandTokenOverrides, keyof BrandEditorState>
>;

/**
 * (2) Every shared key's value type matches the editor's (optionality stripped
 * via `Required`, since the mirror makes each field optional). A value-type
 * change on either side fails compilation here.
 */
export type _AssertBrandOverrideValuesMirrorEditor = Assert<
  {
    [K in SharedKey]: Equal<
      Required<BrandTokenOverrides>[K],
      BrandEditorState[K]
    >;
  }[SharedKey]
>;
