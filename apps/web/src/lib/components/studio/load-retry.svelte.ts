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
 *   it waits for the caller's data to change: a read other than the one it
 *   held. Once that refresh settles unchanged, Retry is offered again
 *   (`busy` goes false) while the wait goes on, and the next change to the
 *   data, whatever reran it, is judged as this Retry.
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
 * Call during a component's initialisation: it registers an effect.
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
  /** The read the caller holds now, settled. `null`: the caller let it go. */
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
   * rejects. Resolves `null` when nothing ran: a Retry is `busy`, or there
   * is no read.
   */
  retry(focus?: RetryFocus<R>): Promise<RetryResult<R> | null>;
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

  function setRetrying(value: boolean) {
    retrying = value;
    options.onretrying?.(value);
  }

  /** Called with each read the caller hands over (see `nextRead`). */
  let onRead: (() => void) | null = null;
  $effect(() => {
    void read();
    untrack(() => onRead?.());
  });

  /**
   * Refreshes `refreshed`, then waits for the answer the caller will hold:
   * the read of the query it holds now, or a load read's new data.
   */
  async function heldRead(refreshed: R) {
    const reread = refreshed.refresh();
    // The caller's derivation is read lazily, so this is already the new query.
    const held = read();
    if (isLoadRead(refreshed)) {
      // Its answer arrives as the caller's new data, which nextRead waits for.
      const settled = () => {
        if (read() === held) stalled = true;
      };
      void reread.then(settled, settled);
      await nextRead(held);
      return;
    }
    if (held !== refreshed) {
      void reread.catch(() => {
        // The stray fetch of a query the caller let go: nobody reads its result.
      });
    }
    try {
      await (held === refreshed ? reread : held);
    } catch {
      // Kept on the held query's `.error`, which the caller reads.
    }
  }

  /** Resolves once the caller holds a read other than `held`. */
  function nextRead(held: R | null): Promise<void> {
    return new Promise((resolve) => {
      onRead = () => {
        if (read() === held) return;
        onRead = null;
        resolve();
      };
    });
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
      setRetrying(true);
      stalled = false;
      try {
        await heldRead(refreshed);
      } finally {
        setRetrying(false);
        stalled = false;
      }
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
