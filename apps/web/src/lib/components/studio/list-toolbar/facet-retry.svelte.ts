/**
 * A facet's Try again (Codex-a6ofh.3.3, owner): the words its menu and its
 * phone sheet say while it runs and after it fails again, as the New menu's
 * drafts say theirs. Judged on the read's own answer: `retry` settles when
 * the refreshed read does.
 */
import * as m from '$paraglide/messages';
import type { FacetUnread } from './list-option';

export interface FacetRetry {
  /** What the facet says: failed, trying again, or failed again. */
  readonly words: string;
  readonly retrying: boolean;
  /** Reads again, once at a time; true when the read came back. */
  retry(): Promise<boolean>;
}

export function createFacetRetry(
  unread: () => FacetUnread | undefined
): FacetRetry {
  let retrying = $state(false);
  let failedAgain = $state(false);

  return {
    get words() {
      const facet = unread();
      if (!facet) return '';
      if (retrying) return m.studio_list_facet_retrying();
      return failedAgain ? facet.failedAgain() : facet.failed();
    },
    get retrying() {
      return retrying;
    },
    async retry() {
      const facet = unread();
      if (retrying || !facet) return false;
      retrying = true;
      try {
        await facet.retry();
        failedAgain = false;
      } catch {
        // Kept on the read's own error, which its page logs.
        failedAgain = true;
      }
      retrying = false;
      return !failedAgain;
    },
  };
}
