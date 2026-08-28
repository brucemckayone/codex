import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createProgressTracker } from './progress.svelte';

/**
 * `createProgressTracker` attribution tests (Codex-1g5lh.12).
 *
 * The tracker reads its content id through a CALLBACK, and in both players
 * that callback returns the live `contentId` prop. That is correct while a
 * player is playing one item, and wrong at the exact moment it stops playing
 * one: on in-course navigation the parent swaps `src` and `contentId` on the
 * SAME component instance, so any final save issued after the props update
 * files the OUTGOING item's playhead against the INCOMING item — silently
 * moving the new session's resume point to wherever the previous one stopped.
 *
 * Hence the explicit-id overload. These tests pin the attribution, because it
 * is invisible in the UI: nothing looks wrong until the listener returns to a
 * session and finds it starting halfway through.
 */

const updateLocalProgress = vi.fn();
vi.mock('$lib/collections/progress', () => ({
  updateLocalProgress: (...args: unknown[]) => updateLocalProgress(...args),
}));

/**
 * A real (detached) media element with a fixed playhead. jsdom cannot play
 * anything, but `duration` / `currentTime` are all the tracker reads, and a
 * real element means `attach`/`detach` exercise real listener wiring.
 */
function fakeMedia(currentTime: number, duration: number): HTMLMediaElement {
  const el = document.createElement('audio');
  Object.defineProperty(el, 'duration', {
    configurable: true,
    value: duration,
  });
  Object.defineProperty(el, 'currentTime', {
    configurable: true,
    writable: true,
    value: currentTime,
  });
  return el;
}

beforeEach(() => {
  updateLocalProgress.mockClear();
});

describe('createProgressTracker — save attribution', () => {
  test('defaults to the live content id', () => {
    let contentId = 'item-a';
    const media = fakeMedia(42, 600);
    const tracker = createProgressTracker({
      getContentId: () => contentId,
      getMedia: () => media,
    });

    tracker.save();
    expect(updateLocalProgress).toHaveBeenCalledWith('item-a', 42, 600);

    contentId = 'item-b';
    tracker.save();
    expect(updateLocalProgress).toHaveBeenLastCalledWith('item-b', 42, 600);
  });

  test('an explicit id wins over the live one', () => {
    // The state right after in-course navigation: the props already answer
    // with item B while the element still holds item A's playhead.
    const tracker = createProgressTracker({
      getContentId: () => 'item-b',
      getMedia: () => fakeMedia(42, 600),
    });

    tracker.save('item-a');

    expect(updateLocalProgress).toHaveBeenCalledWith('item-a', 42, 600);
    expect(updateLocalProgress).not.toHaveBeenCalledWith('item-b', 42, 600);
  });

  test('detach flushes against the id it is given, not the live one', () => {
    const tracker = createProgressTracker({
      getContentId: () => 'item-b',
      getMedia: () => fakeMedia(90, 600),
    });

    tracker.detach('item-a');

    expect(updateLocalProgress).toHaveBeenCalledTimes(1);
    expect(updateLocalProgress).toHaveBeenCalledWith('item-a', 90, 600);
  });

  test('detach with no id still flushes against the live one', () => {
    const tracker = createProgressTracker({
      getContentId: () => 'item-a',
      getMedia: () => fakeMedia(90, 600),
    });

    tracker.detach();

    expect(updateLocalProgress).toHaveBeenCalledWith('item-a', 90, 600);
  });

  test('writes nothing when the duration is unknown', () => {
    // A released element reports NaN duration — a save then has no meaningful
    // percentage, so it must not overwrite a good stored position with zero.
    const tracker = createProgressTracker({
      getContentId: () => 'item-a',
      getMedia: () => fakeMedia(0, Number.NaN),
    });

    tracker.detach('item-a');

    expect(updateLocalProgress).not.toHaveBeenCalled();
  });

  test('writes nothing when there is no media element', () => {
    const tracker = createProgressTracker({
      getContentId: () => 'item-a',
      getMedia: () => null,
    });

    tracker.save('item-a');
    tracker.detach('item-a');

    expect(updateLocalProgress).not.toHaveBeenCalled();
  });
});
