/**
 * CappedChecks: a waiting success page checks about six times over the first
 * minute, only while the tab is visible, then stops (Codex-2hxff.22; owner
 * decision 2026-10-26, "Capped, then a button"). Never an open-ended loop.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('$lib/observability', () => ({
  logger: { warn: warnMock, error: vi.fn(), info: vi.fn() },
}));

import { CappedChecks, CHECK_SCHEDULE_MS } from './capped-checks.svelte';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
  warnMock.mockClear();
});

describe('CappedChecks', () => {
  test("the schedule is the owner's: about 2, 5, 10, 20, 40 and 60 seconds", () => {
    expect(CHECK_SCHEDULE_MS).toEqual([2000, 5000, 10000, 20000, 40000, 60000]);
  });

  test('checks six times over the first minute, then stops for good', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const checks = new CappedChecks(check);
    const stop = checks.start();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(check).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(55_000);
    expect(check).toHaveBeenCalledTimes(6);
    expect(checks.exhausted).toBe(true);

    // An hour on an open tab: nothing more.
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(check).toHaveBeenCalledTimes(6);
    stop();
  });

  test('a check due while the tab is hidden waits for it, then runs once', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const checks = new CappedChecks(check);
    const stop = checks.start();

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(check).not.toHaveBeenCalled();

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    // The rest of the schedule passed while hidden, but it does not fire at
    // once: the next check is its gap (5 s − 2 s) after this one.
    await vi.advanceTimersByTimeAsync(2_999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(check).toHaveBeenCalledTimes(6);
    expect(checks.exhausted).toBe(true);
    stop();
  });

  // A page's answer can restart the checks before the check that fetched it
  // has settled (SvelteKit sets the new data, then resolves `invalidate`).
  test('a check that settles only after a stop and a restart: the next still waits its gap', async () => {
    let settle: () => void = () => {};
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    const checks = new CappedChecks(check);
    let stop = checks.start();

    // Hidden past the minute, then shown: check 1 runs, and is still out.
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    stop();
    stop = checks.start();
    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    // The next comes its gap (5 s − 2 s) after check 1 began, not at once.
    await vi.advanceTimersByTimeAsync(2_999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  test('the cleanup stops every check still to come', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const checks = new CappedChecks(check);
    const stop = checks.start();

    await vi.advanceTimersByTimeAsync(2_000);
    stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(check).toHaveBeenCalledTimes(1);
    expect(checks.exhausted).toBe(false);
  });

  test('a stop and a restart resume the same timeline: still six, still within the minute', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const checks = new CappedChecks(check);
    let stop = checks.start();

    // The page pauses the checks after each one while its answer is on the
    // way, and resumes them a second later.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(
        CHECK_SCHEDULE_MS[i]! -
          (i === 0 ? 0 : CHECK_SCHEDULE_MS[i - 1]! + 1_000)
      );
      stop();
      await vi.advanceTimersByTimeAsync(1_000);
      stop = checks.start();
    }

    expect(check).toHaveBeenCalledTimes(6);
    expect(checks.exhausted).toBe(true);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(check).toHaveBeenCalledTimes(6);
    stop();
  });

  test('Check again is one check per click, with none scheduled after it', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const checks = new CappedChecks(check, []);
    const stop = checks.start();
    expect(checks.exhausted).toBe(true);

    await checks.checkOnce();
    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });

  test('a second click while a check runs sends nothing', async () => {
    let finish: () => void = () => {};
    const check = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const checks = new CappedChecks(check, []);

    const first = checks.checkOnce();
    expect(checks.checking).toBe(true);
    await checks.checkOnce();
    finish();
    await first;

    expect(check).toHaveBeenCalledTimes(1);
    expect(checks.checking).toBe(false);
  });

  test('checks that answer log nothing', async () => {
    const checks = new CappedChecks(vi.fn().mockResolvedValue(undefined));
    const stop = checks.start();
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(warnMock).not.toHaveBeenCalled();
  });

  // A check that rejects is a failure no load reported. To the buyer it is
  // one check fewer; to us, one warn line per wait, however many fail.
  test('a check that rejects is logged once per wait at warn, and the checks carry on', async () => {
    const check = vi.fn().mockRejectedValue(new TypeError('boom'));
    const checks = new CappedChecks(check);
    const stop = checks.start();
    await vi.advanceTimersByTimeAsync(60_000);
    await checks.checkOnce();
    stop();

    expect(check).toHaveBeenCalledTimes(7);
    expect(checks.exhausted).toBe(true);
    expect(checks.checking).toBe(false);
    expect(warnMock).toHaveBeenCalledOnce();
    expect(warnMock).toHaveBeenCalledWith('capped-checks: a check failed', {
      error: 'boom',
    });
  });
});
