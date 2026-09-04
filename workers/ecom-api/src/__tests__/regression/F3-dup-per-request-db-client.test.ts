/**
 * Denoise iter-011 F3 — `createPerRequestDbClient` boilerplate repeated 5x.
 *
 * Fingerprint: simplification:dup-procedure-context-builder
 * Severity: major (cross-handler drift risk on DB client construction)
 * Recurrence: iter-009 F2 (Codex-mqyql.2) — `simplification:dup-procedure-
 * context-builder` first surfaced for procedure() ctx vs upload-shared.ts
 * `buildUploadBaseContext`. This filing is the second hit (different
 * site shape — Stripe webhook handlers). Hits=2.
 *
 * Sites (all five lifted the IDENTICAL `{DATABASE_URL,
 * DATABASE_URL_LOCAL_PROXY, DB_METHOD}` triple off `c.env`):
 *   - workers/ecom-api/src/handlers/checkout.ts
 *   - workers/ecom-api/src/handlers/connect-webhook.ts (×2)
 *   - workers/ecom-api/src/handlers/payment-webhook.ts
 *   - workers/ecom-api/src/handlers/subscription-webhook.ts
 *
 * Procedure() handlers don't have this boilerplate because the service
 * registry handles per-request DB lifecycle. Webhook handlers bypass
 * procedure() (HMAC + raw-body verification), so they need their own DB
 * lifecycle — but the shape is so uniform that a single helper
 * `createWebhookDbClient(c.env)` collapses 5 sites into one import. Drift
 * risk: a future env-binding name change (e.g. `DB_METHOD` → `DB_DRIVER`)
 * would silently miss any one of the five sites without the helper.
 *
 * Proof shape: Catalogue row 12 — clone-count assertion via static grep
 * over the literal three-field call shape inside ecom-api handlers.
 *
 * Fix landed: `createWebhookDbClient(env)` in `@codex/worker-utils` —
 * each handler imports it and calls it with `c.env`.
 */
// Vite `?raw` baked-at-build-time imports — works under both Node and the
// workerd runtime used by @cloudflare/vitest-pool-workers (which has no
// node:fs).
import { describe, expect, it } from 'vitest';
import checkoutSrc from '../../handlers/checkout.ts?raw';
import connectSrc from '../../handlers/connect-webhook.ts?raw';
import paymentSrc from '../../handlers/payment-webhook.ts?raw';
import subscriptionSrc from '../../handlers/subscription-webhook.ts?raw';

const SITES: Array<{ path: string; src: string }> = [
  { path: 'workers/ecom-api/src/handlers/checkout.ts', src: checkoutSrc },
  {
    path: 'workers/ecom-api/src/handlers/connect-webhook.ts',
    src: connectSrc,
  },
  { path: 'workers/ecom-api/src/handlers/payment-webhook.ts', src: paymentSrc },
  {
    path: 'workers/ecom-api/src/handlers/subscription-webhook.ts',
    src: subscriptionSrc,
  },
];

describe('iter-011 F3 — createPerRequestDbClient triple-field shape duplicated', () => {
  it('the {DATABASE_URL, DATABASE_URL_LOCAL_PROXY, DB_METHOD} call shape appears at most once across ecom-api handlers', () => {
    const offenders: Array<{ path: string; line: number }> = [];

    for (const { path, src } of SITES) {
      // Match the exact triple-field call. Allows whitespace / newlines.
      const re =
        /createPerRequestDbClient\(\s*\{\s*DATABASE_URL:[\s\S]{0,80}?DATABASE_URL_LOCAL_PROXY:[\s\S]{0,80}?DB_METHOD:/g;
      for (const m of Array.from(src.matchAll(re))) {
        const line = src.slice(0, m.index ?? 0).split('\n').length;
        offenders.push({ path, line });
      }
    }

    // Pre-fix: 5 offenders. Post-fix: 0 (createWebhookDbClient owns the call).
    expect(
      offenders,
      `Inline createPerRequestDbClient(...) call shape duplicated. Extract to a shared helper. Offenders:\n${offenders.map((o) => `  ${o.path}:${o.line}`).join('\n')}`
    ).toHaveLength(0);
  });
});
