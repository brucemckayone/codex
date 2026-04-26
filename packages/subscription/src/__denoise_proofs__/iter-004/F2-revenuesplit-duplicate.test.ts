/**
 * Denoise iter-004 F2 — proof test for
 * `types:type-duplicate-cross-package` — `RevenueSplit` declared (and
 * publicly exported from each package barrel) in two service packages with
 * structurally identical shapes.
 *
 * Finding:
 *   - packages/purchase/src/services/revenue-calculator.ts:27
 *       export interface RevenueSplit {
 *         platformFeeCents: number;
 *         organizationFeeCents: number;
 *         creatorPayoutCents: number;
 *       }
 *   - packages/subscription/src/services/revenue-split.ts:17
 *       export interface RevenueSplit { ...same three fields... }
 *
 * Both barrels publicly export the type:
 *   - packages/purchase/src/index.ts:76 → `type RevenueSplit`
 *   - packages/subscription/src/index.ts:63 → `type RevenueSplit`
 *
 * Concrete consumer risk: a worker that imports both `@codex/purchase`
 * and `@codex/subscription` (e.g. ecom-api) sees two distinct `RevenueSplit`
 * types under the same name. They are structurally equivalent today, but:
 *  - the docstrings already drift (purchase:revenue-calculator names
 *    rounding semantics; subscription:revenue-split does not)
 *  - if either package adds a field (e.g. `connectAccountId`), only its
 *    own consumers benefit — silent contract divergence
 *
 * Rule (ref 02 §7 row 4 / ref 07 §7 row 5): same interface name declared
 * in 2+ packages → move to `@codex/shared-types` and import via
 * `import type`. Better: move to a single `@codex/revenue` or extend the
 * existing `@codex/subscription` revenue helpers and re-export from
 * `@codex/purchase` for compatibility.
 *
 * Proof shape: type-equality assertion via `expectTypeOf` (Catalogue
 * row 3 — Type-equality test). The structural equivalence is the EVIDENCE
 * — the bead body should record that the two shapes match TODAY (so the
 * fix is risk-free) but the duplicate declarations are themselves the
 * problem.
 *
 * Severity: major (publicly exported via two barrels; consumer drift risk).
 *
 * Remove the `.skip()` modifier in the same PR as consolidation. After
 * consolidation BOTH packages should re-export the same canonical type so
 * the assertion still passes.
 */

import type { RevenueSplit as PurchaseRevenueSplit } from '@codex/purchase';
import { describe, expectTypeOf, it } from 'vitest';
import type { RevenueSplit as SubscriptionRevenueSplit } from '../services/revenue-split';

describe('denoise proof: F2 types:type-duplicate-cross-package — RevenueSplit', () => {
  it('purchase.RevenueSplit and subscription.RevenueSplit MUST resolve to a single canonical type', () => {
    // Today this passes structurally but the two declarations are different
    // file-system identities — TS sees them as distinct types in some
    // assignment positions. After consolidation the two named imports
    // resolve to the *same* declaration site.
    expectTypeOf<PurchaseRevenueSplit>().toEqualTypeOf<SubscriptionRevenueSplit>();
  });
});
