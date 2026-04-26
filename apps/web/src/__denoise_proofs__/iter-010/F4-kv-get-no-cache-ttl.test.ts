/**
 * Proof test for F4 — performance:kv-get-no-cache-ttl
 *
 * Contract test at the boundary per SKILL.md §6 Catalogue row 7
 * (hard-to-mock side effect → contract test on the public function call
 *  shape).
 *
 * The bug:
 *   apps/web/src/lib/server/brand-cache.ts:30 calls
 *     `platform.env.BRAND_KV.get<CachedBrandConfig>(`brand:${slug}`, 'json')`
 *   without a `cacheTtl` option. Per ref 04 §4 + §8 row 2
 *   (`performance:kv-get-no-cache-ttl`), `KV.get(key)` should pass
 *   `{ type: 'json', cacheTtl: <seconds> }` so workerd's edge cache
 *   layer holds the value for `cacheTtl` seconds and avoids a cold KV
 *   read on every request. With BRAND_KV holding org-branding data
 *   that changes rarely (TTL_SECONDS = `CACHE_TTL.BRAND_CACHE_SECONDS`),
 *   a `cacheTtl` of e.g. 60s is safe and removes most KV reads.
 *
 * The proof: spy on the BRAND_KV mock's `get` call and assert the
 *   options arg includes a `cacheTtl` field.
 *
 * Currently SKIPPED — un-skip in the same PR as the fix.
 *
 * MCP gate (R6): n/a static finding; contract assertion is sufficient.
 */

import { describe, it } from 'vitest';

describe.skip('performance:kv-get-no-cache-ttl', () => {
  it('getBrandConfigWithStatus calls BRAND_KV.get with cacheTtl option', async () => {
    // SKETCH (un-skip in the fix PR):
    // const getSpy = vi.fn().mockResolvedValue(null);
    // const platform = {
    //   env: { BRAND_KV: { get: getSpy } },
    //   context: { waitUntil: vi.fn() },
    // } as unknown as App.Platform;
    //
    // const { getBrandConfigWithStatus } = await import('$lib/server/brand-cache');
    // await getBrandConfigWithStatus(platform, 'demo-org');
    //
    // // Pre-fix: call args are ['brand:demo-org', 'json'] (no options object).
    // // Post-fix: options arg present with cacheTtl >= 60.
    // const callArgs = getSpy.mock.calls[0];
    // const options = callArgs[1];
    // expect(typeof options).toBe('object');
    // expect(options).toMatchObject({ type: 'json' });
    // expect(options.cacheTtl).toBeGreaterThanOrEqual(60);
  });
});
