/**
 * Denoise iter-002 F4 — doc-rot in
 * `.claude/skills/denoise/references/06-domain-workers.md` §9 row 11
 * AND §7 idiosyncrasy block: cite `stripe.webhooks.constructEvent`,
 * actual code path uses `stripe.webhooks.constructEventAsync`.
 *
 * Fingerprint: denoise:doc-rot:06-domain-workers:row11
 * Severity: minor (doc-rot)
 * File:Line: .claude/skills/denoise/references/06-domain-workers.md:188,224
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom
 * lint rule + test the rule." Grep-driven assertion: the symbol the
 * reference cites must appear at least once in workers/ or packages/
 * source. If grep returns 0 hits, the reference is fabricated and
 * audits triggered against this row will misdirect future maintainers.
 *
 * Live evidence (run before writing this test):
 *   $ rg -n "constructEvent\b" packages/ workers/ --type ts | grep -v test
 *   (no matches)
 *
 *   $ rg -n "constructEventAsync\b" packages/ --type ts
 *   packages/purchase/src/stripe-client.ts:105:  return await stripeClient.webhooks.constructEventAsync(
 *
 * The reference's row 11 reads:
 *   `workers:stripe-webhook-no-signature-verify` |
 *   `Webhook reads body without `constructEvent`` | ... |
 *   `Call `stripe.webhooks.constructEvent``
 *
 * Both citations should be `constructEventAsync` — the codebase has
 * been on the async API since the Cloudflare Workers Stripe adapter
 * landed (workerd has no synchronous SubtleCrypto path).
 *
 * NOTE: iter-001 filed F4 as a doc-rot finding for reference 01
 * (different file, different row), and reference 01 row 5 cites
 * `constructEvent` too. iter-001's bead Codex-ttavz.4 covers the
 * error-class drift but NOT the constructEvent drift. This iter-002
 * finding is therefore NOT a duplicate — it points at a separate
 * reference file (06 vs 01) and a separate symbol.
 *
 * `it.skip` while the bug stands. Un-skip in the same PR as the
 * fix, which should update both citations (06 §7 line ~188 and §9
 * row 11) to `constructEventAsync` AND ALSO patch reference 01 row 5
 * (currently fabricated — same drift, different cell's reference).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const REF_06 = join(
  PROJECT_ROOT,
  '.claude/skills/denoise/references/06-domain-workers.md'
);

describe.skip('iter-002 F4 — doc-rot ref 06 row 11 (constructEvent)', () => {
  it('reference 06 cites a Stripe verifier symbol that exists in source', () => {
    const refSrc = readFileSync(REF_06, 'utf8');
    const citesSync = /constructEvent\b/.test(refSrc);
    const citesAsync = /constructEventAsync\b/.test(refSrc);

    if (!citesSync && !citesAsync) {
      // Reference no longer cites either — nothing to verify.
      return;
    }

    // Grep workers/ + packages/ for actual usages, excluding tests
    // and worktrees, mirroring the cycle 0 fabrication-check protocol.
    const grepHit = (pattern: string): boolean => {
      try {
        const out = execSync(
          `rg -l ${pattern} packages workers --type ts -g '!**/__tests__/**' -g '!**/*.test.ts' -g '!.claude/worktrees/**'`,
          { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }
        )
          .toString()
          .trim();
        return out.length > 0;
      } catch {
        return false;
      }
    };

    const syncHit = grepHit('"constructEvent\\b"');
    const asyncHit = grepHit('"constructEventAsync\\b"');

    if (citesSync) {
      // FAILS on current main: ref 06 cites `constructEvent` but only
      // `constructEventAsync` exists. The cited symbol must exist.
      expect(
        syncHit,
        `ref 06 cites constructEvent but no source file uses it (constructEventAsync is the live API)`
      ).toBe(true);
    }

    if (citesAsync) {
      expect(
        asyncHit,
        `ref 06 cites constructEventAsync but no source uses it`
      ).toBe(true);
    }
  });
});
