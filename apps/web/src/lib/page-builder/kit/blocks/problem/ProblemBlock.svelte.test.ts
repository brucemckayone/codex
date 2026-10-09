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
import { PROBLEM_EMPTY, problemDefinition } from './definition';
import ProblemBlock from './ProblemBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const SAMPLE = problemDefinition.sample;

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    offer?: SampleOfferState;
    edit?: BlockEdit | null;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'problem-1',
    anchor: 'problem',
    type: 'problem',
    index: 2,
    layout: options.layout ?? 'statement',
    scheme: 'contrast',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(ProblemBlock, {
    target: document.body,
    props: {
      props,
      section,
      context: sampleContext({ offer: options.offer ?? 'buy' }),
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
const items = () =>
  [...document.body.querySelectorAll('li')].map((li) => li.textContent?.trim());
const link = (label: string) =>
  [...document.body.querySelectorAll('a')].find(
    (a) => a.textContent?.trim() === label
  );

describe('ProblemBlock', () => {
  it.each(
    SECTION_LAYOUTS.problem
  )('%s: shows the heading, the body and every sign, in order', async (layout) => {
    await render(SAMPLE, { layout });
    expect(document.body.querySelector('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain(SAMPLE.body);
    expect(items()).toEqual(SAMPLE.points);
  });

  it('draws each layout as its own composition', async () => {
    const shapes = new Set<string>();
    for (const layout of SECTION_LAYOUTS.problem) {
      await rerender(SAMPLE, { layout });
      shapes.add(document.body.querySelector('ul')?.className ?? '');
    }
    expect(shapes.size).toBe(SECTION_LAYOUTS.problem.length);
  });

  it('takes its heading level from the section', async () => {
    await render({ heading: 'H' }, { headingLevel: 1 });
    expect(document.body.querySelector('h1')?.textContent).toBe('H');
    await rerender({ heading: 'H' }, { headingLevel: 2 });
    expect(document.body.querySelector('h1')).toBeNull();
    expect(document.body.querySelector('h2')?.textContent).toBe('H');
  });

  it('shows the small label when written, and never borrows copy', async () => {
    await render({ ...SAMPLE, eyebrow: 'Sound familiar?' });
    expect(text()).toContain('Sound familiar?');
    await rerender({});
    const course = sampleContext().course;
    expect(document.body.querySelector('h2')).toBeNull();
    expect(text()).not.toContain(course.title);
    expect(text()).not.toContain(String(course.lede));
  });

  it('steps a long sentence down a size so it stays a statement', async () => {
    const long =
      'You have tried every app, every routine and every early alarm, and none of them stayed';
    await render({ heading: long });
    expect(
      document.body
        .querySelector('.problem__statement')
        ?.hasAttribute('data-long')
    ).toBe(true);
    await rerender({ heading: 'Short and sharp' });
    expect(
      document.body
        .querySelector('.problem__statement')
        ?.hasAttribute('data-long')
    ).toBe(false);
  });

  it.each(
    SECTION_LAYOUTS.problem
  )('%s: without signs, the page leaves the list out and the canvas asks for them', async (layout) => {
    await render({ heading: 'H', body: 'B' }, { layout });
    expect(document.body.querySelector('ul')).toBeNull();
    expect(text()).not.toContain(PROBLEM_EMPTY);
    await rerender(
      { heading: 'H', body: 'B' },
      { layout, edit: { commit: () => {} } }
    );
    expect(text()).toContain(PROBLEM_EMPTY);
  });

  it('offers a way in only when the creator writes one', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('a')).toBeNull();
    await rerender({
      ...SAMPLE,
      ctaLabel: 'Start this week',
      note: 'Start whenever you like.',
    });
    expect(link('Start this week')?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
    expect(text()).toContain('Start whenever you like.');
  });

  it('gives a member "Continue" and says so when enrolment is closed', async () => {
    await render({ ...SAMPLE, ctaLabel: 'Buy' }, { offer: 'enrolled' });
    expect(link(COPY.cta.continue)?.getAttribute('href')).toBe(
      '/journeys/steady-ground/dashboard'
    );
    await rerender({ ...SAMPLE, ctaLabel: 'Buy' }, { offer: 'unavailable' });
    expect(text()).toContain(COPY.cta.unavailableTitle);
    expect(link('Buy')).toBeUndefined();
  });

  it('carries editing attributes only on the canvas', async () => {
    await render(SAMPLE);
    expect(document.body.querySelector('[contenteditable]')).toBeNull();

    const edits: [string, string][] = [];
    await rerender(SAMPLE, {
      edit: { commit: (key, value) => edits.push([key, value]) },
    });
    const heading = document.body.querySelector('h2') as HTMLElement;
    expect(heading.getAttribute('contenteditable')).toBe('true');
    expect(heading.getAttribute('aria-label')).toBe('The problem — Heading');
    heading.textContent = 'A new sentence';
    heading.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual([['heading', 'A new sentence']]);
    // The signs are a list, edited in the inspector — never inline.
    expect(document.body.querySelector('li [contenteditable]')).toBeNull();
  });

  it('starts a new section with real sentences and a few signs', () => {
    const starter = problemDefinition.starter({ courseTitle: 'Steady Ground' });
    expect(starter.heading?.length).toBeGreaterThan(10);
    expect(starter.points?.length).toBeGreaterThanOrEqual(2);
    expect(starter.points?.length).toBeLessThanOrEqual(4);
    expect(JSON.stringify(starter)).not.toMatch(/lorem|placeholder/i);
  });
});
