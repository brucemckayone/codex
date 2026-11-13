import { afterEach, describe, expect, test } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FallbackImage from './FallbackImage.svelte';

/**
 * FallbackImage (Codex-a6ofh.3.6): a missing or failed picture shows the
 * fallback in its place, and the image is kept, hidden, never removed.
 */
describe('FallbackImage', () => {
  let component: ReturnType<typeof mount> | null = null;
  let target: HTMLElement;

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    target?.remove();
  });

  const fallback = createRawSnippet(() => ({
    render: () => '<span class="the-fallback">icon</span>',
  }));

  function render(props: {
    src: string | null;
    sizes?: string;
    loading?: 'lazy' | 'eager';
  }) {
    target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(FallbackImage, {
      target,
      props: { alt: '', fallback, ...props },
    });
    flushSync();
  }

  const img = () => target.querySelector('img');
  const shownFallback = () => target.querySelector('.the-fallback');

  test('a picture shows, and the fallback does not', () => {
    render({ src: '/cover.webp', sizes: '5rem', loading: 'lazy' });
    expect(img()?.getAttribute('src')).toBe('/cover.webp');
    expect(img()?.style.display).toBe('');
    // The rest of an img's attributes pass through.
    expect(img()?.getAttribute('sizes')).toBe('5rem');
    expect(img()?.getAttribute('loading')).toBe('lazy');
    expect(shownFallback()).toBeNull();
  });

  test('no picture shows the fallback, with no image at all', () => {
    render({ src: null });
    expect(img()).toBeNull();
    expect(shownFallback()).not.toBeNull();
  });

  test('a picture that fails to load is hidden, kept, and the fallback shows', () => {
    render({ src: '/missing.webp' });
    const before = img();
    before?.dispatchEvent(new Event('error'));
    flushSync();

    expect(img()).toBe(before);
    expect(img()?.style.display).toBe('none');
    expect(shownFallback()).not.toBeNull();
  });

  test('a new picture after a failure is tried afresh', () => {
    const props = $state({ alt: '', fallback, src: '/missing.webp' });
    target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(FallbackImage, { target, props });
    flushSync();
    img()?.dispatchEvent(new Event('error'));
    flushSync();

    props.src = '/other.webp';
    flushSync();
    expect(img()?.getAttribute('src')).toBe('/other.webp');
    expect(img()?.style.display).toBe('');
    expect(shownFallback()).toBeNull();
  });
});
