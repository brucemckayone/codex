/**
 * PreviewFrame paints its iframe with the framed page's background. A
 * dialog in the preview keeps the framed page's scrollbar gutter, and
 * Chromium leaves a frame's gutter unpainted: the strip beside the dialog
 * showed the iframe's own background, the studio's surface, whatever the
 * preview's theme (Codex-q6qjb). Measured in Chromium with a classic
 * scrollbar, the real org layout in a real PreviewFrame, preview toggled to
 * dark: the strip went from rgb(245, 239, 230) to the page's
 * rgb(31, 42, 51). jsdom loads nothing into a frame, and refuses to watch
 * a frame's nodes, so a document of this window stands in for the framed
 * page, and a window holding this one's MutationObserver and a computed
 * background for it: the test writes the page's <html> background, as
 * followLayoutBackground does.
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import PreviewFrame from './PreviewFrame.svelte';

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

/** A mounted, loaded PreviewFrame, its framed page a stand-in document. */
function loadedFrame() {
  component = mount(PreviewFrame, {
    target: document.body,
    props: {
      src: '/',
      title: 'Preview',
      route: 'landing',
      theme: 'light',
      origin: location.origin,
    },
  });
  flushSync();
  const iframe = document.querySelector('iframe');
  const page = document.implementation.createHTMLDocument('framed page');
  const view = {
    MutationObserver,
    getComputedStyle: (el: HTMLElement) => ({
      backgroundColor: el.style.backgroundColor || 'rgba(0, 0, 0, 0)',
    }),
  };
  if (iframe) {
    Object.defineProperty(iframe, 'contentDocument', { get: () => page });
    Object.defineProperty(iframe, 'contentWindow', { get: () => view });
  }
  iframe?.dispatchEvent(new Event('load'));
  flushSync();
  return { iframe, root: page.documentElement };
}

describe('PreviewFrame · the framed page’s background', () => {
  test('the iframe takes the framed page’s <html> background, and follows it', async () => {
    const { iframe, root } = loadedFrame();

    root.style.setProperty('background-color', 'rgb(245, 239, 230)');
    await Promise.resolve();
    expect(iframe?.style.backgroundColor).toBe('rgb(245, 239, 230)');

    // The preview toggled to dark: the page re-copies its own background.
    root.style.setProperty('background-color', 'rgb(31, 42, 51)');
    await Promise.resolve();
    expect(iframe?.style.backgroundColor).toBe('rgb(31, 42, 51)');

    // A page with no background of its own leaves the iframe its own.
    root.style.removeProperty('background-color');
    await Promise.resolve();
    expect(iframe?.style.backgroundColor).toBe('');
  });
});
