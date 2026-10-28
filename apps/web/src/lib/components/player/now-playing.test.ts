/**
 * One film at a time (owner P3), and the floating bar's way of knowing a
 * film's controls are on screen.
 */
import { describe, expect, test, vi } from 'vitest';
import { claim, filmInView, release, showing } from './now-playing.svelte';

const film = () => ({ pause: vi.fn() }) as unknown as HTMLMediaElement;

describe('one film at a time', () => {
  test('starting a film pauses the one before it, never itself', () => {
    const first = film();
    const second = film();
    claim(first);
    claim(first);
    expect(first.pause).not.toHaveBeenCalled();
    claim(second);
    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(second.pause).not.toHaveBeenCalled();
    release(second);
    release(first);
  });

  test('a film that has gone holds nothing', () => {
    const gone = film();
    const next = film();
    claim(gone);
    release(gone);
    claim(next);
    expect(gone.pause).not.toHaveBeenCalled();
    release(next);
  });
});

describe('filmInView', () => {
  test('true while any player is on screen', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    expect(filmInView()).toBe(false);
    showing(a, true);
    showing(b, true);
    showing(a, false);
    expect(filmInView()).toBe(true);
    showing(b, false);
    expect(filmInView()).toBe(false);
  });
});
