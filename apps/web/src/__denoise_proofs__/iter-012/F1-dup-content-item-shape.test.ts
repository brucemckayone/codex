/**
 * Proof test for iter-012 F1 — simplification:dup-content-item-shape
 *
 * Finding: Four lib/components/content/ landing-section components each
 * declare an inline `*Item` interface that is structurally identical to the
 * canonical `ContentItem` derived from `getPublicContent` in
 * `routes/_org/[slug]/(space)/feed-types.ts`.
 *
 * Sites (all in apps/web/src/lib/components/content/):
 *   - DiscoverMix.svelte:27-42       interface MixItem
 *   - AudioWall.svelte:21-36         interface AudioItem
 *   - ArticleEditorial.svelte:30-45  interface ArticleItem
 *   - Spotlight.svelte:31-67         interface SpotlightItem (richer superset)
 *
 * Each declares the same 9-field skeleton:
 *     id, title, slug, description, thumbnailUrl, contentType, mediaItem,
 *     creator, priceCents, accessType, category
 *
 * The parent route (`_org/[slug]/(space)/+page.svelte`) hands them
 * `section.items: ContentItem[]` from feed-types.ts — so the structural
 * subset of `ContentItem` IS the contract these components consume. The
 * inline redeclarations duplicate a typed contract that already exists.
 *
 * Catalogue row: "Duplication count → programmatic assertion" (clone-count
 * grep over `lib/components/content/` asserting no inline `interface
 * \w+Item` declarations remain after the fix lifts them to a shared module
 * or `import type { ContentItem } from '../../../routes/.../feed-types'`).
 *
 * Fingerprint: simplification:dup-content-item-shape
 *   (recurrence-watch sibling of simplification:dup-paginated-list-shape
 *    from iter-009 F3 in packages cell)
 *
 * Severity: major — duplicated structural contract drifts independently;
 *           a future schema change to the wire shape silently bypasses
 *           three of the four components.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../../../..');
const contentDir = resolve(repoRoot, 'apps/web/src/lib/components/content');

const sites: Array<{ file: string; declaredInterface: string }> = [
  { file: 'DiscoverMix.svelte', declaredInterface: 'MixItem' },
  { file: 'AudioWall.svelte', declaredInterface: 'AudioItem' },
  { file: 'ArticleEditorial.svelte', declaredInterface: 'ArticleItem' },
];

describe.skip('iter-012 F1 — content section components must not redeclare the ContentItem shape', () => {
  it('canonical ContentItem type lives in feed-types.ts', () => {
    const feedTypes = resolve(
      repoRoot,
      'apps/web/src/routes/_org/[slug]/(space)/feed-types.ts'
    );
    expect(existsSync(feedTypes)).toBe(true);
    const src = readFileSync(feedTypes, 'utf8');
    expect(src).toMatch(/export type ContentItem = NonNullable</);
  });

  for (const { file, declaredInterface } of sites) {
    it(`${file} does not declare an inline ${declaredInterface} interface`, () => {
      const src = readFileSync(resolve(contentDir, file), 'utf8');
      // Pre-fix: each file matches /interface (Mix|Audio|Article)Item \{/.
      // Post-fix: the components import the shared ContentItem type and
      // either alias it or use it directly.
      const inlineRegex = new RegExp(`interface ${declaredInterface}\\s*\\{`);
      expect(src).not.toMatch(inlineRegex);
    });
  }

  it('Spotlight.svelte does not declare an inline SpotlightItem interface', () => {
    // Spotlight is a richer superset (publishedAt, viewCount, tags,
    // hlsPreviewUrl) — fix may keep an inline extension or extract a
    // `SpotlightItem extends ContentItem` shape. Test asserts the BASE
    // duplicated subset (id/title/slug/contentType/mediaItem/creator) is
    // not redeclared in isolation.
    const src = readFileSync(resolve(contentDir, 'Spotlight.svelte'), 'utf8');
    // After fix: SpotlightItem either disappears or extends ContentItem.
    const standalone =
      /interface SpotlightItem\s*\{[^}]*id: string;[^}]*title: string;[^}]*slug: string;[^}]*contentType\?:/s;
    expect(src).not.toMatch(standalone);
  });
});
