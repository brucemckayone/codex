import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClientLogSink } from '$lib/client-log';
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

  // A failure's record waits for its burst to end: every test runs on fake
  // timers and sends what it gathered, so no burst runs into the next test.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(logger.warn).mockReset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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

  /** Fails a picture at `src`, in a box of its own. */
  function fail(src: string) {
    if (component) unmount(component);
    target?.remove();
    render({ src });
    img()?.dispatchEvent(new Event('error'));
    flushSync();
  }

  // With the broken glyph gone, a failure would be silent (review): it is
  // logged, by host, kind and file name, never its path.
  test('a failure is logged once, by host, kind and file, never the path', () => {
    const gone =
      'https://cdn.example.test/creator-1/media-thumbnails/media-2/gone.webp';
    fail(gone);
    fail(gone);
    vi.advanceTimersByTime(2000);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'image.fallback_shown',
      expect.objectContaining({
        host: 'cdn.example.test',
        kind: 'media-thumbnails',
        file: 'gone.webp',
        burst: 1,
      })
    );
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).not.toContain('creator-1');
    expect(logged).not.toContain('media-2');
  });

  // Each record says the tab's total so far, beside its own burst, so a
  // later burst the client log drops is still counted by the next record it
  // does send (the component's docblock says when that is).
  test('a later burst says the tab’s total so far', () => {
    fail('/creator-1/content-thumbnails/a/one.webp');
    fail('/creator-1/content-thumbnails/b/two.webp');
    vi.advanceTimersByTime(2000);
    fail('/creator-1/content-thumbnails/c/three.webp');
    vi.advanceTimersByTime(2000);

    const records = vi
      .mocked(logger.warn)
      .mock.calls.map(
        ([, fields]) => fields as { burst: number; failed: number }
      );
    expect(records.map(({ burst }) => burst)).toEqual([2, 1]);
    expect(records[1]?.failed).toBe((records[0]?.failed ?? 0) + 1);
  });

  // A burst still gathering when the page goes would die with its timer
  // (review round 4): it is sent as the page goes.
  test('a page that goes mid-burst sends it, without waiting', () => {
    fail('/creator-1/content-thumbnails/d/four.webp');
    expect(logger.warn).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'image.fallback_shown',
      expect.objectContaining({ burst: 1, kinds: { 'content-thumbnails': 1 } })
    );
    // Its timer finds nothing left to send.
    vi.advanceTimersByTime(2000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  // The proof is at the sink, not the logger (review round 3): the client
  // log sends a message's first record in a few minutes and drops the rest,
  // so a grid's thirty dead tiles must reach it as one record that says
  // thirty.
  test('a burst of failures reaches the client log as one record of all of them', () => {
    const sent: string[] = [];
    const sink = createClientLogSink({
      send: (body) => sent.push(body),
      now: () => Date.now(),
      path: () => '/studio/content',
    });
    vi.mocked(logger.warn).mockImplementation((message, metadata) =>
      sink.forward({ level: 'warn', message, metadata, timestamp: new Date() })
    );

    for (let tile = 0; tile < 30; tile += 1) {
      fail(`/creator-1/content-thumbnails/piece-${tile}/md.webp`);
    }
    fail('/creator-1/media-thumbnails/media-9/sm.webp');
    vi.advanceTimersByTime(2000);

    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0] ?? '{}') as {
      metadata?: { burst?: number; kinds?: Record<string, number> };
    };
    expect(body.metadata?.burst).toBe(31);
    expect(body.metadata?.kinds).toEqual({
      'content-thumbnails': 30,
      'media-thumbnails': 1,
    });
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
