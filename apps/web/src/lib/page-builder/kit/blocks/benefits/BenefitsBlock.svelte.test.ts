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
});
