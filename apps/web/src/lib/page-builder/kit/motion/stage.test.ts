import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Actor, stageFor } from './stage';
import {
  cross,
  FakeObserver,
  install,
  lineObserver,
  viewObserver,
  wake,
} from './testing';

function actor(arms = true) {
  return {
    arm: vi.fn(() => arms),
    play: vi.fn(),
    settle: vi.fn(),
  } satisfies Actor;
}

let page: HTMLElement;

function placed() {
  const el = document.createElement('div');
  page.appendChild(el);
  return el;
}

/** How far the page can still scroll down. */
function scrollable(px: number) {
  const doc = document.documentElement;
  Object.defineProperty(doc, 'scrollHeight', {
    configurable: true,
    value: 1000 + px,
  });
  Object.defineProperty(doc, 'clientHeight', {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(doc, 'scrollTop', { configurable: true, value: 0 });
}

beforeEach(() => {
  install();
  page = document.createElement('div');
  page.className = 'lp';
  document.body.appendChild(page);
  scrollable(5000);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the entrance stage', () => {
  it('never arms an element on screen as the page wakes up', () => {
    const el = placed();
    const part = actor();
    stageFor(el)?.add(el, part);
    wake(el, 'on');
    expect(part.arm).not.toHaveBeenCalled();
    expect(lineObserver().targets.has(el)).toBe(false);
    cross(el);
    expect(part.play).not.toHaveBeenCalled();
  });

  it('never arms one the visitor has already passed', () => {
    const el = placed();
    const part = actor();
    stageFor(el)?.add(el, part);
    wake(el, 'above');
    expect(part.arm).not.toHaveBeenCalled();
  });

  it('arms one below the fold and plays it once, when it clears the line', () => {
    const el = placed();
    const part = actor();
    stageFor(el)?.add(el, part);
    wake(el, 'below');
    expect(part.arm).toHaveBeenCalledTimes(1);
    expect(part.play).not.toHaveBeenCalled();
    cross(el);
    expect(part.play).toHaveBeenCalledExactlyOnceWith(0);
    cross(el);
    expect(part.play).toHaveBeenCalledTimes(1);
  });

  it('waits for the line while the page can still lift it there', () => {
    const el = placed();
    const part = actor();
    stageFor(el)?.add(el, part);
    wake(el, 'below');
    // In view at the foot of the screen, with plenty of page still to come.
    viewObserver().report(el, { top: 950, intersecting: true });
    expect(part.play).not.toHaveBeenCalled();
  });

  it('plays at the foot of a short page that cannot scroll it to the line', () => {
    const el = placed();
    const part = actor();
    stageFor(el)?.add(el, part);
    wake(el, 'below');
    scrollable(20);
    viewObserver().report(el, { top: 950, intersecting: true });
    expect(part.play).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('steps in the ones that clear the line together', () => {
    const els = [placed(), placed(), placed(), placed(), placed()];
    const parts = els.map(() => actor());
    for (const [index, el] of els.entries())
      stageFor(el)?.add(el, parts[index]);
    for (const el of els) wake(el, 'below');
    const entries = els.map(
      (target) =>
        ({
          target,
          isIntersecting: true,
        }) as unknown as IntersectionObserverEntry
    );
    lineObserver().callback(
      entries,
      lineObserver() as unknown as IntersectionObserver
    );
    expect(parts.map((part) => part.play.mock.calls[0]?.[0])).toEqual([
      0, 1, 2, 3, 3,
    ]);
  });

  it('lets go of one with nothing to play', () => {
    const el = placed();
    const part = actor(false);
    stageFor(el)?.add(el, part);
    wake(el, 'below');
    expect(part.arm).toHaveBeenCalled();
    expect(lineObserver().targets.has(el)).toBe(false);
  });

  it('arms a second actor on an element already waiting', () => {
    const el = placed();
    const first = actor();
    const second = actor();
    const stage = stageFor(el);
    stage?.add(el, first);
    wake(el, 'below');
    stage?.add(el, second);
    expect(second.arm).toHaveBeenCalledTimes(1);
    cross(el);
    expect(first.play).toHaveBeenCalled();
    expect(second.play).toHaveBeenCalled();
  });

  it('returns an element to its own look when it is taken off', () => {
    const el = placed();
    const part = actor();
    const release = stageFor(el)?.add(el, part);
    wake(el, 'below');
    release?.();
    expect(part.settle).toHaveBeenCalled();
    expect(viewObserver().targets.size + lineObserver().targets.size).toBe(0);
  });

  it('keeps no observer once everything has played', () => {
    const el = placed();
    const stage = stageFor(el);
    stage?.add(el, actor());
    wake(el, 'below');
    cross(el);
    expect(viewObserver().targets.size + lineObserver().targets.size).toBe(0);
    // The next element gets a fresh stage, and fresh observers.
    const next = placed();
    expect(stageFor(next)).not.toBe(stage);
  });

  it('draws the line over the floating call to action, never lower than 15%', () => {
    const bar = document.createElement('aside');
    bar.className = 'lp-sticky';
    Object.defineProperty(bar, 'offsetHeight', { value: 72 });
    Object.defineProperty(bar, 'offsetTop', { value: innerHeight - 300 });
    page.appendChild(bar);
    const el = placed();
    stageFor(el)?.add(el, actor());
    const share = Math.round((300 / innerHeight + 0.02) * 100);
    expect(lineObserver().options.rootMargin).toBe(`0px 0px -${share}% 0px`);

    page.innerHTML = '';
    FakeObserver.all = [];
    const plain = document.createElement('div');
    plain.className = 'lp';
    document.body.appendChild(plain);
    const alone = document.createElement('div');
    plain.appendChild(alone);
    stageFor(alone)?.add(alone, actor());
    expect(lineObserver().options.rootMargin).toBe('0px 0px -15% 0px');
  });

  it('stages nothing on a still page, under reduced motion, or without observers', () => {
    page.setAttribute('data-lp-still', '');
    expect(stageFor(placed())).toBeNull();
    page.removeAttribute('data-lp-still');
    install({ reduced: true });
    expect(stageFor(placed())).toBeNull();
    install();
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(stageFor(placed())).toBeNull();
  });
});
