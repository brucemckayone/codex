import { tick } from 'svelte';
import { parse } from 'svelte/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { SECTION_LAYOUTS } from '../../model/ids';
import { sampleContext } from '../../model/sample';
import type { BlockEdit, ResolvedSection } from '../../model/types';
import { STORY_COPY } from './copy';
import { STORY_EMPTY, type StoryStep, storyDefinition } from './definition';
import StoryBlock from './StoryBlock.svelte';
import CHAPTERS_SOURCE from './StoryChapters.svelte?raw';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE = storyDefinition.sample;
const CDN = 'https://cdn.test';

async function render(
  props: Record<string, unknown>,
  options: {
    layout?: string;
    headingLevel?: 1 | 2;
    edit?: BlockEdit | null;
    target?: HTMLElement;
  } = {}
) {
  const section: ResolvedSection = {
    id: 'story-1',
    anchor: 'story',
    type: 'story',
    index: 3,
    layout: options.layout ?? 'scroll',
    scheme: 'base',
    spacing: 'regular',
    headingLevel: options.headingLevel ?? 2,
  };
  app = mount(StoryBlock, {
    target: options.target ?? document.body,
    props: {
      props,
      section,
      context: sampleContext({ mediaBaseUrl: CDN }),
      edit: options.edit ?? null,
    },
  });
  flushSync();
  await tick();
}

async function rerender(...args: Parameters<typeof render>) {
  if (app) unmount(app);
  app = null;
  await render(...args);
}

const text = () => document.body.textContent ?? '';
const one = (selector: string) => document.body.querySelector(selector);
const all = (selector: string) => [...document.body.querySelectorAll(selector)];

/** `count` moments, every other one pictured (the first is). */
function moments(count: number): StoryStep[] {
  return Array.from({ length: count }, (_, i) => ({
    heading: `Moment ${i + 1}`,
    body: `What happens in moment ${i + 1}.`,
    ...(i % 2 === 0
      ? { image: { key: `img/${i + 1}`, alt: `Picture ${i + 1}` } }
      : {}),
  }));
}

/** An observer the test drives (the shared jsdom stub never reports). */
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

/** Reports every observed moment, with `active` crossing the middle line. */
function reach(active: number) {
  for (const observer of observers) {
    const entries = observer.targets.map(
      (target, index) =>
        ({
          target,
          isIntersecting: index === active,
        }) as unknown as IntersectionObserverEntry
    );
    if (entries.length > 0)
      observer.callback(entries, observer as unknown as IntersectionObserver);
  }
  flushSync();
}

function preferReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('StoryBlock', () => {
  it.each(
    SECTION_LAYOUTS.story
  )('%s: the heading, then every moment in order under it', async (layout) => {
    await render(SAMPLE, { layout });
    expect(one('h2')?.textContent).toBe(SAMPLE.heading);
    const list = one('ol');
    expect(list).not.toBeNull();
    const names = [...(list?.querySelectorAll('h3') ?? [])].map(
      (h) => h.textContent
    );
    expect(names).toEqual(SAMPLE.steps?.map((step) => step.heading));
    for (const step of SAMPLE.steps ?? []) expect(text()).toContain(step.body);
  });

  it('draws each layout as its own composition', async () => {
    const shapes = new Set<string>();
    for (const layout of SECTION_LAYOUTS.story) {
      await rerender(SAMPLE, { layout });
      shapes.add(
        (one('.story > :not(header)') as HTMLElement).className.split(' ')[0]
      );
    }
    expect(shapes.size).toBe(SECTION_LAYOUTS.story.length);
  });

  it.each(
    SECTION_LAYOUTS.story
  )('%s: one moment, and eight, each with or without its picture', async (layout) => {
    await render({ steps: moments(1) }, { layout });
    expect(all('ol > li')).toHaveLength(1);
    await rerender({ steps: moments(8) }, { layout });
    expect(all('ol > li')).toHaveLength(8);
    // A moment's picture is described by its own words.
    const pictures = all('ol img').map((img) => img.getAttribute('alt'));
    expect(pictures).toEqual([
      'Picture 1',
      'Picture 3',
      'Picture 5',
      'Picture 7',
    ]);
    // Without a heading above, a moment takes the section's level.
    expect(all('h2')).toHaveLength(8);
  });

  it.each(
    SECTION_LAYOUTS.story
  )('%s: with no moments, the page leaves them out and the canvas asks for them', async (layout) => {
    await render({ heading: 'H' }, { layout });
    expect(one('ol')).toBeNull();
    expect(text()).not.toContain(STORY_EMPTY);
    await rerender({ heading: 'H' }, { layout, edit: { commit: () => {} } });
    expect(one('[data-lp-edit-only]')?.textContent).toBe(STORY_EMPTY);
  });

  it('resolves pictures at the size each layout draws them', async () => {
    await render({ steps: moments(1) }, { layout: 'scroll' });
    expect(one('ol img')?.getAttribute('src')).toBe(`${CDN}/img/1/md.webp`);
    await rerender({ steps: moments(1) }, { layout: 'chapters' });
    expect(one('ol img')?.getAttribute('src')).toBe(`${CDN}/img/1/lg.webp`);
  });

  it('edits the heading in place only on the canvas; a moment is edited in the inspector', async () => {
    await render(SAMPLE);
    expect(one('[contenteditable]')).toBeNull();
    await rerender(SAMPLE, { edit: { commit: () => {} } });
    expect(one('h2')?.getAttribute('contenteditable')).toBe('true');
    expect(one('li [contenteditable]')).toBeNull();
  });
});

