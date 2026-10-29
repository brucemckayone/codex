/**
 * When the player's code loads ahead of a press (owner P9). A play button
 * down the page loads it as it nears the screen; the org landing's intro film
 * chip (Codex-376dl) is in view as the page opens, so it waits for a pointer
 * or focus, or every visit would fetch the player whether or not anyone plays.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadedPlayerCore,
  preloadPlayer,
  preloadPlayerOnIntent,
} from './load-core';

const observed: Element[] = [];

class SpyObserver {
  observe(element: Element) {
    observed.push(element);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  observed.length = 0;
  vi.stubGlobal('IntersectionObserver', SpyObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preloading the player', () => {
  it('a button down the page watches for the screen', () => {
    const button = document.createElement('button');
    const stop = preloadPlayer(button);
    expect(observed).toEqual([button]);
    if (typeof stop === 'function') stop();
  });

  it('a button the page opens with waits for a pointer, then loads', async () => {
    const button = document.createElement('button');
    preloadPlayerOnIntent(button);
    expect(observed).toEqual([]);
    expect(loadedPlayerCore()).toBeNull();

    button.dispatchEvent(new Event('pointerenter'));
    await vi.waitFor(() => expect(loadedPlayerCore()).not.toBeNull());
  });
});
