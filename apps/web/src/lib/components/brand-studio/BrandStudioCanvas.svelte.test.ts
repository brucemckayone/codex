/**
 * BrandStudioCanvas behaviour tests (Codex-cijzb · WP-1.3).
 *
 * Proves the live-preview canvas contract: the route switcher swaps the iframe
 * `src` (root-relative), the device switcher re-targets the viewport width, the
 * theme control reflects the selected mode, side-by-side renders two frames
 * (light + dark), and content routes are disabled when the org has no published
 * content. Loading the real page is a browser concern deferred to WP-1.8 visual
 * checks — here we assert the state the canvas drives, not iframe navigation.
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import BrandStudioCanvas from './BrandStudioCanvas.svelte';

const ORIGIN = 'https://acme.example';
const SLUG = 'my-first-video';

function groupButton(groupLabel: string, text: string): HTMLButtonElement {
  const group = document.querySelector(`[aria-label="${groupLabel}"]`);
  if (!group) throw new Error(`group "${groupLabel}" not found`);
  const button = [...group.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === text
  );
  if (!button) throw new Error(`button "${text}" not found in "${groupLabel}"`);
  return button as HTMLButtonElement;
}

function iframes(): HTMLIFrameElement[] {
  return [...document.querySelectorAll('iframe')];
}

function viewport(): HTMLElement {
  const el = document.querySelector('.brand-studio-canvas__viewport');
  if (!el) throw new Error('viewport not found');
  return el as HTMLElement;
}

describe('BrandStudioCanvas', () => {
  let component: ReturnType<typeof mount> | null = null;

  function render(
    props: { previewOrigin?: string; contentSlug?: string } = {}
  ) {
    component = mount(BrandStudioCanvas, {
      target: document.body,
      props: { previewOrigin: ORIGIN, contentSlug: SLUG, ...props },
    });
    flushSync();
  }

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('defaults to a single Landing frame at the root path', () => {
    render();

    const frames = iframes();
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute('src')).toBe('/');
    expect(
      groupButton('Preview route', 'Landing').getAttribute('aria-pressed')
    ).toBe('true');
    expect(viewport().getAttribute('data-mode')).toBe('single');
  });

  test('route switch swaps the iframe src (root-relative)', () => {
    render();

    groupButton('Preview route', 'Grid').click();
    flushSync();
    expect(iframes()[0].getAttribute('src')).toBe('/explore');

    groupButton('Preview route', 'Detail').click();
    flushSync();
    expect(iframes()[0].getAttribute('src')).toBe(`/content/${SLUG}`);
  });

  test('device switch re-targets the viewport width', () => {
    render();

    expect(viewport().getAttribute('data-device')).toBe('desktop');

    groupButton('Preview device', 'Tablet').click();
    flushSync();
    expect(viewport().getAttribute('data-device')).toBe('tablet');

    groupButton('Preview device', 'Mobile').click();
    flushSync();
    expect(viewport().getAttribute('data-device')).toBe('mobile');
  });

  test('theme control reflects the selected mode on the frame', () => {
    render();

    let frame = document.querySelector('.preview-frame');
    expect(frame?.getAttribute('data-preview-theme')).toBe('light');

    groupButton('Preview theme', 'Dark').click();
    flushSync();
    frame = document.querySelector('.preview-frame');
    expect(frame?.getAttribute('data-preview-theme')).toBe('dark');
    expect(
      groupButton('Preview theme', 'Dark').getAttribute('aria-pressed')
    ).toBe('true');
  });

  test('side-by-side renders two frames — one light, one dark', () => {
    render();
    expect(iframes()).toHaveLength(1);

    groupButton('Preview theme', 'Side by side').click();
    flushSync();

    expect(iframes()).toHaveLength(2);
    expect(viewport().getAttribute('data-mode')).toBe('split');
    const themes = [...document.querySelectorAll('.preview-frame')].map((f) =>
      f.getAttribute('data-preview-theme')
    );
    expect(themes).toContain('light');
    expect(themes).toContain('dark');
    // Both frames preview the same route path.
    expect(iframes()[0].getAttribute('src')).toBe('/');
    expect(iframes()[1].getAttribute('src')).toBe('/');
  });

  test('content routes are disabled when the org has no published content', () => {
    render({ contentSlug: undefined });

    expect(groupButton('Preview route', 'Detail').disabled).toBe(true);
    expect(groupButton('Preview route', 'Player').disabled).toBe(true);
    // Content-free routes remain available.
    expect(groupButton('Preview route', 'Landing').disabled).toBe(false);
    expect(groupButton('Preview route', 'Grid').disabled).toBe(false);
    expect(groupButton('Preview route', 'Nav').disabled).toBe(false);
  });

  test('content routes are enabled once a slug is available', () => {
    render({ contentSlug: SLUG });

    expect(groupButton('Preview route', 'Detail').disabled).toBe(false);
    expect(groupButton('Preview route', 'Player').disabled).toBe(false);
  });
});
