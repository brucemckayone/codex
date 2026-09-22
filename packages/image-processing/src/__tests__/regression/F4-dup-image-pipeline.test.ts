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

/**
 * BOTH files, because the SUBJECT MOVED. (fixed after codex-review)
 *
 * This proof previously read `service.ts` alone and counted a VALUE LITERAL.
 * Codex-p3rre retargeted the literal but left the path, and by then both
 * subjects had moved into `upload-pipeline.ts` — so the count was 0 at head,
 * `expect(0).toBeLessThanOrEqual(1)` passed, and the guard could no longer
 * fail for any reason. Measured at the time: `cacheControl` in service.ts was
 * 1 at base and 0 at head, while upload-pipeline.ts held the live 1.
 *
 * A source-grep proof therefore has TWO failure modes, not one: the literal it
 * greps goes stale (which the retarget addressed), and the subject changes
 * file (which it did not). Scanning every file that could legitimately declare
 * the thing removes both, and counting the DECLARATION SITE rather than a
 * value means the proof cannot drift when the value changes again.
 */
const SCANNED = [
  'packages/image-processing/src/service.ts',
  'packages/image-processing/src/utils/upload-pipeline.ts',
].map((rel) => resolve(REPO_ROOT, rel));

/**
 * Strip comments before counting. Load-bearing, not tidiness: the cleanup
 * phrase appears in upload-pipeline.ts TWICE — once in a docblock describing
 * the warn, once in the warn itself. Counting raw source reports 2 and fails
 * on prose, which would make the guard fire for a reason unrelated to
 * duplication — the mirror image of the bug this replaces.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function countAcrossScanned(needle: string): number {
  return SCANNED.reduce(
    (total, path) =>
      total + (codeOnly(readFileSync(path, 'utf8')).split(needle).length - 1),
    0
  );
}

describe('denoise proof: F4 simplification:dup-image-pipeline', () => {
  it('image-variant cacheControl is declared at most once', () => {
    // The IDENTIFIER, not the value. The value now lives in
    // R2_OVERWRITTEN_OBJECT_CACHE_CONTROL (@codex/constants) and may change
    // again; a duplicated pipeline would re-declare the property either way.
    // Pre-fix: 9 (3 pipelines x 3 variants). Now: 1.
    expect(countAcrossScanned('cacheControl:')).toBeLessThanOrEqual(1);
  });

  it('R2 cleanup-after-DB-error block is declared at most once', () => {
    // The warn CALL, not the phrase — the docblock above it mentions the same
    // string. Pre-fix: 3, one per pipeline. Now: 1.
    expect(
      countAcrossScanned("obs.warn('R2 cleanup failed after DB error'")
    ).toBeLessThanOrEqual(1);
  });

  it('CALIBRATION: the counter detects a duplicate and ignores prose', () => {
    // The guard this replaces was permanently green. Without this case there
    // is nothing to show the replacement is not, and a proof that cannot fail
    // is worse than no proof — it occupies the slot and reports success.
    const duplicated = `
      const a = { cacheControl: X };
      const b = { cacheControl: Y };
    `;
    expect(codeOnly(duplicated).split('cacheControl:').length - 1).toBe(2);

    const prose = `// cacheControl: mentioned in a comment\nconst c = 1;`;
    expect(codeOnly(prose).split('cacheControl:').length - 1).toBe(0);
  });

  it('CALIBRATION: every scanned path exists and is non-empty', () => {
    // A renamed or moved file would make readFileSync throw rather than pass
    // silently, but a path that resolved to an empty file would take the
    // counts to 0 and restore exactly the vacuity this fix removes.
    for (const path of SCANNED) {
      expect(readFileSync(path, 'utf8').length).toBeGreaterThan(500);
    }
  });
});
