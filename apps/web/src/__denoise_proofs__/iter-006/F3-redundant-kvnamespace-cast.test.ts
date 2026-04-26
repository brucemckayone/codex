/**
 * Proof test for iter-006 F3 — `types:as-cast-without-guard`
 * (`as KVNamespace` cast where the value is already typed `KVNamespace`).
 *
 * Finding: 6 sites cast `platform.env.CACHE_KV as KVNamespace` AFTER a
 * truthy check, but `App.Platform.env.CACHE_KV` is already declared as
 * `KVNamespace | undefined` in `apps/web/src/app.d.ts:40`. After
 * `if (!platform?.env?.CACHE_KV) return;`, TS narrows it to `KVNamespace`
 * directly — the cast is redundant.
 *
 * Sites:
 *   - apps/web/src/lib/server/cache.ts:14
 *   - apps/web/src/routes/(platform)/account/notifications/+page.server.ts:23
 *   - apps/web/src/routes/_org/[slug]/+layout.server.ts:180
 *   - apps/web/src/routes/(platform)/+layout.server.ts:17
 *   - apps/web/src/routes/(platform)/account/+layout.server.ts:26
 *   - apps/web/src/routes/_org/[slug]/(space)/explore/+page.server.ts:155
 *
 * The cast is harmless here, but it MASKS drift: if a future change
 * makes CACHE_KV `unknown` or removes the binding, the cast still
 * silently compiles and `new VersionedCache({ kv: ... })` blows up at
 * runtime.
 *
 * Catalogue row: §6 row 12 (custom lint rule). Proof is a grep
 * assertion that the literal cast is gone post-fix.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SITES = [
  'apps/web/src/lib/server/cache.ts',
  'apps/web/src/routes/(platform)/account/notifications/+page.server.ts',
  'apps/web/src/routes/_org/[slug]/+layout.server.ts',
  'apps/web/src/routes/(platform)/+layout.server.ts',
  'apps/web/src/routes/(platform)/account/+layout.server.ts',
  'apps/web/src/routes/_org/[slug]/(space)/explore/+page.server.ts',
];

describe.skip('iter-006 F3 — `as KVNamespace` casts in apps/web should be removed', () => {
  it.each(SITES)('site has no `as KVNamespace` cast: %s', (site) => {
    const repoRoot = resolve(__dirname, '../../../../..');
    const content = readFileSync(resolve(repoRoot, site), 'utf-8');
    expect(content).not.toMatch(/\bas\s+KVNamespace\b/);
  });
});
