/**
 * Proof test for F3 — performance:render-thrash-list-no-key
 *
 * Static lint-rule proof per SKILL.md §6 Catalogue row 12 (Naming/style
 * consistency → custom lint rule + test the rule).
 *
 * The bug:
 *   apps/web/src/routes/_org/[slug]/(space)/+page.svelte:314 and 449 render
 *   `{#each feedCategories as category}` without a `(category.name)` key.
 *   Per ref 04 §3 anti-pattern row `performance:render-thrash-list-no-key`,
 *   keyless `{#each}` blocks force a full re-render of every child when the
 *   array reference changes, even when the items are stable. Categories on
 *   the org landing page change rarely (per-load), so wall-clock impact is
 *   minor — but the pattern is endemic-prone (the same list shape appears in
 *   future per-category carousels) and worth fixing structurally.
 *
 * The proof: a grep-style assertion that flags the pattern
 *   `{#each <expr> as <ident>}` (no parenthesised key clause) against a
 *   curated allow-list, run as a Vitest unit test reading the .svelte
 *   sources from disk.
 *
 * Currently SKIPPED — un-skip in the same PR as the fix (add
 * `(category.name)` keys at lines 314 and 449).
 *
 * MCP gate (R6): n/a for static finding (per ref 04 §9 — bench() not
 *   meaningful here; lint guard is sufficient).
 */

import { describe, it } from 'vitest';

describe.skip('performance:render-thrash-list-no-key', () => {
  it('apps/web/src/routes/_org/[slug]/(space)/+page.svelte has zero keyless {#each} blocks', () => {
    // SKETCH (un-skip in the fix PR):
    // import { readFileSync } from 'node:fs';
    // const src = readFileSync(
    //   'apps/web/src/routes/_org/[slug]/(space)/+page.svelte',
    //   'utf8',
    // );
    // // Match `{#each <expr> as <ident>}` without `(<key>)`
    // const keyless = src.match(/\{#each\s+[^}]+\s+as\s+\w+\s*\}/g) ?? [];
    // expect(keyless).toEqual([]); // no keyless each blocks remain
    //
    // Pre-fix: matches lines 314 + 449 (2 keyless blocks).
    // Post-fix: 0 matches.
  });
});
