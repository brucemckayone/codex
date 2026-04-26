/**
 * Denoise iter-009 F4 — proof test for `simplification:dup-image-pipeline`.
 *
 * Finding: `ImageProcessingService` in
 * `packages/image-processing/src/service.ts` ships THREE near-identical
 * raster image pipelines:
 *
 *   - `processContentThumbnail()` (~lines 100-232)
 *   - `processUserAvatar()`        (~lines 238-345)
 *   - `processOrgLogo()`  (raster path) (~lines 380-545)
 *
 * Each implements the same 5-step recipe:
 *
 *   1. `validateImageFile(file)` → `buffer`
 *   2. `processImageVariants(inputBuffer)` → `{ sm, md, lg }`
 *   3. `keys = { sm, md, lg }` via `getXxxKey(...)`
 *   4. `Promise.allSettled([put(sm), put(md), put(lg)])` — each with the
 *      identical `{ contentType: 'image/webp', cacheControl: 'public,
 *      max-age=31536000, immutable' }` block (33 char literal repeated 9 times)
 *   5. On any failure → `Promise.allSettled([delete(sm), delete(md),
 *      delete(lg)])` + throw `ValidationError`
 *   6. DB update — wrapped in `try { ... } catch (error) { allSettled
 *      cleanup + record orphans + throw }`
 *
 * The catch-and-cleanup branch (lines 193-225, 308-340, 484-525) is itself
 * a 30-line clone repeated three times.
 *
 * This is the strongest "rule of three" smell in the audit set — the
 * abstraction is BEGGING to be extracted (`uploadVariantsToR2(keys, variants,
 * { contentType, cacheControl })` + `withDbUpdateOrphanCleanup({ keys,
 * imageType, entityId, entityType }, dbUpdateFn)`).
 *
 * ## Catalogue walk (SKILL.md §6)
 *
 * - **Parity test (row 1)**: APPLICABLE — the three pipelines should
 *   produce identical R2 results for matching inputs (different keys, same
 *   `Cache-Control` header, same WebP variants). Could capture mock R2 put
 *   sequences across all three callers and assert the put-options match.
 *
 * - **Clone-count assertion (row 12)**: CHOSEN — proof asserts that the
 *   literal `cacheControl: 'public, max-age=31536000, immutable'` appears
 *   in <=1 declaration site (the canonical `uploadVariants` helper), down
 *   from the current 9 occurrences.
 *
 * - **Lonely abstraction (row 2)**: NOT APPLICABLE — the helper does not
 *   exist yet; this finding asks for one.
 *
 * - **Dead pattern (row 5)**: NOT APPLICABLE — code is live.
 *
 * - **Layer leak (row 4)**: NOT APPLICABLE — no layer crossing.
 *
 * ## How this test fails on main and passes after the fix
 *
 * Today (un-skipped): grep counts the literal `cacheControl: 'public,
 * max-age=31536000, immutable'` occurrences in `service.ts`. Current count
 * is 9 (3 pipelines × 3 variants each). After the fix (extract `const
 * IMAGE_VARIANT_PUT_OPTIONS = { ... }` and a `uploadVariants(...)` helper):
 * the literal should appear exactly once.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SERVICE_PATH = resolve(
  REPO_ROOT,
  'packages/image-processing/src/service.ts'
);

describe('denoise proof: F4 simplification:dup-image-pipeline', () => {
  it('image-variant cacheControl is declared at most once', () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    const literal = `cacheControl: 'public, max-age=31536000, immutable'`;
    const occurrences = src.split(literal).length - 1;
    // Pre-fix: 9 occurrences (3 pipelines × 3 variants).
    // Post-fix: ≤1 (a const, or pulled to a sibling helper module).
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it('R2 cleanup-after-DB-error block is declared at most once', () => {
    const src = readFileSync(SERVICE_PATH, 'utf8');
    // The phrase 'R2 cleanup failed after DB error' tags the obs.warn that
    // currently appears in all three pipelines.
    const occurrences =
      src.split('R2 cleanup failed after DB error').length - 1;
    // Pre-fix: 3. Post-fix: ≤1 (in the shared helper's warn).
    expect(occurrences).toBeLessThanOrEqual(1);
  });
});
