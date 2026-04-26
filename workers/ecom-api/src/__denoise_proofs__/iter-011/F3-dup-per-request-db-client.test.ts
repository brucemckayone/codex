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
 * Sites (all five lift the IDENTICAL `{DATABASE_URL, DATABASE_URL_LOCAL_PROXY,
 * DB_METHOD}` triple off `c.env`):
 *   - workers/ecom-api/src/handlers/checkout.ts:132-136
 *   - workers/ecom-api/src/handlers/connect-webhook.ts:28-32
 *   - workers/ecom-api/src/handlers/connect-webhook.ts:70-75 (nested in
 *     account-activation pending-payouts branch)
 *   - workers/ecom-api/src/handlers/payment-webhook.ts:245-249
 *   - workers/ecom-api/src/handlers/subscription-webhook.ts:170-174
 *
 * Procedure() handlers don't have this boilerplate because the service
 * registry handles per-request DB lifecycle. Webhook handlers bypass
 * procedure() (HMAC + raw-body verification), so they need their own DB
 * lifecycle — but the shape is so uniform that a single helper
 * `createWebhookDbClient(c.env)` would collapse 5 sites into one
 * import. Drift risk: a future env-binding name change (e.g. `DB_METHOD`
 * → `DB_DRIVER`) would silently miss any one of the five sites.
 *
 * Proof shape: Catalogue row 12 — clone-count assertion via static grep
 * over the literal three-field call shape.
 *
 * Fix: extract `createWebhookDbClient(env: { DATABASE_URL: string;
 * DATABASE_URL_LOCAL_PROXY?: string; DB_METHOD?: string })` (likely in
 * @codex/database or workers/ecom-api/src/utils/) and have all five
 * sites consume it.
 *
 * `it.skip` while the duplication stands.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const HANDLERS_DIR = join(PROJECT_ROOT, 'workers/ecom-api/src/handlers');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) continue;
    if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe.skip('iter-011 F3 — createPerRequestDbClient triple-field shape duplicated', () => {
  it('the {DATABASE_URL, DATABASE_URL_LOCAL_PROXY, DB_METHOD} call shape appears at most once across ecom-api handlers', () => {
    const offenders: Array<{ path: string; line: number }> = [];

    for (const file of listTsFiles(HANDLERS_DIR)) {
      const src = readFileSync(file, 'utf8');
      // Match the exact triple-field call. Allows whitespace / newlines.
      const re =
        /createPerRequestDbClient\(\s*\{\s*DATABASE_URL:[\s\S]{0,80}?DATABASE_URL_LOCAL_PROXY:[\s\S]{0,80}?DB_METHOD:/g;
      for (const m of Array.from(src.matchAll(re))) {
        const line = src.slice(0, m.index ?? 0).split('\n').length;
        offenders.push({ path: file.slice(PROJECT_ROOT.length + 1), line });
      }
    }

    // Pre-fix: 5 offenders. Post-fix: 0 (shared helper owns the call).
    expect(
      offenders,
      `Inline createPerRequestDbClient(...) call shape duplicated. Extract to a shared helper. Offenders:\n${offenders.map((o) => `  ${o.path}:${o.line}`).join('\n')}`
    ).toHaveLength(0);
  });
});
