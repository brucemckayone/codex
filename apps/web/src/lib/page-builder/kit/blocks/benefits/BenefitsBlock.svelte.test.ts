import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import BenefitsBlock from './BenefitsBlock.svelte';
import { BENEFITS_EMPTY, benefitsDefinition } from './definition';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const SAMPLE = benefitsDefinition.sample;

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    offer?: SampleOfferState;
    edit?: BlockEdit | null;
    mediaBaseUrl?: string;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'benefits-1',
    anchor: 'benefits',
    type: 'benefits',
    index: 5,
    layout: options.layout ?? 'grid',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(BenefitsBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({
        offer: options.offer ?? 'buy',
        mediaBaseUrl: options.mediaBaseUrl,
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

const text = () => document.body.textContent ?? '';
const one = (selector: string) => document.body.querySelector(selector);
const all = (selector: string) => [...document.body.querySelectorAll(selector)];

describe('BenefitsBlock', () => {
  it.each(
    SECTION_LAYOUTS.benefits
  )('%s: shows the heading, the body and every item with its line', async (layout) => {
    await render(
      { ...SAMPLE, body: 'All of it opens on day one.' },
      { layout }
    );
    expect(one('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain('All of it opens on day one.');
    const rows = all('li');
    expect(rows).toHaveLength(SAMPLE.items?.length ?? 0);
    SAMPLE.items?.forEach((item, index) => {
      expect(rows[index].textContent).toContain(item.title);
      if (item.detail) expect(rows[index].textContent).toContain(item.detail);
    });
  });

  it('draws each layout as its own composition', async () => {
    const shapes = new Set<string>();
    for (const layout of SECTION_LAYOUTS.benefits) {
      await rerender(SAMPLE, { layout });
      shapes.add(one('ul')?.className.split(' ')[0] ?? '');
    }
    expect(shapes.size).toBe(SECTION_LAYOUTS.benefits.length);
  });

  it('takes its heading level from the section, and nests tile names under it', async () => {
    await render(SAMPLE, { layout: 'grid', headingLevel: 1 });
    expect(one('h1')?.textContent).toBe(SAMPLE.heading);
    expect(all('h2')).toHaveLength(SAMPLE.items?.length ?? 0);
    await rerender(SAMPLE, { layout: 'grid' });
    expect(one('h2')?.textContent).toBe(SAMPLE.heading);
    expect(all('h3').map((h) => h.textContent)).toEqual(
      SAMPLE.items?.map((item) => item.title)
    );
    // With no section heading the tiles take its level, so no level is skipped.
    await rerender({ items: SAMPLE.items }, { layout: 'grid' });
    expect(all('h3')).toHaveLength(0);
    expect(all('h2')).toHaveLength(SAMPLE.items?.length ?? 0);
  });

  it('shows an item without a line, and counts the tiles for the grid', async () => {
    await render({ items: [{ title: 'Lifetime access' }] }, { layout: 'grid' });
    expect(text()).toContain('Lifetime access');
    expect(one('.benefits__detail')).toBeNull();
    expect(one('ul')?.getAttribute('data-count')).toBe('1');
  });

  it('ticks every item in the checklist, and marks the ticks decorative', async () => {
    await render(SAMPLE, { layout: 'checklist' });
    const marks = all('.benefits-checks__mark');
    expect(marks).toHaveLength(SAMPLE.items?.length ?? 0);
    expect(
      marks.every((mark) => mark.getAttribute('aria-hidden') === 'true')
    ).toBe(true);
  });

  it.each(
    SECTION_LAYOUTS.benefits
  )('%s: with no items, the page leaves the list out and the canvas asks for them', async (layout) => {
    await render({ heading: 'H' }, { layout });
    expect(one('ul')).toBeNull();
    expect(text()).not.toContain(BENEFITS_EMPTY);
    await rerender({ heading: 'H' }, { layout, edit: { commit: () => {} } });
    expect(text()).toContain(BENEFITS_EMPTY);
  });

  it('renders only its own words', async () => {
    await render({});
    expect(one('h2')).toBeNull();
    expect(text()).not.toContain(sampleContext().course.title);
  });

  it('offers a way in only when the creator writes one, in every state', async () => {
    await render(SAMPLE, { layout: 'split' });
    expect(one('a')).toBeNull();
    await rerender(
      { ...SAMPLE, ctaLabel: 'Get all of it', note: 'Pay once.' },
      { layout: 'split' }
    );
    expect(one('a')?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
    expect(one('a')?.textContent?.trim()).toBe('Get all of it');
    expect(text()).toContain('Pay once.');
    await rerender(
      { ...SAMPLE, ctaLabel: 'Get all of it' },
      { offer: 'enrolled' }
    );
    expect(one('a')?.textContent?.trim()).toBe(COPY.cta.continue);
    await rerender(
      { ...SAMPLE, ctaLabel: 'Get all of it' },
      { offer: 'unavailable' }
    );
    expect(text()).toContain(COPY.cta.unavailableTitle);
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ ...SAMPLE, body: 'B' });
    expect(one('[contenteditable]')).toBeNull();

    const edits: [string, string][] = [];
    await rerender(
      { ...SAMPLE, body: 'B' },
      { edit: { commit: (key, value) => edits.push([key, value]) } }
    );
    const heading = one('h2') as HTMLElement;
    expect(heading.getAttribute('aria-label')).toBe(
      "What's included — Heading"
    );
    heading.textContent = 'All of it';
    heading.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['heading', 'All of it']]);
    expect(one('[data-field="body"]')).not.toBeNull();
    // Items are edited in the inspector, never inline.
    expect(one('li [contenteditable]')).toBeNull();
  });

  it('starts a new section from the course title, with a few real items', () => {
    const starter = benefitsDefinition.starter({
      courseTitle: 'Steady Ground',
    });
    expect(starter.heading).toContain('Steady Ground');
    expect(starter.items?.length).toBeGreaterThanOrEqual(2);
    expect(starter.items?.length).toBeLessThanOrEqual(4);
    expect(benefitsDefinition.coerce(starter)).toEqual(starter);
  });

  describe('tile images (contract A5)', () => {
    const CDN = 'https://cdn.test';
    const image = {
      key: 'landing-pages/p1/images/b1',
      alt: 'The printed journal',
    };
    const [first, second, ...rest] = SAMPLE.items ?? [];
    const mixed = { ...SAMPLE, items: [{ ...first, image }, second, ...rest] };

    it('grid: pictures a tile, and gives every other tile the same frame', async () => {
      await render(mixed, { mediaBaseUrl: CDN });
      const tiles = [...document.body.querySelectorAll('.benefits-grid li')];
      expect(tiles).toHaveLength(mixed.items.length);
      const img = tiles[0].querySelector('img');
      expect(img?.getAttribute('src')).toBe(`${CDN}/${image.key}/md.webp`);
      expect(img?.getAttribute('alt')).toBe(image.alt);
      for (const tile of tiles.slice(1)) {
        expect(tile.querySelector('.lp-media[data-empty]')).not.toBeNull();
        expect(tile.querySelector('img')).toBeNull();
      }
    });

    it.each([
      'checklist',
      'split',
    ])('%s ignores tile images', async (layout) => {
      await render(mixed, { layout, mediaBaseUrl: CDN });
      expect(document.body.querySelector('.lp-media, img')).toBeNull();
      expect(document.body.textContent).toContain(first.title);
    });

    it('grid without a CDN base draws the tiles exactly as without images', async () => {
      await render(mixed);
      expect(document.body.querySelector('.lp-media, img')).toBeNull();
      expect(
        document.body
          .querySelector('.benefits-grid')
          ?.hasAttribute('data-pictured')
      ).toBe(false);
    });

    it('reads a tile image and drops a malformed one', () => {
      const read = benefitsDefinition.coerce({
        items: [
          { title: 'A', image },
          { title: 'B', image: { key: '' } },
          { title: 'C', image: 'landing-pages/p1/images/x' },
        ],
      });
      expect(read.items).toEqual([
        { title: 'A', image },
        { title: 'B' },
        { title: 'C' },
      ]);
    });

    it('bento: every tile shows its own picture, the lead on the large file, drifting on a wrapper of its own', async () => {
      const both = {
        ...SAMPLE,
        items: [
          { ...first, image },
          { ...second, image: { key: 'landing-pages/p1/images/b2' } },
          ...rest,
        ],
      };
      await render(both, { layout: 'bento', mediaBaseUrl: CDN });
      const tiles = [
        ...document.body.querySelectorAll('.benefits-bento__tile'),
      ];
      expect(tiles[0].querySelector('img')?.getAttribute('src')).toBe(
        `${CDN}/${image.key}/lg.webp`
      );
      expect(tiles[0].querySelector('img')?.getAttribute('alt')).toBe(
        image.alt
      );
      expect(tiles[1].querySelector('img')?.getAttribute('src')).toBe(
        `${CDN}/landing-pages/p1/images/b2/md.webp`
      );
      // A tile without a picture keeps to its words: no empty frame.
      for (const tile of tiles.slice(2)) {
        expect(tile.querySelector('.lp-media')).toBeNull();
        expect(tile.hasAttribute('data-pictured')).toBe(false);
      }
      const drifting = [
        ...document.body.querySelectorAll('[data-lp-parallax]'),
      ];
      expect(drifting).toHaveLength(1);
      expect(drifting[0].closest('li')).toBe(tiles[0]);
      expect(drifting[0].matches('.lp-media, li')).toBe(false);
    });

    it('offers the tile image in the grid and the bento only', () => {
      const field = benefitsDefinition.fields
        .find((f) => f.key === 'items')
        ?.itemFields?.find((f) => f.key === 'image');
      expect(field?.layouts).toEqual(['grid', 'bento']);
    });
  });

  describe('bento', () => {
    it('gives the first item the largest tile and the section’s one filled card', async () => {
      await render(SAMPLE, { layout: 'bento' });
      const tiles = [
        ...document.body.querySelectorAll('.benefits-bento__tile'),
      ];
      expect(tiles.map((t) => t.getAttribute('data-tile'))).toEqual([
        'lead',
        'side',
        'half',
        'half',
      ]);
      // Bold (the default Style) features a base section's card in `contrast`.
      expect(tiles[0].getAttribute('data-lp-scheme')).toBe('contrast');
      expect(tiles[0].hasAttribute('data-lead')).toBe(true);
      for (const tile of tiles.slice(1)) {
        expect(tile.hasAttribute('data-lp-scheme')).toBe(false);
      }
    });

    it('nests each tile’s name under the section heading', async () => {
      await render(SAMPLE, { layout: 'bento' });
      expect(one('h2')?.textContent).toBe(SAMPLE.heading);
      expect(all('h3').map((h) => h.textContent)).toEqual(
        SAMPLE.items?.map((item) => item.title)
      );
    });

    it('draws one item as a whole tile', async () => {
      await render(
        { items: [{ title: 'Lifetime access' }] },
        { layout: 'bento' }
      );
      expect(one('.benefits-bento__tile')?.getAttribute('data-tile')).toBe(
        'whole'
      );
    });
  });
});

describe('a mark for each item (Codex-61zsk.58)', () => {
  const ITEMS = [
    { title: 'Live circles', detail: 'Every Sunday.', mark: 'heart' },
    { title: 'Audio', detail: 'For the walk.' },
  ];
  /** The drawn shape inside an element: its svg's markup. */
  const shape = (el: Element | null | undefined) =>
    el?.querySelector('svg')?.innerHTML ?? null;

  it('reads only a mark the kit can draw', () => {
    const content = benefitsDefinition.coerce({
      items: [
        { title: 'One', mark: 'heart' },
        { title: 'Two', mark: 'unicorn' },
        { title: 'Three', mark: 7 },
      ],
    });
    expect(content.items?.map((item) => item.mark)).toEqual([
      'heart',
      undefined,
      undefined,
    ]);
  });

  it('checklist: the chosen mark takes the tick’s place, and the tick is the default', async () => {
    await render({ items: ITEMS }, { layout: 'checklist' });
    const [marked, plain] = all('.benefits-checks__mark');
    const tick = shape(plain);
    expect(tick).not.toBeNull();
    expect(shape(marked)).not.toBe(tick);
    expect(all('.benefits-checks__mark svg')).toHaveLength(2);

    await rerender(
      { items: [{ ...ITEMS[0], mark: 'check' }, ITEMS[1]] },
      { layout: 'checklist' }
    );
    const [chosenTick, defaultTick] = all('.benefits-checks__mark');
    expect(shape(chosenTick)).toBe(shape(defaultTick));
  });

  it.each([
    ['grid', '.benefits__mark'],
    ['split', '.benefits__mark'],
    ['bento', '.benefits-bento__mark'],
  ] as const)('%s: the mark sits above its own item’s name, and only there', async (layout, mark) => {
    await render({ items: ITEMS }, { layout });
    const marks = all(mark);
    expect(marks).toHaveLength(1);
    const item = marks[0]?.closest('li');
    expect(item?.textContent).toContain('Live circles');
    const name = [
      ...(item?.querySelectorAll('.lp-heading, .benefits-rows__name') ?? []),
    ][0];
    expect(name).toBeDefined();
    // Before the name in the item's reading order.
    expect(marks[0]?.compareDocumentPosition(name as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    // Decoration: the name is what reads.
    expect(marks[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('bento: its mixed tiles’ first tile leads, in no other layout', () => {
    const lead = benefitsDefinition.leadingItem;
    const raw = {
      items: [{ title: '' }, { title: 'First kept' }, { title: 'Third' }],
    };
    for (const layout of SECTION_LAYOUTS.benefits)
      expect(lead?.(raw, layout, sampleContext()), layout).toBe(
        layout === 'bento' ? 1 : null
      );
  });
});

describe('BenefitsBlock: every size a tile picture has (Codex-61zsk.66)', () => {
  const CDN = 'https://cdn.test';
  const image = {
    key: 'landing-pages/p1/images/b1',
    alt: 'The printed journal',
  };
  const SET = ['sm.webp 200w', 'md.webp 400w', 'lg.webp 800w']
    .map((size) => `${CDN}/${image.key}/${size}`)
    .join(', ');
  const [first, ...rest] = SAMPLE.items ?? [];
  const three = {
    ...SAMPLE,
    items: [{ ...first, image }, ...rest].slice(0, 3),
  };

  it('grid: a card is a third of the column from 60rem, a half from 36rem', async () => {
    await render(three, { mediaBaseUrl: CDN });
    const img = document.body.querySelector('.benefits-grid li img');
    expect(img?.getAttribute('srcset')).toBe(SET);
    expect(img?.getAttribute('sizes')).toBe(
      '(min-width: 60rem) min(33.33vw, 27.33rem), (min-width: 36rem) min(50vw, 41rem), min(100vw, 82rem)'
    );
  });

  it('bento: the lead tile is drawn at its span', async () => {
    await render(three, { layout: 'bento', mediaBaseUrl: CDN });
    const img = document.body.querySelector('img');
    expect(img?.getAttribute('srcset')).toBe(SET);
    // The lead tile: four of six columns from 56rem, both of two from 36rem.
    expect(img?.getAttribute('sizes')).toBe(
      '(min-width: 56rem) min(66.67vw, 54.67rem), (min-width: 36rem) min(100vw, 82rem), min(100vw, 82rem)'
    );
  });
});