describe('StoryBlock — scroll', () => {
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });

  it('before its script runs, every moment shows its own picture beside it', async () => {
    await render({ steps: moments(3) }, { layout: 'scroll' });
    const root = one('.story-scroll');
    expect(root?.hasAttribute('data-live')).toBe(false);
    expect(
      all('.story-scroll__step')[0].querySelector('img')?.getAttribute('alt')
    ).toBe('Picture 1');
    // The frame is a duplicate for the eye alone.
    expect(one('.story-scroll__frame')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(
      all('.story-scroll__frame img').every(
        (img) => img.getAttribute('alt') === ''
      )
    ).toBe(true);
  });

  it('follows the moment being read; one without a picture keeps the last', async () => {
    await render({ steps: moments(4) }, { layout: 'scroll' });
    reach(0);
    expect(one('.story-scroll')?.hasAttribute('data-live')).toBe(true);
    const shown = () =>
      one('.story-scroll__shot[data-shown] img')?.getAttribute('src');
    const activeStep = () =>
      all('.story-scroll__step').findIndex((s) =>
        s.hasAttribute('data-active')
      );
    expect(shown()).toBe(`${CDN}/img/1/md.webp`);
    expect(activeStep()).toBe(0);
    reach(1);
    expect(activeStep()).toBe(1);
    expect(shown()).toBe(`${CDN}/img/1/md.webp`);
    reach(2);
    expect(shown()).toBe(`${CDN}/img/3/md.webp`);
    expect(all('.story-scroll__shot[data-shown]')).toHaveLength(1);
  });

  it('never moves under reduced motion', async () => {
    preferReducedMotion();
    await render({ steps: moments(3) }, { layout: 'scroll' });
    expect(observers).toHaveLength(0);
    expect(one('.story-scroll')?.hasAttribute('data-live')).toBe(false);
  });

  it('stays still on the canvas and in previews', async () => {
    const still = document.createElement('div');
    still.className = 'lp';
    still.setAttribute('data-lp-still', '');
    document.body.appendChild(still);
    await render({ steps: moments(3) }, { layout: 'scroll', target: still });
    expect(observers).toHaveLength(0);
    expect(one('.story-scroll')?.hasAttribute('data-live')).toBe(false);
  });

  it('with no pictures at all there is no frame', async () => {
    await render(SAMPLE, { layout: 'scroll' });
    expect(one('.story-scroll__frame')).toBeNull();
  });
});

