/**
 * Proof test for iter-027 F1 — simplification:duplicate-utility-helper
 *
 * Finding: SidebarRail.svelte and SidebarRailUserSection.svelte each STILL
 * inline-redeclare the STUDIO_ROLES Set + canAccessStudio derive + studioHref
 * computation that was canonicalised into `lib/utils/studio-access.svelte.ts`
 * by Round 3 Tier 2.A (commit 2d1c065a).
 *
 * Sites pre-fix (verified live by audit):
 *   - apps/web/src/lib/components/layout/SidebarRail/SidebarRail.svelte:55-63
 *     - `const STUDIO_ROLES = new Set([AUTH_ROLES.CREATOR, ...]);`
 *     - `const canAccessStudio = $derived(...)`;
 *     - `const studioHref = $derived(...)` with extractSubdomain + buildCreatorsUrl
 *   - apps/web/src/lib/components/layout/SidebarRail/SidebarRailUserSection.svelte:31-39
 *     - same triple
 *   - apps/web/src/routes/_creators/studio/+layout.server.ts:17-38
 *     - inline STUDIO_ROLES (server-side; uses pure `hasStudioRole` instead)
 *
 * Canonical helper (post-Tier 2.A, in tree at iter-027 head):
 *   - apps/web/src/lib/utils/studio-access.svelte.ts:28
 *     `export const STUDIO_ROLES`
 *   - line 38 `export function hasStudioRole(user)` — server-safe
 *   - line 49 `export function resolveStudioHref(currentUrl)` — pure
 *   - line 79 `export function useStudioAccess(getInput)` — reactive
 *
 * Header surfaces (Tier 2.A migrated these):
 *   - Header/MobileNav.svelte:7  imports hasStudioRole from studio-access.svelte ✓
 *   - Header/UserMenu.svelte uses useStudioAccess ✓
 *   - MobileNav/MobileBottomSheet.svelte uses helper ✓
 *
 * Sidebar surfaces (Tier 2.A NOT migrated, this finding):
 *   - SidebarRail.svelte still inlines (line 55-63) ✗
 *   - SidebarRailUserSection.svelte still inlines (line 31-39) ✗
 *
 * Fix: replace each inline triple with `useStudioAccess(() => ({ user, url: page.url }))`
 * (same pattern as Header/UserMenu.svelte).
 *
 * Catalogue row: "Duplication count → programmatic assertion" (R14 sibling).
 * R14 promoted `simplification:duplicate-utility-helper` for cache-fanout —
 * same fingerprint, separate violation surface (auth-derive copy-paste).
 *
 * Fingerprint: simplification:duplicate-utility-helper
 * Severity: major — the helper's docblock explicitly lists the migrated
 *           sites (Header/UserMenu, Header/MobileNav, MobileNav/MobileBottomSheet)
 *           but a future change to STUDIO_ROLES will drift in the two SidebarRail
 *           consumers, recreating the original 3-site bug.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const sites = [
  'apps/web/src/lib/components/layout/SidebarRail/SidebarRail.svelte',
  'apps/web/src/lib/components/layout/SidebarRail/SidebarRailUserSection.svelte',
];
const canonical = resolve(
  repoRoot,
  'apps/web/src/lib/utils/studio-access.svelte.ts'
);

describe('iter-027 F1 — SidebarRail surface must use useStudioAccess helper, not inline STUDIO_ROLES', () => {
  it('canonical helper exports STUDIO_ROLES + hasStudioRole + resolveStudioHref + useStudioAccess', () => {
    expect(existsSync(canonical)).toBe(true);
    const src = readFileSync(canonical, 'utf8');
    expect(src).toMatch(/export const STUDIO_ROLES\b/);
    expect(src).toMatch(/export function hasStudioRole\b/);
    expect(src).toMatch(/export function resolveStudioHref\b/);
    expect(src).toMatch(/export function useStudioAccess\b/);
  });

  for (const site of sites) {
    it(`${site} does not inline STUDIO_ROLES`, () => {
      const src = readFileSync(resolve(repoRoot, site), 'utf8');
      // Pre-fix: each file has /const STUDIO_ROLES = new Set\(\[/.
      // Post-fix: each file imports STUDIO_ROLES (or uses useStudioAccess
      // composable) from studio-access.svelte.
      expect(src).not.toMatch(/const STUDIO_ROLES\s*=\s*new Set\(/);
    });

    it(`${site} does not inline studioHref derivation`, () => {
      const src = readFileSync(resolve(repoRoot, site), 'utf8');
      // Pre-fix: both compute `currentSubdomain && currentSubdomain !== 'creators'
      // && currentSubdomain !== 'www' ? '/studio' : buildCreatorsUrl(...)`.
      // Post-fix: that ternary lives only in resolveStudioHref().
      expect(src).not.toMatch(/currentSubdomain !== 'creators'/);
    });
  }

  it('only studio-access.svelte declares STUDIO_ROLES at apps/web/src/lib/components/layout', () => {
    // Reverse search — the helper file is the only declaration site under
    // lib/components/layout/. After fix, this passes.
    const grepResults: string[] = [];
    for (const site of sites) {
      const src = readFileSync(resolve(repoRoot, site), 'utf8');
      if (/const STUDIO_ROLES\s*=\s*new Set\(/.test(src))
        grepResults.push(site);
    }
    expect(grepResults).toEqual([]);
  });
});
