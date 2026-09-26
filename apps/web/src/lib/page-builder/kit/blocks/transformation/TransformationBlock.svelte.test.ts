import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { COPY } from '../../model/copy';
import { SECTION_LAYOUTS } from '../../model/ids';
import { featuredScheme } from '../../model/resolve';
import { type SampleOfferState, sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { TRANSFORMATION_EMPTY, transformationDefinition } from './definition';
import TransformationBlock from './TransformationBlock.svelte';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

const SAMPLE = transformationDefinition.sample;

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
    id: 'transformation-1',
    anchor: 'transformation',
    type: 'transformation',
    index: 4,
    layout: options.layout ?? 'columns',
    scheme: 'contrast',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(TransformationBlock, {
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
const one = (selector: string) => document.body.querySelector(selector);
const all = (selector: string) => [...document.body.querySelectorAll(selector)];

describe('TransformationBlock', () => {
  it.each(
    SECTION_LAYOUTS.transformation
  )('%s: shows the heading, both titles and every line', async (layout) => {
    await render(
      { ...SAMPLE, body: 'Six weeks of small, steady changes.' },
      { layout }
    );
    expect(one('h2')?.textContent).toBe(SAMPLE.heading);
    expect(text()).toContain('Six weeks of small, steady changes.');
    for (const line of [
      SAMPLE.beforeLabel,
      SAMPLE.afterLabel,
      ...(SAMPLE.before ?? []),
      ...(SAMPLE.after ?? []),
    ]) {
      expect(text()).toContain(line);
    }
  });

  it('draws each layout as its own composition', async () => {
    const shapes = new Set<string>();
    for (const layout of SECTION_LAYOUTS.transformation) {
      await rerender(SAMPLE, { layout });
      shapes.add(
        (one('.tf > :not(header)') as HTMLElement).className.split(' ')[0]
      );
    }
    expect(shapes.size).toBe(SECTION_LAYOUTS.transformation.length);
  });

  it('takes its heading level from the section', async () => {
    await render({ ...SAMPLE }, { headingLevel: 1 });
    expect(one('h1')?.textContent).toBe(SAMPLE.heading);
    await rerender({ ...SAMPLE });
    expect(one('h1')).toBeNull();
    expect(one('h2')?.textContent).toBe(SAMPLE.heading);
  });

  it('columns: the after side is the one filled panel, in the featured scheme', async () => {
    await render(SAMPLE, { layout: 'columns' });
    const after = one('.tf-col[data-side="after"]');
    expect(after?.getAttribute('data-lp-scheme')).toBe(
      featuredScheme('bold', 'contrast')
    );
    expect(
      one('.tf-col[data-side="before"]')?.hasAttribute('data-lp-scheme')
    ).toBe(false);
  });

  it('columns: each list is named by its own title', async () => {
    await render(SAMPLE, { layout: 'columns' });
    for (const side of ['before', 'after']) {
      const list = one(`.tf-col[data-side="${side}"] ul`);
      const id = list?.getAttribute('aria-labelledby') ?? '';
      expect(document.getElementById(id)?.textContent).toBe(
        side === 'before' ? SAMPLE.beforeLabel : SAMPLE.afterLabel
      );
    }
  });

  it('steps: pairs lines by position, and joins only a complete pair', async () => {
    await render(
      {
        before: ['Rushed mornings', 'A busy head', 'Tired by noon'],
        after: ['A quiet start'],
      },
      { layout: 'steps' }
    );
    const rows = all('.tf-step');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Rushed mornings');
    expect(rows[0].textContent).toContain('A quiet start');
    expect(rows[0].querySelector('.tf-link')).not.toBeNull();
    // A line without a partner still shows — only its connector is left out.
    expect(rows[2].textContent).toContain('Tired by noon');
    expect(rows[2].querySelector('.tf-link')).toBeNull();
  });

  it('steps: a screen reader hears each line with its side', async () => {
    await render(SAMPLE, { layout: 'steps' });
    const spoken = all('.tf-step .sr-only').map((el) => el.textContent);
    expect(spoken.slice(0, 2)).toEqual([
      `${SAMPLE.beforeLabel}: `,
      `${SAMPLE.afterLabel}: `,
    ]);
    expect(
      all('.tf-link').every((el) => el.getAttribute('aria-hidden') === 'true')
    ).toBe(true);
  });

  it('statement: one connector between the two sides, and none for one side', async () => {
    await render(SAMPLE, { layout: 'statement' });
    expect(all('.tf-link')).toHaveLength(1);
    await rerender({ after: ['A quiet start'] }, { layout: 'statement' });
    expect(all('.tf-link')).toHaveLength(0);
    expect(text()).toContain('A quiet start');
  });

  it.each(
    SECTION_LAYOUTS.transformation
  )('%s: with no lines, the page leaves the change out and the canvas asks for it', async (layout) => {
    await render({ heading: 'H' }, { layout });
    expect(one('ul')).toBeNull();
    expect(text()).not.toContain(TRANSFORMATION_EMPTY);
    await rerender({ heading: 'H' }, { layout, edit: { commit: () => {} } });
    expect(text()).toContain(TRANSFORMATION_EMPTY);
  });

  it('renders only its own words', async () => {
    await render({});
    expect(one('h2')).toBeNull();
    expect(text()).not.toContain(sampleContext().course.title);
  });

  it('offers a way in only when the creator writes one, in every state', async () => {
    await render(SAMPLE);
    expect(one('a')).toBeNull();
    await rerender({ ...SAMPLE, ctaLabel: 'Begin', note: 'Start any time.' });
    expect(one('a')?.getAttribute('href')).toBe(
      '/journeys/steady-ground/checkout'
    );
    expect(text()).toContain('Start any time.');
    await rerender({ ...SAMPLE, ctaLabel: 'Begin' }, { offer: 'enrolled' });
    expect(one('a')?.textContent?.trim()).toBe(COPY.cta.continue);
    await rerender({ ...SAMPLE, ctaLabel: 'Begin' }, { offer: 'unavailable' });
    expect(text()).toContain(COPY.cta.unavailableTitle);
  });

  it('edits the heading and both titles in place, only on the canvas', async () => {
    await render(SAMPLE);
    expect(one('[contenteditable]')).toBeNull();

    const edits: [string, string][] = [];
    await rerender(SAMPLE, {
      edit: { commit: (key, value) => edits.push([key, value]) },
    });
    const before = one('.tf-label[data-side="before"]') as HTMLElement;
    expect(before.getAttribute('contenteditable')).toBe('true');
    expect(before.getAttribute('aria-label')).toBe(
      'Before and after — Before title'
    );
    before.textContent = 'Right now';
    before.dispatchEvent(new Event('input', { bubbles: true }));
    const after = one('.tf-label[data-side="after"]') as HTMLElement;
    expect(after.getAttribute('aria-label')).toBe(
      'Before and after — After title'
    );
    expect(one('h2')?.getAttribute('contenteditable')).toBe('true');
    expect(edits).toEqual([['beforeLabel', 'Right now']]);
    // The lines themselves are lists, edited in the inspector.
    expect(one('li [contenteditable]')).toBeNull();
  });

  it('starts a new section from the course title, with real pairs', () => {
    const starter = transformationDefinition.starter({
      courseTitle: 'Steady Ground',
    });
    expect(starter.heading).toContain('Steady Ground');
    expect(starter.before?.length).toBe(starter.after?.length);
    expect(starter.before?.length).toBeGreaterThanOrEqual(2);
    expect(starter.before?.length).toBeLessThanOrEqual(4);
  });
});
