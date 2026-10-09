/**
 * Test doubles for the motion tests: jsdom has no IntersectionObserver and no
 * Web Animations. Imported by tests only.
 */
import { vi } from 'vitest';

/** An IntersectionObserver the test reports through, like the browser would. */
export class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {}
  ) {
    FakeObserver.all.push(this);
  }

  observe(el: Element) {
    this.targets.add(el);
  }

  unobserve(el: Element) {
    this.targets.delete(el);
  }

  disconnect() {
    this.targets.clear();
  }

  takeRecords() {
    return [];
  }

  /** Where `el` is: its top edge, on a screen `height` tall. */
  report(
    el: Element,
    {
      top,
      intersecting,
      height = 1000,
    }: { top: number; intersecting: boolean; height?: number }
  ) {
    if (!this.targets.has(el)) return;
    const entry = {
      target: el,
      isIntersecting: intersecting,
      boundingClientRect: { top },
      rootBounds: { height },
    } as unknown as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

/** The page stage's two observers: where things are, and the line. */
function latest(line: boolean): FakeObserver {
  const found = FakeObserver.all
    .filter((o) => !!o.options.rootMargin === line)
    .at(-1);
  if (!found) throw new Error(`no ${line ? 'line' : 'view'} observer yet`);
  return found;
}
export const viewObserver = () => latest(false);
export const lineObserver = () => latest(true);

/** The observers watching `el`: where it is, or the line (a root margin). */
const watching = (el: Element, line: boolean) =>
  FakeObserver.all.filter(
    (o) => o.targets.has(el) && !!o.options.rootMargin === line
  );

/** The browser seeing `el` on screen, below the fold, or already passed. */
export function wake(el: Element, where: 'on' | 'below' | 'above') {
  const top = { on: 300, below: 1600, above: -900 }[where];
  for (const o of watching(el, false))
    o.report(el, { top, intersecting: where === 'on' });
}

/** `el` clearing the line above the floating call to action. */
export function cross(el: Element) {
  for (const o of watching(el, true))
    o.report(el, { top: 500, intersecting: true });
}

export function install({ reduced = false } = {}) {
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced,
    media: query,
  }));
}

interface FakeAnimation {
  animationName?: string;
  effect: { target: Element };
  timeline: unknown;
  finished: Promise<unknown>;
}

/**
 * What `motion.css` would give each element once it is armed. `moves(el)`
 * says whether a waiting element has an entrance (a CSS animation in time).
 */
export function animate(moves: (el: Element) => FakeAnimation[]) {
  const real = Element.prototype.getAnimations;
  Element.prototype.getAnimations = function (this: Element) {
    return this.hasAttribute('data-lp-enter')
      ? (moves(this) as unknown as Animation[])
      : [];
  };
  return () => {
    Element.prototype.getAnimations = real;
  };
}

/** A CSS animation in time on `el`, finishing when `done` resolves. */
export function entranceOn(
  el: Element,
  done: Promise<unknown> = Promise.resolve()
): FakeAnimation {
  return {
    animationName: 'lp-build-rise',
    effect: { target: el },
    timeline: el.ownerDocument.timeline,
    finished: done,
  };
}
