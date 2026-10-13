import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JourneyStageView } from '$lib/page-builder';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import type { JourneySalesContext } from '../../../render/types';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext, sampleStages } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import {
  reportPlace,
  resize,
  startAt,
  stubSwap,
  unstubSwap,
} from '../../primitives/swap.testing';
import CurriculumBlock from './CurriculumBlock.svelte';
import { CURRICULUM_COPY } from './copy';
import {
  CURRICULUM_EMPTY,
  CURRICULUM_EMPTY_STAGE,
  curriculumDefinition,
} from './definition';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const SAMPLE = curriculumDefinition.sample;
const STAGES = sampleStages();

function mountCurriculum(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    context?: JourneySalesContext;
    edit?: BlockEdit | null;
    scheme?: ResolvedSection['scheme'];
  } = {}
) {
  const section: ResolvedSection = {
    id: 'curriculum-1',
    anchor: 'curriculum',
    type: 'curriculum',
    index: 6,
    layout: options.layout ?? 'timeline',
    scheme: options.scheme ?? 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(CurriculumBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: options.context ?? sampleContext(),
      edit: options.edit ?? null,
    },
  });
}

async function render(...args: Parameters<typeof mountCurriculum>) {
  mountCurriculum(...args);
  flushSync();
  await tick();
}

const text = () => document.body.textContent ?? '';
const withStages = (stages: JourneyStageView[]) => ({
  ...sampleContext(),
  stages,
});
// A practice is a row in most layouts and a picture-led card in the layered one.
const practiceRows = () => [
  ...document.body.querySelectorAll('.practice, .practice-card'),
];
/**
 * What a screen reader hears of a practice, in order. A row's text is that,
 * exactly. A card's paragraphs are read as lines of their own, so the
 * whitespace between them is never heard: its name, then its kind and length.
 */
const spoken = (row: Element) => {
  if (!row.classList.contains('practice-card')) return row.textContent;
  const part = (name: string) =>
    row
      .querySelector(`.practice-card__${name}`)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim() ?? '';
  return `${part('name')}${part('meta')}`;
};
const toggles = () => [...document.body.querySelectorAll('button')];
const panel = (button: HTMLButtonElement) =>
  document.getElementById(button.getAttribute('aria-controls') ?? '');

