import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
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
import CurriculumBlock from './CurriculumBlock.svelte';
import { CURRICULUM_COPY } from './copy';
import { CURRICULUM_EMPTY, curriculumDefinition } from './definition';

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
  } = {}
) {
  const section: ResolvedSection = {
    id: 'curriculum-1',
    anchor: 'curriculum',
    type: 'curriculum',
    index: 6,
    layout: options.layout ?? 'timeline',
    scheme: 'base',
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
const practiceRows = () => [...document.body.querySelectorAll('.practice')];
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

  it('reads a practice’s kind by its icon, and says it to a screen reader', async () => {
    await render(SAMPLE);
    const rows = practiceRows();
    const practices = STAGES.flatMap((stage) => stage.practices);
    // The sample must exercise every kind, or this proves nothing.
    expect(new Set(practices.map((p) => p.contentType))).toEqual(
      new Set(['video', 'audio', 'written'])
    );
    rows.forEach((row, i) => {
      expect(row.querySelector('svg')).not.toBeNull();
      expect(row.querySelector('.sr-only')?.textContent).toBe(
        `, ${CURRICULUM_COPY.type(practices[i].contentType)}`
      );
    });
    expect(CURRICULUM_COPY.type('written')).toBe('reading');
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
