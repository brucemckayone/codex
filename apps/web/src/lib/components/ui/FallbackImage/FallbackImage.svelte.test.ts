import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createRawSnippet,
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import FallbackImage from './FallbackImage.svelte';

vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const { logger } = await import('$lib/observability');

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
    srcset?: string;
    sizes?: string;
    loading?: 'lazy' | 'eager';
  }) {
    target = document.createElement('div');
    document.body.appendChild(target);
    component = mount(FallbackImage, {
      target,
      props: {
        alt: '',
        fallback,
        srcset: undefined,
        sizes: undefined,
        ...props,
      },
    });
    flushSync();
  }

  const img = () => target.querySelector('img');
  const shownFallback = () => target.querySelector('.the-fallback');

  test('a picture shows, and the fallback does not', () => {
    render({
      src: '/cover.webp',
      srcset: '/cover.webp 400w',
      sizes: '5rem',
      loading: 'lazy',
    });
    expect(img()?.getAttribute('src')).toBe('/cover.webp');
    expect(img()?.style.display).toBe('');
    // The rest of an img's attributes pass through.
    expect(img()?.getAttribute('srcset')).toBe('/cover.webp 400w');
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

  // With the broken glyph gone, a failure would be silent (review): it is
  // logged once per file, by host and file name, never its path.
  test('a failure is logged once, by host and file, never the path', () => {
    vi.mocked(logger.warn).mockClear();
    render({ src: 'https://cdn.example.test/creator-1/media-2/gone.webp' });
    img()?.dispatchEvent(new Event('error'));
    flushSync();
    unmount(component);
    target.remove();
    render({ src: 'https://cdn.example.test/creator-1/media-2/gone.webp' });
    img()?.dispatchEvent(new Event('error'));
    flushSync();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('image.fallback_shown', {
      host: 'cdn.example.test',
      file: 'gone.webp',
    });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      'creator-1'
    );
  });

  test('a new picture after a failure is tried afresh', () => {
    const props = $state({
      alt: '',
      fallback,
      srcset: undefined,
      sizes: undefined,
      src: '/missing.webp',
    });
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
