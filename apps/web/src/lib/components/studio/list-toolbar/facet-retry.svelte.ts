/**
 * A facet's Try again (Codex-a6ofh.3.3, owner): the words its menu and its
 * phone sheet say while it runs and after it fails again, as the New menu's
 * drafts say theirs. Made once, where the read is held, and handed to both
 * views as their `unread`, so they agree and a reopened sheet keeps it.
 */
import * as m from '$paraglide/messages';
import type { FacetUnread } from './list-option';

export interface FacetRetryOptions {
  /** What could not be read: "Couldn't load the categories." */
  failed: () => string;
  /** The same once a Try again failed too, so a repeat is told apart. */
  failedAgain: () => string;
  /**
   * Reads the choices again; rejects when that read fails. One at a time,
   * so it settles with its own read. The owner logs a failure (the read's
   * own error): this only says it.
   */
  read: () => Promise<unknown>;
}

export function createFacetRetry(options: FacetRetryOptions): FacetUnread {
  let retrying = $state(false);
  let failedAgain = $state(false);

  return {
    get words() {
      if (retrying) return m.studio_list_facet_retrying();
      return failedAgain ? options.failedAgain() : options.failed();
    },
    get retrying() {
      return retrying;
    },
    async retry() {
      if (retrying) return false;
      retrying = true;
      try {
        await options.read();
        failedAgain = false;
      } catch {
        failedAgain = true;
      }
      retrying = false;
      return !failedAgain;
    },
  };
}
