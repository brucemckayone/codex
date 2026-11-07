/**
 * The reads a piece's settings are checked by (Codex-a6ofh.2.4): payouts, the
 * org's plans and the media as it stands now. The Publish step lists what is
 * missing from them; a live piece's Settings (Codex-a6ofh.2.5) offers the
 * same choices by them. A read that fails is logged, and said by its host
 * with Try again, never taken for "ready" or "none".
 *
 * Call during a component's initialisation: it registers effects, and
 * watches the media while it is on its way.
 */

import { mediaStatus } from '$lib/client/media-status.svelte';
import { getMediaItem } from '$lib/remote/media.remote';
import { type QueryResult, remoteErrorStatus } from '$lib/remote/query-result';
import { listTiers } from '$lib/remote/subscription.remote';
import type { ContentWithRelations, SubscriptionTier } from '$lib/types';
import {
  connectQueryState,
  payoutSetupHref,
} from '$lib/utils/connect-readiness';
import { logReadFailure } from '../media-library/log-read-failure';
import { watchMediaItem } from '../media-library/watch-media-item.svelte';
import { createPayoutsRead } from '../payouts-read.svelte';
import type { DraftValues } from './draft-session.svelte';

export interface PublishReadsOptions {
  /** The session's own values, the same object for its life. */
  values: Readonly<DraftValues>;
  /** The piece as read on arriving: its media row stands in until the media's own read. */
  content: () => ContentWithRelations;
  organizationId: () => string | null;
}

/** The media as the checklist judges it; null while it is not known. */
interface PublishMedia {
  status: string;
  deleted: boolean;
  progress: number | null;
}

export type PublishReads = ReturnType<typeof createPublishReads>;

export function createPublishReads(options: PublishReadsOptions) {
  const { values } = options;

  // ── Payouts ─────────────────────────────────────────────────────────────
  // They gate the kinds that earn, by the rule the content lists' draft
  // progress uses too (`readPayouts`). Offered while still loading, so a
  // set-up creator never sees them flash off (the server judges). A read
  // that failed is not "not set up": the host says it is unread, with Try
  // again.
  const payouts = createPayoutsRead('studio_publish.connect_unread', () => ({
    organizationId: options.organizationId(),
  }));

  // ── The org's active plans (the options) ────────────────────────────────
  // Plans never read are not "none": the picker is disabled and no set is
  // sent (AccessSection's rule).
  const tiersQuery = $derived.by(() => {
    const org = options.organizationId();
    return org ? listTiers(org) : null;
  });
  const tiersRead = $derived(
    connectQueryState(tiersQuery as QueryResult<SubscriptionTier[]> | null)
  );
  $effect(() => {
    if (tiersQuery?.error != null) {
      logReadFailure('studio_publish.tiers_unread', tiersQuery.error, {
        organizationId: options.organizationId(),
      });
    }
  });

  // ── The media, read again and watched while it is on its way ────────────
  const mediaId = $derived(values.mediaItemId);
  const mediaQuery = $derived(mediaId ? getMediaItem(mediaId) : null);
  watchMediaItem(() => mediaQuery);
  const mediaRow = $derived.by(() => {
    if (mediaQuery?.current) return mediaQuery.current;
    const content = options.content();
    return mediaId !== null && content.mediaItemId === mediaId
      ? (content.mediaItem ?? null)
      : null;
  });
  /** Deleted, or no longer theirs: the read says so. */
  const mediaGone = $derived(remoteErrorStatus(mediaQuery?.error) === 404);
  /** Never read: the arrival's status is not taken for the media's now. */
  const mediaUnread = $derived(
    !mediaGone && mediaQuery?.error != null && mediaQuery.current === undefined
  );
  // The watch's settled refresh leaves its failure here too.
  $effect(() => {
    const error = mediaQuery?.error;
    if (error == null) return;
    logReadFailure(
      mediaGone ? 'studio_publish.media_gone' : 'studio_publish.media_unread',
      error,
      { mediaId }
    );
  });
  const media = $derived.by((): PublishMedia | null => {
    if (!mediaId || mediaUnread) return null;
    if (mediaGone) {
      return {
        status: mediaRow?.status ?? 'ready',
        deleted: true,
        progress: null,
      };
    }
    if (!mediaRow) return null;
    const live = mediaStatus.items.get(mediaId);
    return {
      status: live?.lifecycle ?? mediaRow.status,
      deleted: mediaRow.deletedAt != null,
      progress: live?.progress ?? mediaRow.transcodingProgress ?? null,
    };
  });

  return {
    get connectReady() {
      return payouts.current !== 'missing';
    },
    get connectUnread() {
      return payouts.current === 'unread';
    },
    /** Not read yet: offered meanwhile, but never announced ready (Codex-a6ofh.2.6). */
    get connectLoading() {
      return payouts.current === 'loading';
    },
    get connectRetrying() {
      return payouts.retrying;
    },
    get connectFailedAgain() {
      return payouts.failedAgain;
    },
    get payoutsHref() {
      return payoutSetupHref(options.organizationId() !== null);
    },
    /** A failure shows through `connectUnread`, and the read logs it. */
    /** Resolves once the re-read settles; never rejects. */
    rereadConnect(): Promise<void> {
      return payouts.refresh();
    },
    get orgTiers(): SubscriptionTier[] {
      return tiersRead.kind === 'ok' ? tiersRead.status : [];
    },
    get tiersState(): 'loading' | 'loaded' | 'failed' {
      if (!options.organizationId()) return 'loaded';
      if (tiersRead.kind === 'failed') return 'failed';
      if (tiersRead.kind === 'loading') return 'loading';
      return values.access.tierIds !== null ? 'loaded' : 'failed';
    },
    /** A failure shows through the query's `.error`, logged above. */
    rereadTiers() {
      tiersQuery?.refresh().catch(() => undefined);
    },
    /** The media's own read: its poster and length. */
    get mediaQuery() {
      return mediaQuery;
    },
    get mediaRow() {
      return mediaRow;
    },
    get mediaUnread() {
      return mediaUnread;
    },
    get media() {
      return media;
    },
    /** A failure shows through the query's `.error`, logged above. */
    rereadMedia() {
      mediaQuery?.refresh().catch(() => undefined);
    },
  };
}