describe('CurriculumBlock', () => {
  it.each(
    SECTION_LAYOUTS.curriculum
  )('%s: every stage in order, numbered, with every practice', async (layout) => {
    await render(SAMPLE, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain(SAMPLE.body);
    const names = [...document.body.querySelectorAll('h3')].map(
      (h) => h.textContent ?? ''
    );
    expect(names).toHaveLength(STAGES.length);
    STAGES.forEach((stage, index) => {
      expect(names[index]).toContain(stage.name);
      expect(text()).toContain(`Stage ${index + 1}`);
    });
    // A real sequence, so a real ordered list.
    expect(document.body.querySelector('ol')).not.toBeNull();
    const titles = practiceRows().map((row) => row.textContent ?? '');
    expect(titles).toHaveLength(STAGES.flatMap((s) => s.practices).length);
    expect(titles[0]).toContain(STAGES[0].practices[0].title);
  });

  it.each(
    SECTION_LAYOUTS.curriculum
  )('%s: says what each practice is and how long it takes', async (layout) => {
    await render(SAMPLE, { layout });
    const rows = practiceRows();
    const practices = STAGES.flatMap((stage) => stage.practices);
    // The sample must exercise every kind, measured and not, or this proves
    // nothing.
    expect(new Set(practices.map((p) => p.contentType))).toEqual(
      new Set(['video', 'audio', 'written'])
    );
    expect(practices.some((p) => p.durationSeconds)).toBe(true);
    expect(practices.some((p) => !p.durationSeconds)).toBe(true);
    rows.forEach((row, i) => {
      const practice = practices[i];
      const length = CURRICULUM_COPY.length(practice.durationSeconds);
      expect(row.querySelector('svg')).not.toBeNull();
      // What a screen reader hears, in order; the dot between is drawn.
      expect(spoken(row)).toBe(
        `${practice.title}, ${CURRICULUM_COPY.kind(practice.contentType)}${
          length ? `, ${length}` : ''
        }`
      );
    });
    expect(text()).toContain('Video');
    expect(text()).toContain('6 min');
    expect(text()).toContain('Reading');
  });

  it('names a practice’s kind alone when nobody measured its length', async () => {
    const [stage] = STAGES;
    const unmeasured = {
      ...stage,
      practices: stage.practices.map((p) => ({ ...p, durationSeconds: null })),
    };
    // An older worker omits the field altogether.
    const omitted = {
      ...STAGES[1],
      practices: STAGES[1].practices.map(({ durationSeconds: _, ...p }) => p),
    };
    await render(SAMPLE, { context: withStages([unmeasured, omitted]) });
    const practices = [...unmeasured.practices, ...omitted.practices];
    practiceRows().forEach((row, i) => {
      expect(row.querySelector('.practice__length')).toBeNull();
      expect(row.querySelector('.practice__meta')?.textContent).toBe(
        `, ${CURRICULUM_COPY.kind(practices[i].contentType)}`
      );
    });
  });

  it('says a length in whole minutes, then hours, rounded as a visitor plans by it', () => {
    expect(CURRICULUM_COPY.length(580)).toBe('10 min');
    expect(CURRICULUM_COPY.length(89)).toBe('1 min');
    expect(CURRICULUM_COPY.length(25)).toBe('under 1 min');
    expect(CURRICULUM_COPY.length(3570)).toBe('1 hr');
    expect(CURRICULUM_COPY.length(4500)).toBe('1 hr 15 min');
    for (const nothing of [null, undefined, 0, -5, Number.NaN]) {
      expect(CURRICULUM_COPY.length(nothing)).toBeNull();
    }
    expect(CURRICULUM_COPY.kind('written')).toBe('Reading');
  });

  it('orders the stages and their practices as the course does', async () => {
    const [a, b] = STAGES;
    const stages = [
      { ...b, sortOrder: 5 },
      { ...a, sortOrder: 1, practices: [...a.practices].reverse() },
    ];
    await render(SAMPLE, { context: withStages(stages) });
    const names = [...document.body.querySelectorAll('h3')].map(
      (h) => h.textContent
    );
    expect(names).toEqual([a.name, b.name]);
    expect(practiceRows()[0].textContent).toContain(a.practices[0].title);
  });

  it('accordion: every stage is open until the script runs', () => {
    mountCurriculum(SAMPLE, { layout: 'accordion' });
    for (const button of toggles()) {
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(panel(button)?.hasAttribute('hidden')).toBe(false);
    }
  });

  it('accordion: the first stage stays open; the rest open on demand', async () => {
    await render(SAMPLE, { layout: 'accordion' });
    const [first, second] = toggles();
    expect(toggles()).toHaveLength(STAGES.length);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(first.textContent).toContain('4 practices');
    expect(second.getAttribute('aria-expanded')).toBe('false');
    expect(panel(second)?.getAttribute('hidden')).toBe('until-found');
    expect(panel(second)?.textContent).toContain(STAGES[1].practices[0].title);
    second.click();
    flushSync();
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('accordion: a stage with nothing inside is a row, not a button', async () => {
    const stages = [{ ...STAGES[0], gloss: null, practices: [] }, STAGES[1]];
    await render(SAMPLE, { layout: 'accordion', context: withStages(stages) });
    expect(toggles()).toHaveLength(1);
    expect(text()).toContain(STAGES[0].name);
    expect(text()).not.toContain('0 practices');
  });

  it('map: each stop is a native disclosure — number, name and count, the first open', async () => {
    await render(SAMPLE, { layout: 'map' });
    const stops = [...document.body.querySelectorAll('details')];
    expect(stops).toHaveLength(STAGES.length);
    // Opens and closes with no script at all: no buttons, no ARIA state.
    expect(toggles()).toHaveLength(0);
    stops.forEach((stop, index) => {
      const summary = stop.querySelector(':scope > summary');
      expect(summary?.textContent).toContain(`Stage ${index + 1}`);
      expect(summary?.querySelector('h3')?.textContent).toBe(
        STAGES[index].name
      );
      expect(summary?.textContent).toContain(
        CURRICULUM_COPY.practices(STAGES[index].practices.length)
      );
      expect(stop.open).toBe(index === 0);
      // Closed stops keep their practices in the page (find-in-page opens them).
      expect(stop.textContent).toContain(STAGES[index].practices[0].title);
    });
  });

  it('map: a stage with nothing inside is a plain stop; the first that holds anything opens', async () => {
    const stages = [
      { ...STAGES[0], gloss: null, practices: [] },
      { ...STAGES[1], practices: [] },
      STAGES[2],
    ];
    await render(SAMPLE, { layout: 'map', context: withStages(stages) });
    const stops = [...document.body.querySelectorAll('.map__stop')];
    expect(stops.map((s) => s.tagName)).toEqual(['DIV', 'DETAILS', 'DETAILS']);
    expect(stops[0].textContent).toContain(STAGES[0].name);
    expect(text()).not.toContain('0 practices');
    // The second holds only its line: it opens, and shows no count.
    expect((stops[1] as HTMLDetailsElement).open).toBe(true);
    expect(stops[1].textContent).toContain(STAGES[1].gloss ?? '');
    expect(stops[1].querySelector('.map__count')).toBeNull();
    expect((stops[2] as HTMLDetailsElement).open).toBe(false);
  });

  it('map: the route is decoration, joining each stop to the next and ready to draw', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      ...STAGES[i % STAGES.length],
      id: `stage-${i}`,
      sortOrder: i,
    }));
    await render(SAMPLE, { layout: 'map', context: withStages(eight) });
    expect(document.body.querySelectorAll('.map__stage')).toHaveLength(8);
    const route = [...document.body.querySelectorAll('.map__line, .map__bend')];
    // A line and a bend under every stop but the last.
    expect(route).toHaveLength(7 * 2);
    for (const piece of route) {
      expect(piece.getAttribute('aria-hidden')).toBe('true');
      expect(piece.hasAttribute('data-lp-draw')).toBe(true);
    }
    unmount(app);
    await render(SAMPLE, { layout: 'map', context: withStages([STAGES[0]]) });
    expect(
      document.body.querySelectorAll('.map__line, .map__bend')
    ).toHaveLength(0);
    expect(document.body.querySelector('details')?.open).toBe(true);
  });

  it('map: a long stage name stays whole', async () => {
    const name =
      'An unhurried week of learning to breathe slowly before anything else happens';
    await render(SAMPLE, {
      layout: 'map',
      context: withStages([{ ...STAGES[0], name }]),
    });
    expect(document.body.querySelector('summary h3')?.textContent).toBe(name);
  });

  it.each(
    SECTION_LAYOUTS.curriculum
  )('%s: with no stages yet the public page keeps only the words', async (layout) => {
    await render(SAMPLE, { layout, context: withStages([]) });
    expect(document.body.querySelector('ol')).toBeNull();
    expect(text()).not.toContain(CURRICULUM_EMPTY);
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    unmount(app);
    await render(SAMPLE, {
      layout,
      context: withStages([]),
      edit: { commit: () => {} },
    });
    expect(
      document.body.querySelector('[data-lp-edit-only]')?.textContent
    ).toBe(CURRICULUM_EMPTY);
  });

  it.each(
    SECTION_LAYOUTS.curriculum
  )('%s: adds a way to join only when the creator writes one', async (layout) => {
    await render(SAMPLE, { layout });
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render({ ...SAMPLE, ctaLabel: 'Start stage one' }, { layout });
    expect(document.body.querySelector('a')?.textContent?.trim()).toBe(
      'Start stage one'
    );
  });

  it('takes its levels from the section, never skipping one', async () => {
    await render(SAMPLE, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe(SAMPLE.heading);
    expect(document.body.querySelectorAll('h2')).toHaveLength(STAGES.length);
    unmount(app);
    await render({});
    expect(document.body.querySelectorAll('h2')).toHaveLength(STAGES.length);
  });

  it('starts from the course, and never lists stages of its own', () => {
    const starter = curriculumDefinition.starter({
      courseTitle: 'Steady Ground',
    });
    expect(starter.heading).toContain('Steady Ground');
    expect(Object.keys(starter).sort()).toEqual(['body', 'heading']);
  });

  it('carries editing attributes only on the canvas', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render(SAMPLE, { edit: { commit: () => {} } });
    expect(document.body.querySelector('h2')?.getAttribute('aria-label')).toBe(
      'Curriculum — Heading'
    );
  });
});

