/**
 * Proof test for iter-012 F6 — simplification:dup-checkout-form-vs-command
 *
 * Finding: lib/remote/checkout.remote.ts declares two near-identical Zod
 * schemas and two near-identical Stripe checkout calls:
 *
 *   - checkoutFormSchema  (lines 18-22)
 *   - checkoutCommandSchema (lines 71-75)
 *
 * Both schemas have the SAME three fields (`contentId`, `successUrl?`,
 * `cancelUrl?`) with the same validation. They are then consumed by:
 *
 *   - createCheckout         (form, lines 40-65)  — try/catch + redirect
 *   - createCheckoutSession  (command, lines 108-123) — no try, returns URL
 *
 * The bodies differ only in:
 *   - form() wraps with try/catch and `redirect(303, result.sessionUrl)`
 *   - command() returns `{ sessionUrl: result.sessionUrl }`
 *
 * Right shape: one shared schema, one shared `createStripeSession()` helper
 * that accepts `{ contentId, successUrl?, cancelUrl?, request }`. The form
 * and command wrappers reduce to ~5 lines each.
 *
 * Catalogue row: "Behaviour-equivalent refactor → parity test"
 *
 * Fingerprint: simplification:dup-checkout-form-vs-command
 * Severity: minor — this is small surface (one file, ~120 lines) but the
 * pattern is exactly the "two Zod schemas with identical fields" smell
 * that ref 03 §1 calls out.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const remoteFile = resolve(
  repoRoot,
  'apps/web/src/lib/remote/checkout.remote.ts'
);

describe('iter-012 F6 — checkout form/command share one schema and one body', () => {
  it('the file declares only one z.object literal for checkout input', () => {
    const src = readFileSync(remoteFile, 'utf8');
    const literals = src.match(
      /=\s*z\.object\(\{\s*\n\s*contentId:\s*z\.string\(\)\.uuid\(\)/g
    );
    const count = literals?.length ?? 0;
    // Pre-fix: 2 (form + command).
    // Post-fix: 1 (shared base).
    expect(count).toBeLessThanOrEqual(1);
  });

  it('the api.checkout.create({ contentId, successUrl, cancelUrl }) body is declared exactly once', () => {
    const src = readFileSync(remoteFile, 'utf8');
    const calls = src.match(/api\.checkout\.create\(\{\s*\n\s*contentId,/g);
    const count = calls?.length ?? 0;
    // Pre-fix: 2 sites.
    // Post-fix: 1 (a private helper) — both form() and command() call it.
    expect(count).toBeLessThanOrEqual(1);
  });
});
