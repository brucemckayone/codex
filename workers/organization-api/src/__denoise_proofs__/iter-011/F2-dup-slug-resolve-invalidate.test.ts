/**
 * Denoise iter-011 F2 — `resolve-slug-then-invalidate` block duplicated.
 *
 * Fingerprint: simplification:duplicate-utility-helper (sub-stem)
 * Severity: major (cross-worker drift risk on slug-keyed cache invalidation)
 *
 * Sites (both implement `db.query.organizations.findFirst({where: eq(id),
 * columns: {slug: true}}) → cache.invalidate(slug)` inside a try/catch
 * "Non-critical — slug cache expires via TTL" swallow):
 *   - workers/content-api/src/routes/content.ts:78-91 (inside
 *     `bumpOrgContentVersion`)
 *   - workers/organization-api/src/routes/members.ts:99-114
 *     (`invalidateOrgSlugCache`)
 *
 * Drift risk: the two implementations could diverge on retry/timeout
 * semantics, on the swallow message, or on which orgId source is the
 * authoritative slug. The block is a textbook rule-of-three candidate
 * (already 2 vindicating consumers exist) — extract to one shared helper.
 *
 * Cleanest landing site: `@codex/cache` exposes
 * `invalidateOrgSlugCache({ db, cache, orgId, logger? })` returning a
 * Promise. Both workers consume it instead of inlining.
 *
 * Proof shape: Catalogue row 12 — clone-count assertion via static grep
 * for the canonical query shape `findFirst({ where: eq(...id), columns:
 * { slug: true } })`.
 *
 * Fix: extract to shared helper; both call sites import it.
 *
 * `it.skip` while the duplication stands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..', '..');

const SITES = [
  'workers/content-api/src/routes/content.ts',
  'workers/organization-api/src/routes/members.ts',
];

describe.skip('iter-011 F2 — slug-resolve-then-invalidate duplication', () => {
  it('canonical "findFirst({where: eq(...organizations.id), columns: {slug: true}})" appears at most once across worker route files', () => {
    const offenders: Array<{ path: string; line: number; snippet: string }> =
      [];

    for (const rel of SITES) {
      const src = readFileSync(join(PROJECT_ROOT, rel), 'utf8');
      // Look for the exact slug-only column projection inside an
      // organizations.findFirst — it's the unambiguous fingerprint.
      const re =
        /db\.query\.organizations\.findFirst\(\s*\{[\s\S]{0,200}?columns:\s*\{\s*slug:\s*true\s*\}/g;
      const matches = Array.from(src.matchAll(re));
      for (const m of matches) {
        const line = src.slice(0, m.index ?? 0).split('\n').length;
        offenders.push({
          path: rel,
          line,
          snippet: m[0].slice(0, 80),
        });
      }
    }

    // Pre-fix: 2 offenders (content.ts:81 + members.ts:104).
    // Post-fix: 0 offenders in workers/ (shared helper owns the query).
    expect(
      offenders,
      `slug-resolve query should not be inlined in worker route files — offenders:\n${offenders
        .map((o) => `  ${o.path}:${o.line}`)
        .join('\n')}`
    ).toEqual([]);
  });
});
