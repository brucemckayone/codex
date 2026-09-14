/**
 * `measureMediaDuration` — the client-side runtime probe.
 *
 * Every rejected value here is one a real browser genuinely produces, which is
 * why they are asserted individually rather than as "invalid input":
 * `HTMLMediaElement.duration` is `NaN` until metadata resolves and `Infinity`
 * for an unbounded stream, and a header can legitimately declare `0`.
 *
 * The `null` returns are the whole contract. A runtime badge is advisory copy,
 * so a file the browser cannot parse must cost the creator no more than a
 * missing badge — never a failed upload.
 */
import { describe, expect, it, vi } from 'vitest';
import { measureMediaDuration, normaliseDuration } from './media-duration';

describe('normaliseDuration', () => {
  it('rounds to whole seconds, because the column is an integer', () => {
    expect(normaliseDuration(90.4)).toBe(90);
    expect(normaliseDuration(90.6)).toBe(91);
  });

  it('rejects NaN — what `duration` reads before metadata arrives', () => {
    expect(normaliseDuration(Number.NaN)).toBeNull();
  });

  it('rejects Infinity — what an unbounded stream reports', () => {
    expect(normaliseDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rejects zero rather than returning it', () => {
    // The distinction that matters: 0 would paint a `0:00` badge, which is a
    // lie. `null` falls back to no badge, which is the truth.
    expect(normaliseDuration(0)).toBeNull();
    expect(normaliseDuration(0.2)).toBeNull();
  });

  it('rejects negatives', () => {
    expect(normaliseDuration(-5)).toBeNull();
  });

  it('rejects anything over the 24h cap @codex/validation enforces', () => {
    expect(normaliseDuration(86_400)).toBe(86_400);
    expect(normaliseDuration(86_401)).toBeNull();
  });

  it('passes null through', () => {
    expect(normaliseDuration(null)).toBeNull();
  });
});

describe('measureMediaDuration', () => {
  /** A `File` whose bytes are never read — only `type` matters here. */
  const file = (type: string): File =>
    new File([new Uint8Array([0])], 'clip', { type });

  it('returns null for a type with no runtime, without touching the DOM', () => {
    // An image has no duration and this is not an error condition, so it must
    // not construct an element or an object URL at all.
    const create = vi.spyOn(URL, 'createObjectURL');
    return measureMediaDuration(file('image/png')).then((d) => {
      expect(d).toBeNull();
      expect(create).not.toHaveBeenCalled();
      create.mockRestore();
    });
  });

  it('resolves the duration once `loadedmetadata` fires, and REVOKES the url', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');

    // jsdom never loads media, so the element is stubbed to fire the event and
    // report a duration the way a real decoder would.
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string
    ): HTMLElement => {
      const el = original(tag) as HTMLElement;
      if (tag === 'video' || tag === 'audio') {
        Object.defineProperty(el, 'duration', { value: 137.2 });
        Object.defineProperty(el, 'load', { value: () => {} });
        // Fire on the next microtask, after the caller has attached listeners.
        Object.defineProperty(el, 'src', {
          set() {
            queueMicrotask(() => el.dispatchEvent(new Event('loadedmetadata')));
          },
          get: () => 'blob:stub',
          configurable: true,
        });
      }
      return el;
    }) as typeof document.createElement);

    await expect(measureMediaDuration(file('video/mp4'))).resolves.toBe(137);
    expect(revoke).toHaveBeenCalledWith('blob:stub');

    vi.restoreAllMocks();
  });

  it('returns null on a decode error — and still revokes', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bad');

    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string
    ): HTMLElement => {
      const el = original(tag) as HTMLElement;
      if (tag === 'video' || tag === 'audio') {
        Object.defineProperty(el, 'load', { value: () => {} });
        Object.defineProperty(el, 'src', {
          set() {
            queueMicrotask(() => el.dispatchEvent(new Event('error')));
          },
          get: () => 'blob:bad',
          configurable: true,
        });
      }
      return el;
    }) as typeof document.createElement);

    await expect(measureMediaDuration(file('video/mp4'))).resolves.toBeNull();
    // The leak this guards: revoking on the SUCCESS path only would hold the
    // entire file in memory for exactly the files most likely to be retried.
    expect(revoke).toHaveBeenCalledWith('blob:bad');

    vi.restoreAllMocks();
  });

  it('gives up rather than hanging when metadata never arrives', async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:silent');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string
    ): HTMLElement => {
      const el = original(tag) as HTMLElement;
      if (tag === 'video' || tag === 'audio') {
        Object.defineProperty(el, 'load', { value: () => {} });
        // Deliberately silent: no event is ever dispatched.
        Object.defineProperty(el, 'src', {
          set() {},
          get: () => 'blob:silent',
          configurable: true,
        });
      }
      return el;
    }) as typeof document.createElement);

    const pending = measureMediaDuration(file('video/quicktime'));
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toBeNull();

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
