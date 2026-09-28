import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext } from '../../../render/types';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { TESTIMONIALS_COPY } from './copy';
import { TESTIMONIALS_EMPTY, testimonialsDefinition } from './definition';
import { MARQUEE_MIN, marqueeCopies } from './marquee';
import TestimonialsBlock from './TestimonialsBlock.svelte';
import { unwrapQuote, voices } from './voices';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const OWN = {
  quote: 'Twenty minutes, and the day feels less loud.',
  name: 'Tom W.',
  detail: 'Nurse',
};

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'testimonials-1',
    anchor: 'testimonials',
    type: 'testimonials',
    index: 9,
    layout: options.layout ?? 'grid',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(TestimonialsBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: options.context ?? sampleContext(),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
}

const text = () => document.body.textContent ?? '';
/** What a screen reader meets: the moving strip's copies are hidden from it. */
const read = (selector: string) =>
  [...document.body.querySelectorAll(selector)].filter(
    (el) => !el.closest('[aria-hidden="true"]')
  );
const quotes = () => read('blockquote').map((q) => q.textContent?.trim());
const bylines = () =>
  read('figcaption').map((c) =>
    [...c.children].map((part) => part.textContent).join(' / ')
  );
const inert = (el: Element) =>
  Boolean((el as HTMLElement).inert || el.hasAttribute('inert'));

