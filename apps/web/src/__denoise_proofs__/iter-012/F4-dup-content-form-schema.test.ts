/**
 * Proof test for iter-012 F4 — simplification:dup-zod-schema-fragment
 *
 * Finding: lib/remote/content.remote.ts declares two Zod schemas that are
 * identical except for a `contentId` field on one of them:
 *
 *   - createContentFormSchema  (lines 396-428, 33 lines)
 *   - updateContentFormSchema  (lines 559-592, 34 lines)
 *
 * The 16 fields and their per-field validation rules — including the inline
 * `transform` for `price` (string → cents), the inline `tags` JSON.parse
 * pipeline, and the `formBoolean` transform — are duplicated verbatim. Only
 * `updateContentFormSchema` adds `contentId: z.string().uuid()` at the top.
 *
 * Drift risk is concrete: a recent change to the price transform or to the
 * `accessType` enum would have to be replicated by hand. Today the two
 * schemas can silently disagree and the form/update endpoints accept
 * different shapes.
 *
 * Standard Zod fix:
 *   const contentBaseFormSchema = z.object({ ... });           // shared
 *   const updateContentFormSchema = contentBaseFormSchema
 *     .extend({ contentId: z.string().uuid() });
 *
 * Catalogue row: "Duplication count → programmatic assertion"
 *
 * Fingerprint: simplification:dup-zod-schema-fragment
 *   (refs/03-simplification.md §1 row "simplification:dup-zod-schema-fragment")
 *
 * Severity: major — silent drift surface; the price/tags transforms are
 * already non-trivial and have to stay in lockstep.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const remoteFile = resolve(
  repoRoot,
  'apps/web/src/lib/remote/content.remote.ts'
);

describe('iter-012 F4 — content create/update form schemas must share a base via .extend()', () => {
  it('the two schemas do not each declare a standalone z.object({...}) literal', () => {
    const src = readFileSync(remoteFile, 'utf8');

    // Pre-fix: both `createContentFormSchema` and `updateContentFormSchema`
    // are declared with `z.object({ ... })` literals from scratch.
    const createIsLiteral =
      /const createContentFormSchema\s*=\s*z\.object\(\{/.test(src);
    const updateIsLiteral =
      /const updateContentFormSchema\s*=\s*z\.object\(\{/.test(src);

    // Post-fix: one shared base (e.g. `contentBaseFormSchema`) is the
    // z.object literal, and the other extends it via .extend(...).
    expect(createIsLiteral && updateIsLiteral).toBe(false);
  });

  it('updateContentFormSchema is derived via .extend or .merge from a shared base', () => {
    const src = readFileSync(remoteFile, 'utf8');
    // Post-fix expectation: the update schema references the create schema
    // (or a shared base) via .extend / .merge.
    const sharesBase =
      /updateContentFormSchema\s*=\s*\w+\.extend\(/.test(src) ||
      /updateContentFormSchema\s*=\s*\w+\.merge\(/.test(src);
    expect(sharesBase).toBe(true);
  });

  it('the price transform is declared exactly once', () => {
    const src = readFileSync(remoteFile, 'utf8');
    // The "price string → cents" transform is the most visible piece of
    // duplicated logic. Count occurrences of its signature.
    const priceTransformMatches = src.match(
      /price:\s*z\.string\(\)\.transform\(\(v\)\s*=>\s*\{\s*const parsed = parseFloat/g
    );
    const count = priceTransformMatches?.length ?? 0;
    // Pre-fix: 2 (create + update).
    // Post-fix: 1 (lives on the shared base).
    expect(count).toBeLessThanOrEqual(1);
  });
});
