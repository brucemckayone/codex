/**
 * The judgement behind a load-failure Retry, with no markup (Codex-if444).
 * LoadFailedAlert renders it as the studio's error alert; a failure UI with a
 * design of its own (the fee note's muted line, PriceChangeNote's warning
 * note, the refund preview's problems) renders its own markup on the same
 * judgement.
 *
 * What it judges:
 * - WHICH read. Pages derive their read (`$derived(getX(id))`), and kit 2.55
 *   drops a query whose first read FAILED from its cache, so `refresh()`
 *   re-runs the derivation and the caller is handed a NEW query, still
 *   loading, with a read of its own. The refreshed query fetches again too;
 *   that stray result is discarded (a Retry sends two reads: kit's doing).
 *   The Retry waits for the read the caller holds once it has refreshed. A
 *   load read (`loadRead`) is no promise and its `invalidate` resolves late
 *   (after every live remote query) or early (overtaken, data unchanged), so
 *   it waits for the caller's data to change: a read of another run of the
 *   load (`LoadRead.key`), not just new merged data. Once that refresh
 *   settles unchanged, Retry is offered again (`busy` goes false) while the
 *   wait goes on, and the next run of that load, whatever reran it, is
 *   judged as this Retry.
 * - WHEN it stops waiting without an answer. A later Retry takes the wait
 *   over (after a load read's refresh settled unchanged); the caller moves to
 *   a remote read this Retry did not start (the refund preview's amount
 *   changed, or the page let the query go); or the component unmounts. That
 *   Retry is superseded: it resolves `null`, and leaves focus, `settled` and
 *   `retrying` to whatever runs now. On unmount nothing runs on, so the core
 *   itself tells the caller `retrying` is false: a page that binds it would
 *   otherwise keep its failed layout up over a read that may be fine.
 * - `retrying` / `busy`. True from the press until the answer is in, so a
 *   failure UI that renders while `failed || retrying` stays mounted, with
 *   its focused button, while the new read loads. A press while `busy` does
 *   nothing.
 * - Where focus may go. Only if it is still in the failure UI (`from`), or
 *   was lost (`focusIsFree`, the rule the studio's Try agains share): a read
 *   can take seconds, and the person may have moved on.
 *
 * The caller decides what the settled read MEANS. `retry()` resolves with
 * the read it holds now, so a caller can tell more than ok and failed apart
 * (the refund preview: lines, refused, session ended, failed). With no value
 * and no error, the caller let the read go or it is still loading: claim
 * nothing.
 *
 * Call during a component's initialisation: it registers effects.
 */
import { tick, untrack } from 'svelte';
import { focusIsFree } from '$lib/utils/focus-if-lost';
import { type AlertRead, isLoadRead } from './alert-read';

export interface LoadRetryOptions {
  /**
   * Told of each change to `retrying`, as it happens. LoadFailedAlert passes
   * it to its bindable `retrying`, so a page that binds it keeps its failed
   * layout through kit's swap without a frame of the new query's loading one.
   */
  onretrying?: (retrying: boolean) => void;
}

export interface RetryFocus<R> {
  /** The failure UI. Focus moves only if it is still in here, or was lost. */
  from?: () => Element | null | undefined;
  /**
   * Called with the read the caller holds once the answer is in, before the
   * DOM updates: set what says the outcome here. Return where focus goes,
   * read once that has rendered, or nothing to leave focus where it is.
   */
  settled?: (
    read: R | null
  ) => (() => HTMLElement | null | undefined) | undefined;
}

export interface RetryResult<R> {
  /**
   * The read the caller holds once the answer is in. `null` when the answer
   * itself made the caller let the read go (a thread a 403 refuses passes
   * `null`). Letting it go BEFORE the answer is not this: that Retry resolves
   * `null` as a whole (see `LoadRetry.retry`).
   */
  read: R | null;
  /** Focus was still in `from`, or lost, once the outcome rendered. */
  focusFree: boolean;
}

export interface LoadRetry<R extends AlertRead> {
  /** From the press until the answer is in, including a load read's wait with Retry offered again. */
  readonly retrying: boolean;
  /** A Retry is running and a press does nothing (false while a load read waits with Retry offered again). */
  readonly busy: boolean;
  /**
   * Refreshes the read and waits for the answer the caller will hold. Never
   * rejects. Resolves `null`, with no `settled` call and no focus move, when:
   * - at the press, a Retry is `busy`, or the caller holds no read;
   * - before a remote read answers, the caller holds another read, or none
   *   (for a load read, a new read IS the answer);
   * - a later Retry takes a load read's wait over (pressed once its refresh
   *   settled unchanged);
   * - the component unmounts before the answer is judged.
   * Otherwise it resolves `{ read, focusFree }`.
   */
  retry(focus?: RetryFocus<R>): Promise<RetryResult<R> | null>;
}

