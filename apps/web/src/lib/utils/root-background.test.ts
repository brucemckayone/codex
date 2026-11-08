/**
 * `followLayoutBackground`: <html> carries the org layout's background (its
 * `--color-background` token, once the layout is transparent), and takes it
 * again whenever something changes it under the layout's own state. jsdom
 * resolves no custom properties, so the layout's computed background and
 * token are stubbed: each test sets what the browser would compute after a
 * change, then makes the change. Whether the strip beside a dialog really
 * shows it was measured in Chromium and WebKit with a classic scrollbar, in
 * the real layout inside a real PreviewFrame and in the real studio layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followLayoutBackground } from './root-background';

const LIGHT = 'rgb(245, 239, 230)';
const DARK = 'rgb(31, 42, 51)';
const html = document.documentElement;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const CLEAR = 'rgba(0, 0, 0, 0)';
let paint = LIGHT;
let token = LIGHT;
let layout: HTMLElement;
let stop: () => void = () => {};

/** The MutationObserver's microtask, then every frame it asked for. */
async function settle() {
  await Promise.resolve();
  const due = [...frames.values()];
  frames = new Map();
  for (const callback of due) callback(0);
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        backgroundColor: paint,
        getPropertyValue: (name: string) =>
          name === '--color-background' ? token : '',
      }) as CSSStyleDeclaration
  );
  layout = document.createElement('div');
  layout.className = 'org-layout';
  document.body.appendChild(layout);
  paint = LIGHT;
  token = LIGHT;
});

afterEach(() => {
  stop();
  layout.remove();
  html.removeAttribute('data-theme');
  html.className = '';
  html.style.cssText = '';
  frames = new Map();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('followLayoutBackground', () => {
  it("copies the layout's background onto <html>", async () => {
    stop = followLayoutBackground(layout);
    await settle();
    expect(html.style.backgroundColor).toBe(LIGHT);
  });

  // PreviewFrame stamps the preview's theme straight onto a framed page's
  // <html>: nothing in the frame's state changes (review c6, q6qjb).
  it("takes it again when <html>'s theme changes: a toggle, or PreviewFrame's stamp", async () => {
    stop = followLayoutBackground(layout);
    await settle();

    paint = DARK;
    html.setAttribute('data-theme', 'dark');
    html.classList.add('dark');
    await settle();

    expect(html.style.backgroundColor).toBe(DARK);
  });

  it.each([
    ['the preview theme', 'data-editing-theme', 'dark'],
    ['an edit', 'style', '--brand-bg: #1f2a33'],
    ['a route change', 'class', 'org-layout org-layout--landing'],
  ])('takes it again on %s, on the layout', async (_, attribute, value) => {
    stop = followLayoutBackground(layout);
    await settle();

    paint = DARK;
    layout.setAttribute(attribute, value);
    await settle();

    expect(html.style.backgroundColor).toBe(DARK);
  });

  // The studio's layout is transparent: its surfaces mix the token over
  // <html>. With no copy, the strip showed the platform's background beside
  // the org's (review fu-focus-2).
  it("copies the layout's --color-background once the layout is transparent (the studio)", async () => {
    stop = followLayoutBackground(layout);
    await settle();

    paint = CLEAR;
    token = DARK;
    layout.classList.add('org-layout--studio');
    await settle();

    expect(html.style.backgroundColor).toBe(DARK);
  });

  it('copies it on a page loaded in the studio', async () => {
    paint = CLEAR;
    token = DARK;
    layout.classList.add('org-layout--studio');
    stop = followLayoutBackground(layout);
    await settle();

    expect(html.style.backgroundColor).toBe(DARK);
  });

  it('takes the token again on a theme toggle in the studio', async () => {
    paint = CLEAR;
    stop = followLayoutBackground(layout);
    await settle();
    expect(html.style.backgroundColor).toBe(LIGHT);

    token = DARK;
    html.setAttribute('data-theme', 'dark');
    await settle();

    expect(html.style.backgroundColor).toBe(DARK);
  });

  // <html> ignores a value it can't parse, so the old copy stood.
  it.each([
    ['no token', ''],
    ['a token <html> cannot parse', 'not-a-colour'],
  ])('leaves no stale copy with %s', async (_, value) => {
    stop = followLayoutBackground(layout);
    await settle();
    expect(html.style.backgroundColor).toBe(LIGHT);

    paint = CLEAR;
    token = value;
    layout.classList.add('org-layout--studio');
    await settle();

    expect(html.style.backgroundColor).toBe('');
  });

  it('samples once a frame, however many changes come in it', async () => {
    stop = followLayoutBackground(layout);
    await settle();
    const read = vi.mocked(window.getComputedStyle);
    read.mockClear();

    // Two observer callbacks before the frame comes.
    html.setAttribute('data-theme', 'dark');
    await Promise.resolve();
    layout.setAttribute('data-editing-theme', 'dark');
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops following, and takes the copy off, when it is let go', async () => {
    stop = followLayoutBackground(layout);
    await settle();
    stop();
    stop = () => {};
    expect(html.style.backgroundColor).toBe('');

    paint = DARK;
    html.setAttribute('data-theme', 'dark');
    await settle();
    expect(html.style.backgroundColor).toBe('');
  });
});
