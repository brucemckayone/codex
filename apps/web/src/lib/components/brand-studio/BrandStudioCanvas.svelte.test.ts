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
import { brandEditor } from '$lib/brand-editor';
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
    // The light/dark choice is the module-level store's editingTheme (shared
    // with the rail). Reset it so a test that flips to dark can't leak into the
    // next test's default.
    brandEditor.setEditingTheme('light');
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

  test('the shared editing theme drives the preview (rail ↔ canvas hookup)', () => {
    render();
    expect(
      document
        .querySelector('.preview-frame')
        ?.getAttribute('data-preview-theme')
    ).toBe('light');

    // RAIL side: flipping the store's editing theme (what the rail's toggle does
    // via setEditingTheme) must move THIS preview — they share one source.
    brandEditor.setEditingTheme('dark');
    flushSync();
    expect(
      document
        .querySelector('.preview-frame')
        ?.getAttribute('data-preview-theme')
    ).toBe('dark');
    expect(
      groupButton('Preview theme', 'Dark').getAttribute('aria-pressed')
    ).toBe('true');

    // CANVAS side: the toolbar's Light/Dark writes the SAME store, so the rail +
    // colour controls follow the preview.
    brandEditor.setEditingTheme('light');
    flushSync();
    groupButton('Preview theme', 'Dark').click();
    flushSync();
    expect(brandEditor.editingTheme).toBe('dark');
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

  test('only Detail is disabled when the org has no published content', () => {
    render({ contentSlug: undefined });

    // Detail loads a real content page → needs a slug.
    expect(groupButton('Preview route', 'Detail').disabled).toBe(true);
    // Content-free routes remain available — including Player, whose demo is
    // synthetic (Nav was retired).
    expect(groupButton('Preview route', 'Landing').disabled).toBe(false);
    expect(groupButton('Preview route', 'Grid').disabled).toBe(false);
    expect(groupButton('Preview route', 'Player').disabled).toBe(false);
  });

  test('Detail enables once a slug is available; Player is always enabled', () => {
    render({ contentSlug: SLUG });

    expect(groupButton('Preview route', 'Detail').disabled).toBe(false);
    expect(groupButton('Preview route', 'Player').disabled).toBe(false);
  });

  test('bumping reloadToken appends a cache-busting param → frame reloads (WP-1.6)', () => {
    // Reactive props object so a hero-text save (token bump) re-renders the src.
    const props = $state({
      previewOrigin: ORIGIN,
      contentSlug: SLUG,
      reloadToken: 0,
    });
    component = mount(BrandStudioCanvas, { target: document.body, props });
    flushSync();

    // Clean URL before any hero-text save — token 0 adds no param.
    expect(iframes()[0].getAttribute('src')).toBe('/');

    // Hero-text save bumps the token → the frame src changes, which reloads the
    // iframe in place (element identity + WP-1.4 handle survive, like a route
    // change) so the freshly-persisted hero text renders.
    props.reloadToken = 1;
    flushSync();
    expect(iframes()[0].getAttribute('src')).toBe('/?__brandPreviewReload=1');

    // A brand-TOKEN edit would NOT bump the token — the src stays put and the
    // change streams via the postMessage bridge with no reload. A second
    // hero-text save advances the token again.
    props.reloadToken = 2;
    flushSync();
    expect(iframes()[0].getAttribute('src')).toBe('/?__brandPreviewReload=2');
  });
});
