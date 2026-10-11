/**
 * The live veil's runtime (03 X54). The DOM's reader needs a browser's
 * cascade and canvas, which jsdom has neither of: the e2e measures what it
 * reads on a real page. Here a section is handed in, the shader's reports
 * go through the real channel, and the frames are run by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  shaderTone,
  TONE_SETTLE_SAMPLES,
} from '$lib/components/ui/ShaderHero/shader-tone';
import {
  accumulateTone,
  emptyToneGrid,
  TONE_COLS,
  TONE_ROWS,
} from '$lib/components/ui/ShaderHero/tone-grid';
import {
  atmosphereVeil,
  sectionNeed,
  type VeilLine,
  type VeilSection,
} from './atmosphere-veil';
import type { Rgb } from './model/live-veil';

const PAPER: Rgb = [232, 236, 214]; // of-blood-and-bones' light veil
const SOFT_INK: Rgb = [77, 78, 70]; // and its soft ink on it
const DUSK: Rgb = [60, 64, 40];
const viewport = { width: 400, height: 200 };

const line = (
  box: { left: number; top: number; right: number; bottom: number },
  rgb: Rgb = SOFT_INK,
  floor = 4.5
): VeilLine & { at: typeof box } => {
  const l = { rgb, floor, at: box, box: () => l.at };
  return l;
};
const section = (
  lines: VeilLine[],
  el = document.createElement('div')
): VeilSection => ({
  el,
  ground: PAPER,
  thin: 0.71,
  floor: 0.82,
  lines,
});

/** A grid of 4 × 2 cells of 100px, each drawing `at(cell)`. */
function grid(at: (cell: number) => Rgb) {
  const g = emptyToneGrid(4, 2);
  const rgba = new Uint8ClampedArray(8 * 4);
  for (let cell = 0; cell < 8; cell++) rgba.set([...at(cell), 255], cell * 4);
  accumulateTone(g, rgba);
  return g;
}

