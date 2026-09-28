import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from 'svelte';
import { parse } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext, SellPreview } from '../../../render/types';
import { COPY } from '../../model/copy';
import { type ColourSchemeId, SECTION_LAYOUTS } from '../../model/ids';
import { isLongHeading } from '../../model/long-heading';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import HeroBlock from './HeroBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

function section(
  layout: string,
  headingLevel: 1 | 2 = 1,
  scheme: ColourSchemeId = 'brand'
): ResolvedSection {
  return {
    id: 'hero-1',
    anchor: 'hero',
    type: 'hero',
    index: 0,
    layout,
    scheme,
    spacing: 'regular',
    headingLevel,
  };
}

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    scheme?: ColourSchemeId;
    offer?: SampleOfferState;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  app = mount(HeroBlock, {
    target: document.body,
    props: {
      props,
      section: section(
        options.layout ?? 'statement',
        options.headingLevel,
        options.scheme
      ),
      context:
        options.context ??
        sampleContext({
          offer: options.offer ?? 'buy',
          media: { heroImageUrl: '/hero.jpg' },
        }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  // Let the streamed sell-preview resolve.
  await tick();
  await Promise.resolve();
  flushSync();
}

const links = () => [...document.body.querySelectorAll('a')];

describe('HeroBlock', () => {
  it.each(
    SECTION_LAYOUTS.hero
  )('renders the %s layout with one h1 and its call to action', async (layout) => {
    await render(
      { heading: 'Find your steady ground', body: 'Six calm weeks.' },
      { layout }
    );
    const h1s = document.body.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Find your steady ground');
    expect(document.body.textContent).toContain('Six calm weeks.');
    expect(
      links().some(
        (a) => a.getAttribute('href') === '/journeys/steady-ground/checkout'
      )
    ).toBe(true);
  });

  it('draws a duplicate hero at h2, never a second h1', async () => {
    await render({ heading: 'Again' }, { headingLevel: 2 });
    expect(document.body.querySelector('h1')).toBeNull();
    expect(document.body.querySelector('h2')?.textContent).toBe('Again');
  });

  it('falls back to the course title — and borrows nothing else', async () => {
    await render({});
    const context = sampleContext();
    expect(document.body.querySelector('h1')?.textContent).toBe(
      context.course.title
    );
    // The course HAS a lede; an empty hero body must not show it.
    expect(document.body.textContent).not.toContain(
      String(context.course.lede)
    );
  });

  it('uses the creator label to buy', async () => {
    await render({
      heading: 'H',
      ctaLabel: 'Start the course',
      note: 'Start any time.',
    });
    const buy = links().find(
      (a) => a.textContent?.trim() === 'Start the course'
    );
    expect(buy?.getAttribute('href')).toBe('/journeys/steady-ground/checkout');
    expect(document.body.textContent).toContain('Start any time.');
  });

  it('says "Continue" to a member and drops the sales small print', async () => {
    await render(
      { heading: 'H', ctaLabel: 'Buy', note: 'Start any time.' },
      { offer: 'enrolled' }
    );
    const next = links().find(
      (a) => a.textContent?.trim() === COPY.cta.continue
    );
    expect(next?.getAttribute('href')).toBe(
      '/journeys/steady-ground/dashboard'
    );
    expect(document.body.textContent).not.toContain('Buy');
    expect(document.body.textContent).not.toContain('Start any time.');
  });

  it('says so when enrolment is closed, with no checkout link', async () => {
    await render({ heading: 'H', ctaLabel: 'Buy' }, { offer: 'unavailable' });
    expect(document.body.textContent).toContain(COPY.cta.unavailableTitle);
    expect(
      links().some((a) => a.getAttribute('href')?.includes('checkout'))
    ).toBe(false);
  });

  it('shows the hero image once the streamed media arrives, and none when asked not to', async () => {
    await render({ heading: 'H' }, { layout: 'split' });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      '/hero.jpg'
    );
    unmount(app);
    await render({ heading: 'H', media: 'none' }, { layout: 'split' });
    expect(document.body.querySelector('img')).toBeNull();
  });

  it.each(
    SECTION_LAYOUTS.hero
  )('%s: an uploaded still is on first paint, before the streamed preview settles', async (layout) => {
    const context = {
      ...sampleContext({ course: { heroImageUrl: '/uploaded.jpg' } }),
      // A preview that never settles — only the synchronous still can paint.
      sellPreview: new Promise<never>(() => {}),
    };
    await render({ heading: 'H' }, { layout, context });
    expect(document.body.querySelector('img')?.getAttribute('src')).toBe(
      '/uploaded.jpg'
    );
  });

  describe('the creator image (contract A5)', () => {
    const CDN = 'https://cdn.test';
    const image = { key: 'landing-pages/p1/images/i1', alt: 'A lake at dawn' };
    const url = `${CDN}/${image.key}/lg.webp`;

    it.each(
      SECTION_LAYOUTS.hero
    )('%s: replaces the course still on first paint, with its description', async (layout) => {
      const context = {
        ...sampleContext({
          course: { heroImageUrl: '/uploaded.jpg' },
          mediaBaseUrl: CDN,
        }),
        sellPreview: new Promise<never>(() => {}),
      };
      await render({ heading: 'H', image }, { layout, context });
      const img = document.body.querySelector('img');
      expect(img?.getAttribute('src')).toBe(url);
      expect(img?.getAttribute('alt')).toBe(image.alt);
    });

    it('wins over the streamed still too, and is decorative when undescribed', async () => {
      await render(
        { heading: 'H', image: { key: image.key } },
        {
          layout: 'split',
          context: sampleContext({
            media: { heroImageUrl: '/hero.jpg' },
            mediaBaseUrl: CDN,
          }),
        }
      );
      const img = document.body.querySelector('img');
      expect(img?.getAttribute('src')).toBe(url);
      expect(img?.getAttribute('alt')).toBe('');
    });

    it('leaves a chosen clip playing, and shows nothing when asked for no image', async () => {
      const context = sampleContext({
        media: { heroClip: { playlistUrl: '/clip.m3u8' } },
        mediaBaseUrl: CDN,
      });
      await render(
        { heading: 'H', image, media: 'video' },
        { layout: 'split', context }
      );
      expect(document.body.textContent).toContain(COPY.hero.watch);
      unmount(app);
      await render(
        { heading: 'H', image, media: 'none' },
        { layout: 'split', context }
      );
      expect(document.body.querySelector('img, video')).toBeNull();
    });

    it('without a CDN base, keeps the course still and builds no broken URL', async () => {
      await render(
        { heading: 'H', image },
        {
          layout: 'split',
          context: sampleContext({ media: { heroImageUrl: '/hero.jpg' } }),
        }
      );
      const srcs = [...document.body.querySelectorAll('img')].map((img) =>
        img.getAttribute('src')
      );
      expect(srcs).toEqual(['/hero.jpg']);
    });
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'Find your steady ground' });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);

    const edits: [string, string][] = [];
    await render(
      { heading: 'Find your steady ground' },
      { edit: { commit: (key, value) => edits.push([key, value]) } }
    );
    const h1 = document.body.querySelector('h1');
    expect(h1?.getAttribute('contenteditable')).toBe('true');
    expect(h1?.getAttribute('aria-label')).toBe('Hero — Headline');
    h1!.textContent = 'New headline';
    h1!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['heading', 'New headline']]);
  });

  describe('a long headline (Codex-61zsk.23)', () => {
    const LONG =
      'Twenty quiet minutes every morning, for six weeks, until calm is simply how you begin';
    const headline = () => document.body.querySelector('.hero__headline');
    // The element each layout sets its display scale on: a Style steps a long
    // headline down with `<parent>:has(> .hero__headline[data-long])`, so the
    // poster's picture — which drops by one headline line — steps with it.
    const PARENT: Record<string, string> = {
      statement: 'hero-statement',
      split: 'hero-split__copy',
      cover: 'hero-cover__copy',
      centered: 'hero-centered',
      poster: 'hero-poster',
    };

    it.each(
      SECTION_LAYOUTS.hero
    )('%s: marks a long headline for its Style to step down, and never a short one', async (layout) => {
      await render({ heading: LONG }, { layout });
      expect(headline()?.hasAttribute('data-long')).toBe(true);
      expect(
        headline()?.parentElement?.classList.contains(PARENT[layout])
      ).toBe(true);
      unmount(app);
      await render({ heading: 'Find your steady ground' }, { layout });
      expect(headline()?.hasAttribute('data-long')).toBe(false);
    });

    it('draws the line where the problem statement does, on the headline it draws', async () => {
      for (const heading of ['x'.repeat(64), 'x'.repeat(65)]) {
        await render({ heading });
        expect(headline()?.hasAttribute('data-long')).toBe(
          isLongHeading(heading)
        );
        unmount(app);
      }
      // Left empty, the headline is the course title, and that is measured.
      await render({}, { context: sampleContext({ course: { title: LONG } }) });
      expect(document.body.querySelector('h1')?.textContent).toBe(LONG);
      expect(headline()?.hasAttribute('data-long')).toBe(true);
    });
  });

  describe('the split buttons in a narrow column (Codex-61zsk.24)', () => {
    type Node = {
      type: string;
      name?: string;
      prelude?: string | { start: number; end: number };
      property?: string;
      value?: string;
      block?: { children: Node[] } | null;
    };
    const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

    /** Each rule of HeroBlock's <style>, with the container query it sits in. */
    function rules() {
      const source = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'HeroBlock.svelte'),
        'utf8'
      );
      const found: {
        query: string;
        selector: string;
        decls: Record<string, string>;
      }[] = [];
      const visit = (nodes: Node[], query: string) => {
        for (const node of nodes) {
          if (node.type === 'Atrule')
            visit(
              node.block?.children ?? [],
              node.name === 'container' ? squash(String(node.prelude)) : query
            );
          else if (node.type === 'Rule' && typeof node.prelude === 'object') {
            const decls: Record<string, string> = {};
            for (const d of node.block?.children ?? [])
              if (d.type === 'Declaration')
                decls[d.property ?? ''] = squash(d.value ?? '');
            found.push({
              query,
              selector: squash(
                source.slice(node.prelude.start, node.prelude.end)
              ),
              decls,
            });
          }
        }
      };
      visit(
        (parse(source, { modern: true }).css?.children ?? []) as Node[],
        ''
      );
      return found;
    }

    it('sets its buttons where the rule reaches them: in the words column, each with its variant', async () => {
      await render(
        {
          heading: 'H',
          secondaryLabel: 'See what is inside',
          secondaryHref: '#curriculum',
        },
        { layout: 'split' }
      );
      const row = document.body.querySelector(
        '.hero-split__copy .lp-actions__row'
      );
      expect(
        [...(row?.children ?? [])].map((b) => [
          b.classList.contains('lp-button'),
          b.getAttribute('data-variant'),
        ])
      ).toEqual([
        [true, 'primary'],
        [true, 'secondary'],
      ]);
    });

    it('keeps the phone rule from the width the layout splits at: share the row or take full rows, a link keeps its width', () => {
      const all = rules();
      const split = all.find(
        (r) => r.selector === '.hero-split' && r.decls['grid-template-columns']
      );
      const row = all.find(
        (r) => r.selector === '.hero-split__copy :global(.lp-actions__row)'
      );
      const range = row?.query.match(
        /^\((\d+(?:\.\d+)?)rem <= width < (\d+(?:\.\d+)?)rem\)$/
      );
      expect(split?.query).toMatch(/^\(min-width: \d+(?:\.\d+)?rem\)$/);
      expect(range, `no narrow-column rule: ${row?.query}`).not.toBeNull();
      // It starts where the words get a column of their own, and ends later.
      expect(`(min-width: ${range![1]}rem)`).toBe(split!.query);
      expect(Number(range![2])).toBeGreaterThan(Number(range![1]));
      const inRange = (selector: string) =>
        all.find((r) => r.query === row!.query && r.selector === selector)
          ?.decls;
      expect(row?.decls['justify-self']).toBe('stretch');
      expect(
        inRange('.hero-split__copy :global(.lp-actions__row > .lp-button)')
          ?.flex
      ).toBe('1 1 auto');
      expect(
        inRange(
          ".hero-split__copy :global(.lp-actions__row > .lp-button[data-variant='quiet']), :global(.lp[data-lp-style='bold']) .hero-split__copy :global(.lp-actions__row > .lp-button[data-variant='secondary'])"
        )?.flex
      ).toBe('0 0 auto');
    });
  });

  /** A preview the test settles by hand. */
  function deferred() {
    let settle: (value: SellPreview | null) => void = () => {};
    const promise = new Promise<SellPreview | null>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  const noMedia = () => ({
    ...sampleContext({ course: { heroImageUrl: null } }),
    sellPreview: Promise.resolve(null),
  });

  describe('cover on a Moving background (03 §5.1, X10)', () => {
    it('with nothing to show, leaves the band to the section: no paint, no glow, no media colours', async () => {
      await render(
        { heading: 'H' },
        { layout: 'cover', scheme: 'atmosphere', context: noMedia() }
      );
      expect(document.body.querySelector('h1')?.textContent).toBe('H');
      expect(document.body.querySelector('.lp-bleed')).toBeNull();
      expect(document.body.querySelector('[data-lp-on-media]')).toBeNull();
      expect(document.body.querySelector('.lp-atmos')).toBeNull();
    });

    it('with an image, bleeds only the image; the words keep the column on the media colours', async () => {
      await render({ heading: 'H' }, { layout: 'cover', scheme: 'atmosphere' });
      const bleeding = [...document.body.querySelectorAll('.lp-bleed')];
      expect(bleeding).toHaveLength(1);
      expect(bleeding[0].classList.contains('hero-cover__media')).toBe(true);
      expect(bleeding[0].querySelector('img')?.getAttribute('src')).toBe(
        '/hero.jpg'
      );
      expect(bleeding[0].querySelector('h1')).toBeNull();
      const copy = document.body.querySelector('.hero-cover__copy');
      expect(copy?.hasAttribute('data-lp-on-media')).toBe(true);
      expect(copy?.querySelector('h1')).not.toBeNull();
    });

    it('on any other colour, draws its own glow when it has no image', async () => {
      await render({ heading: 'H' }, { layout: 'cover', context: noMedia() });
      const media = document.body.querySelector('.hero-cover__media');
      expect(media?.classList.contains('lp-bleed')).toBe(true);
      expect(media?.querySelector('.lp-atmos')).not.toBeNull();
      expect(
        document.body
          .querySelector('.hero-cover__copy')
          ?.hasAttribute('data-lp-on-media')
      ).toBe(true);
    });

    it('keeps the same headline when the streamed clip arrives, and adds the play button', async () => {
      const { promise, settle } = deferred();
      await render(
        { heading: 'H' },
        {
          layout: 'cover',
          scheme: 'atmosphere',
          context: {
            ...sampleContext({ course: { heroImageUrl: null } }),
            sellPreview: promise,
          },
        }
      );
      const before = document.body.querySelector('h1');
      expect(document.body.querySelector('[data-lp-on-media]')).toBeNull();
      settle({
        intro: null,
        reel: null,
        heroImageUrl: null,
        heroClip: { playlistUrl: '/clip.m3u8' },
        guidePortraitUrl: null,
      });
      await tick();
      await Promise.resolve();
      flushSync();
      expect(document.body.querySelector('h1')).toBe(before);
      expect(document.body.textContent).toContain(COPY.hero.watch);
      expect(
        document.body
          .querySelector('.hero-cover__copy')
          ?.hasAttribute('data-lp-on-media')
      ).toBe(true);
    });
  });

  describe('poster', () => {
    it('sets the words round the picture, which paints first and never bleeds the words', async () => {
      await render({ heading: 'H', body: 'B' }, { layout: 'poster' });
      const poster = document.body.querySelector('.hero-poster');
      expect(poster?.hasAttribute('data-pictured')).toBe(true);
      // The picture comes first, so the words can wrap round it.
      expect(
        poster?.firstElementChild?.classList.contains('hero-poster__media')
      ).toBe(true);
      const img = poster?.querySelector('img');
      expect(img?.getAttribute('src')).toBe('/hero.jpg');
      expect(img?.getAttribute('loading')).toBe('eager');
      expect(img?.getAttribute('fetchpriority')).toBe('high');
      expect(document.body.querySelector('.lp-bleed')).toBeNull();
    });

    it('takes the hero entrance and its reveal on two boxes, never one', async () => {
      await render({ heading: 'H' }, { layout: 'poster' });
      const outer = document.body.querySelector('.hero-poster__media');
      const inner = document.body.querySelector('[data-lp-reveal]');
      expect(outer?.classList.contains('hero__enter-m')).toBe(true);
      expect(outer?.hasAttribute('data-lp-reveal')).toBe(false);
      expect(inner?.getAttribute('data-lp-reveal')).toBe('wipe');
      expect(inner?.parentElement).toBe(outer);
      expect(inner?.classList.contains('hero__enter-m')).toBe(false);
    });

    it('is a type-only poster when the creator chooses No image', async () => {
      await render({ heading: 'H', media: 'none' }, { layout: 'poster' });
      const poster = document.body.querySelector('.hero-poster');
      expect(poster?.hasAttribute('data-pictured')).toBe(false);
      expect(poster?.querySelector('.hero-poster__media, img')).toBeNull();
      expect(poster?.querySelector('h1')?.textContent).toBe('H');
    });

    it('with no still known as it draws, holds the picture’s place, and the streamed clip lands in it', async () => {
      const { promise, settle } = deferred();
      await render(
        { heading: 'H' },
        {
          layout: 'poster',
          context: {
            ...sampleContext({ course: { heroImageUrl: null } }),
            sellPreview: promise,
          },
        }
      );
      const poster = document.body.querySelector('.hero-poster');
      // Before the stream settles: already set round the picture, the plate
      // in its place (the server's HTML is this).
      expect(poster?.hasAttribute('data-pictured')).toBe(true);
      const box = poster?.querySelector('.hero-poster__media');
      const headline = poster?.querySelector('h1');
      expect(box?.querySelector('.lp-media__plate')).not.toBeNull();
      settle({
        intro: null,
        reel: null,
        heroImageUrl: null,
        heroClip: { playlistUrl: '/clip.m3u8' },
        guidePortraitUrl: null,
      });
      await tick();
      await Promise.resolve();
      flushSync();
      // The clip lands in that same box; the words were never re-set.
      expect(poster?.querySelector('.hero-poster__media')).toBe(box);
      expect(poster?.querySelector('h1')).toBe(headline);
      expect(box?.querySelector('.lp-media__plate')).toBeNull();
      expect(box?.textContent).toContain(COPY.hero.watch);
    });

    it('settled with no media at all, keeps that arrangement with the plate as its picture', async () => {
      await render({ heading: 'H' }, { layout: 'poster', context: noMedia() });
      const poster = document.body.querySelector('.hero-poster');
      expect(poster?.hasAttribute('data-pictured')).toBe(true);
      const media = poster?.querySelector('.hero-poster__media .lp-media');
      expect(media?.hasAttribute('data-empty')).toBe(true);
      expect(media?.querySelector('.lp-media__plate')).not.toBeNull();
      expect(poster?.querySelector('img, video')).toBeNull();
    });

    it('gives that plate a sheet of its own — the panel tinted with the brand and lifted toward its ink — computed a step up (no cycle)', () => {
      // On a band the plate's panel is the page's ground, and this picture
      // runs off the band's foot into the next section's ground: untinted, it
      // had no edge. Redeclaring `--lp-panel` from itself on one element
      // would be a cycle, voiding the plate's whole background.
      const source = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'HeroPoster.svelte'),
        'utf8'
      );
      const rules = new Map<string, Map<string, string>>();
      type Node = {
        type: string;
        property?: string;
        value?: string;
        prelude?: { start: number; end: number };
        block?: { children: Node[] } | null;
      };
      const squash = (s: string) =>
        s
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .trim();
      // A selector can recur (inside a container query): merge its rules.
      const visit = (nodes: Node[]) => {
        for (const node of nodes) {
          const children = node.block?.children ?? [];
          if (node.type === 'Rule' && node.prelude) {
            const selector = squash(
              source.slice(node.prelude.start, node.prelude.end)
            );
            const own = rules.get(selector) ?? new Map<string, string>();
            for (const d of children)
              if (d.type === 'Declaration')
                own.set(d.property ?? '', squash(d.value ?? ''));
            rules.set(selector, own);
          }
          visit(children);
        }
      };
      visit((parse(source, { modern: true }).css?.children ?? []) as Node[]);
      expect(rules.get('.hero-poster__reveal')?.get('--_plate')).toBe(
        'color-mix( in oklab, color-mix(in oklab, var(--lp-panel), var(--lp-brand) var(--lp-tint-panel)), var(--lp-panel-ink) 5% )'
      );
      expect([
        ...(rules.get('.hero-poster__reveal :global(.lp-media[data-empty])') ??
          []),
      ]).toEqual([['--lp-panel', 'var(--_plate)']]);
    });

    it('plays a clip silently in the picture, with the play button over it', async () => {
      await render(
        { heading: 'H' },
        {
          layout: 'poster',
          context: sampleContext({
            media: { heroClip: { playlistUrl: '/clip.m3u8' } },
          }),
        }
      );
      expect(
        document.body.querySelector('.hero-poster__media')?.textContent
      ).toContain(COPY.hero.watch);
    });
  });
});
