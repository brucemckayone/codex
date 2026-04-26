/**
 * Proof test for iter-006 F6 — `types:type-duplicate-cross-package`
 * (R11 family — `SubscriptionContext` declared 3× across server/client/utility
 * modules in apps/web).
 *
 * Finding: `SubscriptionContext` is declared in 3 distinct files in apps/web:
 *
 *   1. apps/web/src/lib/server/content-detail.ts:88 (canonical, server-side)
 *      → { requiresSubscription, hasSubscription, subscriptionCoversContent,
 *          currentSubscription, tiers }
 *   2. apps/web/src/lib/utils/subscription-context.svelte.ts:34
 *      `ResolvedSubscriptionContext` (client utility, fields 1-3 + tiers?)
 *   3. apps/web/src/lib/utils/access-context.svelte.ts:18
 *      `interface SubscriptionContext { tiers: SubscriptionTier[] }`
 *      (client, name-collision with #1 — different shape!)
 *
 * #2 is a deliberate copy with a comment explaining why ("avoid importing
 * server module on client") — but the fix is to move the canonical type
 * to a client-safe module (`$lib/types.ts`) and import it from BOTH
 * places.
 *
 * #3 is the most concerning: same name as #1 but a structurally different
 * shape (subset of one field). Future maintainers will misread the import.
 *
 * Per R11 (just promoted): "Type names declared in 2+ packages MUST resolve
 * to a single canonical declaration site." Same-package duplicates are not
 * R11-strict but file under the same fingerprint family.
 *
 * Catalogue row: §6 row 3 (type-equality) + grep guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SITES = [
  'apps/web/src/lib/utils/subscription-context.svelte.ts',
  'apps/web/src/lib/utils/access-context.svelte.ts',
];

describe('iter-006 F6 — SubscriptionContext should have one canonical declaration', () => {
  it.each(
    SITES
  )('site %s does not redeclare SubscriptionContext / ResolvedSubscriptionContext', (site) => {
    const repoRoot = resolve(__dirname, '../../../../..');
    const content = readFileSync(resolve(repoRoot, site), 'utf-8');
    // Only the canonical site (lib/server/content-detail.ts OR a new
    // client-safe canonical site like lib/types.ts) should declare it.
    expect(content).not.toMatch(/^\s*interface\s+SubscriptionContext\b/m);
    expect(content).not.toMatch(
      /^\s*interface\s+ResolvedSubscriptionContext\b/m
    );
  });
});
