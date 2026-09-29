import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { GALLERY_COPY } from './copy';
import { GALLERY_EMPTY, galleryDefinition } from './definition';
import GalleryBlock from './GalleryBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const CDN = 'https://cdn.test';
const HEADING = 'A look inside';

/** Pictures 1…count, every other one captioned. */
function pictures(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    image: {
      key: `landing-pages/p1/images/g${i + 1}`,
      alt: `Picture ${i + 1}`,
    },
    ...(i % 2 === 0 ? { caption: `Caption ${i + 1}` } : {}),
  }));
}

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    edit?: BlockEdit | null;
    mediaBaseUrl?: string | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'gallery-1',
    anchor: 'gallery',
    type: 'gallery',
    index: 6,
    layout: options.layout ?? 'mosaic',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(GalleryBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({
        mediaBaseUrl:
          options.mediaBaseUrl === undefined ? CDN : options.mediaBaseUrl,
      }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
}

function rerender(...args: Parameters<typeof render>) {
  if (app) unmount(app);
  app = null;
  return render(...args);
}

const one = (selector: string) => document.body.querySelector(selector);
const all = (selector: string) => [...document.body.querySelectorAll(selector)];
const text = () => document.body.textContent ?? '';
const inert = (el: Element | null) =>
  Boolean((el as HTMLElement | null)?.inert || el?.hasAttribute('inert'));

describe('GalleryBlock', () => {
  it.each(
    SECTION_LAYOUTS.gallery
  )('%s: the heading, then every picture with its description and caption', async (layout) => {
    await render({ heading: HEADING, items: pictures(5) }, { layout });
    expect(one('h2')?.textContent).toBe(HEADING);
    expect(all('li')).toHaveLength(5);
    expect(all('img').map((img) => img.getAttribute('alt'))).toEqual([
      'Picture 1',
      'Picture 2',
      'Picture 3',
      'Picture 4',
      'Picture 5',
    ]);
    expect(
      all('figure > figcaption').map((c) => c.textContent?.trim())
    ).toEqual(['Caption 1', 'Caption 3', 'Caption 5']);
  });

  it('draws each layout as its own composition', async () => {
    const shapes = new Set<string>();
    for (const layout of SECTION_LAYOUTS.gallery) {
      await rerender({ items: pictures(5) }, { layout });
      shapes.add(one('ul')?.className.split(' ')[0] ?? '');
    }
    expect(shapes.size).toBe(SECTION_LAYOUTS.gallery.length);
  });

  describe('mosaic', () => {
    it('gives the first picture the largest tile, and a designed tile to every other', async () => {
      await render({ items: pictures(5) });
      expect(all('li').map((li) => li.getAttribute('data-tile'))).toEqual([
        'large',
        'small',
        'small',
        'wide',
        'wide',
      ]);
      await rerender({ items: pictures(1) });
      expect(one('li')?.getAttribute('data-tile')).toBe('single');
    });

    it('moves only its first picture, on a wrapper of its own', async () => {
      await render({ items: pictures(5) });
      const drifting = all('[data-lp-parallax]');
      expect(drifting).toHaveLength(1);
      expect(drifting[0].getAttribute('data-lp-parallax')).toBe('1');
      expect(drifting[0].closest('li')).toBe(all('li')[0]);
      // Never on the media or the figure, which a Style may move themselves.
      expect(drifting[0].matches('.lp-media, figure')).toBe(false);
      expect(drifting[0].querySelector('.lp-media img')).not.toBeNull();
    });

    it('sets its captions on the pictures, on the media colours', async () => {
      await render({ items: pictures(3) });
      for (const caption of all('figcaption')) {
        expect(caption.hasAttribute('data-lp-on-media')).toBe(true);
      }
    });
  });

  describe('strip', () => {
    it('is a labelled region a keyboard can focus, named by the heading', async () => {
      await render(
        { heading: HEADING, items: pictures(4) },
        { layout: 'strip' }
      );
      const region = one('[role="region"]') as HTMLElement;
      expect(region.getAttribute('aria-label')).toBe(HEADING);
      expect(region.tabIndex).toBe(0);
      expect(region.id).toBe('gallery-pictures');
      const [previous, next] = all('button');
      expect(previous.getAttribute('aria-label')).toBe(GALLERY_COPY.previous);
      expect(next.getAttribute('aria-label')).toBe(GALLERY_COPY.next);
      for (const button of [previous, next]) {
        expect(button.getAttribute('aria-controls')).toBe(region.id);
      }
      await rerender({ items: pictures(4) }, { layout: 'strip' });
      expect(one('[role="region"]')?.getAttribute('aria-label')).toBe(
        GALLERY_COPY.strip
      );
    });

    it('alternates landscape and portrait pictures, starting wide', async () => {
      await render({ items: pictures(4) }, { layout: 'strip' });
      expect(all('li').map((li) => li.getAttribute('data-shape'))).toEqual([
        'wide',
        'tall',
        'wide',
        'tall',
      ]);
    });

    it('is the only layout that runs to the section edges', async () => {
      for (const layout of SECTION_LAYOUTS.gallery) {
        await rerender({ items: pictures(3) }, { layout });
        expect(one('.gallery')?.classList.contains('lp-bleed')).toBe(
          layout === 'strip'
        );
      }
    });
  });

  it('grid: as many to a row as divide the set, and notes when captions need a measure', async () => {
    await render({ items: pictures(4) }, { layout: 'grid' });
    expect(one('ul')?.getAttribute('data-columns')).toBe('2');
    expect(one('ul')?.hasAttribute('data-captioned')).toBe(true);
    await rerender(
      { items: pictures(7).map(({ image }) => ({ image })) },
      { layout: 'grid' }
    );
    expect(one('ul')?.getAttribute('data-columns')).toBe('4');
    expect(one('ul')?.hasAttribute('data-captioned')).toBe(false);
  });

  it('takes the large file only for pictures drawn wider than the medium one', async () => {
    await render({ items: pictures(5) });
    expect(all('img').map((img) => img.getAttribute('src'))).toEqual([
      `${CDN}/landing-pages/p1/images/g1/lg.webp`,
      `${CDN}/landing-pages/p1/images/g2/md.webp`,
      `${CDN}/landing-pages/p1/images/g3/md.webp`,
      `${CDN}/landing-pages/p1/images/g4/lg.webp`,
      `${CDN}/landing-pages/p1/images/g5/lg.webp`,
    ]);
  });

  it.each(
    SECTION_LAYOUTS.gallery
  )('%s without a CDN base: every picture a plate, every caption kept, no URL built', async (layout) => {
    await render({ items: pictures(3) }, { layout, mediaBaseUrl: null });
    expect(one('img')).toBeNull();
    expect(all('.lp-media[data-empty]')).toHaveLength(3);
    expect(all('figcaption')).toHaveLength(2);
  });

  it.each(
    SECTION_LAYOUTS.gallery
  )('%s with no pictures: the page keeps only the words; previews draw plates; the canvas asks', async (layout) => {
    await render({ heading: HEADING }, { layout });
    expect(one('h2')?.textContent).toBe(HEADING);
    expect(one('img')).toBeNull();
    expect(text()).not.toContain(GALLERY_EMPTY);
    // The plates are only ever a picture of the layout: hidden from assistive
    // tech, unreachable, and shown by CSS only on a still page.
    const plates = one('.gallery__plates');
    expect(plates?.getAttribute('aria-hidden')).toBe('true');
    expect(inert(plates)).toBe(true);
    expect(
      plates?.querySelectorAll('.lp-media[data-empty]').length
    ).toBeGreaterThan(2);
    expect(plates?.querySelector('figcaption')).toBeNull();
    await rerender(
      { heading: HEADING },
      { layout, edit: { commit: () => {} } }
    );
    expect(one('[data-lp-edit-only]')?.textContent).toBe(GALLERY_EMPTY);
  });

  it('renders only its own words', async () => {
    await render({});
    expect(one('h2')).toBeNull();
    expect(text()).not.toContain(sampleContext().course.title);
  });

  it('takes its heading level from the section', async () => {
    await render({ heading: HEADING, items: pictures(2) }, { headingLevel: 1 });
    expect(one('h1')?.textContent).toBe(HEADING);
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: HEADING, items: pictures(2) });
    expect(one('[contenteditable]')).toBeNull();
    const edits: [string, string][] = [];
    await rerender(
      { heading: HEADING, items: pictures(2) },
      { edit: { commit: (key, value) => edits.push([key, value]) } }
    );
    const heading = one('h2') as HTMLElement;
    expect(heading.getAttribute('aria-label')).toBe('Gallery — Heading');
    heading.textContent = 'Inside the studio';
    heading.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['heading', 'Inside the studio']]);
    // Pictures and captions are edited in the inspector, never inline.
    expect(one('li [contenteditable]')).toBeNull();
  });

  it('never brings pictures of its own: the starter and the sample point at none', () => {
    const starter = galleryDefinition.starter({ courseTitle: 'Steady Ground' });
    expect(starter.heading).toContain('Steady Ground');
    expect(starter).not.toHaveProperty('items');
    expect(galleryDefinition.sample).not.toHaveProperty('items');
  });
});