describe('CurriculumBlock — the timeline folds on a phone', () => {
  // The stylesheet sets the phone-width flag on the timeline itself.
  beforeEach(() => stubSwap('timeline'));
  afterEach(() => {
    unstubSwap();
    document.body.removeAttribute('data-lp-still');
  });

  const timelineToggles = () => [
    ...document.body.querySelectorAll<HTMLButtonElement>('.timeline button'),
  ];
  const AHEAD = 900;

  it('is served open: every stage’s words and practices, and no buttons', async () => {
    await render(SAMPLE);
    expect(timelineToggles()).toHaveLength(0);
    expect(practiceRows()).toHaveLength(
      STAGES.flatMap((s) => s.practices).length
    );
    expect(document.body.querySelector('.timeline [hidden]')).toBeNull();
  });

  it('on a phone, once ahead of the visitor, each stage folds under its name, the first open', async () => {
    await render(SAMPLE);
    reportPlace(false, AHEAD);
    const toggles = timelineToggles();
    expect(toggles).toHaveLength(STAGES.length);
    toggles.forEach((toggle, index) => {
      // A real heading for the outline, the button inside it.
      expect(toggle.parentElement?.tagName).toBe('H3');
      expect(toggle.textContent).toContain(STAGES[index].name);
      expect(toggle.textContent).toContain(
        CURRICULUM_COPY.practices(STAGES[index].practices.length)
      );
    });
    const [first, second] = toggles;
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(panel(first)?.hasAttribute('hidden')).toBe(false);
    expect(second.getAttribute('aria-expanded')).toBe('false');
    // Closed, but still in the page: find-in-page opens it.
    expect(panel(second)?.getAttribute('hidden')).toBe('until-found');
    expect(panel(second)?.textContent).toContain(STAGES[1].practices[0].title);
    expect(panel(second)?.textContent).toContain(STAGES[1].gloss ?? '');

    second.click();
    flushSync();
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-expanded')).toBe('true');
  });

  it('never folds where the visitor would see it move: in view, or scrolled past', async () => {
    await render(SAMPLE);
    reportPlace(true, 120);
    expect(timelineToggles()).toHaveLength(0);
    reportPlace(false, -2000);
    expect(timelineToggles()).toHaveLength(0);
  });

  it('wider than a phone it stays one row a stage, and follows the width as it changes', async () => {
    startAt(false);
    await render(SAMPLE);
    reportPlace(false, AHEAD);
    expect(timelineToggles()).toHaveLength(0);
    resize(true);
    expect(timelineToggles()).toHaveLength(STAGES.length);
    resize(false);
    expect(timelineToggles()).toHaveLength(0);
    expect(practiceRows()).toHaveLength(
      STAGES.flatMap((s) => s.practices).length
    );
  });

  it('folds at once in a still preview, which nobody is scrolling', async () => {
    document.body.setAttribute('data-lp-still', '');
    await render(SAMPLE);
    reportPlace(true, 0);
    expect(timelineToggles()).toHaveLength(STAGES.length);
  });

  it('keeps a stage with nothing inside a plain row', async () => {
    const stages = [{ ...STAGES[0], gloss: null, practices: [] }, STAGES[1]];
    await render(SAMPLE, { context: withStages(stages) });
    reportPlace(false, AHEAD);
    const toggles = timelineToggles();
    expect(toggles).toHaveLength(1);
    // The first stage that holds anything is the one open.
    expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain(STAGES[0].name);
    expect(text()).not.toContain('0 practices');
  });

  it('steps between the stages with the arrow keys', async () => {
    await render(SAMPLE);
    reportPlace(false, AHEAD);
    const [first, second] = timelineToggles();
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(document.activeElement).toBe(second);
  });

  it('when the fold gives way under the visitor’s focus, their stage keeps it', async () => {
    await render(SAMPLE);
    reportPlace(false, AHEAD);
    timelineToggles()[1].focus();
    resize(false);
    await tick();
    const stage = document.body.querySelectorAll('.timeline__stage')[1];
    expect(document.activeElement).toBe(
      stage.querySelector('.timeline__words')
    );
  });
});