describe('sectionNeed', () => {
  const left = { left: 10, top: 10, right: 90, bottom: 40 }; // cell 0
  const right = { left: 310, top: 10, right: 390, bottom: 40 }; // cell 3

  it('is unmeasured before the shader reports, and has nothing to judge off the window', () => {
    expect(
      sectionNeed(section([line(left)]), emptyToneGrid(4, 2), viewport)
    ).toBeNull();
    const off = line({ left: 10, top: -80, right: 90, bottom: -20 });
    expect(
      sectionNeed(
        section([off]),
        grid(() => PAPER),
        viewport
      )
    ).toBeNull();
    // Nor a line with no box: one that is not drawn.
    const none = line({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(
      sectionNeed(
        section([none]),
        grid(() => DUSK),
        viewport
      )
    ).toBeNull();
  });

  it("is the Style's veil over a shader as light as the paper, and thicker over a dark one", () => {
    expect(
      sectionNeed(
        section([line(left)]),
        grid(() => PAPER),
        viewport
      )
    ).toBe(0.71);
    const dark = sectionNeed(
      section([line(left)]),
      grid(() => DUSK),
      viewport
    );
    expect(dark).toBeGreaterThan(0.71);
    expect(dark).toBeLessThanOrEqual(0.82);
  });

  it('holds each ink against the cells under it alone', () => {
    // Dark on the left, paper on the right. The soft ink sits on the paper;
    // a pale mark sits on the dark, where it holds 3:1 at any veil here.
    const shader = grid((cell) => (cell % 4 === 0 ? DUSK : PAPER));
    const ink = line(right);
    const mark = line(left, [235, 235, 225], 1.2);
    expect(sectionNeed(section([ink, mark]), shader, viewport)).toBe(0.71);
    // Moved over the dark, the soft ink needs more.
    ink.at = left;
    expect(sectionNeed(section([ink, mark]), shader, viewport)).toBeGreaterThan(
      0.71
    );
  });

  it('judges again when the shader reports again, though the line has not moved', () => {
    const memo = new Map();
    const g = grid(() => PAPER);
    const s = section([line(left)]);
    expect(sectionNeed(s, g, viewport, memo)).toBe(0.71);
    accumulateTone(
      g,
      new Uint8ClampedArray(8 * 4)
        .fill(0)
        .map((_, i) => (i % 4 === 3 ? 255 : 40))
    );
    expect(sectionNeed(s, g, viewport, memo)).toBeGreaterThan(0.71);
  });

  it("reaches as far as the shader's blur: a dark cell beside the line counts", () => {
    // The line is over paper; the cell beside it is dark, 20px off its edge.
    const shader = grid((cell) => (cell === 1 ? DUSK : PAPER));
    const s = section([line({ left: 10, top: 10, right: 80, bottom: 40 })]);
    expect(sectionNeed(s, shader, viewport)).toBe(0.71);
    expect(
      sectionNeed(s, shader, viewport, new Map(), { reach: 40 })
    ).toBeGreaterThan(0.71);
  });

  it('judges nothing until the shader has been watched for long enough', () => {
    const s = section([line(left)]);
    expect(
      sectionNeed(
        s,
        grid(() => PAPER),
        viewport,
        new Map(),
        { settled: false }
      )
    ).toBeNull();
  });
});

describe('atmosphereVeil', () => {
  let frames: FrameRequestCallback[] = [];
  let observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] =
    [];
  /** What a change of size in `el` reports, to whoever observes it. */
  const resize = (el: Element) => {
    for (const o of observers)
      if (o.targets.has(el)) o.callback([], {} as ResizeObserver);
  };
  const flush = () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  };
  /** One frame of the shader, all `rgb`; still (exact at once) or moving. */
  const report = (rgb: Rgb, still = true) => {
    const rgba = new Uint8ClampedArray(TONE_COLS * TONE_ROWS * 4);
    for (let cell = 0; cell < TONE_COLS * TONE_ROWS; cell++)
      rgba.set([...rgb, 255], cell * 4);
    shaderTone.record(rgba, { still, blur: 0 });
  };
  const need = (el: HTMLElement) => el.style.getPropertyValue('--_atmos-need');
  const across = () => line({ left: 10, top: 10, right: 390, bottom: 40 });

  beforeEach(() => {
    frames = [];
    observers = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly targets = new Set<Element>();
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, targets: this.targets });
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
      }
    );
    for (const [side, size] of [
      ['clientWidth', viewport.width],
      ['clientHeight', viewport.height],
    ] as const)
      Object.defineProperty(document.documentElement, side, {
        configurable: true,
        value: size,
      });
  });

  afterEach(() => {
    shaderTone.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
    document.body.replaceChildren();
  });

  it('asks the shader for nothing on a page that is not live, or with no veil to thin', () => {
    const read = vi.fn(() => []);
    const root = document.createElement('div');
    const off = atmosphereVeil(false, read)(root);
    expect(read).not.toHaveBeenCalled();
    expect(shaderTone.wanted).toBe(false);
    off?.();

    const detach = atmosphereVeil(true, read)(root);
    expect(read).toHaveBeenCalledTimes(1);
    expect(shaderTone.wanted).toBe(false);
    detach?.();
  });

  it('asks while a section may thin, sets its veil from each report, and lets go when the page leaves', () => {
    const s = section([across()]);
    const detach = atmosphereVeil(true, () => [s])(
      document.createElement('div')
    );
    expect(shaderTone.wanted).toBe(true);
    // Unmeasured: the proven veil.
    expect(need(s.el)).toBe('');

    report(PAPER);
    flush();
    expect(need(s.el)).toBe('0.71');
    report(DUSK);
    flush();
    expect(Number(need(s.el))).toBeGreaterThan(0.71);

    detach?.();
    expect(shaderTone.wanted).toBe(false);
    expect(need(s.el)).toBe('');
  });

  it('watches a moving shader for a few seconds before it thins anything', () => {
    const s = section([across()]);
    const detach = atmosphereVeil(true, () => [s])(
      document.createElement('div')
    );
    for (let i = 1; i < TONE_SETTLE_SAMPLES; i++) {
      report(PAPER, false);
      flush();
    }
    expect(need(s.el)).toBe('');
    report(PAPER, false);
    flush();
    expect(need(s.el)).toBe('0.71');
    detach?.();
  });

  it('eases in as it thins, and thickens at once', () => {
    const s = section([across()]);
    const detach = atmosphereVeil(true, () => [s])(
      document.createElement('div')
    );
    report(PAPER);
    flush();
    expect(s.el.hasAttribute('data-lp-veil-easing')).toBe(true);
    report(DUSK);
    flush();
    expect(Number(need(s.el))).toBeGreaterThan(0.71);
    expect(s.el.hasAttribute('data-lp-veil-easing')).toBe(false);
    detach?.();
  });

  it('keeps its veil while none of its inks is on the window', () => {
    const words = across();
    const s = section([words]);
    const detach = atmosphereVeil(true, () => [s])(
      document.createElement('div')
    );
    report(DUSK);
    flush();
    const held = need(s.el);
    expect(Number(held)).toBeGreaterThan(0.71);

    words.at = { left: 10, top: -90, right: 390, bottom: -60 };
    window.dispatchEvent(new Event('scroll'));
    flush();
    expect(need(s.el)).toBe(held);
    detach?.();
  });

  it('drops every veil the moment the shader starts over, before its next frame', () => {
    const s = section([across()]);
    const detach = atmosphereVeil(true, () => [s])(
      document.createElement('div')
    );
    report(PAPER);
    flush();
    expect(need(s.el)).toBe('0.71');
    shaderTone.clear();
    // No frame run: the new picture is never painted under the old veil.
    expect(need(s.el)).toBe('');
    detach?.();
  });

  it('measures again when a scroller inside the page moves, or a section changes size', () => {
    // The shader dark over the window's top half, paper over its bottom.
    const rgba = new Uint8ClampedArray(TONE_COLS * TONE_ROWS * 4);
    for (let cell = 0; cell < TONE_COLS * TONE_ROWS; cell++) {
      const top = Math.floor(cell / TONE_COLS) < TONE_ROWS / 2;
      rgba.set([...(top ? DUSK : PAPER), 255], cell * 4);
    }
    const words = line({ left: 10, top: 10, right: 390, bottom: 40 });
    const s = section([words]);
    const root = document.createElement('div');
    const strip = document.createElement('div');
    root.appendChild(strip);
    document.body.appendChild(root);
    const detach = atmosphereVeil(true, () => [s])(root);
    shaderTone.record(rgba, { still: true, blur: 0 });
    flush();
    expect(Number(need(s.el))).toBeGreaterThan(0.71);

    // A scroller inside the page carries the words down over the paper.
    words.at = { left: 10, top: 150, right: 390, bottom: 180 };
    strip.dispatchEvent(new Event('scroll'));
    flush();
    expect(need(s.el)).toBe('0.71');

    // Content above them grows (a <details> opening) and pushes them back up.
    words.at = { left: 10, top: 10, right: 390, bottom: 40 };
    resize(s.el);
    flush();
    expect(Number(need(s.el))).toBeGreaterThan(0.71);
    detach?.();
  });

  it('reaches as far as the shader says its blur does', () => {
    // Dark over the window's top half; the words just below it, on paper.
    const rgba = new Uint8ClampedArray(TONE_COLS * TONE_ROWS * 4);
    for (let cell = 0; cell < TONE_COLS * TONE_ROWS; cell++) {
      const top = Math.floor(cell / TONE_COLS) < TONE_ROWS / 2;
      rgba.set([...(top ? DUSK : PAPER), 255], cell * 4);
    }
    const s = section([line({ left: 10, top: 112, right: 390, bottom: 140 })]);
    const detach = atmosphereVeil(true, () => [s])(
      document.createElement('div')
    );
    shaderTone.record(rgba, { still: true, blur: 0 });
    flush();
    expect(need(s.el)).toBe('0.71');
    shaderTone.clear();
    shaderTone.record(rgba, { still: true, blur: 20 });
    flush();
    expect(Number(need(s.el))).toBeGreaterThan(0.71);
    detach?.();
  });

  it('measures a count as it rolls, and reads the page again only once it stops', async () => {
    const read = vi.fn(() => [section([across()])]);
    const root = document.createElement('div');
    const figure = document.createElement('span');
    figure.textContent = '0';
    root.appendChild(figure);
    const detach = atmosphereVeil(true, read)(root);
    expect(read).toHaveBeenCalledTimes(1);
    for (const n of ['1', '2', '3']) {
      figure.textContent = n;
      await Promise.resolve();
      flush();
    }
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    flush();
    expect(read).toHaveBeenCalledTimes(2);

    // A new element is a new ink: read at once.
    root.appendChild(document.createElement('p'));
    await Promise.resolve();
    flush();
    expect(read).toHaveBeenCalledTimes(3);
    detach?.();
  });

  it("reading the page again keeps a section's veil rather than starting it over", async () => {
    const s = section([across()]);
    const root = document.createElement('div');
    root.appendChild(s.el);
    const detach = atmosphereVeil(true, () => [s])(root);
    report(PAPER);
    flush();
    expect(need(s.el)).toBe('0.71');
    const writes: MutationRecord[] = [];
    new MutationObserver((r) => writes.push(...r)).observe(s.el, {
      attributes: true,
    });
    document.documentElement.setAttribute('data-theme', 'dark');
    await Promise.resolve();
    flush();
    await Promise.resolve();
    expect(need(s.el)).toBe('0.71');
    expect(writes).toEqual([]);
    detach?.();
  });

  it("does not read the page again when a veil's own easing ends, only when a colour's does", () => {
    const read = vi.fn();
    const s = section([across()]);
    read.mockReturnValue([s]);
    const root = document.createElement('div');
    const link = document.createElement('a');
    root.appendChild(s.el);
    root.appendChild(link);
    const detach = atmosphereVeil(true, read)(root);
    expect(read).toHaveBeenCalledTimes(1);
    s.el.dispatchEvent(new Event('transitionend', { bubbles: true }));
    vi.advanceTimersByTime(300);
    flush();
    expect(read).toHaveBeenCalledTimes(1);
    link.dispatchEvent(new Event('transitionend', { bubbles: true }));
    vi.advanceTimersByTime(300);
    flush();
    expect(read).toHaveBeenCalledTimes(2);
    detach?.();
  });

  it('reads the page again when the theme changes', async () => {
    const read = vi.fn(() => [section([])]);
    const detach = atmosphereVeil(true, read)(document.createElement('div'));
    expect(read).toHaveBeenCalledTimes(1);
    document.documentElement.setAttribute('data-theme', 'dark');
    await Promise.resolve();
    flush();
    expect(read).toHaveBeenCalledTimes(2);
    detach?.();
  });
});