describe('TestimonialsBlock', () => {
  const live = sampleContext().testimonials;

  it.each(
    SECTION_LAYOUTS.testimonials
  )('%s: the course’s testimonials first, then the creator’s — every one of them', async (layout) => {
    await render({ heading: 'What members say', items: [OWN] }, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(
      'What members say'
    );
    expect(quotes()).toEqual([...live.map((t) => t.quote), OWN.quote]);
    expect(bylines()).toEqual([
      ...live.map((t) => `${t.authorName} / ${t.authorContext}`),
      'Tom W. / Nurse',
    ]);
  });

  it('orders the course’s testimonials as the course does', async () => {
    const context = {
      ...sampleContext(),
      testimonials: [
        { ...live[0], sortOrder: 1 },
        { ...live[1], sortOrder: 2 },
        { ...live[2], sortOrder: 0 },
      ],
    };
    await render({}, { context });
    expect(quotes()).toEqual([live[2].quote, live[0].quote, live[1].quote]);
  });

  it('featured: the first quote alone takes the filled panel', async () => {
    await render({ items: [OWN] }, { layout: 'featured' });
    const panel = document.body.querySelector('[data-lp-scheme]');
    // Bold (the default Style) features a base section's card in `contrast`.
    expect(panel?.getAttribute('data-lp-scheme')).toBe('contrast');
    expect(panel?.querySelectorAll('blockquote')).toHaveLength(1);
    expect(panel?.textContent).toContain(live[0].quote);
  });

  it('quote: the first quote is the headline, and the heading steps aside', async () => {
    await render({ heading: 'What members say' }, { layout: 'quote' });
    expect(document.body.querySelector('h2')?.dataset.size).toBe('title');
    expect(
      document.body.querySelector('[data-size="monument"]')?.textContent
    ).toContain(live[0].quote);
    // Never censors: the others follow under it.
    expect(quotes()).toHaveLength(live.length);
  });

  it('draws its own quotation marks, never doubled', () => {
    expect(unwrapQuote('“It changed my mornings.”')).toBe(
      'It changed my mornings.'
    );
    expect(unwrapQuote('"Plain quotes too."')).toBe('Plain quotes too.');
    // Quotes inside the words are the words.
    expect(unwrapQuote('She said "breathe" and "wait"')).toBe(
      'She said "breathe" and "wait"'
    );
  });

  it('skips a quote with no words, and sizes the big layouts by length', () => {
    const entries = voices(
      [
        {
          id: 't',
          quote: '  ',
          authorName: 'A',
          authorContext: null,
          sortOrder: 0,
        },
      ],
      [{ quote: 'Short.' }, { quote: 'x'.repeat(200) }]
    );
    expect(entries.map((e) => e.length)).toEqual(['short', 'long']);
    expect(entries[0].name).toBeUndefined();
  });

  it('shows no ratings and no invented faces', async () => {
    await render({ items: [OWN] }, { layout: 'grid' });
    expect(document.body.querySelector('img')).toBeNull();
    expect(text()).not.toMatch(/★|☆/);
  });

  it.each(
    SECTION_LAYOUTS.testimonials
  )('%s: with no quotes the public page keeps only the words', async (layout) => {
    const context = { ...sampleContext(), testimonials: [] };
    await render({ heading: 'What members say' }, { layout, context });
    expect(document.body.querySelector('blockquote')).toBeNull();
    expect(text()).not.toContain(TESTIMONIALS_EMPTY);
    unmount(app);
    await render(
      { heading: 'What members say' },
      { layout, context, edit: { commit: () => {} } }
    );
    expect(
      document.body.querySelector('[data-lp-edit-only]')?.textContent
    ).toBe(TESTIMONIALS_EMPTY);
  });

  it.each(
    SECTION_LAYOUTS.testimonials
  )('%s: adds a way to join only when the creator writes one', async (layout) => {
    await render({}, { layout });
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render({ ctaLabel: 'Join them' }, { layout });
    expect(document.body.querySelector('a')?.textContent?.trim()).toBe(
      'Join them'
    );
  });

  it('starts from the course and puts no words in anyone’s mouth', () => {
    const starter = testimonialsDefinition.starter({
      courseTitle: 'Steady Ground',
    });
    expect(starter.heading).toContain('Steady Ground');
    expect(starter).not.toHaveProperty('items');
  });

  it('takes its heading level from the section', async () => {
    await render({ heading: 'What members say' }, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe(
      'What members say'
    );
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'What members say' });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render(
      { heading: 'What members say' },
      { edit: { commit: () => {} } }
    );
    expect(document.body.querySelector('h2')?.getAttribute('aria-label')).toBe(
      'Testimonials — Heading'
    );
  });

  describe('marquee', () => {
    const lanes = () => [
      ...document.body.querySelectorAll('.tm-marquee__lane'),
    ];

    it('reads each quote once: every copy on the strip is hidden and unreachable', async () => {
      await render({ items: [OWN] }, { layout: 'marquee' });
      const [first, ...copies] = lanes();
      expect(first.hasAttribute('aria-hidden')).toBe(false);
      expect(inert(first)).toBe(false);
      expect(copies).toHaveLength(marqueeCopies(live.length + 1));
      expect(copies.length).toBeGreaterThan(0);
      for (const copy of copies) {
        expect(copy.getAttribute('aria-hidden')).toBe('true');
        expect(inert(copy)).toBe(true);
        expect(
          [...copy.querySelectorAll('blockquote')].map((q) =>
            q.textContent?.trim()
          )
        ).toEqual(quotes());
      }
    });

    it('has a pause button that says whether it is pressed', async () => {
      await render({ items: [OWN] }, { layout: 'marquee' });
      const button = document.body.querySelector(
        '.tm-marquee__toggle'
      ) as HTMLButtonElement;
      const strip = () => document.body.querySelector('.tm-marquee');
      // Its name starts with the word it shows.
      expect(button.getAttribute('aria-label')).toBe(
        TESTIMONIALS_COPY.pauseLabel
      );
      expect(button.textContent?.trim()).toBe(TESTIMONIALS_COPY.pause);
      expect(
        TESTIMONIALS_COPY.pauseLabel.startsWith(TESTIMONIALS_COPY.pause)
      ).toBe(true);
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(strip()?.hasAttribute('data-paused')).toBe(false);
      button.click();
      flushSync();
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(strip()?.hasAttribute('data-paused')).toBe(true);
      button.click();
      flushSync();
      expect(button.getAttribute('aria-pressed')).toBe('false');
    });

    it('sits still, with no copies and no button, when there are too few quotes to move', async () => {
      const context = {
        ...sampleContext(),
        testimonials: live.slice(0, MARQUEE_MIN - 2),
      };
      await render({ items: [OWN] }, { layout: 'marquee', context });
      expect(quotes()).toHaveLength(MARQUEE_MIN - 1);
      expect(lanes()).toHaveLength(1);
      expect(document.body.querySelector('.tm-marquee__toggle')).toBeNull();
      expect(
        document.body.querySelector('.tm-marquee')?.hasAttribute('data-moving')
      ).toBe(false);
    });

    it('covers the widest window at every count, so no gap opens behind the last card', () => {
      for (let count = MARQUEE_MIN; count <= 12; count++) {
        // A card is at most 22rem with at least 1.5rem after it; the widest
        // window is 240rem.
        expect(marqueeCopies(count) * count * 23.5).toBeGreaterThanOrEqual(240);
      }
      expect(marqueeCopies(MARQUEE_MIN - 1)).toBe(0);
    });

    it('is the only layout that runs to the section edges', async () => {
      for (const layout of SECTION_LAYOUTS.testimonials) {
        await render({ items: [OWN] }, { layout });
        expect(
          document.body.querySelector('.tm')?.classList.contains('lp-bleed')
        ).toBe(layout === 'marquee');
        unmount(app);
        app = null;
      }
    });
  });

  describe('wall', () => {
    it('features the first quote in the filled panel, and sets every other on the wall', async () => {
      await render({ items: [OWN] }, { layout: 'wall' });
      const tiles = [...document.body.querySelectorAll('.tm-wall__tile')];
      expect(tiles).toHaveLength(live.length + 1);
      expect(tiles[0].hasAttribute('data-featured')).toBe(true);
      // Bold (the default Style) features a base section's card in `contrast`.
      expect(tiles[0].getAttribute('data-lp-scheme')).toBe('contrast');
      for (const tile of tiles.slice(1)) {
        expect(tile.hasAttribute('data-featured')).toBe(false);
        expect(tile.hasAttribute('data-lp-scheme')).toBe(false);
      }
    });

    it('sets each quote by its length', async () => {
      await render(
        { items: [{ quote: 'Short.' }, { quote: 'x'.repeat(200) }] },
        {
          layout: 'wall',
          context: { ...sampleContext(), testimonials: [] },
        }
      );
      const voicesOnWall = [...document.body.querySelectorAll('.voice')];
      expect(voicesOnWall.map((v) => v.getAttribute('data-length'))).toEqual([
        'short',
        'long',
      ]);
      expect(voicesOnWall.map((v) => v.hasAttribute('data-featured'))).toEqual([
        true,
        false,
      ]);
    });
  });
});