describe('CurriculumBlock — layered stages (Codex-61zsk.55)', () => {
  const regions = () => [...document.body.querySelectorAll('[role="region"]')];
  const stageItems = () => [
    ...document.body.querySelectorAll('.layers__stage'),
  ];
  /** A stage of `count` practices, from the sample's first stage. */
  const stageOf = (
    id: string,
    name: string,
    count: number
  ): JourneyStageView => ({
    ...STAGES[0],
    id,
    name,
    practices: Array.from({ length: count }, (_, i) => ({
      ...STAGES[0].practices[i % STAGES[0].practices.length],
      contentId: `${id}-p${i}`,
    })),
  });

  it('gives each stage of two or more practices its own row, named for its stage', async () => {
    await render(SAMPLE, { layout: 'layered' });
    expect(stageItems()).toHaveLength(STAGES.length);
    expect(regions().map((r) => r.getAttribute('aria-label'))).toEqual(
      STAGES.map((stage, i) => CURRICULUM_COPY.stageLine(i + 1, stage.name))
    );
    // Each row's buttons say which stage they move, in its heading's line.
    stageItems().forEach((item, i) => {
      const [previous, next] = [...item.querySelectorAll('button')];
      expect(previous.getAttribute('aria-label')).toBe(
        CURRICULUM_COPY.previousIn(i + 1)
      );
      expect(next.getAttribute('aria-label')).toBe(
        CURRICULUM_COPY.nextIn(i + 1)
      );
      const line = item.querySelector('.lp-strip__nav--head');
      expect(line?.querySelector('.lp-strip__head h3')?.textContent).toBe(
        STAGES[i].name
      );
    });
  });

  it('heads each stage with its number and how many practices it holds', async () => {
    await render(SAMPLE, { layout: 'layered' });
    stageItems().forEach((item, i) => {
      expect(
        item
          .querySelector('.layers__label')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim()
      ).toBe(
        `${CURRICULUM_COPY.stage} ${i + 1} · ${CURRICULUM_COPY.practices(STAGES[i].practices.length)}`
      );
    });
  });

  it('draws a stage of one practice as a plain card: no region, no buttons, no tab stop', async () => {
    await render(SAMPLE, {
      layout: 'layered',
      context: withStages([
        stageOf('a', 'Arriving', 1),
        stageOf('b', 'Breath', 3),
      ]),
    });
    const [one, three] = stageItems();
    expect(one.querySelector('[role="region"]')).toBeNull();
    expect(one.querySelector('button')).toBeNull();
    expect(one.querySelector('[tabindex]')).toBeNull();
    expect(one.querySelectorAll('.practice-card')).toHaveLength(1);
    expect(three.querySelector('[role="region"]')).not.toBeNull();
    expect(three.querySelectorAll('.practice-card')).toHaveLength(3);
  });

  it('keeps a stage with nothing in it to its heading, prompting only while editing', async () => {
    const stages = [stageOf('a', 'Arriving', 0), stageOf('b', 'Breath', 2)];
    await render(SAMPLE, { layout: 'layered', context: withStages(stages) });
    const [empty] = stageItems();
    expect(empty.querySelector('h3')?.textContent).toBe('Arriving');
    expect(empty.querySelector('.practice-card, [role="region"]')).toBeNull();
    expect(empty.querySelector('.layers__label')?.textContent?.trim()).toBe(
      'Stage 1'
    );
    expect(text()).not.toContain(CURRICULUM_EMPTY_STAGE);
    unmount(app);
    await render(SAMPLE, {
      layout: 'layered',
      context: withStages(stages),
      edit: { commit: () => {} },
    });
    expect(
      stageItems()[0].querySelector('[data-lp-edit-only]')?.textContent
    ).toBe(CURRICULUM_EMPTY_STAGE);
  });

  it('leaves the stage line off its cards: the row names the stage', async () => {
    await render(SAMPLE, { layout: 'layered' });
    expect(document.body.querySelector('.practice-card__stage')).toBeNull();
  });

  it('draws a missing picture on the band’s panel on a filled band, the brand elsewhere', async () => {
    for (const [scheme, ground] of [
      ['base', 'brand'],
      ['contrast', 'panel'],
      ['accent', 'panel'],
      ['brand', 'panel'],
    ] as const) {
      await render(SAMPLE, { layout: 'layered', scheme });
      const grounds = [
        ...document.body.querySelectorAll('.layers [data-ground]'),
      ].map((tile) => tile.getAttribute('data-ground'));
      expect(grounds.length, scheme).toBeGreaterThan(0);
      expect(new Set(grounds), scheme).toEqual(new Set([ground]));
      unmount(app);
      app = null;
    }
  });

  it('loads every picture lazily, with What’s inside’s sizes, behind the hero', async () => {
    await render(SAMPLE, {
      layout: 'layered',
      context: sampleContext({
        practicePictures: ['https://cdn.test/m1/lg.webp'],
      }),
    });
    const pictures = [...document.body.querySelectorAll('.layers img')];
    expect(pictures.length).toBeGreaterThan(0);
    for (const img of pictures) {
      expect(img.getAttribute('loading')).toBe('lazy');
      expect(img.hasAttribute('fetchpriority')).toBe(false);
      expect(img.getAttribute('sizes')).toBe('(max-width: 40rem) 80vw, 23rem');
    }
  });

  it('runs its rows to the band’s edges only when it has stages to show', async () => {
    await render(SAMPLE, { layout: 'layered' });
    expect(
      document.body.querySelector('.curriculum')?.classList.contains('lp-bleed')
    ).toBe(true);
    unmount(app);
    await render(SAMPLE, { layout: 'layered', context: withStages([]) });
    expect(
      document.body.querySelector('.curriculum')?.classList.contains('lp-bleed')
    ).toBe(false);
    unmount(app);
    await render(SAMPLE, { layout: 'cards' });
    expect(
      document.body.querySelector('.curriculum')?.classList.contains('lp-bleed')
    ).toBe(false);
  });
});
