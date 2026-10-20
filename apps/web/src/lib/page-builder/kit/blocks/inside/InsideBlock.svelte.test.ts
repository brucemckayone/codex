/**
 * "What's inside" (03 X63, Codex-61zsk.52): every practice as a picture-led
 * card in one row the visitor swipes through, a pure showcase, folded away on
 * a public page that has no practices yet.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { JourneyStageView } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext } from '../../../render/types';
import { type ColourSchemeId, PAGE_STYLE_IDS } from '../../model/ids';
import { sampleContext, samplePage, sampleStages } from '../../model/sample';
import { STYLES } from '../../model/styles';
import { starterPage } from '../../model/template';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import PageRenderer from '../../PageRenderer.svelte';
import { componentRules } from '../testing';
import { INSIDE_COPY } from './copy';
import { INSIDE_EMPTY, insideDefinition } from './definition';
import InsideBlock from './InsideBlock.svelte';

const HERE = dirname(fileURLToPath(import.meta.url));
const CDN = 'https://cdn-assets.example.test/creator/media-thumbnails';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(
  props: Record<string, unknown> = insideDefinition.sample,
  options: {
    scheme?: ColourSchemeId;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'inside-1',
    anchor: 'inside',
    type: 'inside',
    index: 1,
    layout: 'carousel',
    scheme: options.scheme ?? 'base',
    spacing: 'regular',
    headingLevel: 2,
  };
  app = mount(InsideBlock, {
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

const withStages = (stages: JourneyStageView[]) => ({
  ...sampleContext(),
  stages,
});
const cards = () => [...document.body.querySelectorAll('.practice-card')];
const words = (el: Element, part: string) =>
  el
    .querySelector(`.practice-card__${part}`)
    ?.textContent?.replace(/\s+/g, ' ')
    .trim();

/** Two stages, each practice with or without a picture. */
function pictured(): JourneyStageView[] {
  return [
    {
      id: 's1',
      name: 'Arriving',
      gloss: null,
      sortOrder: 0,
      practices: [
        {
          contentId: 'c1',
          slug: null,
          title: 'Breath',
          contentType: 'video',
          sortOrder: 0,
          durationSeconds: 720,
          thumbnailUrl: `${CDN}/m1/lg.webp`,
        },
        {
          contentId: 'c2',
          slug: null,
          title: 'Notes',
          contentType: 'written',
          sortOrder: 1,
          durationSeconds: null,
          thumbnailUrl: null,
        },
      ],
    },
    {
      id: 's2',
      name: 'Staying',
      gloss: null,
      sortOrder: 1,
      practices: [
        {
          contentId: 'c3',
          slug: null,
          title: 'Hum',
          contentType: 'audio',
          sortOrder: 2,
          durationSeconds: 300,
        },
      ],
    },
  ];
}

