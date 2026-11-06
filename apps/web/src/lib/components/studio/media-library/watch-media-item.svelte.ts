/**
 * Watch one media item on the studio's status socket while it is on its
 * way to ready or failed (data-design §1.5: a card subscribes to its one
 * id), so a transcode that ends while the page is open says so. When it gets
 * there, or the store asks for the list again, the page's read of the item
 * is refreshed. The store bounds its own fallback (no open-ended polling,
 * owner rule). The picker's chosen card and the editor's Publish step
 * (Codex-a6ofh.2.4) both watch this way.
 *
 * Call it during a component's initialisation: it registers in an effect.
 */

import { MEDIA_STATUS } from '@codex/constants';
import { untrack } from 'svelte';
import { mediaStatus } from '$lib/client/media-status.svelte';

/** The page's read of the item: a remote query by id. */
interface MediaRead {
  readonly current: { id: string; status: string } | undefined;
  refresh(): Promise<void>;
}

export function watchMediaItem(read: () => MediaRead | null): {
  /** The item's id while it is watched; null once it is ready or failed. */
  readonly id: string | null;
} {
  /** A primitive, so a re-read that changes nothing re-subscribes nothing. */
  const watchedId = $derived.by(() => {
    const item = read()?.current;
    return item &&
      item.status !== MEDIA_STATUS.READY &&
      item.status !== MEDIA_STATUS.FAILED
      ? item.id
      : null;
  });
  $effect(() => {
    const id = watchedId;
    if (!id) return;
    // UNTRACKED, as the library registers in onMount: register() reads the
    // store's own `connection`, and an effect tracking it would re-subscribe
    // on every pause or stop, and each re-subscribe restarts the bounded
    // fallback, which is open-ended polling (owner rule).
    return untrack(() =>
      mediaStatus.register({
        listed: () => new Map([[id, read()?.current?.status ?? 'uploading']]),
        refresh: () => read()?.refresh(),
        settled: (mediaId) => {
          // A failure shows through the query's own `.error`.
          if (mediaId === id)
            read()
              ?.refresh()
              .catch(() => undefined);
        },
      })
    );
  });
  return {
    get id() {
      return watchedId;
    },
  };
}
