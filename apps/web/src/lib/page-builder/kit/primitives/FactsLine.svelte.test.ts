import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FactsLine from './FactsLine.svelte';
import SOURCE from './FactsLine.svelte?raw';

let app: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (app) unmount(app);
  app = null;
  document.body.innerHTML = '';
});

async function render(facts: readonly string[], className?: string) {
  app = mount(FactsLine, {
    target: document.body,
    props: { facts, class: className },
  });
  flushSync();
  await tick();
}

const FACTS = ['6 stages', '24 practices', '2 hr 41 min of video and audio'];
const line = () => document.body.querySelector('.lp-facts');
const facts = () => [
  ...document.body.querySelectorAll<HTMLElement>('.lp-facts__fact'),
];

describe('FactsLine', () => {
  it('draws nothing when there is nothing to say', async () => {
    await render([]);
    expect(document.body.innerHTML).not.toContain('lp-facts');
  });

  it('draws each fact in order, one paragraph, never a list', async () => {
    await render(FACTS);
    expect(line()?.tagName).toBe('P');
    expect(document.body.querySelector('li')).toBeNull();
    expect(facts().map((fact) => fact.textContent)).toEqual([
      FACTS[0],
      `, ${FACTS[1]}`,
      `, ${FACTS[2]}`,
    ]);
  });

  it('pauses between facts with a hidden comma, its drawn dots silent', async () => {
    await render(FACTS);
    // The dots are CSS (`content: '·' / ''`), so the text is the facts and
    // the pauses alone; the first fact has none before it.
    expect(line()?.textContent).toBe(FACTS.join(', '));
    expect(line()?.textContent).not.toContain('·');
    const [first, ...rest] = facts();
    expect(first.querySelector('.sr-only')).toBeNull();
    for (const fact of rest) {
      expect(fact.firstElementChild?.classList.contains('sr-only')).toBe(true);
    }
  });

  // An engine without the silent `content` form drops that declaration; the
  // plain dot before it keeps the facts parted and fills the run's shift.
  it('draws a plain dot first, for an engine that cannot keep it silent', () => {
    const rule =
      SOURCE.match(/\.lp-facts__fact::before \{([^}]*)\}/)?.[1] ?? '';
    const contents = [...rule.matchAll(/content: ([^;]+);/g)].map(
      ([, value]) => value
    );
    expect(contents).toEqual(["'·'", "'·' / ''"]);
  });

  it('parts nothing for a single fact', async () => {
    await render(['3 stages']);
    expect(line()?.textContent).toBe('3 stages');
    expect(document.body.querySelector('.sr-only')).toBeNull();
  });

  it('takes the parent’s class beside its own', async () => {
    await render(FACTS, 'hero__facts');
    expect(line()?.classList.contains('lp-facts')).toBe(true);
    expect(line()?.classList.contains('hero__facts')).toBe(true);
  });

  it('is served unmarked: where each line starts is only known once laid out', async () => {
    await render(FACTS);
    expect(document.body.querySelector('[data-starts]')).toBeNull();
  });
});

describe('FactsLine — a centred line hides the dot each line starts with', () => {
  /** Where each fact sits, top and height, as the browser would lay them out. */
  let tops: number[] = [];
  const observers: { callback: ResizeObserverCallback; targets: Element[] }[] =
    [];

  class FakeSizeObserver {
    targets: Element[] = [];
    constructor(readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }
    observe(target: Element) {
      this.targets.push(target);
    }
    unobserve() {}
    disconnect() {
      this.targets = [];
    }
  }

  /** The browser lays the line out again, and the observers report. */
  function layOut(next: number[]) {
    tops = next;
    for (const observer of observers) {
      if (observer.targets.length > 0)
        observer.callback([], observer as unknown as ResizeObserver);
    }
    flushSync();
  }

  beforeEach(() => {
    observers.length = 0;
    tops = [];
    vi.stubGlobal('ResizeObserver', FakeSizeObserver);
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(
      function (this: HTMLElement) {
        return tops[facts().indexOf(this)] ?? 0;
      }
    );
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const marked = () => facts().map((fact) => fact.hasAttribute('data-starts'));

  it('watches the run and every fact, so a font that re-wraps it is seen', async () => {
    await render(FACTS);
    const watched = observers.flatMap((observer) => observer.targets);
    expect(watched).toContain(document.body.querySelector('.lp-facts__run'));
    for (const fact of facts()) expect(watched).toContain(fact);
  });

  it('marks each fact that starts a new line, and none on one line', async () => {
    await render(FACTS);
    layOut([0, 0, 0]);
    expect(marked()).toEqual([false, false, false]);
    layOut([0, 0, 24]);
    expect(marked()).toEqual([false, false, true]);
    layOut([0, 24, 24]);
    expect(marked()).toEqual([false, true, false]);
    layOut([0, 24, 48]);
    expect(marked()).toEqual([false, true, true]);
  });

  it('reads a fact a little lower on the same line as the same line', async () => {
    await render(FACTS);
    layOut([0, 3, 3]);
    expect(marked()).toEqual([false, false, false]);
  });

  it('stops watching once the line goes', async () => {
    await render(FACTS);
    if (app) unmount(app);
    app = null;
    expect(observers.flatMap((observer) => observer.targets)).toHaveLength(0);
  });

  it('watches nothing for a single fact, which never parts', async () => {
    await render(['3 stages']);
    expect(observers.flatMap((observer) => observer.targets)).toHaveLength(0);
  });
});