describe('InsideBlock', () => {
  it('shows every practice across the stages, in order, with its kind, length, title and stage', async () => {
    const stages = sampleStages();
    await render(undefined, { context: withStages(stages) });
    const expected = stages.flatMap((stage) =>
      stage.practices.map((p) => p.title)
    );
    expect(expected.length).toBeGreaterThan(20);
    expect(cards().map((card) => words(card, 'name'))).toEqual(expected);

    const [first] = cards();
    // "Welcome, and how to use the course": a six-minute film in stage 1,
    // heard as "…, Video, 6 min, Stage 1 · Arriving".
    expect(words(first, 'meta')).toBe(', Video, 6 min');
    expect(words(first, 'stage')).toBe(', Stage 1 · Arriving');
    const last = cards().at(-1) as Element;
    expect(words(last, 'stage')).toBe(', Stage 6 · Home');
    // A reading names its kind alone.
    expect(words(cards()[2], 'meta')).toBe(', Reading');
  });

  it('is a labelled, ordered row the visitor swipes through, named by its heading', async () => {
    await render({ heading: 'Inside Steady Ground' });
    const region = document.body.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Inside Steady Ground');
    expect(region?.id).toBe('inside-practices');
    expect(region?.querySelector(':scope > ol')).not.toBeNull();
    expect(region?.querySelectorAll('ol > li')).toHaveLength(cards().length);
    const [previous, next] = [
      ...document.body.querySelectorAll('.lp-strip__move'),
    ];
    expect(previous?.getAttribute('aria-label')).toBe(INSIDE_COPY.previous);
    expect(next?.getAttribute('aria-label')).toBe(INSIDE_COPY.next);
    // Where the visitor is in it, beside the arrows.
    expect(document.body.querySelector('.lp-strip__position')).not.toBeNull();
  });

  it('names the row “What’s inside” when the section has no heading', async () => {
    await render({ body: 'Every practice, in order.' });
    expect(
      document.body.querySelector('[role="region"]')?.getAttribute('aria-label')
    ).toBe(INSIDE_COPY.label);
  });

  it('draws each picture at its stored sizes, and the kind’s brand tile where there is none', async () => {
    await render(undefined, { context: withStages(pictured()) });
    const [pictureCard, readingCard, audioCard] = cards();
    const img = pictureCard.querySelector('img');
    expect(img?.getAttribute('src')).toBe(`${CDN}/m1/lg.webp`);
    expect(img?.getAttribute('srcset')).toContain(`${CDN}/m1/md.webp 400w`);
    expect(img?.getAttribute('sizes')).toBe('(max-width: 40rem) 80vw, 23rem');
    expect(pictureCard.querySelector('.practice-tile')).toBeNull();

    for (const card of [readingCard, audioCard]) {
      expect(card.querySelector('img')).toBeNull();
      const tile = card.querySelector('.practice-tile');
      expect(tile?.getAttribute('data-lp-scheme')).toBe('brand');
      expect(tile?.querySelector('svg')).not.toBeNull();
      // Designed content, never the empty-frame plate.
      expect(card.querySelector('.lp-media__plate')).toBeNull();
    }
  });

  it('draws the tile when a picture fails, never a broken image', async () => {
    await render(undefined, { context: withStages(pictured()) });
    const [card] = cards();
    card.querySelector('img')?.dispatchEvent(new Event('error'));
    flushSync();
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.practice-tile')).not.toBeNull();
  });

  it.each([
    'brand',
    'accent',
    'contrast',
  ] as const)('on a %s band, the tile takes the band’s panel, where the brand would vanish or smear', async (scheme) => {
    await render(undefined, { scheme, context: withStages(pictured()) });
    const tile = cards()[1].querySelector('.practice-tile');
    expect(tile?.getAttribute('data-ground')).toBe('panel');
    expect(tile?.hasAttribute('data-lp-scheme')).toBe(false);
  });

  it('loads the first four pictures now, behind the hero’s, and the rest as a swipe nears them', async () => {
    const stages = sampleStages().map((stage) => ({
      ...stage,
      practices: stage.practices.map((p, i) => ({
        ...p,
        thumbnailUrl: `${CDN}/${stage.id}-${i}/lg.webp`,
      })),
    }));
    await render(undefined, { context: withStages(stages) });
    const loads = [...document.body.querySelectorAll('.practice-card img')].map(
      (img) =>
        `${img.getAttribute('loading')}:${img.getAttribute('fetchpriority')}`
    );
    expect(loads.slice(0, 4)).toEqual(Array(4).fill('eager:low'));
    expect(new Set(loads.slice(4))).toEqual(new Set(['lazy:null']));
  });

  // A pure showcase (owner, 2026-10-12): nothing on a card is a link or takes
  // a press. The row's own arrows are the only buttons in the section.
  it('carries no link and nothing to press on any card', async () => {
    await render(undefined, { context: withStages(pictured()) });
    const items = document.body.querySelector(
      '.lp-strip__items'
    ) as HTMLElement;
    expect(
      items.querySelectorAll(
        'a, button, [tabindex], [role="button"], [onclick]'
      )
    ).toHaveLength(0);
    expect(document.body.querySelectorAll('a')).toHaveLength(0);
    expect(document.body.querySelectorAll('button')).toHaveLength(2);
    for (const file of ['PracticeCard.svelte', 'PracticeTile.svelte']) {
      const markup = readFileSync(join(HERE, file), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script[\s\S]*?<\/script>/, '')
        .replace(/<style[\s\S]*?<\/style>/, '');
      expect(markup, file).not.toMatch(/\son[a-z]+=|<a[\s>]|<button/);
    }
  });

  describe('with no practices yet', () => {
    const none = () => withStages([]);

    it('folds the band away on the public page: no heading over nothing', async () => {
      await render(undefined, { context: none() });
      expect(document.body.querySelector('.inside')).toBeNull();
      expect(
        document.body.querySelector('.inside-none')?.hasAttribute('hidden')
      ).toBe(true);
      const fold = componentRules(join(HERE, 'InsideBlock.svelte')).find(
        (rule) =>
          rule.selector ===
          ':global(.lp:not([data-lp-still]) .lp-section:has(> .lp-inner > .inside-none))'
      );
      expect(fold?.decls.get('display')).toBe('none');
    });

    it('keeps its words and a row of tiles on the canvas, and points to the Curriculum tab', async () => {
      await render(undefined, { context: none(), edit: { commit: () => {} } });
      const block = document.body.querySelector('.inside');
      expect(block?.hasAttribute('data-lp-edit-only')).toBe(true);
      expect(block?.querySelector('h2')?.textContent).toBe("What's inside");
      expect(
        block?.querySelectorAll('.inside__tiles .practice-tile')
      ).toHaveLength(4);
      expect(
        block?.querySelector('.inside__tiles')?.getAttribute('aria-hidden')
      ).toBe('true');
      expect(block?.querySelector('.inside__prompt')?.textContent).toBe(
        INSIDE_EMPTY
      );
      expect(block?.querySelector('[role="region"]')).toBeNull();
    });

    it('shows the tiles, not the prompt, in a still thumbnail', async () => {
      app = mount(PageRenderer, {
        target: document.body,
        props: {
          page: samplePage('studio', ['hero', 'inside']),
          context: none(),
          edit: null,
          still: true,
        },
      });
      flushSync();
      await tick();
      const band = document.body.querySelector(
        '.lp-section[data-lp-type="inside"]'
      );
      expect(
        band?.querySelectorAll('.inside__tiles .practice-tile')
      ).toHaveLength(4);
      expect(band?.textContent).not.toContain(INSIDE_EMPTY);
    });
  });
});

describe('insideDefinition', () => {
  it('starts with a heading and one line naming the course, and no eyebrow', () => {
    expect(
      insideDefinition.starter({ courseTitle: 'Ancestral Threads' })
    ).toEqual({
      heading: "What's inside",
      body: "Every practice in Ancestral Threads, in the order you'll meet them.",
    });
    expect(insideDefinition.layouts.map((layout) => layout.id)).toEqual([
      'carousel',
    ]);
    // A showcase: no button of its own to configure.
    expect(insideDefinition.fields.map((field) => field.key)).toEqual([
      'eyebrow',
      'heading',
      'body',
    ]);
  });

  it.each(
    PAGE_STYLE_IDS
  )('%s puts it straight after the hero, in its order and on a new page', (style) => {
    expect(STYLES[style].order.indexOf('inside')).toBe(1);
    expect(STYLES[style].starter.slice(0, 2)).toEqual(['hero', 'inside']);
    const page = starterPage({ courseTitle: 'Steady Ground' }, { style });
    expect(page.sections[1]?.type).toBe('inside');
    expect(STYLES[style].layouts.inside).toBe('carousel');
  });
});
