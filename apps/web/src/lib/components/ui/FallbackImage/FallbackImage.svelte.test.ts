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
  // logged once per file, by host, kind and file name, never its path.
  test('a failure is logged once, by host, kind and file, never the path', () => {
    vi.mocked(logger.warn).mockClear();
    const gone =
      'https://cdn.example.test/creator-1/media-thumbnails/media-2/gone.webp';
    render({ src: gone });
    img()?.dispatchEvent(new Event('error'));
    flushSync();
    unmount(component);
    target.remove();
    render({ src: gone });
    img()?.dispatchEvent(new Event('error'));
    flushSync();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'image.fallback_shown',
      expect.objectContaining({
        host: 'cdn.example.test',
        kind: 'media-thumbnails',
        file: 'gone.webp',
      })
    );
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).not.toContain('creator-1');
    expect(logged).not.toContain('media-2');
  });

  // The client log keeps a sample, so each record says how many files have
  // failed in the tab so far (review round 2): one dead tile reads apart
  // from a sweep that removed thirty.
  test('each record counts the files failed so far', () => {
    vi.mocked(logger.warn).mockClear();
    render({ src: '/content-thumbnails/a/one.webp' });
    img()?.dispatchEvent(new Event('error'));
    flushSync();
    unmount(component);
    target.remove();
    render({ src: '/content-thumbnails/b/two.webp' });
    img()?.dispatchEvent(new Event('error'));
    flushSync();

    const counts = vi
      .mocked(logger.warn)
      .mock.calls.map(([, fields]) => (fields as { failed: number }).failed);
    expect(counts).toHaveLength(2);
    expect(counts[1]).toBe(counts[0] + 1);
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
