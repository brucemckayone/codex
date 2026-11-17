/**
 * Changes carried to the live editor (Codex-a6ofh.2): taken once, and only
 * across the one move they were left for. One that came too late is said,
 * never dropped without a word (the round-2 review).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const told = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('$lib/observability', () => ({ logger: { warn: told.warn } }));

const {
  handOffToLive,
  LIVE_HANDOFF_FRESH_MS,
  takeLiveHandoff,
  withdrawLiveHandoff,
} = await import('./live-handoff');

const ID = 'c1';

beforeEach(() => {
  vi.useFakeTimers();
  withdrawLiveHandoff(ID);
  told.warn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a hand-off to the live editor', () => {
  it('is taken once', () => {
    handOffToLive(ID, { description: 'Carried' });

    expect(takeLiveHandoff(ID)).toEqual({
      changes: { description: 'Carried' },
    });
    expect(takeLiveHandoff(ID)).toBeNull();
  });

  it('is for its own piece only', () => {
    handOffToLive(ID, { description: 'Carried' });

    expect(takeLiveHandoff('c2')).toBeNull();
    expect(takeLiveHandoff(ID)).toEqual({
      changes: { description: 'Carried' },
    });
  });

  it('one the move never reached is never applied later, and is said', () => {
    handOffToLive(ID, { description: 'Carried' });
    vi.advanceTimersByTime(LIVE_HANDOFF_FRESH_MS + 1);

    expect(takeLiveHandoff(ID)).toEqual({ expired: true });
    expect(told.warn).toHaveBeenCalledWith(
      'studio_editor.live_handoff_expired',
      expect.objectContaining({ contentId: ID, keys: ['description'] })
    );
    expect(takeLiveHandoff(ID)).toBeNull();
  });

  it('a fresh one is not said', () => {
    handOffToLive(ID, { description: 'Carried' });
    vi.advanceTimersByTime(LIVE_HANDOFF_FRESH_MS);

    expect(takeLiveHandoff(ID)).toEqual({
      changes: { description: 'Carried' },
    });
    expect(told.warn).not.toHaveBeenCalled();
  });

  it('one withdrawn is gone', () => {
    handOffToLive(ID, { description: 'Carried' });
    withdrawLiveHandoff(ID);

    expect(takeLiveHandoff(ID)).toBeNull();
  });

  it('a newer one replaces it', () => {
    handOffToLive(ID, { description: 'First' });
    handOffToLive(ID, { description: 'Second' });

    expect(takeLiveHandoff(ID)).toEqual({ changes: { description: 'Second' } });
  });
});
