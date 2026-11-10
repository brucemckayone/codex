/**
 * A surface's one payouts read (`getMyConnectStatus`), judged as a piece
 * that earns needs it (`readPayouts`): the content lists' draft progress
 * and the Publish step (Codex-a6ofh.2.6). A read that fails is logged under
 * `event`, and said by the surface, never taken for "not set up".
 *
 * Call during a component's initialisation: it registers an effect.
 */
import { getMyConnectStatus } from '$lib/remote/subscription.remote';
import { type PayoutsRead, readPayouts } from '$lib/utils/connect-readiness';
import { logReadFailure } from './media-library/log-read-failure';

export interface PayoutsReadState {
  readonly current: PayoutsRead;
  /** A Try again is in flight. */
  readonly retrying: boolean;
  /** The last Try again failed too: said, so a second failure is not a dead button. */
  readonly failedAgain: boolean;
  /** Read again (Try again), once at a time; a failure shows through `current`, and is logged. */
  refresh(): Promise<void>;
}

export function createPayoutsRead(
  event: string,
  context: () => Record<string, unknown> = () => ({})
): PayoutsReadState {
  const status = getMyConnectStatus();
  const current = $derived(readPayouts(status));
  $effect(() => {
    if (status.error != null) logReadFailure(event, status.error, context());
  });
  let retrying = $state(false);
  let failedAgain = $state(false);
  return {
    get current() {
      return current;
    },
    get retrying() {
      return retrying;
    },
    get failedAgain() {
      return failedAgain;
    },
    async refresh() {
      if (retrying) return;
      retrying = true;
      try {
        await status.refresh();
      } catch {
        // Kept on the query's `error`, which the effect above logs.
      }
      failedAgain = readPayouts(status) === 'unread';
      retrying = false;
    },
  };
}
