/**
 * Proof test for iter-027 F2 — simplification:dup-content-item-shape
 *
 * Finding: `apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte:41`
 * inline-redeclares `interface ContentItem { title; slug; thumbnailUrl;
 * contentType }` — structurally identical to the canonical
 * `apps/web/src/lib/components/ui/CreatorCard/types.ts:18` `export interface
 * ContentItem` shape that lives one directory up the same component family.
 *
 * `CreatorCard.svelte:34` ALSO inlines `interface SocialLinks` (4 fields)
 * which `types.ts:11` already exports.
 *
 * The sibling `types.ts` file's docblock states:
 *   "Shared types for CreatorCard family components. CreatorDrawerData lives
 *    here (rather than inline in CreatorProfileDrawer.svelte) so it can be
 *    re-exported from the package barrel"
 *
 * — i.e. the family already established the rule "shared shapes go in
 * types.ts". CreatorCard.svelte ignores the rule for its own consumed shape.
 *
 * Recurrence: this is the 2nd cycle hit for `simplification:dup-content-item-shape`
 * (cycle_density=4 in iter-012 from the lib/components/content/ landing-section
 * components: DiscoverMix/AudioWall/ArticleEditorial/Spotlight, all still open
 * as Codex-mqyql.13). Per the master.md 2-hit early-promotion watch, this
 * second hit qualifies the fingerprint for promotion review next cycle.
 *
 * Catalogue row: "Type duplication" → "Type-equality test"
 * (`expectTypeOf<X>().toEqualTypeOf<Y>()`). Replaced here with a structural
 * grep assertion since the inline interface is local to a `<script>` block
 * (svelte-tsc's expect-type pipeline doesn't reliably surface inline
 * interfaces from .svelte files).
 *
 * Fingerprint: simplification:dup-content-item-shape
 * Severity: major — duplicate structural contract drifts independently;
 *           a future field addition to types.ts ContentItem (e.g.,
 *           publishedAt) silently bypasses CreatorCard's prop type.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../..');
const cardSvelte = resolve(
  repoRoot,
  'apps/web/src/lib/components/ui/CreatorCard/CreatorCard.svelte'
);
const cardTypes = resolve(
  repoRoot,
  'apps/web/src/lib/components/ui/CreatorCard/types.ts'
);

describe('iter-027 F2 — CreatorCard.svelte must import ContentItem + SocialLinks from sibling types.ts', () => {
  it('canonical types.ts exports ContentItem with the 4-field shape', () => {
    expect(existsSync(cardTypes)).toBe(true);
    const src = readFileSync(cardTypes, 'utf8');
    expect(src).toMatch(/export interface ContentItem\s*\{/);
    expect(src).toMatch(/title:\s*string/);
    expect(src).toMatch(/slug:\s*string/);
    expect(src).toMatch(/thumbnailUrl:\s*string \| null/);
    expect(src).toMatch(/contentType:\s*string/);
  });

  it('canonical types.ts exports SocialLinks', () => {
    const src = readFileSync(cardTypes, 'utf8');
    expect(src).toMatch(/export interface SocialLinks\s*\{/);
  });

  it('CreatorCard.svelte does NOT inline-redeclare interface ContentItem', () => {
    // Pre-fix: line 41 has `interface ContentItem { ... }`.
    // Post-fix: the file imports ContentItem from sibling './types'.
    const src = readFileSync(cardSvelte, 'utf8');
    expect(src).not.toMatch(/^\s*interface ContentItem\s*\{/m);
  });

  it('CreatorCard.svelte does NOT inline-redeclare interface SocialLinks', () => {
    const src = readFileSync(cardSvelte, 'utf8');
    expect(src).not.toMatch(/^\s*interface SocialLinks\s*\{/m);
  });

  it('CreatorCard.svelte imports ContentItem and SocialLinks from sibling types.ts', () => {
    const src = readFileSync(cardSvelte, 'utf8');
    // Acceptable forms:
    //   import type { ContentItem, SocialLinks } from './types';
    //   import type { ContentItem } from './types';
    expect(src).toMatch(
      /import\s+type\s+\{[^}]*\bContentItem\b[^}]*\}\s+from\s+['"]\.\/types['"]/
    );
    expect(src).toMatch(
      /import\s+type\s+\{[^}]*\bSocialLinks\b[^}]*\}\s+from\s+['"]\.\/types['"]/
    );
  });
});
