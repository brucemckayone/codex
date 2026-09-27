import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countUp, figureAt, parseFigure } from './count-up';

describe('which figures count', () => {
  it.each([
    [
      '4,000+',
      { prefix: '', value: 4000, decimals: 0, grouped: true, suffix: '+' },
    ],
    [
      '20 min',
      { prefix: '', value: 20, decimals: 0, grouped: false, suffix: ' min' },
    ],
    [
      '£49',
      { prefix: '£', value: 49, decimals: 0, grouped: false, suffix: '' },
    ],
    [
      '4.9★',
      { prefix: '', value: 4.9, decimals: 1, grouped: false, suffix: '★' },
    ],
    [
      '98%',
      { prefix: '', value: 98, decimals: 0, grouped: false, suffix: '%' },
    ],
    [
      '£1.5k',
      { prefix: '£', value: 1.5, decimals: 1, grouped: false, suffix: 'k' },
    ],
    [
      '1,200',
      { prefix: '', value: 1200, decimals: 0, grouped: true, suffix: '' },
    ],
    [
      '12h',
      { prefix: '', value: 12, decimals: 0, grouped: false, suffix: 'h' },
    ],
    ['6', { prefix: '', value: 6, decimals: 0, grouped: false, suffix: '' }],
  ])('%s counts, its signs and words kept as they are', (text, figure) => {
    expect(parseFigure(text)).toEqual(figure);
  });

  it.each([
    ['24/7', 'a digit after the amount'],
    ['1h 30m', 'two amounts'],
    ['4.9/5', 'a rating out of five'],
    ['10²', 'a power'],
    ['2019', 'a year'],
    ['007', 'a code'],
    ['0', 'nothing to count'],
    ['.5', 'a decimal cut short'],
    ['4,5', 'not grouped in threes'],
    ['Top 10', 'words before it'],
    ['Lifetime', 'no amount at all'],
  ])('%s never counts (%s)', (text) => {
    expect(parseFigure(text)).toBeNull();
    expect(countUp(text)).toBeUndefined();
  });

  it('writes every counting figure back exactly as it was written', () => {
    for (const text of [
      '4,000+',
      '1,000,000',
      '20 min',
      '£49',
      '4.90',
      '£1.5k',
      '6',
      '98%',
    ])
      expect(figureAt(parseFigure(text)!, 1)).toBe(text);
  });

  it('counts from zero, grouped as the figure is', () => {
    const figure = parseFigure('4,000+')!;
    expect(figureAt(figure, 0)).toBe('0+');
    expect(figureAt(figure, 0.5)).toBe('2,000+');
    expect(figureAt(parseFigure('1500')!, 0.9)).toBe('1350');
    expect(figureAt(parseFigure('4.9★')!, 0.5)).toBe('2.5★');
  });
});

// ── the attachment ───────────────────────────────────────────────────────
class FakeObserver {
  static last: FakeObserver | null = null;
  targets: Element[] = [];
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.last = this;
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** The browser reporting where the figure is. */
  report(isIntersecting: boolean) {
    const entry = {
      isIntersecting,
      target: this.targets[0],
    } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

let frames: FrameRequestCallback[] = [];
let progress = 0;
let finish: () => void = () => {};
const animate = vi.fn();

function fakeAnimation() {
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    effect: { getComputedTiming: () => ({ progress }) },
    finished,
    cancel: vi.fn(),
  };
}

function reduced(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
}

/** A figure's element with the motion tokens its page would give it. */
function figure(text: string, style: Record<string, string> = {}) {
  const value = document.createElement('span');
  value.textContent = text;
  value.style.setProperty('--duration-slowest', '800ms');
  value.style.setProperty('--ease-out', 'cubic-bezier(0, 0, 0.2, 1)');
  for (const [key, entry] of Object.entries(style))
    value.style.setProperty(key, entry);
  document.body.appendChild(value);
  return value;
}

/** What a screen reader reads: the text outside anything aria-hidden. */
function spoken(value: HTMLElement) {
  const clone = value.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]'))
    hidden.remove();
  return clone.textContent;
}

