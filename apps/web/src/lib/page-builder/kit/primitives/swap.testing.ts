/**
 * Drives `swap.ts` in a component test. Imported by tests only.
 *
 * jsdom runs no container queries and its observers never report, so a
 * section that swaps on a phone, mounted without this, stays the markup it was
 * served as: the no-JS state. With `stubSwap(rootClass)` in a `beforeEach`:
 *
 *   - `reportPlace(isIntersecting, top)` tells every observed element where it
 *     is, as an IntersectionObserver would (`whenAhead`);
 *   - `resize(phone)` moves the section across its phone-width breakpoint: the
 *     stylesheet's `--_phone` flag on the element carrying `rootClass` answers
 *     accordingly, every size observer reports, then a frame runs
 *     (`phoneWidth`). `reportSize` and `frames` are its two halves, for a test
 *     that must look between them.
 */
import { vi } from 'vitest';
import { flushSync } from '$tests/utils/component-test-utils.svelte';

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

export function reportPlace(isIntersecting: boolean, top: number) {
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

let phoneWidth = true;
const sizeObservers: FakeSizeObserver[] = [];

class FakeSizeObserver {
  targets: Element[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    sizeObservers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
}

/** Frames the page has asked for, run by `frames()`. */
let queued: FrameRequestCallback[] = [];

export function frames() {
  const due = queued;
  queued = [];
  for (const callback of due) callback(0);
  flushSync();
}

/** The section crosses the breakpoint: the observers report (no frame yet). */
export function reportSize(phone: boolean) {
  phoneWidth = phone;
  for (const observer of sizeObservers) {
    if (observer.targets.length > 0)
      observer.callback([], observer as unknown as ResizeObserver);
  }
  flushSync();
}

export function resize(phone: boolean) {
  reportSize(phone);
  frames();
}

/** Where the section starts, before it mounts: nothing is told. */
export function startAt(phone: boolean) {
  phoneWidth = phone;
}

/** Every element a size observer is watching. */
export function watchedForSize(): Element[] {
  return sizeObservers.flatMap((observer) => observer.targets);
}

/**
 * Installs the fakes, starting at phone width. `rootClass` names the element
 * the stylesheet sets `--_phone` on (the attached element).
 */
export function stubSwap(rootClass: string) {
  observers.length = 0;
  sizeObservers.length = 0;
  phoneWidth = true;
  queued = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('ResizeObserver', FakeSizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    queued.push(callback)
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queued.splice(id - 1, 1, () => {});
  });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    if (!element.classList.contains(rootClass)) return style;
    return new Proxy(style, {
      get(target, property) {
        if (property === 'getPropertyValue')
          return (name: string) =>
            name === '--_phone'
              ? phoneWidth
                ? '1'
                : ''
              : target.getPropertyValue(name);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
}

export function unstubSwap() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
