/**
 * Proof test for iter-006 F8 — `types:as-unknown-as`
 * (`content as unknown as { publishedAt; createdAt }` in ContentDetailView).
 *
 * Finding: `apps/web/src/lib/components/content/ContentDetailView.svelte:551`
 * uses `content as unknown as { publishedAt?: string | Date | null; createdAt?: string | Date | null }`
 * to extract two fields the static `content` prop type doesn't surface.
 *
 * The fix is structural: declare those fields as optional on the component's
 * `Props.content` interface (matching the pattern used in `Spotlight.svelte`
 * lines 38-50, where `publishedAt` / `viewCount` / `tags` are explicitly
 * declared with `string | Date | null` to acknowledge SSR/CSR boundary).
 *
 * Same fingerprint family as F7 — third `as unknown as` site in apps/web
 * production code. With F7 + F8, this cycle alone increments
 * `types:as-unknown-as` to hit #2 in trailing 6 cycles (after iter-005's
 * hit #1 in workers). One more sighting in iter-007/008 standard 3-hit
 * R7 promotion.
 *
 * Catalogue row: §6 row 3 (type-equality) + grep guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skip('iter-006 F8 — ContentDetailView should not use `as unknown as`', () => {
  it('ContentDetailView.svelte contains no `as unknown as` cast', () => {
    const repoRoot = resolve(__dirname, '../../../../..');
    const content = readFileSync(
      resolve(
        repoRoot,
        'apps/web/src/lib/components/content/ContentDetailView.svelte'
      ),
      'utf-8'
    );
    expect(content).not.toMatch(/\bas\s+unknown\s+as\b/);
  });
});