describe('counting up', () => {
  const realAnimate = Element.prototype.animate;

  beforeEach(() => {
    FakeObserver.last = null;
    frames = [];
    progress = 0;
    animate.mockReset().mockImplementation(fakeAnimation);
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback)
    );
    vi.stubGlobal('cancelAnimationFrame', () => {});
    Element.prototype.animate = animate as unknown as Element['animate'];
    reduced(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.animate = realAnimate;
    document.body.innerHTML = '';
  });

  const step = (to: number) => {
    progress = to;
    const pending = frames;
    frames = [];
    for (const frame of pending) frame(0);
  };

  it('leaves a figure that is on screen as the page wakes up exactly as it is', () => {
    const value = figure('4,000+');
    countUp('4,000+')!(value);
    FakeObserver.last!.report(true);
    expect(FakeObserver.last!.disconnected).toBe(true);
    expect([...value.childNodes].map((node) => node.nodeType)).toEqual([
      Node.TEXT_NODE,
    ]);
    expect(value.hasAttribute('data-lp-counting')).toBe(false);
    expect(animate).not.toHaveBeenCalled();
  });

  it('waits at zero out of sight, the real value still there for a screen reader', () => {
    const value = figure('4,000+');
    countUp('4,000+')!(value);
    FakeObserver.last!.report(false);
    const copy = value.querySelector('.lp-count');
    expect(value.hasAttribute('data-lp-counting')).toBe(true);
    expect(copy?.getAttribute('aria-hidden')).toBe('true');
    expect(copy?.textContent).toBe('0+');
    expect(spoken(value)).toBe('4,000+');
    expect(animate).not.toHaveBeenCalled();
  });

  it('counts once it is seen, timed and eased by the motion tokens, then is itself again', async () => {
    const value = figure('4,000+');
    countUp('4,000+')!(value);
    FakeObserver.last!.report(false);
    FakeObserver.last!.report(true);
    expect(FakeObserver.last!.disconnected).toBe(true);
    expect(animate).toHaveBeenCalledWith(null, {
      duration: 1600,
      easing: 'cubic-bezier(0, 0, 0.2, 1)',
      fill: 'forwards',
    });
    const copy = value.querySelector('.lp-count');
    expect(copy?.textContent).toBe('0+');
    step(0.5);
    expect(copy?.textContent).toBe('2,000+');
    expect(spoken(value)).toBe('4,000+');
    step(1);
    finish();
    await Promise.resolve();
    expect(value.querySelector('.lp-count')).toBeNull();
    expect(value.hasAttribute('data-lp-counting')).toBe(false);
    expect(value.textContent).toBe('4,000+');
  });

  it('never runs on a still page', () => {
    const still = document.createElement('div');
    still.setAttribute('data-lp-still', '');
    const value = figure('4,000+');
    still.appendChild(value);
    document.body.appendChild(still);
    countUp('4,000+')!(value);
    expect(FakeObserver.last).toBeNull();
  });

  it('never runs under reduced motion', () => {
    reduced(true);
    const value = figure('4,000+');
    countUp('4,000+')!(value);
    expect(FakeObserver.last).toBeNull();
  });

  it('stays still where the Style says so', () => {
    const value = figure('4,000+', { '--lp-stat-count': 'none' });
    countUp('4,000+')!(value);
    expect(FakeObserver.last).toBeNull();
  });

  it('shows the real value again when it goes away mid-way', () => {
    const value = figure('4,000+');
    const cleanup = countUp('4,000+')!(value) as () => void;
    FakeObserver.last!.report(false);
    cleanup();
    expect(value.querySelector('.lp-count')).toBeNull();
    expect(value.hasAttribute('data-lp-counting')).toBe(false);
  });
});
