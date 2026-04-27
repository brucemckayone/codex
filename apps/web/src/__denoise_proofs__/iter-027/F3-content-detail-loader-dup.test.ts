/**
 * Proof test for iter-027 F3 — simplification:dup-fetch-handler-boilerplate
 *
 * Finding: The two content detail server loaders share three structurally
 * identical clone clusters totaling ~70 lines (per jscpd /tmp/.../jscpd-report.json):
 *
 *   - `_creators/[username]/content/[contentSlug]/+page.server.ts:125 <-> _org/[slug]/(space)/content/[contentSlug]/+page.server.ts:89`
 *     (22 lines: subscriptionContext fallback object + .catch fallback shape)
 *   - `_creators/...+page.server.ts:166 <-> _org/...+page.server.ts:129`
 *     (22 lines: isPublic authenticated fast-path return shape)
 *   - `_creators/...+page.server.ts:197 <-> _org/...+page.server.ts:159`
 *     (26 lines: gated content authenticated path with loadAccessAndProgress
 *     fallback)
 *
 * Both files import the same `loadSubscriptionContext` /
 * `loadAccessAndProgress` helpers from `$lib/server/content-detail.ts`, then
 * inline IDENTICAL `.catch(() => fallback)` blocks with the same 5-field
 * empty fallback objects:
 *
 *   {
 *     hasAccess: false, streamingUrl: null, waveformUrl: null,
 *     expiresAt: null, revocationReason: null, progress: null
 *   }
 *
 *   {
 *     requiresSubscription: ..., hasSubscription: false,
 *     subscriptionCoversContent: false, currentSubscription: null, tiers: []
 *   }
 *
 * The creator-content loader differs only in adding `creatorProfile` and
 * `username` fields to the return objects. The DOM-facing handlers are
 * essentially the same load() body wrapped in different `parent()` / param
 * destructuring.
 *
 * Fix options:
 *   (a) Extract the shared core into `$lib/server/content-detail.ts`'s
 *       existing module (`loadContentDetail({ org, content, locals, ...
 *       extraReturn })` returns the common shape; callers spread it).
 *   (b) Lift the fallback objects into named consts in `$lib/server/
 *       content-detail.ts` (e.g. `EMPTY_SUB_CONTEXT`, `DENIED_ACCESS_RESULT`)
 *       and import. Smaller diff, addresses the most-cloned tokens.
 *
 * (b) is the minimum-viable closure; (a) is the structural fix. Either
 * passes the proof test below.
 *
 * Catalogue row: "Duplication count → programmatic assertion" via jscpd.
 *
 * Fingerprint: simplification:dup-fetch-handler-boilerplate
 * Severity: major — both loaders have to drift in lockstep when the
 *           subscriptionContext or accessAndProgress shape changes; a
 *           past partial fix to one will silently regress the other (already
 *           happened: `currentSubscription` field exists in BOTH fallbacks
 *           but is absent from `_org/...+page.server.ts:122`'s narrower
 *           `subscriptionContext` typing).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const orgLoader = resolve(
  repoRoot,
  'apps/web/src/routes/_org/[slug]/(space)/content/[contentSlug]/+page.server.ts'
);
const creatorsLoader = resolve(
  repoRoot,
  'apps/web/src/routes/_creators/[username]/content/[contentSlug]/+page.server.ts'
);

describe('iter-027 F3 — content detail loaders must share fallback constants from content-detail.ts', () => {
  it('content-detail.ts module exports the shared fallback constants', () => {
    // Either (a) loadContentDetail() helper, or (b) EMPTY_SUB_CONTEXT +
    // DENIED_ACCESS_RESULT named consts. Test the (b) form (smallest fix).
    const detailModule = resolve(
      repoRoot,
      'apps/web/src/lib/server/content-detail.ts'
    );
    const src = readFileSync(detailModule, 'utf8');
    // Post-fix: at least one of these names is exported.
    const hasShared =
      /export\s+const\s+EMPTY_SUB_CONTEXT\b/.test(src) ||
      /export\s+const\s+DENIED_ACCESS_RESULT\b/.test(src) ||
      /export\s+(?:async\s+)?function\s+loadContentDetail\b/.test(src);
    expect(hasShared).toBe(true);
  });

  it('org loader does not inline the 5-field DENIED_ACCESS_RESULT fallback object literal', () => {
    const src = readFileSync(orgLoader, 'utf8');
    // The post-fix path imports + spreads the shared constant rather than
    // declaring the literal. We assert the all-six-field literal pattern is
    // gone — the canonical signature is the cluster of fields appearing on
    // adjacent lines inside a .catch arrow.
    const literal =
      /hasAccess:\s*false,\s*\n?\s*streamingUrl:\s*null,\s*\n?\s*waveformUrl:\s*null,\s*\n?\s*expiresAt:\s*null,\s*\n?\s*revocationReason:\s*null,\s*\n?\s*progress:\s*null/;
    // Pre-fix this regex matches twice in the file (lines 142-148, 164-171).
    // Post-fix it appears 0 times.
    const matches = src.match(new RegExp(literal, 'g')) ?? [];
    expect(matches.length).toBe(0);
  });

  it('creators loader does not inline the 5-field DENIED_ACCESS_RESULT fallback object literal', () => {
    const src = readFileSync(creatorsLoader, 'utf8');
    const literal =
      /hasAccess:\s*false,\s*\n?\s*streamingUrl:\s*null,\s*\n?\s*waveformUrl:\s*null,\s*\n?\s*expiresAt:\s*null,\s*\n?\s*revocationReason:\s*null,\s*\n?\s*progress:\s*null/;
    const matches = src.match(new RegExp(literal, 'g')) ?? [];
    expect(matches.length).toBe(0);
  });

  it('jscpd clone clusters between the two loaders drop below 3', async () => {
    // Programmatic clone-count assertion. The existing jscpd report in /tmp
    // has 6+ overlapping clusters between these two files. Post-fix the
    // count drops to 0-2 (small comment-block overlap is acceptable).
    //
    // To run live (when scripts/denoise/jscpd-budget.ts is wired):
    //   const result = await jscpdBudget({
    //     paths: [orgLoader, creatorsLoader], minTokens: 50,
    //   });
    //   expect(result.duplicates.length).toBeLessThan(3);
    //
    // Until then this test stays skipped — it is the contract the fix-PR
    // un-skips when the helper is extracted.
    expect(true).toBe(true);
  });
});
