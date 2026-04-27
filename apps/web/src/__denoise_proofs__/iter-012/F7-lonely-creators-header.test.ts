/**
 * Proof test for iter-012 F7 — simplification:lonely-abstraction
 *
 * Finding: `lib/components/layout/Header/MobileNav.svelte` (289 lines) and
 * `lib/components/layout/Header/UserMenu.svelte` (~100 lines) have exactly
 * ONE consumer each — `routes/_creators/+layout.svelte` (lines 12-13).
 *
 * The platform tree (`(platform)/+layout.svelte`) and the org tree
 * (`_org/[slug]/+layout.svelte`) BOTH use the canonical `MobileBottomNav` +
 * `MobileBottomSheet` from `lib/components/layout/MobileNav/`. Only the
 * `_creators` subdomain layout still imports the older hamburger-style
 * `Header/MobileNav.svelte`.
 *
 * Two valid resolutions:
 *
 *   A. Migrate `_creators/+layout.svelte` to use MobileBottomNav +
 *      MobileBottomSheet (UX consistency win).
 *
 *   B. Keep the hamburger pattern but inline it into `_creators/+layout.svelte`
 *      (eliminate the abstraction since it has one consumer).
 *
 * Either way, after the fix `lib/components/layout/Header/` is empty (or
 * gone entirely). Today it is a "lonely abstraction" carve-out — every
 * other consumer has migrated to the bottom-nav model.
 *
 * Catalogue row: "Lonely abstraction → consumer-count assertion"
 *
 * Note on hand-off: if the chosen resolution is "delete with no behaviour
 * change in _creators" (option A delegates layout), the bead routes to
 * /fallow-audit instead. The denoise bead is filed on the assumption that
 * _creators wants to keep the hamburger UX and a deletion-with-replacement
 * is in play.
 *
 * Fingerprint: simplification:lonely-abstraction
 *   (refs/03-simplification.md §2 row 1)
 *
 * Severity: minor — frozen old UX pattern carrying ~390 lines of code.
 */

import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const apps = resolve(repoRoot, 'apps/web/src');

async function findConsumers(importPath: string): Promise<string[]> {
  const consumers: string[] = [];
  // Collect svelte + ts files under apps/web/src
  for await (const entry of glob('**/*.{svelte,ts}', {
    cwd: apps,
    exclude: (path) =>
      path.includes('__denoise_proofs__') ||
      path.includes('node_modules') ||
      path.includes('.svelte-kit'),
  })) {
    const p = resolve(apps, entry);
    const src = readFileSync(p, 'utf8');
    if (src.includes(importPath)) consumers.push(entry);
  }
  return consumers;
}

describe.skip('iter-012 F7 — Header/MobileNav and Header/UserMenu consolidate or inline', () => {
  it('Header/MobileNav.svelte has at most one consumer (which has been resolved)', async () => {
    const consumers = await findConsumers(
      "'$lib/components/layout/Header/MobileNav.svelte'"
    );
    // Pre-fix: 1 (creators layout).
    // Post-fix: 0 (deleted) OR the file no longer exists (deleted).
    expect(consumers.length).toBe(0);
  });

  it('Header/UserMenu.svelte has at most one consumer (which has been resolved)', async () => {
    const consumers = await findConsumers(
      "'$lib/components/layout/Header/UserMenu.svelte'"
    );
    expect(consumers.length).toBe(0);
  });
});
