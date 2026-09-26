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
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { STATS_PROMPT, statsDefinition } from './definition';
import { liveFigures } from './figures';
import StatsBlock from './StatsBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

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
    id: 'stats-1',
    anchor: 'stats',
    type: 'stats',
    index: 10,
    layout: options.layout ?? 'row',
    scheme: 'brand',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(StatsBlock, {
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
/** Each figure as "value label", in reading order. */
const figures = () =>
  [...document.body.querySelectorAll('.stat')].map((cell) =>
    [...cell.children].map((part) => part.textContent?.trim()).join(' ')
  );
const OWN = [
  { value: '4,000+', label: 'students taught' },
  { value: '20 min', label: 'a day' },
];

function stages(count: number, practicesEach: number): JourneyStageView[] {
  return Array.from({ length: count }, (_, stage) => ({
    id: `stage-${stage}`,
    name: `Stage ${stage + 1}`,
    gloss: null,
    sortOrder: stage,
    practices: Array.from({ length: practicesEach }, (__, practice) => ({
      contentId: `practice-${stage}-${practice}`,
      slug: null,
      title: `Practice ${practice + 1}`,
      contentType: 'audio' as const,
      sortOrder: stage * practicesEach + practice,
    })),
  }));
}

describe('StatsBlock', () => {
  it.each(
    SECTION_LAYOUTS.stats
  )('%s: the course’s own counts first, then the creator’s', async (layout) => {
    await render(
      { heading: 'At a glance', live: true, items: OWN },
      { layout }
    );
    expect(document.body.querySelector('h2')?.textContent).toBe('At a glance');
    expect(figures()).toEqual([
      '6 stages',
      '24 practices',
      '4,000+ students taught',
      '20 min a day',
    ]);
  });

  it('shows only the creator’s numbers when the course numbers are off', async () => {
    await render({ items: OWN });
    expect(figures()).toEqual(['4,000+ students taught', '20 min a day']);
  });

  it('counts from the curriculum the page renders, singular and with separators', async () => {
    const context = { ...sampleContext(), stages: stages(1, 1) };
    await render({ live: true }, { context });
    expect(figures()).toEqual(['1 stage', '1 practice']);
    expect(liveFigures(stages(3, 400)).map((f) => f.value)).toEqual([
      '3',
      '1,200',
    ]);
  });

  it('leaves out a count of zero', () => {
    expect(liveFigures([])).toEqual([]);
    expect(liveFigures(stages(2, 0)).map((f) => f.label)).toEqual(['stages']);
  });

  it('never numbers the figures as a sequence', async () => {
    await render({ live: true, items: OWN });
    expect(document.body.querySelector('ol')).toBeNull();
    expect(document.body.querySelector('ul')?.children).toHaveLength(4);
  });

  it('sets every figure to fit the longest value', async () => {
    await render({ live: true, items: OWN });
    const list = document.body.querySelector<HTMLElement>('.stats__list');
    expect(list?.style.getPropertyValue('--_chars')).toBe('6');
  });

  it('takes its heading level from the section', async () => {
    await render({ heading: 'At a glance', live: true }, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe('At a glance');
  });

  it.each(
    SECTION_LAYOUTS.stats
  )('%s: with no numbers the public page keeps only the words', async (layout) => {
    const context = { ...sampleContext(), stages: [] };
    await render({ heading: 'At a glance', live: true }, { layout, context });
    expect(document.body.querySelector('ul')).toBeNull();
    expect(document.body.querySelector('h2')?.textContent).toBe('At a glance');
    expect(text()).not.toContain(STATS_PROMPT);
  });

  it('tells the creator how to add numbers on the canvas', async () => {
    await render({ heading: 'At a glance' }, { edit: { commit: () => {} } });
    expect(text()).toContain(STATS_PROMPT);
  });

  it.each(
    SECTION_LAYOUTS.stats
  )('%s: adds a way to join only when the creator writes one', async (layout) => {
    await render({ live: true }, { layout });
    expect(document.body.querySelector('a')).toBeNull();
    unmount(app);
    await render({ live: true, ctaLabel: 'Join them' }, { layout });
    expect(document.body.querySelector('a')?.textContent?.trim()).toBe(
      'Join them'
    );
  });

  it('starts from the course’s own counts and claims nothing else', () => {
    const starter = statsDefinition.starter({ courseTitle: 'Steady Ground' });
    expect(starter.live).toBe(true);
    expect(starter.heading).toContain('Steady Ground');
    expect(starter).not.toHaveProperty('items');
  });

  it('carries editing attributes only on the canvas', async () => {
    await render({ heading: 'At a glance', live: true });
    expect(document.body.querySelector('[contenteditable]')).toBeNull();
    unmount(app);
    await render(
      { heading: 'At a glance', live: true },
      { edit: { commit: () => {} } }
    );
    expect(document.body.querySelector('h2')?.getAttribute('aria-label')).toBe(
      'Numbers — Heading'
    );
  });
});
