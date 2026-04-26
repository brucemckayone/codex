/**
 * Denoise iter-011 F1 — `bumpUserLibrary` helper duplicated across workers.
 *
 * Fingerprint: simplification:duplicate-utility-helper
 * Severity: major (3 nearly-identical sites; recurrence #2 of iter-009 stem)
 * Recurrence: iter-009 F1 (Codex-mqyql.1) + F5 (Codex-mqyql.5) → 2 hits already
 *   (worker-utils generateRequestId/getClientIP and content/subscription
 *   bumpWithLogger). This filing makes hits=3 → triggers R7 standard 3-hit
 *   promotion check at next cycle prep.
 *
 * Sites (all do `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(userId))`
 * via VersionedCache + waitUntil + .catch(() => {})):
 *   - workers/organization-api/src/routes/members.ts:75-83 (`bumpUserLibrary(ctx, userId)`)
 *   - workers/organization-api/src/routes/followers.ts:32-42 (`bumpUserLibrary(env, ctx, userId)`)
 *   - workers/ecom-api/src/handlers/checkout.ts:167-174 (inline, same shape)
 *
 * Differences are signature-only (CacheCtx vs raw env+ctx), the bodies are
 * identical: build VersionedCache from CACHE_KV, call invalidate, dispatch
 * via waitUntil with a swallowing .catch. The cleanest fix is to lift this
 * into a shared helper in `@codex/cache` (e.g. `invalidateUserLibrary(env,
 * waitUntilFn, userId)`) so the three workers and any future consumer share
 * one entry point. Per `feedback_dont_defer_cache_issues.md`, fan-out cache
 * helpers belong in the cache package — they should not live as inline
 * route helpers each carrying their own .catch ergonomics.
 *
 * Proof shape: Catalogue row 12 — "Naming/style consistency: custom lint
 * rule + test the rule" — static grep over both worker files counting
 * declarations of `function bumpUserLibrary` / equivalent inline
 * `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(...))` calls.
 *
 * Fix: extract to `@codex/cache` (or `@codex/worker-utils`) and have all
 * three call sites import the shared helper. Test then asserts that
 * `bumpUserLibrary` is declared at exactly ONE site (the shared helper)
 * AND that the `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(...))`
 * literal appears at most once in workers/* route handlers.
 *
 * `it.skip` while the duplication stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const SITES = [
  'workers/organization-api/src/routes/members.ts',
  'workers/organization-api/src/routes/followers.ts',
  'workers/ecom-api/src/handlers/checkout.ts',
];

describe.skip('iter-011 F1 — bumpUserLibrary helper duplicated', () => {
  it('declares `function bumpUserLibrary` at most once across worker route files', () => {
    const declarations: Array<{ path: string; line: number }> = [];
    for (const rel of SITES) {
      const src = readFileSync(join(PROJECT_ROOT, rel), 'utf8');
      const lines = src.split('\n');
      lines.forEach((ln, i) => {
        if (/function bumpUserLibrary\b/.test(ln)) {
          declarations.push({ path: rel, line: i + 1 });
        }
      });
    }
    expect(
      declarations,
      `bumpUserLibrary should be declared once (in @codex/cache or @codex/worker-utils) — found:\n${declarations.map((d) => `  ${d.path}:${d.line}`).join('\n')}`
    ).toHaveLength(0);
  });

  it('cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(...)) appears in at most one worker file', () => {
    // After fix the shared helper is the only caller; route files import it.
    const offenders: Array<{ path: string; lines: number[] }> = [];
    for (const rel of SITES) {
      const src = readFileSync(join(PROJECT_ROOT, rel), 'utf8');
      const hits = Array.from(
        src.matchAll(
          /cache\.invalidate\(\s*CacheType\.COLLECTION_USER_LIBRARY/g
        )
      ).map((m) => src.slice(0, m.index ?? 0).split('\n').length);
      if (hits.length > 0) offenders.push({ path: rel, lines: hits });
    }
    // Currently: 3 sites (members.ts, followers.ts, checkout.ts).
    // Post-fix: 0 sites in workers/ (helper lives in @codex/cache).
    expect(
      offenders,
      `cache.invalidate(CacheType.COLLECTION_USER_LIBRARY(...)) should not appear in worker route files — extract to shared helper. Offenders:\n${offenders.map((o) => `  ${o.path} (lines ${o.lines.join(', ')})`).join('\n')}`
    ).toEqual([]);
  });
});
