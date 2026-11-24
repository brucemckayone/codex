/**
 * "More from this creator" draws Explore's tile (Codex-2yosh): a 3:4 cover
 * with the title inside it and no card body. The default filled body painted
 * the brand's --color-surface-card under the page's ink, and a brand that
 * tunes that surface dark left the titles near-invisible on prod.
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import RelatedContent from './RelatedContent.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function item(id: string, contentType: 'video' | 'audio' | 'written') {
  return {
    id,
    slug: id,
    title: `${id} title`,
    description: null,
    contentType,
    priceCents: null,
    accessType: 'free',
    featured: false,
    thumbnailUrl: null,
    mediaItem: null,
    organization: { slug: 'org' },
  };
}

describe('RelatedContent', () => {
  test('every card is the Explore tile: grid, 3:4, title in the cover, no card body', () => {
    component = mount(RelatedContent, {
      target: document.body,
      props: {
        // The page hands the grid its DTO rows; only the fields read matter.
        items: [
          item('a', 'video'),
          item('b', 'audio'),
          item('c', 'written'),
        ] as never,
        creatorName: 'Ada',
        hrefBuilder: (i: { slug: string }) => `/content/${i.slug}`,
      },
    });
    flushSync();

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.cc'));
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.dataset.variant).toBe('grid');
      expect(card.dataset.chrome).toBe('transparent');
    }
    // Video and audio put the title in the cover; an article tile keeps its
    // own text layout, as it does on Explore.
    expect(cards[0].classList.contains('cc--title-in-cover')).toBe(true);
    expect(cards[1].classList.contains('cc--title-in-cover')).toBe(true);
    expect(document.querySelector('h2')?.textContent).toContain('Ada');
  });
});