describe('StoryBlock — chapters', () => {
  it('sets every moment as a scene on the media ink, a picture behind the pictured ones', async () => {
    await render({ steps: moments(3) }, { layout: 'chapters' });
    const scenes = all('.story-chapter');
    expect(scenes).toHaveLength(3);
    for (const scene of scenes)
      expect(scene.hasAttribute('data-lp-on-media')).toBe(true);
    const [first, second] = scenes;
    expect(first.hasAttribute('data-pictured')).toBe(true);
    expect(first.querySelector('img')?.getAttribute('alt')).toBe('Picture 1');
    // Only the picture drifts; the words never do.
    expect(
      first.querySelector('[data-lp-parallax]')?.querySelector('img')
    ).not.toBeNull();
    expect(all('[data-lp-parallax]')).toHaveLength(2);
    // Unpictured: a designed title card, lit by the brand glow.
    expect(second.hasAttribute('data-pictured')).toBe(false);
    expect(second.querySelector('img')).toBeNull();
    expect(second.querySelector('.lp-atmos')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('numbers the scenes for the eye; the list already numbers them for a screen reader', async () => {
    await render({ steps: moments(2) }, { layout: 'chapters' });
    const numbers = all('.story-chapter__num');
    expect(numbers.map((n) => n.textContent)).toEqual(['01', '02']);
    expect(numbers.every((n) => n.getAttribute('aria-hidden') === 'true')).toBe(
      true
    );
  });

  /**
   * Each rule's declarations in StoryChapters' `<style>`, by selector. The
   * comments go first, so a commented-out declaration is no declaration.
   */
  function chaptersRules(): Map<string, Map<string, string>> {
    const source = CHAPTERS_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');
    type Node = {
      type: string;
      prelude?: string | { children: { start: number; end: number }[] };
      property?: string;
      value?: string;
      block?: { children: Node[] } | null;
    };
    const rules = new Map<string, Map<string, string>>();
    const walk = (nodes: Node[]) => {
      for (const node of nodes) {
        if (node.type === 'Atrule') walk(node.block?.children ?? []);
        else if (
          node.type === 'Rule' &&
          typeof node.prelude === 'object' &&
          node.prelude
        ) {
          const selector = node.prelude.children
            .map((part) =>
              source.slice(part.start, part.end).replace(/\s+/g, ' ').trim()
            )
            .join(', ');
          const declared = rules.get(selector) ?? new Map<string, string>();
          for (const child of node.block?.children ?? [])
            if (child.type === 'Declaration')
              declared.set(child.property ?? '', (child.value ?? '').trim());
          rules.set(selector, declared);
        }
      }
    };
    walk(
      (parse(source, { modern: true }).css?.children ?? []) as unknown as Node[]
    );
    return rules;
  }

  // A subgrid's column gap is centred on the page's own column lines, so any
  // column gap on the list pushes the content track — and every scene's
  // words — half a gap off the content line (7px at 1440 under Soft).
  it('keeps the words on the content line: the list spaces rows only, and a scene zeroes its column gap', () => {
    const rules = chaptersRules();
    const list = rules.get('.story-chapters');
    const scene = rules.get('.story-chapter');
    expect(list?.get('grid-template-columns')).toBe('subgrid');
    expect(list?.has('row-gap')).toBe(true);
    expect(list?.has('gap')).toBe(false);
    expect(list?.has('column-gap')).toBe(false);
    expect(scene?.get('grid-template-columns')).toBe('subgrid');
    expect(scene?.get('column-gap')).toBe('0');
  });
});

describe('StoryBlock — strip', () => {
  const region = () => one('[role="region"]') as HTMLElement;
  const buttons = () => all('.story-strip__move') as HTMLButtonElement[];
  const resting = (button: HTMLButtonElement) =>
    button.getAttribute('aria-disabled') === 'true';

  it('is the kit’s strip, keeping the block’s own class names for its parts', async () => {
    await render(SAMPLE, { layout: 'strip' });
    expect(one('.story-strip > .lp-strip')).not.toBeNull();
    for (const [part, own] of [
      ['lp-strip__track', 'story-strip__track'],
      ['lp-strip__items', 'story-strip__cards'],
      ['lp-strip__nav', 'story-strip__nav'],
    ]) {
      expect(one(`.${part}`)?.classList.contains(own)).toBe(true);
    }
    expect(all('.lp-strip__move.story-strip__move')).toHaveLength(2);
    expect(all('.story-strip__cards > li.story-strip__card')).toHaveLength(
      SAMPLE.steps?.length ?? 0
    );
  });

  it('is a labelled region a keyboard can focus and scroll', async () => {
    await render(SAMPLE, { layout: 'strip' });
    expect(region().getAttribute('aria-label')).toBe(SAMPLE.heading);
    expect(region().tabIndex).toBe(0);
    region().focus();
    expect(document.activeElement).toBe(region());
    await rerender({ steps: moments(2) }, { layout: 'strip' });
    expect(region().getAttribute('aria-label')).toBe(STORY_COPY.strip);
  });

  it('before its script has measured the row, both buttons rest (no-JS: left out by CSS)', async () => {
    await render(SAMPLE, { layout: 'strip' });
    const [previous, next] = buttons();
    expect(previous.getAttribute('aria-label')).toBe(STORY_COPY.previous);
    expect(next.getAttribute('aria-label')).toBe(STORY_COPY.next);
    for (const button of [previous, next]) {
      expect(button.getAttribute('aria-controls')).toBe(region().id);
      expect(resting(button)).toBe(true);
      // Resting, not disabled: a keyboard keeps its place on it.
      expect(button.disabled).toBe(false);
    }
    expect(one('.story-strip__nav')?.hasAttribute('data-idle')).toBe(true);
  });

  describe('with a row wider than the screen', () => {
    // Cards 300 wide, 20 apart: they start at 0, 320, 640…
    let scrollLeft = 0;
    const scrollTo = vi.fn();

    beforeEach(() => {
      scrollLeft = 0;
      scrollTo.mockReset();
      const dimension = (name: string, value: (el: HTMLElement) => number) =>
        vi
          .spyOn(HTMLElement.prototype, name as 'scrollWidth', 'get')
          .mockImplementation(function (this: HTMLElement) {
            return value(this);
          });
      const isTrack = (el: HTMLElement) =>
        el.classList.contains('story-strip__track');
      dimension('scrollWidth', (el) => (isTrack(el) ? 2000 : 0));
      dimension('clientWidth', (el) => (isTrack(el) ? 800 : 0));
      vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(
        () => scrollLeft
      );
      Object.defineProperty(Element.prototype, 'scrollTo', {
        configurable: true,
        writable: true,
        value: scrollTo,
      });
      // Each card sits at its start, less the scroll, past a 48px inset.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          const index = this.parentElement
            ? [...this.parentElement.children].indexOf(this)
            : 0;
          return { left: 48 + index * 320 - scrollLeft, width: 300 } as DOMRect;
        }
      );
    });

    const scrolled = (value: number) => {
      scrollLeft = value;
      region().dispatchEvent(new Event('scroll'));
      flushSync();
    };

    it('moves one card at a time and rests at each end, keeping the keyboard on the button', async () => {
      await render({ steps: moments(8) }, { layout: 'strip' });
      const [previous, next] = buttons();
      expect(resting(previous)).toBe(true);
      expect(resting(next)).toBe(false);
      expect(one('.story-strip__nav')?.hasAttribute('data-idle')).toBe(false);
      next.focus();
      next.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'smooth',
      });
      scrolled(640);
      expect(resting(previous)).toBe(false);
      previous.click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'smooth',
      });
      scrolled(1200);
      expect(resting(next)).toBe(true);
      expect(document.activeElement).toBe(next);
      scrollTo.mockReset();
      next.click();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('jumps rather than glides under reduced motion', async () => {
      preferReducedMotion();
      await render({ steps: moments(8) }, { layout: 'strip' });
      buttons()[1].click();
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 320,
        behavior: 'auto',
      });
    });
  });

  it('words-only cards when no moment has a picture; the plate keeps the rhythm when some do', async () => {
    await render(SAMPLE, { layout: 'strip' });
    expect(one('.story-strip')?.hasAttribute('data-pictured')).toBe(false);
    expect(one('.lp-media')).toBeNull();
    await rerender({ steps: moments(2) }, { layout: 'strip' });
    expect(one('.story-strip')?.hasAttribute('data-pictured')).toBe(true);
    expect(all('.story-strip__card .lp-media')).toHaveLength(2);
    expect(all('.story-strip__card img')).toHaveLength(1);
  });
});
