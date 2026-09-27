import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { TRANSFORMATION_COPY } from './copy';
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
    target?: HTMLElement;
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
    target: options.target ?? document.body,
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

/**
 * An observer the test drives: `report()` tells every observed element where
 * it is. (The shared jsdom stub never reports, so a toggle mounted without
 * this stays the columns it starts as — the no-JS markup.)
 */
const observers: FakeObserver[] = [];

class FakeObserver {
  targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
  takeRecords() {
    return [];
  }
}

function report(isIntersecting: boolean, top: number) {
  for (const observer of observers) {
    const entries = observer.targets.map(
      (target) =>
        ({
          target,
          isIntersecting,
          boundingClientRect: { top },
        }) as unknown as IntersectionObserverEntry
    );
    if (entries.length > 0)
      observer.callback(entries, observer as unknown as IntersectionObserver);
  }
  flushSync();
}

describe('TransformationBlock — toggle', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tabs = () => all('[role="tab"]') as HTMLButtonElement[];
  const panelOf = (tab: Element) =>
    document.getElementById(tab.getAttribute('aria-controls') ?? '');
  const key = (el: Element, name: string) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true })
    );
    flushSync();
  };

  it('before the script has placed it, reads both sides exactly like columns', async () => {
    await render(SAMPLE, { layout: 'toggle' });
    expect(one('[role="tablist"]')).toBeNull();
    expect(one('.tf-toggle .tf-cols')).not.toBeNull();
    for (const side of ['before', 'after']) {
      expect(one(`.tf-col[data-side="${side}"]`)?.hasAttribute('hidden')).toBe(
        false
      );
    }
    expect(text()).toContain(SAMPLE.before?.[0]);
    expect(text()).toContain(SAMPLE.after?.[0]);
  });

  it('becomes two tabs while the section is still ahead of the visitor', async () => {
    await render(SAMPLE, { layout: 'toggle' });
    report(false, 2000);
    const list = one('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toBe(TRANSFORMATION_COPY.switch);
    const [before, after] = tabs();
    expect(tabs().map((t) => t.textContent?.trim())).toEqual([
      SAMPLE.beforeLabel,
      SAMPLE.afterLabel,
    ]);
    expect(before.getAttribute('aria-selected')).toBe('true');
    expect(after.getAttribute('aria-selected')).toBe('false');
    for (const tab of [before, after]) {
      const panel = panelOf(tab);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
      expect(panel?.getAttribute('tabindex')).toBe('0');
    }
    expect(panelOf(before)?.hasAttribute('hidden')).toBe(false);
    expect(panelOf(after)?.hasAttribute('hidden')).toBe(true);
    // Every line is still in the page: the panel not shown keeps its place.
    for (const line of [...(SAMPLE.before ?? []), ...(SAMPLE.after ?? [])]) {
      expect(text()).toContain(line);
    }
    // The after side is the section's one filled panel, as in columns.
    expect(panelOf(after)?.getAttribute('data-lp-scheme')).toBe(
      featuredScheme('bold', 'contrast')
    );
  });

  it('never re-lays out a section the visitor is looking at', async () => {
    await render(SAMPLE, { layout: 'toggle' });
    report(true, 100);
    expect(one('[role="tablist"]')).toBeNull();
    // Scrolled past: still columns, it is above the visitor now.
    report(false, -900);
    expect(one('[role="tablist"]')).toBeNull();
    // Back ahead of them: now it can change.
    report(false, 1200);
    expect(one('[role="tablist"]')).not.toBeNull();
  });

  it('a still preview shows the tabs at once', async () => {
    const still = document.createElement('div');
    still.className = 'lp';
    still.setAttribute('data-lp-still', '');
    document.body.appendChild(still);
    await render(SAMPLE, { layout: 'toggle', target: still });
    report(true, 0);
    expect(tabs()).toHaveLength(2);
  });

  it('flips with a click, and only one panel is shown at a time', async () => {
    await render(SAMPLE, { layout: 'toggle' });
    report(false, 2000);
    const [before, after] = tabs();
    after.click();
    flushSync();
    expect(after.getAttribute('aria-selected')).toBe('true');
    expect(before.getAttribute('aria-selected')).toBe('false');
    expect(panelOf(after)?.hasAttribute('hidden')).toBe(false);
    expect(panelOf(before)?.hasAttribute('hidden')).toBe(true);
  });

  it('arrow keys, Home and End move the selection with the focus (roving tabindex)', async () => {
    await render(SAMPLE, { layout: 'toggle' });
    report(false, 2000);
    const [before, after] = tabs();
    expect([before.tabIndex, after.tabIndex]).toEqual([0, -1]);
    before.focus();
    key(before, 'ArrowRight');
    expect(document.activeElement).toBe(after);
    expect(after.getAttribute('aria-selected')).toBe('true');
    expect([before.tabIndex, after.tabIndex]).toEqual([-1, 0]);
    key(after, 'ArrowRight');
    expect(document.activeElement).toBe(before);
    key(before, 'ArrowLeft');
    expect(document.activeElement).toBe(after);
    key(after, 'Home');
    expect(document.activeElement).toBe(before);
    expect(before.getAttribute('aria-selected')).toBe('true');
    key(before, 'End');
    expect(document.activeElement).toBe(after);
    // Up and down stay the page's own (a horizontal tab list).
    key(after, 'ArrowUp');
    expect(document.activeElement).toBe(after);
    expect(after.getAttribute('aria-selected')).toBe('true');
  });

  it('names an untitled side plainly', async () => {
    await render(
      { before: ['Rushed mornings'], after: ['A quiet start'] },
      { layout: 'toggle' }
    );
    report(false, 2000);
    expect(tabs().map((t) => t.textContent?.trim())).toEqual([
      TRANSFORMATION_COPY.before,
      TRANSFORMATION_COPY.after,
    ]);
  });

  it('with one side written there is nothing to flip: it stays columns', async () => {
    await render({ after: ['A quiet start'] }, { layout: 'toggle' });
    report(false, 2000);
    expect(one('[role="tablist"]')).toBeNull();
    expect(text()).toContain('A quiet start');
  });

  it('a side with fewer lines still shows every line of its own', async () => {
    await render(
      { before: ['One', 'Two', 'Three'], after: ['Uno'] },
      { layout: 'toggle' }
    );
    report(false, 2000);
    expect(all('.tf-toggle__panel[data-side="before"] li')).toHaveLength(3);
    expect(all('.tf-toggle__panel[data-side="after"] li')).toHaveLength(1);
    expect(all('.tf-toggle__panel[data-side="after"] svg')).toHaveLength(1);
  });
});
