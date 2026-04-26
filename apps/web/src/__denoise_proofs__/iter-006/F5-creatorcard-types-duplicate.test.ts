/**
 * Proof test for iter-006 F5 — `types:type-duplicate-cross-package`
 * (R11 family — same package, two declaration sites).
 *
 * Finding: `apps/web/src/lib/components/ui/CreatorCard/types.ts` exports
 * `SocialLinks` and `ContentItem`, but
 * `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte` declares
 * the SAME shapes inline at lines 34 and 41. The interfaces are
 * structurally identical:
 *
 *   types.ts:11    export interface SocialLinks { website?: string; twitter?: string; ... }
 *   CreatorCard:34 interface SocialLinks { website?: string; twitter?: string; ... }
 *
 *   types.ts:18    export interface ContentItem { title: string; slug: string; thumbnailUrl: string | null; contentType: string }
 *   CreatorCard:41 interface ContentItem { title: string; slug: string; thumbnailUrl: string | null; contentType: string }
 *
 * R11 (just promoted) targets cross-package duplicates, so this is a
 * lesser variant — same package, but still a `types:type-duplicate-...`
 * fingerprint. The fix is to import from `./types` in CreatorCard.svelte
 * (one canonical declaration site).
 *
 * Catalogue row: §6 row 3 (type-equality test) + grep guard.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ContentItem,
  SocialLinks,
} from '../../lib/components/ui/CreatorCard/types';

describe.skip('iter-006 F5 — CreatorCard.svelte should not redeclare types from types.ts', () => {
  it('CreatorCard.svelte does not declare an inline SocialLinks interface', () => {
    const repoRoot = resolve(__dirname, '../../../../..');
    const content = readFileSync(
      resolve(
        repoRoot,
        'apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte'
      ),
      'utf-8'
    );
    // After fix: imports from './types', no inline `interface SocialLinks`.
    expect(content).not.toMatch(/^\s*interface\s+SocialLinks\b/m);
    expect(content).not.toMatch(/^\s*interface\s+ContentItem\b/m);
  });

  it('canonical types compile (regression guard)', () => {
    expectTypeOf<SocialLinks>().toMatchTypeOf<{
      website?: string;
      twitter?: string;
      youtube?: string;
      instagram?: string;
    }>();
    expectTypeOf<ContentItem>().toMatchTypeOf<{
      title: string;
      slug: string;
      thumbnailUrl: string | null;
      contentType: string;
    }>();
  });
});
