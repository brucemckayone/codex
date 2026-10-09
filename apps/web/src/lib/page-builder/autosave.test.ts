/**
 * Autosave controller tests (WP-7a).
 *
 * Drives {@link createAutosave} with fake timers and a controllable `save()`
 * double so the debounce, the in-flight/queued-follow-up bookkeeping, and the
 * published-page opt-out are each proven rather than just read off the
 * implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AutosaveDeps,
  type AutosaveSaveResult,
  createAutosave,
  guardUnload,
} from './autosave.svelte';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeps(overrides: Partial<AutosaveDeps> = {}): AutosaveDeps {
  return {
    isDirty: () => true,
    isPublished: () => false,
    save: vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockResolvedValue({ ok: true }),
    debounceMs: 100,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosave — debounce', () => {
  it('runs no save before the debounce window elapses', async () => {
    const deps = makeDeps();
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    expect(autosave.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(99);
    expect(deps.save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(deps.save).toHaveBeenCalledTimes(1);
  });

  it('a change resets the window rather than adding a second save', async () => {
    const deps = makeDeps();
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(60);
    autosave.notifyChange(); // resets the 100ms window
    await vi.advanceTimersByTimeAsync(60);
    expect(deps.save).not.toHaveBeenCalled(); // 120ms since the 2nd, but only 60 since the true last

    await vi.advanceTimersByTimeAsync(40);
    expect(deps.save).toHaveBeenCalledTimes(1);
  });

  it('settles to saved and records lastSavedAt', async () => {
    const deps = makeDeps();
    const autosave = createAutosave(deps);
    expect(autosave.lastSavedAt).toBeNull();

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);

    expect(autosave.status).toBe('saved');
    expect(autosave.lastSavedAt).toBeInstanceOf(Date);
  });
});

describe('createAutosave — in-flight queueing (never two concurrent)', () => {
  it('queues exactly one follow-up when changes arrive while saving', async () => {
    const first = createDeferred<AutosaveSaveResult>();
    const second = createDeferred<AutosaveSaveResult>();
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const deps = makeDeps({ save });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.status).toBe('saving');

    // Several more edits land while the first save is still in flight.
    autosave.notifyChange();
    autosave.notifyChange();
    autosave.notifyChange();
    expect(save).toHaveBeenCalledTimes(1); // still just the one — no concurrent second call

    first.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    // Exactly one follow-up ran — not three, not zero — and it started
    // immediately rather than waiting through another debounce window.
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.status).toBe('saving');

    second.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.status).toBe('saved');
  });
});

describe('createAutosave — error and retry', () => {
  it('a save that resolves ok:false surfaces status "error" with its message', async () => {
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockResolvedValueOnce({ ok: false, message: 'Network down' });
    const deps = makeDeps({ save });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);

    expect(autosave.status).toBe('error');
    expect(autosave.errorMessage).toBe('Network down');
  });

  it('a save() that throws is caught, not left unhandled, and reported as an error', async () => {
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockRejectedValueOnce(new Error('boom'));
    const deps = makeDeps({ save });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);

    expect(autosave.status).toBe('error');
    expect(autosave.errorMessage).toBe('boom');
  });

  it('retry() re-attempts the save and clears the error on success', async () => {
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockResolvedValueOnce({ ok: false, message: 'Network down' })
      .mockResolvedValueOnce({ ok: true });
    const deps = makeDeps({ save });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(autosave.status).toBe('error');

    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.status).toBe('saved');
    expect(autosave.errorMessage).toBeUndefined();
  });
});

describe('createAutosave — a published page never autosaves', () => {
  it('notifyChange never schedules a save, however long we wait', async () => {
    const deps = makeDeps({ isPublished: () => true });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(deps.save).not.toHaveBeenCalled();
    expect(autosave.status).toBe('idle');
  });

  it('hasUnpublishedChanges tracks published-and-dirty live, without notifyChange', () => {
    let dirty = true;
    const deps = makeDeps({ isPublished: () => true, isDirty: () => dirty });
    const autosave = createAutosave(deps);

    expect(autosave.hasUnpublishedChanges).toBe(true);
    dirty = false;
    expect(autosave.hasUnpublishedChanges).toBe(false);
  });

  it('is false for a dirty DRAFT — the flag is published-and-dirty, not dirty alone', () => {
    const deps = makeDeps({ isPublished: () => false, isDirty: () => true });
    const autosave = createAutosave(deps);
    expect(autosave.hasUnpublishedChanges).toBe(false);
  });
});

describe('createAutosave — flush', () => {
  it('saves immediately, bypassing the debounce window', async () => {
    const deps = makeDeps({ debounceMs: 10_000 });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    expect(deps.save).not.toHaveBeenCalled();

    const result = await autosave.flush();

    expect(result).toEqual({ ok: true });
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(autosave.status).toBe('saved');
  });

  it('rides an already-in-flight save rather than starting a second one', async () => {
    const deferred = createDeferred<AutosaveSaveResult>();
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockReturnValue(deferred.promise);
    const deps = makeDeps({ save });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);

    const flushed = autosave.flush();
    expect(save).toHaveBeenCalledTimes(1); // no second, competing save

    deferred.resolve({ ok: true });
    await expect(flushed).resolves.toEqual({ ok: true });
  });

  it('after dispose, saves nothing and says so rather than reporting success', async () => {
    const deps = makeDeps();
    const autosave = createAutosave(deps);
    autosave.dispose();

    await expect(autosave.flush()).resolves.toEqual({
      ok: false,
      message:
        'The editor closed before your change was saved. Open the page again to check it.',
    });
    expect(deps.save).not.toHaveBeenCalled();
  });
});

describe('createAutosave — dispose', () => {
  it('clears a pending debounce timer so the scheduled save never runs', async () => {
    const deps = makeDeps();
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(1000);

    expect(deps.save).not.toHaveBeenCalled();
  });

  it('stops a queued follow-up from starting once the in-flight save settles', async () => {
    const deferred = createDeferred<AutosaveSaveResult>();
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockReturnValue(deferred.promise);
    const deps = makeDeps({ save });
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.notifyChange(); // queues a follow-up
    autosave.dispose();

    deferred.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1); // the queued follow-up never ran
  });
});

describe('createAutosave — cancel', () => {
  it('drops a scheduled save and stops showing it as pending', async () => {
    const deps = makeDeps();
    const autosave = createAutosave(deps);

    autosave.notifyChange();
    expect(autosave.status).toBe('pending');
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(1000);

    expect(deps.save).not.toHaveBeenCalled();
    expect(autosave.status).toBe('idle');
  });

  it('drops the follow-up queued behind a running save, which still lands', async () => {
    const deferred = createDeferred<AutosaveSaveResult>();
    const save = vi
      .fn<() => Promise<AutosaveSaveResult>>()
      .mockReturnValue(deferred.promise);
    const autosave = createAutosave(makeDeps({ save }));

    autosave.notifyChange();
    await vi.advanceTimersByTimeAsync(100);
    autosave.notifyChange(); // queues a follow-up
    autosave.cancel();
    deferred.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    // A cancelled controller is not a disposed one: the save it had sent
    // still reports its outcome.
    expect(autosave.status).toBe('saved');
  });
});

describe('guardUnload', () => {
  it('prevents unload only while shouldBlock() is true', () => {
    let blocked = true;
    const cleanup = guardUnload(() => blocked);

    const blockedEvent = new Event('beforeunload', { cancelable: true });
    const preventBlocked = vi.spyOn(blockedEvent, 'preventDefault');
    window.dispatchEvent(blockedEvent);
    expect(preventBlocked).toHaveBeenCalled();

    blocked = false;
    const clearEvent = new Event('beforeunload', { cancelable: true });
    const preventClear = vi.spyOn(clearEvent, 'preventDefault');
    window.dispatchEvent(clearEvent);
    expect(preventClear).not.toHaveBeenCalled();

    cleanup();
  });

  it('the cleanup function removes the listener', () => {
    const cleanup = guardUnload(() => true);
    cleanup();

    const event = new Event('beforeunload', { cancelable: true });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
  });
});
