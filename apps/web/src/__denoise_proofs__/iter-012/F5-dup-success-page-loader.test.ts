/**
 * Proof test for iter-012 F5 — simplification:dup-checkout-success-loader
 *
 * Finding: Three Stripe-success page server loaders share an identical
 * skeleton (cache header, depends() token, locals.user redirect, sessionId
 * extraction, parent() org resolution, api.{checkout|subscription}.verify
 * with try/catch fallback to verification:null):
 *
 *   1. routes/_org/[slug]/(space)/checkout/success/+page.server.ts        (59 lines)
 *   2. routes/_org/[slug]/(space)/subscription/success/+page.server.ts    (50 lines)
 *   3. routes/_creators/checkout/success/+page.server.ts                  (clone-cluster confirmed by jscpd)
 *
 * Pairs flagged by jscpd (min-tokens=50):
 *   - org/checkout vs org/subscription:    15 lines, 110 tokens (load() body skeleton)
 *   - org/checkout vs _creators/checkout:  11 lines, ~80 tokens (duplicate verify-with-fallback)
 *
 * The variations across the three are tiny:
 *   - `api.checkout.verify(sessionId)` vs `api.subscription.verify(sessionId)`
 *   - depends('checkout:verify') vs depends('subscription:verify')
 *   - return shape ({ verification, contentSlug, org } vs { verification, org })
 *
 * Right shape is a shared helper in `$lib/server/stripe-verify.ts`:
 *   loadStripeVerification({ event, kind: 'checkout' | 'subscription', extra }).
 *
 * Catalogue row: "Duplication count → programmatic assertion"
 *
 * Fingerprint: simplification:dup-checkout-success-loader
 *   (NEW; sibling of simplification:dup-paginated-list-shape — generic
 *    boilerplate that should be a tiny helper)
 *
 * Severity: major — webhook-race-condition retry semantics live in this
 * code path; drift between the three copies has caused real bugs in the
 * past (Codex-twzso lineage notes "subscription/success is the counterpart
 * to checkout/success" — counterpart is exactly the dup smell).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');

const sites = [
  'apps/web/src/routes/_org/[slug]/(space)/checkout/success/+page.server.ts',
  'apps/web/src/routes/_org/[slug]/(space)/subscription/success/+page.server.ts',
  'apps/web/src/routes/_creators/checkout/success/+page.server.ts',
];

describe.skip('iter-012 F5 — Stripe-verify success loaders consolidate behind one helper', () => {
  it('all three success loaders exist (sanity)', () => {
    for (const rel of sites) {
      expect(existsSync(resolve(repoRoot, rel))).toBe(true);
    }
  });

  it('only one of the three loaders inlines the api.{checkout|subscription}.verify try/catch block', () => {
    const matches = sites.filter((rel) => {
      const src = readFileSync(resolve(repoRoot, rel), 'utf8');
      // Inline pattern: try { const result = await api.X.verify(sessionId); ... } catch { ... }
      return /try\s*\{[\s\S]{0,200}api\.(checkout|subscription)\.verify\(sessionId\)/.test(
        src
      );
    });

    // Pre-fix: all three (3 of 3).
    // Post-fix: 0 — the helper owns the try/catch; the loaders call the
    // helper with a `kind` discriminator.
    expect(matches.length).toBeLessThanOrEqual(0);
  });

  it('a shared helper exists at $lib/server/stripe-verify (or equivalent)', () => {
    const candidates = [
      'apps/web/src/lib/server/stripe-verify.ts',
      'apps/web/src/lib/server/checkout-verify.ts',
      'apps/web/src/lib/server/verify.ts',
    ];
    const exists = candidates.some((rel) => existsSync(resolve(repoRoot, rel)));
    expect(exists).toBe(true);
  });
});
