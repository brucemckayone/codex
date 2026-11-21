/**
 * The title as the film's window on Corner and Wide (Codex-1yd58.7, WP-6;
 * owner, 2026-11-21): its words where the page lays them out, taken back by
 * the words' swap transform, drawn white on black in the title's font, and
 * no mask at all when there is no word to draw (so the motion falls back).
 * jsdom lays nothing out, so each word's Range box is given here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  drawTitleMask,
  titleWords,
  translationOf,
  wordsAt,
} from './title-mask';

describe('wordsAt', () => {
  it('finds each word and where it sits, past any whitespace', () => {
    expect(wordsAt('\n  Of Blood &  Bones ')).toEqual([
      { word: 'Of', start: 3, end: 5 },
      { word: 'Blood', start: 6, end: 11 },
      { word: '&', start: 12, end: 13 },
      { word: 'Bones', start: 15, end: 20 },
    ]);
    expect(wordsAt('   ')).toEqual([]);
  });
});

describe('translationOf', () => {
  it('reads a 2D and a 3D matrix’s translation, and none for none', () => {
    expect(translationOf('none')).toEqual({ x: 0, y: 0 });
    expect(translationOf('')).toEqual({ x: 0, y: 0 });
    expect(translationOf('matrix(1, 0, 0, 1, 4, 12)')).toEqual({ x: 4, y: 12 });
    expect(
      translationOf('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3, 8, 0, 1)')
    ).toEqual({ x: -3, y: 8 });
  });
});

describe('titleWords and drawTitleMask', () => {
  /** The boxes jsdom cannot lay out: word i of the title, in a row. */
  const box = (i: number, shift = 0) => ({
    left: 40 + 120 * i,
    top: 300 + shift,
    width: 100,
    height: 80,
  });
  let rise = 0;
  let style: Partial<CSSStyleDeclaration> = {};
  let drawn: { text: string; x: number; y: number; font: string }[] = [];
  let context: Record<string, unknown> | null = null;

  beforeEach(() => {
    rise = 0;
    style = { transform: 'none' };
    drawn = [];
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: Range) {
        const before = (this.startContainer.textContent ?? '')
          .slice(0, this.startOffset)
          .trim();
        const i = before ? before.split(/\s+/).length : 0;
        return box(i, rise);
      },
    });
    for (const [side, size] of [
      ['clientWidth', 1280],
      ['clientHeight', 800],
    ] as const)
      Object.defineProperty(document.documentElement, side, {
        configurable: true,
        value: size,
      });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      const computed = real(el);
      return new Proxy(computed, {
        get: (target, prop) =>
          prop in style
            ? style[prop as keyof CSSStyleDeclaration]
            : Reflect.get(target, prop, target),
      });
    });
    context = {
      scale() {},
      fillRect() {},
      fillText(text: string, x: number, y: number) {
        drawn.push({ text, x, y, font: String(context?.font) });
      },
      font: '',
      fillStyle: '',
      textAlign: '',
      textBaseline: '',
      letterSpacing: '0px',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => context as unknown as CanvasRenderingContext2D
    );
  });

  afterEach(() => {
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const title = (text: string) => {
    const el = document.createElement('h2');
    el.textContent = text;
    document.body.appendChild(el);
    return el;
  };

  it('places each word at its laid-out box', () => {
    const words = titleWords(title('Of Blood & Bones'));
    expect(words.map((w) => w.text)).toEqual(['Of', 'Blood', '&', 'Bones']);
    expect(words[3]).toEqual({ text: 'Bones', ...box(3) });
  });

  it('places the words where the title sits, not where its swap’s rise has it this frame', () => {
    // Mid-rise: the title, and so every word box, 12 px down.
    rise = 12;
    style = { transform: 'matrix(1, 0, 0, 1, 0, 12)' };
    const words = titleWords(title('Of Blood'));
    expect(words[1]?.top).toBe(box(1).top);
  });

  it('reads words across the title’s own elements, as the page wraps them', () => {
    const el = title('');
    el.innerHTML = 'River <em>Songs</em>';
    expect(titleWords(el).map((w) => w.text)).toEqual(['River', 'Songs']);
  });

  it('draws each word white on black in the title’s font, its middle line through its box’s', () => {
    style = {
      transform: 'none',
      fontWeight: '400',
      fontSize: '96px',
      fontFamily: 'Brand Serif',
      letterSpacing: '-0.02em',
    };
    const canvas = drawTitleMask(title('Of Blood'));
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(drawn).toEqual([
      {
        text: 'Of',
        x: box(0).left,
        y: box(0).top + 40,
        font: '400 96px Brand Serif',
      },
      {
        text: 'Blood',
        x: box(1).left,
        y: box(1).top + 40,
        font: '400 96px Brand Serif',
      },
    ]);
    expect(context?.letterSpacing).toBe('-0.02em');
    expect(context?.fillStyle).toBe('#fff');
  });

  it('draws no mask for a title with no words, so the motion falls back', () => {
    expect(drawTitleMask(title('  '))).toBeNull();
    expect(drawn).toEqual([]);
  });

  it('draws no mask before the window is laid out', () => {
    Reflect.deleteProperty(document.documentElement, 'clientWidth');
    expect(drawTitleMask(title('Of Blood'))).toBeNull();
  });
});
