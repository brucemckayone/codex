/**
 * Publish when ready, as the Publish step shows it (Codex-a6ofh.2.9, mockup
 * W4r). What it shows is the piece's own fields, as last read: scheduled
 * (`publishRequestedAt`), didn't go live (`publishBlockedReason`), or live.
 * Nothing about the schedule is kept anywhere else.
 *
 * An open step learns of a go-live without polling of its own (owner,
 * 2026-11-08). The go-live lands a moment after the media settles, so when
 * the media watcher (already bounded) sees it settle while the piece is
 * scheduled, the piece is read again at most {@link REREAD_DELAYS_MS}.length
 * times, over about 15 s. Still scheduled after that, it offers Check again.
 *
 * Call during a component's initialisation: it registers an effect.
 */

import {
  CONTENT_STATUS,
  ERROR_CODES,
  MEDIA_STATUS,
  type PublicationState,
} from '@codex/constants';
import { logger } from '$lib/observability';
import {
  cancelPublishRequest,
  readPublishState,
} from '$lib/remote/content.remote';
import { isReadOutage, remoteErrorCode } from '$lib/remote/query-result';
import * as m from '$paraglide/messages';
import { logReadFailure } from '../media-library/log-read-failure';

/** The fields a piece's publish is read from. */
interface PublishState extends PublicationState {
  publishRequestedAt: Date | string | null;
  publishBlockedReason: string | null;
  /** Its address as saved, for View: what is on screen may not have saved. */
  slug: string | null;
}

/** The media as the step judges it, as far as the schedule reads it. */
interface ScheduleMedia {
  status: string;
  deleted: boolean;
  /** Failed, and a Try again can still get it there. */
  canRetry: boolean;
}

interface PublishScheduleOptions {
  contentId: string;
  /** The piece as read on arriving. */
  initial: PublishState;
  /** The media as the step judges it; null while it is not known. */
  media: () => ScheduleMedia | null;
}

/** Where the piece's publish stands, from its own fields; null for nothing. */
type SchedulePhase = 'live' | 'scheduled' | 'blocked' | null;

/**
 * What the banner shows: the phase, and while scheduled, what the wait is
 * on. Its host moves focus when it changes, as each has its own controls.
 */
type ScheduleView =
  | 'live'
  | 'blocked'
  | 'gone'
  | 'failed'
  | 'stale'
  | 'waiting'
  | null;

export type PublishSchedule = ReturnType<typeof createPublishSchedule>;

/** The waits before each read after the media settles: 2, 7 and 15 s in. */
export const REREAD_DELAYS_MS = [2_000, 5_000, 8_000] as const;

/** The publish fields of an answer, or null for anything that is not a row. */
function publishStateOf(answer: unknown): PublishState | null {
  if (typeof answer !== 'object' || answer === null || !('status' in answer)) {
    return null;
  }
  const { status } = answer;
  if (typeof status !== 'string') return null;
  const fields = answer as Partial<PublishState>;
  return {
    status,
    publishedAt: fields.publishedAt ?? null,
    publishRequestedAt: fields.publishRequestedAt ?? null,
    publishBlockedReason: fields.publishBlockedReason ?? null,
    slug: fields.slug ?? null,
  };
}

/**
 * The media will not change again by itself: ready, gone, or failed past
 * any Try again (the tile's rule, which is the server's
 * `isTerminalTranscodeFailure`). Only then does the server move a schedule
 * on (Codex-a6ofh.2.8), so only then is a read worth making.
 */
function settled(media: ScheduleMedia | null): boolean {
  if (media === null) return false;
  if (media.deleted || media.status === MEDIA_STATUS.READY) return true;
  return media.status === MEDIA_STATUS.FAILED && !media.canRetry;
}