/**
 * The same read: the same object, or load reads of one run of the load. A
 * rerun of another load (a layout's) hands the page new merged data, so a
 * new load read, built from the same run of this one.
 */
function sameRead(a: AlertRead | null, b: AlertRead | null): boolean {
  if (a === b) return true;
  if (a === null || b === null || !isLoadRead(a) || !isLoadRead(b))
    return false;
  return a.key !== undefined && a.key === b.key;
}

export function createLoadRetry<R extends AlertRead>(
  read: () => R | null,
  options: LoadRetryOptions = {}
): LoadRetry<R> {
  let retrying = $state(false);
  /**
   * A load read's refresh settled with the data unchanged: Retry is offered
   * again while the wait goes on (see `heldRead`).
   */
  let stalled = $state(false);
  const busy = $derived(retrying && !stalled);
  /** The Retry that owns the wait. A later one, or unmounting, moves it on. */
  let run = 0;
  /**
   * The caller was told `retrying` and not yet told it ended. Plain, not
   * `$state`: the unmount teardown reads it, and a teardown can read state as
   * it was before its last change.
   */
  let toldRetrying = false;

  function setRetrying(value: boolean) {
    retrying = value;
    toldRetrying = value;
    options.onretrying?.(value);
  }

  /** The running Retry's wait for the caller to hold a read other than `held`. */
  let waiter: { held: R | null; done: (moved: boolean) => void } | null = null;

  /** Ends the wait: `moved`, the caller holds another read; else superseded. */
  function release(moved: boolean) {
    const ending = waiter;
    waiter = null;
    ending?.done(moved);
  }

  $effect(() => {
    void read();
    untrack(() => {
      if (waiter && !sameRead(read(), waiter.held)) release(true);
    });
  });

  // Unmounted: a Retry still waiting is superseded, and touches nothing
  // more. Nothing runs on to end `retrying`, so it ends here: a page that
  // binds it keeps its failed layout up otherwise.
  $effect(() => () => {
    run += 1;
    release(false);
    if (toldRetrying) {
      toldRetrying = false;
      options.onretrying?.(false);
    }
  });

  /**
   * Resolves `true` once the caller holds a read other than `held`, `false`
   * if superseded first. A wait it replaces is superseded.
   */
  function nextRead(held: R | null) {
    release(false);
    const mine: { held: R | null; done: (moved: boolean) => void } = {
      held,
      done: () => {},
    };
    const moved = new Promise<boolean>((resolve) => {
      mine.done = resolve;
    });
    waiter = mine;
    return {
      moved,
      /** The answer came first: stop waiting, unless another wait took over. */
      cancel: () => {
        if (waiter === mine) waiter = null;
      },
    };
  }

  /**
   * Refreshes `refreshed`, then waits for the answer the caller will hold:
   * the read of the query it holds now, or a load read's new data. `false`:
   * superseded first.
   */
  async function heldRead(refreshed: R, mine: number): Promise<boolean> {
    const reread = refreshed.refresh();
    // The caller's derivation is read lazily, so this is already the new query.
    const held = read();
    if (isLoadRead(refreshed)) {
      // Its answer arrives as the caller's new data, which nextRead waits for.
      const settled = () => {
        if (run === mine && sameRead(read(), held)) stalled = true;
      };
      void reread.then(settled, settled);
      return nextRead(held).moved;
    }
    if (held !== refreshed) {
      void reread.catch(() => {
        // The stray fetch of a query the caller let go: nobody reads its result.
      });
    }
    const wait = nextRead(held);
    const answer = Promise.resolve(held === refreshed ? reread : held).then(
      () => true,
      // Kept on the held query's `.error`, which the caller reads.
      () => true
    );
    // The caller moving to a read this Retry did not start supersedes it.
    const answered = await Promise.race([answer, wait.moved.then(() => false)]);
    wait.cancel();
    return answered;
  }

  return {
    get retrying() {
      return retrying;
    },
    get busy() {
      return busy;
    },
    async retry(focus = {}) {
      const refreshed = read();
      if (busy || !refreshed) return null;
      run += 1;
      const mine = run;
      setRetrying(true);
      stalled = false;
      let answered = false;
      try {
        answered = await heldRead(refreshed, mine);
      } finally {
        // Superseded by a later Retry or by unmounting: that owns it now.
        if (run === mine) {
          setRetrying(false);
          stalled = false;
        }
      }
      if (!answered || run !== mine) return null;
      const settled = read();
      const target = focus.settled?.(settled);
      await tick();
      // Not if they moved on during it: a read can take seconds.
      const focusFree = focusIsFree(focus.from?.() ?? null);
      if (focusFree && target) target()?.focus();
      return { read: settled, focusFree };
    },
  };
}
