/**
 * The shared retry core's superseded Retries (Codex-if444). LoadFailedAlert's
 * suite and each designed failure UI's cover a Retry that gets its answer;
 * these cover one that stops waiting without it. `retry()` promises it never
 * hangs: a Retry that is superseded resolves `null`, and leaves `settled`,
 * focus and `retrying` to whatever runs now.
 *
 * The core registers effects, so each test makes it inside `$effect.root`;
 * stopping the root is the component unmounting.
 */
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { kitQuery } from './__fixtures__/kit-query.mock.svelte';
import { loadReadDouble } from './__fixtures__/load-read.mock.svelte';
import type { AlertRead } from './alert-read';
import { createLoadRetry, type LoadRetry } from './load-retry.svelte';

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
});

/** The core over `read`, as a component makes it; `told` logs `onretrying`. */
function makeCore<R extends AlertRead>(read: () => R | null) {
  const told: boolean[] = [];
  let core: LoadRetry<R> | null = null;
  stop = $effect.root(() => {
    core = createLoadRetry(read, { onretrying: (value) => told.push(value) });
  });
  flushSync();
  if (!core) throw new Error('no core');
  return { core: core as LoadRetry<R>, told };
}

/** Lets reads settle and the core's effects run. */
async function settle() {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync();
}

/** What `promise` resolved with once things settle, or 'pending'. */
async function within<T>(
  promise: Promise<T>
): Promise<{ value: T } | 'pending'> {
  let out: { value: T } | 'pending' = 'pending';
  void promise.then((value) => {
    out = { value };
  });
  await settle();
  return out;
}

describe('a superseded Retry resolves null, and never hangs', () => {
  test('a later Retry, after a refresh that settled unchanged, takes the wait over', async () => {
    const load = loadReadDouble<string[]>();
    const { core, told } = makeCore(() => load.get());
    const outcomes: unknown[] = [];

    const first = core.retry({
      settled: (read) => {
        outcomes.push(['first', read?.current]);
        return undefined;
      },
    });
    load.overtake();
    await settle();
    expect(core.busy).toBe(false);
    expect(core.retrying).toBe(true);

    const second = core.retry({
      settled: (read) => {
        outcomes.push(['second', read?.current]);
        return undefined;
      },
    });
    expect(await within(first)).toEqual({ value: null });
    expect(core.retrying).toBe(true);

    load.land(['a']);
    const answer = await within(second);
    expect(answer).not.toBe('pending');
    expect(answer !== 'pending' && answer.value?.read?.current).toEqual(['a']);
    expect(outcomes).toEqual([['second', ['a']]]);
    expect(core.retrying).toBe(false);
    expect(told).toEqual([true, true, false]);
  });

  test('the caller moving to a read it did not start ends the wait: retrying goes false', async () => {
    const amountA = kitQuery<string[]>();
    const amountB = kitQuery<string[]>();
    let showing = $state<'a' | 'b'>('a');
    const { core, told } = makeCore(() =>
      showing === 'a' ? amountA.get() : amountB.get()
    );
    amountA.fail();
    flushSync();
    const outcomes: unknown[] = [];

    const pending = core.retry({
      settled: (read) => {
        outcomes.push(read);
        return undefined;
      },
    });
    await settle();
    expect(core.busy).toBe(true);

    // The refund preview's amount changed: a read of another amount.
    showing = 'b';
    expect(await within(pending)).toEqual({ value: null });
    expect(core.retrying).toBe(false);
    expect(told).toEqual([true, false]);
    expect(outcomes).toEqual([]);
  });

  test('the caller letting the read go (null) ends the wait the same way', async () => {
    const kit = kitQuery<string[]>();
    let held = $state(true);
    const { core } = makeCore(() => (held ? kit.get() : null));
    kit.fail();
    flushSync();

    const pending = core.retry();
    await settle();
    held = false;
    expect(await within(pending)).toEqual({ value: null });
    expect(core.retrying).toBe(false);
  });

  test('unmounting mid-wait resolves it null, and tells the caller once that retrying ended', async () => {
    const kit = kitQuery<string[]>();
    const { core, told } = makeCore(() => kit.get());
    kit.fail();
    flushSync();

    const pending = core.retry();
    await settle();
    stop?.();
    stop = null;

    expect(await within(pending)).toEqual({ value: null });
    // A page that binds `retrying` drops its failed layout.
    expect(told).toEqual([true, false]);

    // The answer that comes after is nobody's: nothing more is told.
    kit.land(['late']);
    await settle();
    expect(told).toEqual([true, false]);
  });

  test('unmounting while a load read waits resolves it null too, and ends retrying', async () => {
    const load = loadReadDouble<string[]>();
    const { core, told } = makeCore(() => load.get());

    const pending = core.retry();
    await settle();
    stop?.();
    stop = null;

    expect(await within(pending)).toEqual({ value: null });
    expect(told).toEqual([true, false]);
  });

  test('unmounting with no Retry in flight tells the caller nothing', async () => {
    const kit = kitQuery<string[]>();
    const { core, told } = makeCore(() => kit.get());
    kit.fail();
    flushSync();

    const pending = core.retry();
    await settle();
    kit.land(['x']);
    await within(pending);
    expect(told).toEqual([true, false]);

    stop?.();
    stop = null;
    expect(told).toEqual([true, false]);
  });
});

describe('an answer still lands as before', () => {
  test('the held query answering is the answer, with the caller still on it', async () => {
    const kit = kitQuery<string[]>();
    const { core } = makeCore(() => kit.get());
    kit.fail();
    flushSync();

    const pending = core.retry();
    await settle();
    kit.land(['x']);
    const answer = await within(pending);
    expect(answer !== 'pending' && answer.value?.read?.current).toEqual(['x']);
    expect(core.retrying).toBe(false);
  });
});