export function createPublishSchedule(options: PublishScheduleOptions) {
  const { contentId } = options;
  let row = $state.raw<PublishState>(options.initial);
  /**
   * Reads are numbered as they are sent. `standing` is the newest whose news
   * stands: the last read taken, or every read sent before an answer that
   * was not a read (a publish, a cancel). A read no newer is older news.
   */
  let sent = 0;
  let standing = 0;

  const phase = $derived.by((): SchedulePhase => {
    if (row.status === CONTENT_STATUS.PUBLISHED) return 'live';
    if (row.status !== CONTENT_STATUS.DRAFT) return null;
    if (row.publishRequestedAt != null) return 'scheduled';
    return row.publishBlockedReason != null ? 'blocked' : null;
  });
  /**
   * Scheduled, and the media has had its say: the go-live (or why not) is on
   * its way. A boolean, so a media read that changes nothing restarts nothing.
   */
  const awaiting = $derived(phase === 'scheduled' && settled(options.media()));
  /** The reads after it settled ran out with it still scheduled. */
  let readsSpent = $state(false);
  let checking = $state(false);
  let cancelling = $state(false);
  /**
   * The last read the banner waits on could not be made (the reads after
   * the media settles, Check again, a lost cancel's read for the link):
   * until one is taken, or the phase moves. A refused cancel's read only
   * ever clears it, as its own line already says to reload.
   */
  let readFailed = $state(false);
  /** A cancel that did not land: its words, true until it is tried again. */
  let cancelProblem = $state<string | null>(null);
  /** The last end of the schedule was a cancel made here: said as one. */
  let cancelledHere = $state(false);
  /** Check again read it, and it is still scheduled: said, so the press is heard. */
  let stillWaiting = $state(false);
  /** The reads ran out with it still scheduled: Check again. */
  const stale = $derived(awaiting && readsSpent);
  /**
   * A read that could not be made, in the phase's words. Hidden while a
   * Check again is out, so one that fails again is heard again; what the
   * banner shows of it keys on `readFailed`, which holds meanwhile.
   */
  const readProblem = $derived(readFailed && !checking ? unreadWords() : null);

  const view = $derived.by((): ScheduleView => {
    if (phase !== 'scheduled') return phase;
    const media = options.media();
    if (media?.deleted) return 'gone';
    if (media?.status === MEDIA_STATUS.FAILED) return 'failed';
    return stale ? 'stale' : 'waiting';
  });

  /**
   * What a publish, a cancel or a read (`read`, its number) answered: the
   * piece as it now is. False, and logged, for an answer that is not a row,
   * which no server of this version sends.
   */
  function adopt(answer: unknown, read?: number): boolean {
    const next = publishStateOf(answer);
    if (next === null) {
      logger.error('studio_publish.unexpected_answer', {
        contentId,
        answer: answer === null ? 'null' : typeof answer,
      });
      return false;
    }
    const was = phase;
    // A read stands from its own place; anything else, over every read sent.
    standing = read === undefined ? sent : Math.max(standing, read);
    row = next;
    // A new phase: what was said about the old one no longer holds.
    if (phase !== was) {
      readFailed = false;
      cancelProblem = null;
      stillWaiting = false;
      if (phase !== null) cancelledHere = false;
    }
    return true;
  }

  /**
   * An answer older than the last one taken that still adds to it: live,
   * while all that is known of it live is a cancel's refusal, whose stand-in
   * row has no address (a piece read live always has its slug).
   */
  function stillNews(answer: unknown): boolean {
    return (
      phase === 'live' &&
      row.slug === null &&
      publishStateOf(answer)?.status === CONTENT_STATUS.PUBLISHED
    );
  }

  /**
   * Read the piece again. Never rejects: a failure is logged, and false.
   * Newer news taken while it was out (`standing`) stands over it, whether
   * this one answered or failed (true then, as there is nothing to say),
   * unless this one adds to it (`stillNews`). Live with its link known, a
   * failure has nothing to say either: nothing is waiting on it.
   */
  async function reread(): Promise<boolean> {
    sent += 1;
    const read = sent;
    try {
      const answer = await readPublishState(contentId);
      if (read <= standing && !stillNews(answer)) return true;
      if (!adopt(answer, read)) return false;
      // Read: an earlier read's failure no longer holds.
      readFailed = false;
      return true;
    } catch (err) {
      logReadFailure('studio_publish.schedule_unread', err, { contentId });
      return read <= standing || (phase === 'live' && row.slug !== null);
    }
  }

  /** A read that could not be made, as the phase it left says it. */
  function unreadWords(): string {
    // Live, the read was for its link: Done still leads to the content list.
    return phase === 'live'
      ? m.studio_publish_live_unread()
      : m.studio_publish_scheduled_unread();
  }

  // Settled while scheduled: read for the go-live a few times, then hand it
  // to Check again. Live, cancelled or blocked, this effect stops.
  $effect(() => {
    if (!awaiting) return;
    // Settled anew (a retry, then ready): what the last reads found is old.
    readsSpent = false;
    stillWaiting = false;
    readFailed = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let read = true;
      for (const delay of REREAD_DELAYS_MS) {
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, delay);
        });
        if (stopped) return;
        read = await reread();
        if (stopped) return;
      }
      readsSpent = true;
      // The last read never answered: "should be live in a moment" is not known.
      if (!read) readFailed = true;
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  });

  return {
    /** As the draft session reads whether the piece has been live. */
    get publication(): PublicationState {
      return row;
    },
    get phase() {
      return phase;
    },
    get view() {
      return view;
    },
    get live() {
      return phase === 'live';
    },
    get scheduled() {
      return phase === 'scheduled';
    },
    /** Why the last scheduled attempt didn't go live, until a new ask clears it. */
    get blockedReason() {
      return phase === 'blocked' ? row.publishBlockedReason : null;
    },
    /** The reads ran out with it still scheduled: Check again. */
    get stale() {
      return stale;
    },
    get checking() {
      return checking;
    },
    get cancelling() {
      return cancelling;
    },
    /** The last read the banner waits on could not be made (not a refused cancel's): it holds what it shows of that. */
    get readFailed() {
      return readFailed;
    },
    /** A read that could not be made, said under the banner by its own line. */
    get readProblem() {
      return readProblem;
    },
    /** A cancel that did not land, said by its own line, so neither hides the other. */
    get cancelProblem() {
      return cancelProblem;
    },
    get cancelledHere() {
      return cancelledHere;
    },
    get stillWaiting() {
      return stillWaiting;
    },
    get slug() {
      return row.slug;
    },
    /** A publish's answer: news over every read sent before it. */
    adopt: (answer: unknown) => adopt(answer),
    /**
     * Check again: one more read, said if it fails. Scheduled, for the
     * go-live; live after a lost cancel, for its link.
     */
    async checkAgain(): Promise<void> {
      if (checking) return;
      checking = true;
      stillWaiting = false;
      try {
        if (!(await reread())) readFailed = true;
        else stillWaiting = phase === 'scheduled';
      } finally {
        checking = false;
      }
    },
    /**
     * Cancel the schedule: an ordinary draft again. Lost to a go-live that
     * landed first, the refusal says it is live, so it shows as live at once;
     * a read fills in the rest.
     */
    async cancel(): Promise<boolean> {
      if (cancelling) return false;
      cancelling = true;
      cancelProblem = null;
      try {
        if (adopt(await cancelPublishRequest(contentId))) {
          cancelledHere = phase === null;
          return true;
        }
        // Answered, but not with the piece: whether it landed is not known.
        cancelProblem = m.studio_publish_scheduled_cancel_refused();
        void reread();
        return false;
      } catch (err) {
        if (remoteErrorCode(err) === ERROR_CODES.CONTENT_ALREADY_LIVE) {
          logger.warn('studio_publish.cancel_lost_to_go_live', { contentId });
          // A read already brought it live, with its address: nothing to add.
          if (phase === 'live') return false;
          // Its saved address is not known from a refusal: View waits for
          // the read to bring it (a route finds a piece by its slug only).
          // A read that fails says so, and Check again reads once more.
          adopt({
            ...row,
            status: CONTENT_STATUS.PUBLISHED,
            publishRequestedAt: null,
            slug: null,
          });
          void reread().then((read) => {
            if (!read) readFailed = true;
          });
          return false;
        }
        logReadFailure('studio_publish.cancel_failed', err, { contentId });
        if (isReadOutage(err)) {
          cancelProblem = m.studio_publish_scheduled_cancel_failed();
        } else {
          // Refused: a Try again cannot help, and the schedule may be gone.
          cancelProblem = m.studio_publish_scheduled_cancel_refused();
          void reread();
        }
        return false;
      } finally {
        cancelling = false;
      }
    },
  };
}
