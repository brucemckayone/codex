/**
 * Proof test for iter-012 F3 — simplification:dup-auth-derive-logic
 *
 * Finding: The same five-step auth-derivation block is inlined in three
 * sibling layout components:
 *
 *   1. lib/components/layout/Header/UserMenu.svelte:24-43
 *   2. lib/components/layout/Header/MobileNav.svelte:20-21 (partial: STUDIO_ROLES + canAccessStudio only)
 *   3. lib/components/layout/MobileNav/MobileBottomSheet.svelte:33-50
 *
 * The duplicated block:
 *   const STUDIO_ROLES = new Set([AUTH_ROLES.CREATOR, AUTH_ROLES.ADMIN, AUTH_ROLES.PLATFORM_OWNER]);
 *   const canAccessStudio = $derived(!!user?.role && STUDIO_ROLES.has(user.role));
 *   const currentSubdomain = $derived(extractSubdomain(page.url.hostname));
 *   const studioHref = $derived(
 *     currentSubdomain && currentSubdomain !== 'creators' && currentSubdomain !== 'www'
 *       ? '/studio'
 *       : buildCreatorsUrl(page.url, '/studio')
 *   );
 *   function getInitials(name: string): string { ... }
 *
 * The MobileBottomSheet:32 comment "Auth logic (reused from UserMenu)"
 * acknowledges the dup explicitly.
 *
 * This shape belongs in `$lib/utils/auth-context.svelte.ts` (or a snippet
 * exported from `UserMenu`) so that role/subdomain heuristics live in one
 * place. Today, a future change to STUDIO_ROLES (e.g., adding 'manager')
 * silently diverges between the desktop and mobile menus.
 *
 * Catalogue row: "Duplication count → programmatic assertion"
 *
 * Fingerprint: simplification:dup-auth-derive-logic
 *   (sibling of simplification:duplicate-utility-helper R14 — content-domain
 *    cache fanout was promoted in iter-011; THIS is its UI-domain analogue:
 *    auth/role helpers inlined where they should be in shared utils)
 *
 * Severity: major
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');
const sites = [
  'apps/web/src/lib/components/layout/Header/UserMenu.svelte',
  'apps/web/src/lib/components/layout/Header/MobileNav.svelte',
  'apps/web/src/lib/components/layout/MobileNav/MobileBottomSheet.svelte',
];

describe.skip('iter-012 F3 — STUDIO_ROLES + canAccessStudio + studioHref logic should live in one place', () => {
  it('STUDIO_ROLES Set construction appears in at most one source file', () => {
    const matches = sites.filter((rel) => {
      const src = readFileSync(resolve(repoRoot, rel), 'utf8');
      return /new Set\(\[\s*AUTH_ROLES\.CREATOR\s*,\s*AUTH_ROLES\.ADMIN\s*,\s*AUTH_ROLES\.PLATFORM_OWNER/.test(
        src
      );
    });

    // Pre-fix: 3 of 3 match.
    // Post-fix: 0 (logic moved to a util) or 1 (kept in UserMenu, others
    // import the derived value).
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('studioHref derivation appears in at most one source file', () => {
    const matches = sites.filter((rel) => {
      const src = readFileSync(resolve(repoRoot, rel), 'utf8');
      return (
        /buildCreatorsUrl\(page\.url,\s*['"]\/studio['"]\)/.test(src) &&
        /currentSubdomain && currentSubdomain !== ['"]creators['"]/.test(src)
      );
    });

    // Pre-fix: 2 of 3 sites carry the full derivation (UserMenu +
    // MobileBottomSheet). Header/MobileNav has the partial canAccessStudio
    // but not the studioHref derivation.
    // Post-fix: at most one canonical site.
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('the "reused from UserMenu" maintenance comment in MobileBottomSheet is gone', () => {
    const src = readFileSync(
      resolve(
        repoRoot,
        'apps/web/src/lib/components/layout/MobileNav/MobileBottomSheet.svelte'
      ),
      'utf8'
    );
    // After consolidation, there's nothing to "reuse" — the helper is imported.
    expect(src).not.toMatch(/Auth logic.*reused from UserMenu/i);
  });
});
