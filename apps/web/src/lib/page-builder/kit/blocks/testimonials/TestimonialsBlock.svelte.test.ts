import { tick } from 'svelte';
import { parse } from 'svelte/compiler';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import MARQUEE_SOURCE from './TestimonialsMarquee.svelte?raw';
import WALL_SOURCE from './TestimonialsWall.svelte?raw';
import VOICE_SOURCE from './Voice.svelte?raw';
import { unwrapQuote, voices } from './voices';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
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

/**
 * A component's stylesheet as declarations, read with svelte's own CSS parser
 * (as `styles/motion.test.ts` reads the kit): comments are not rules, so a
 * commented-out rule cannot pass.
 */
function declarationsOf(source: string) {
  type Node = {
    type: string;
    name?: string;
    prelude?: string | { children: { start: number; end: number }[] };
    property?: string;
    value?: string;
    block?: { children: Node[] } | null;
  };
  const declared: {
    property: string;
    value: string;
    selectors: string[];
    conditions: string[];
  }[] = [];
  const walk = (nodes: Node[], conditions: string[]) => {
    for (const node of nodes) {
      if (node.type === 'Atrule' && node.name !== 'keyframes') {
        walk(node.block?.children ?? [], [
          ...conditions,
          `@${node.name} ${node.prelude}`,
        ]);
      } else if (
        node.type === 'Rule' &&
        typeof node.prelude === 'object' &&
        node.prelude
      ) {
        const selectors = node.prelude.children.map((part) =>
          source.slice(part.start, part.end).replace(/\s+/g, ' ').trim()
        );
        for (const child of node.block?.children ?? [])
          if (child.type === 'Declaration')
            declared.push({
              property: child.property ?? '',
              value: (child.value ?? '').trim(),
              selectors,
              conditions,
            });
      }
    }
  };
  walk(
    (parse(source, { modern: true }).css?.children ?? []) as unknown as Node[],
    []
  );
  return declared;
}

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
      // A real button, so Enter and Space work it with no script of its own.
      expect(button.tagName).toBe('BUTTON');
      expect(button.type).toBe('button');
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

    // Reduced motion has no script path: the component renders one strip, and
    // its stylesheet decides whether it moves, so the server's HTML and the
    // page never disagree.
    it('renders the same strip whatever the motion preference', async () => {
      await render({ items: [OWN] }, { layout: 'marquee' });
      const welcome = document.body.innerHTML;
      unmount(app);
      app = null;
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));
      await render({ items: [OWN] }, { layout: 'marquee' });
      expect(document.body.innerHTML).toBe(welcome);
    });

    /**
     * The stylesheet's half of the contract. `motion.test.ts` already proves
     * the strip never animates under reduced motion or when still.
     */
    const marqueeCss = () => declarationsOf(MARQUEE_SOURCE);

    const MOVING =
      /^@media screen and \(prefers-reduced-motion: no-preference\)$/;
    const LIVE = /:root\[data-theme\] \.lp:not\(\[data-lp-still\]\)/;

    it('stops the strip when paused, and while a pointer rests on it or focus is inside', () => {
      const held = marqueeCss().filter(
        (d) => d.property === 'animation-play-state' && d.value === 'paused'
      );
      expect(held).toHaveLength(1);
      const [rule] = held;
      expect(rule.conditions.some((c) => MOVING.test(c))).toBe(true);
      for (const selector of rule.selectors) {
        expect(selector).toMatch(LIVE);
        expect(selector).toMatch(
          /\.tm-marquee\[data-moving\]:is\(:hover, :focus-within, \[data-paused\]\) \.tm-marquee__lane$/
        );
      }
    });

    it('draws no control and no copy wherever it does not move', () => {
      const css = marqueeCss();
      const display = (selector: string, where: 'still' | 'moving') =>
        css
          .filter(
            (d) =>
              d.property === 'display' &&
              d.selectors.some((s) => s.endsWith(selector)) &&
              (where === 'still'
                ? d.conditions.length === 0
                : d.conditions.some((c) => MOVING.test(c)))
          )
          .map((d) => ({ value: d.value, selectors: d.selectors }));
      // Reduced motion, a still page, print and no script: the final state.
      expect(
        display('.tm-marquee__controls', 'still').map((d) => d.value)
      ).toEqual(['none']);
      expect(
        display('.tm-marquee__lane[data-copy]', 'still').map((d) => d.value)
      ).toEqual(['none']);
      // The control appears only on a live strip that moves.
      const shown = display('.tm-marquee__controls', 'moving');
      expect(shown.map((d) => d.value)).toEqual(['flex']);
      for (const selector of shown[0].selectors) {
        expect(selector).toMatch(LIVE);
        expect(selector).toContain('.tm-marquee[data-moving]');
      }
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

  /**
   * Voice hangs a quote's opening mark outside its words by a share of the
   * quote's own size (`text-indent`), and sets that size case by case. A card
   * cannot read its child's font-size, so the wall and the strip restate each
   * case to make the mark's room — on the voice, so the words and the name
   * keep one edge whatever padding a Style gives the card. Every restated
   * case is pinned to Voice's own here: a size or hang Voice changes fails
   * this, rather than silently pushing the mark out over the card's edge.
   */
  describe('the opening mark', () => {
    /** Voice's quote size and hang per modifier of `.voice`, for one size. */
    const quoteCases = (size: 'wall' | 'grid') => {
      const cases = new Map<string, { size?: string; hang?: string }>();
      const own = new RegExp(`^\\.voice\\[data-size='${size}'\\](.*) p$`);
      for (const d of declarationsOf(VOICE_SOURCE)) {
        for (const selector of d.selectors) {
          const modifier =
            selector === '.voice__quote p'
              ? ''
              : (selector.match(own)?.[1] ?? null);
          if (modifier === null) continue;
          const entry = cases.get(modifier) ?? {};
          if (d.property === 'font-size') entry.size = d.value;
          if (d.property === 'text-indent')
            entry.hang = d.value.replace(/^-/, '').replace(/em$/, '');
          cases.set(modifier, entry);
        }
      }
      return cases;
    };

    /** The room a card makes per modifier of the `.voice` it holds. */
    const roomCases = (source: string, card: string) => {
      const cases = new Map<
        string,
        { size?: string; hang?: string; room?: string }
      >();
      const prefix = `${card} > :global(.voice`;
      for (const d of declarationsOf(source)) {
        for (const selector of d.selectors) {
          if (!selector.startsWith(prefix) || !selector.endsWith(')')) continue;
          const modifier = selector.slice(prefix.length, -1);
          const entry = cases.get(modifier) ?? {};
          if (d.property === '--_quote') entry.size = d.value;
          if (d.property === '--_hang') entry.hang = d.value;
          if (d.property === 'padding-inline-start') entry.room = d.value;
          cases.set(modifier, entry);
        }
      }
      return cases;
    };

    it.each([
      ['wall', WALL_SOURCE, '.tm-wall__tile', 'wall'],
      ['marquee', MARQUEE_SOURCE, '.tm-marquee__card', 'grid'],
    ] as const)('%s: makes the room each quote size hangs its mark into', (_, source, card, size) => {
      const voice = quoteCases(size);
      const room = roomCases(source, card);
      expect(voice.get('')).toEqual({
        size: 'var(--lp-size-lead)',
        hang: '0.4',
      });
      expect(room.get('')?.room).toBe('calc(var(--_quote) * var(--_hang))');
      for (const [modifier, own] of voice) {
        const made = room.get(modifier);
        if (own.size) expect(made?.size, `.voice${modifier}`).toBe(own.size);
        if (own.hang) expect(made?.hang, `.voice${modifier}`).toBe(own.hang);
      }
      // …and restates no case Voice does not have.
      for (const modifier of room.keys())
        expect(voice.has(modifier), `.voice${modifier}`).toBe(true);
    });
  });
});
