/**
 * Capped checks for a success page waiting on our record (Codex-2hxff.22;
 * owner decision 2026-10-26, "Capped, then a button").
 *
 * The page checks again about six times over the first minute, at roughly 2,
 * 5, 10, 20, 40 and 60 seconds after it started waiting, and only while the
 * tab is visible. Then it STOPS, and the page offers Check again: one check
 * per click. It never polls open-endedly. Every check is a billed request,
 * and a tab left open must not keep them going (the owner: "I'll be leaving a
 * webpage open and then racking up my bill").
 *
 * A check that falls due while the tab is hidden waits until it is shown,
 * then runs once. Hidden time adds no checks: there are never more than six,
 * and each comes at least its gap in the schedule after the one before, so a
 * tab shown again after a long while does not fire the rest at once.
 */

/** When each scheduled check runs, in ms after the wait began. */
export const CHECK_SCHEDULE_MS: readonly number[] = [
  2_000, 5_000, 10_000, 20_000, 40_000, 60_000,
];

export class CappedChecks {
  /** Every scheduled check has run: the page offers Check again. */
  exhausted = $state(false);
  /** A check is running. */
  checking = $state(false);

  readonly #check: () => Promise<unknown>;
  readonly #schedule: readonly number[];
  // Not reactive: `start` runs inside an `$effect` and must track nothing.
  /** Scheduled checks run so far. */
  #ran = 0;
  /**
   * When the wait began, and when the last check STARTED. Kept across a stop
   * and a restart, so a page that pauses the checks (while a check's own
   * answer is on its way) resumes the same timeline, not a new one. Taken at
   * the start, not the finish: a page whose answer restarts the checks before
   * the check has settled would otherwise time the next one from the check
   * before, and fire it at once.
   */
  #startedAt: number | undefined;
  #lastRanAt = 0;

  /**
   * @param check - One check, e.g. `() => invalidate('checkout:verify')`.
   *   It settles when the page has the answer.
   */
  constructor(
    check: () => Promise<unknown>,
    schedule: readonly number[] = CHECK_SCHEDULE_MS
  ) {
    this.#check = check;
    this.#schedule = schedule;
  }

  /**
   * Run the scheduled checks, and return the cleanup that stops them. Call
   * it from an `$effect` that runs while the page is waiting: the checks stop
   * when the wait ends or the page goes.
   */
  start(): () => void {
    if (this.#startedAt === undefined) {
      this.#startedAt = Date.now();
      this.#lastRanAt = this.#startedAt;
    }
    const startedAt = this.#startedAt;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let dueWhileHidden = false;

    const runDue = async () => {
      this.#ran += 1;
      this.#lastRanAt = Date.now();
      await this.#run();
      if (!stopped) scheduleNext();
    };
    const scheduleNext = () => {
      const offset = this.#schedule[this.#ran];
      if (offset === undefined) {
        this.exhausted = true;
        return;
      }
      const gap = offset - (this.#schedule[this.#ran - 1] ?? 0);
      const dueAt = Math.max(startedAt + offset, this.#lastRanAt + gap);
      timer = setTimeout(
        () => {
          if (document.visibilityState === 'hidden') {
            dueWhileHidden = true;
            return;
          }
          void runDue();
        },
        Math.max(0, dueAt - Date.now())
      );
    };
    const onVisibilityChange = () => {
      if (stopped || !dueWhileHidden) return;
      if (document.visibilityState !== 'visible') return;
      dueWhileHidden = false;
      void runDue();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    scheduleNext();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }

  /** Check again: one check, with none scheduled after it. */
  async checkOnce(): Promise<void> {
    if (this.checking) return;
    await this.#run();
  }

  async #run(): Promise<void> {
    this.checking = true;
    try {
      await this.#check();
    } catch {
      // The page's load logs its own failure, and its answer is what the
      // page shows. A check that could not run is one fewer, not an error.
    } finally {
      this.checking = false;
    }
  }
}
