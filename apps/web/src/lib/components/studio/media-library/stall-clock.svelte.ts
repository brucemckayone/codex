/**
 * The clock the stall rule reads (`describeTile`, `isMediaOnItsWay`) for one
 * upload: one timer, for the moment it would stall, rather than a clock
 * ticking all the while (owner rule: no open-ended polling). Nothing else
 * brings the line's passing: no read, and no socket report. The clock lands
 * on the line at least, as a timer is not the wall clock. The picker's
 * chosen card and the editor's Publish step both read it.
 *
 * Call it during a component's initialisation: it registers an effect.
 */

import { MEDIA_STATUS, uploadStallsAt } from '@codex/constants';

/** The longest delay setTimeout keeps (2^31 - 1 ms). */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** An upload, as far as its stall line is read from it. */
interface StallMedia {
  status: string;
  createdAt?: Date | string | null;
}

export function createStallClock(media: () => StallMedia | null | undefined): {
  readonly now: number;
} {
  let clock = $state(Date.now());
  $effect(() => {
    const item = media();
    if (item?.status !== MEDIA_STATUS.UPLOADING || !item.createdAt) return;
    const at = uploadStallsAt(item.createdAt);
    const wait = at - Date.now();
    // Past setTimeout's limit a browser fires at once, which the clamp would
    // turn into a false "stopped": arm nothing; the next re-read checks again.
    if (!Number.isFinite(at) || wait >= MAX_TIMEOUT_MS) return;
    const timer = setTimeout(() => {
      clock = Math.max(Date.now(), at + 1);
    }, Math.max(0, wait) + 1);
    return () => clearTimeout(timer);
  });
  return {
    get now() {
      return clock;
    },
  };
}
