/**
 * Changes carried to the live editor (Codex-a6ofh.2): taken once, and only
 * across the one move they were left for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handOffToLive,
  LIVE_HANDOFF_FRESH_MS,
  takeLiveHandoff,
} from './live-handoff';

const ID = 'c1';

beforeEach(() => {
  vi.useFakeTimers();
  takeLiveHandoff(ID);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a hand-off to the live editor', () => {
  it('is taken once', () => {
    handOffToLive(ID, { description: 'Carried' });

    expect(takeLiveHandoff(ID)).toEqual({ description: 'Carried' });
    expect(takeLiveHandoff(ID)).toBeNull();
  });

  it('is for its own piece only', () => {
    handOffToLive(ID, { description: 'Carried' });

    expect(takeLiveHandoff('c2')).toBeNull();
    expect(takeLiveHandoff(ID)).toEqual({ description: 'Carried' });
  });

  it('one the move never reached is never applied later', () => {
    handOffToLive(ID, { description: 'Carried' });
    vi.advanceTimersByTime(LIVE_HANDOFF_FRESH_MS + 1);

    expect(takeLiveHandoff(ID)).toBeNull();
  });

  it('a newer one replaces it', () => {
    handOffToLive(ID, { description: 'First' });
    handOffToLive(ID, { description: 'Second' });

    expect(takeLiveHandoff(ID)).toEqual({ description: 'Second' });
  });
});
