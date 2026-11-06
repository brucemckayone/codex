<!--
  @component PublishStep

  Step 2, Publish (Codex-a6ofh.2.4, mockup W4), for a piece that has never
  been live: everything that isn't the piece itself, on one screen. Who can
  watch is open; how it looks in lists shows the card it becomes; where it
  appears folds to a one-line summary. Only what is missing is listed, right
  above the one button, which names what it does ("Publish for £12.00").

  Settings save as they go, through the same draft session as Write (owner
  3A). Publish is the session's (`session.publish`): it saves what is on
  screen, riding any save already out, then publishes, so it never puts an
  older save live. The checklist is the publish gate's own rules read from
  the screen (`publishGaps`); a refusal the server sends anyway is listed by
  its code (`PUBLISH_REFUSAL_CODES`), or said in its own words. A read it
  checks by (the media, payouts) that fails is logged and said, with Try
  again, never taken for "nothing missing"; Publish stays open, as the
  server still judges.

  Mounted by `ContentEditor`, once per visit, from the read the route made
  on arriving, so the session starts from the piece as Write left it.

  @prop {ContentWithRelations} content - The draft, read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for the piece's address; null in the personal studio
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by, on the card
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { navigating } from '$app/state';
  import { describeThrown } from '$lib/client-log';
  import { mediaStatus } from '$lib/client/media-status.svelte';
  import { Button } from '$lib/components/ui';
  import * as Accordion from '$lib/components/ui/Accordion';
  import ContentCard from '$lib/components/ui/ContentCard/ContentCard.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { getCategories } from '$lib/remote/categories.remote';
  import { publishContent } from '$lib/remote/content.remote';
  import { getMediaItem } from '$lib/remote/media.remote';
  import type { QueryResult } from '$lib/remote/query-result';
  import { remoteErrorStatus } from '$lib/remote/query-result';
  import { getMyConnectStatus, listTiers } from '$lib/remote/subscription.remote';
  import { logger } from '$lib/observability';
  import type { ContentWithRelations, SubscriptionTier } from '$lib/types';
  import { deriveConnectState } from '$lib/utils/bank-payouts';
  import { connectQueryState, payoutSetupHref } from '$lib/utils/connect-readiness';
  import { accessGroupToFlags, type ContentAccessKind } from '$lib/utils/content-access';
  import { formatPrice } from '$lib/utils/format';
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';
  import * as m from '$paraglide/messages';
  import AccessSection from '../content-form/AccessSection.svelte';
  import OrganizeSection from '../content-form/OrganizeSection.svelte';
  import SlugField from '../content-form/SlugField.svelte';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { watchMediaItem } from '../media-library/watch-media-item.svelte';
  import { selectFromTier, toggleTierId } from '../plan-picker/select-from-tier';
  import { savedDraftValues, TYPE_WORD } from './canvas-text';
  import CoverLine from './CoverLine.svelte';
  import { createDraftSession, type DraftValues } from './draft-session.svelte';
  import { CONTENT_LIST_HREF, type EditorContentType, editHref } from './editor-url';
  import { priceText, withKind, withPrice } from './publish-access';
  import { asPublishGap, gapRow, type PublishGap, publishGaps, refusalPutRightBy } from './publish-gaps';
  import WriteBar from './WriteBar.svelte';

  interface Props {
    content: ContentWithRelations;
    contentType: EditorContentType;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    authorName: string;
  }

  const { content, contentType, organizationId, orgSlug, creatorUsername = null, authorName }: Props = $props();

  // One session per mount (ContentEditor keys it per visit): the props it is
  // started from are this visit's read.
  const session = untrack(() =>
    createDraftSession({
      saved: { id: content.id, values: savedDraftValues(content) },
      publication: () => ({ status: content.status, publishedAt: content.publishedAt }),
      contentType,
      organizationId,
    })
  );
  /** The session's own values, the same object for its life. */
  const values = session.values;
  const access = $derived(session.values.access);
  const writeHref = $derived(editHref(content.id));

  /** A change made here: what the last Publish was refused for may be put right. */
  function change<K extends keyof DraftValues>(key: K, value: DraftValues[K]) {
    if (refusal && refusalPutRightBy(refusal.gap, key)) refusal = null;
    session.set(key, value);
  }

  // ── Who can watch ──────────────────────────────────────────────────────
  // Payouts gate the kinds that earn (`deriveConnectState` reads the two
  // flags the server checks). Ready until known, as the old form assumed, so
  // a set-up creator never sees those kinds flash off; the server judges. A
  // read that failed is never "ready": the checklist says it couldn't check.
  const connectStatus = getMyConnectStatus();
  const connectRead = $derived(connectQueryState(connectStatus));
  const connectReady = $derived(
    connectRead.kind === 'ok' ? deriveConnectState(connectRead.status) === 'enabled' : true
  );
  const connectUnread = $derived(connectRead.kind === 'failed');
  $effect(() => {
    if (connectStatus.error != null) logReadFailure('studio_publish.connect_unread', connectStatus.error);
  });
  /** A failure shows through the query's `.error`, logged above. */
  function rereadConnect() {
    connectStatus.refresh().catch(() => undefined);
  }
  const payoutsHref = $derived(payoutSetupHref(organizationId !== null));

  // The org's active plans (the options). Plans never read are not "none":
  // the picker is disabled and no set is sent (AccessSection's rule).
  const tiersQuery = $derived(organizationId ? listTiers(organizationId) : null);
  const tiersRead = $derived(connectQueryState(tiersQuery as QueryResult<SubscriptionTier[]> | null));
  const orgTiers = $derived<SubscriptionTier[]>(tiersRead.kind === 'ok' ? tiersRead.status : []);
  $effect(() => {
    if (tiersQuery?.error != null) {
      logReadFailure('studio_publish.tiers_unread', tiersQuery.error, { organizationId });
    }
  });
  /** A failure shows through the query's `.error`, logged above. */
  function rereadTiers() {
    tiersQuery?.refresh().catch(() => undefined);
  }
  const tiersState = $derived.by((): 'loading' | 'loaded' | 'failed' => {
    if (!organizationId) return 'loaded';
    if (tiersRead.kind === 'failed') return 'failed';
    if (tiersRead.kind === 'loading') return 'loading';
    return access.tierIds !== null ? 'loaded' : 'failed';
  });

  /** The price as typed; the session holds it in pence. */
  let typedPrice = $state(untrack(() => priceText(session.values.access.priceCents)));

  function changeKind(kind: string) {
    // AccessSection's options are the five kinds.
    const next = withKind(access, kind as ContentAccessKind);
    if (next.priceCents !== access.priceCents) typedPrice = priceText(next.priceCents);
    change('access', next);
  }

  function changePrice(text: string) {
    typedPrice = text;
    change('access', withPrice(access, text));
  }

  function toggleTier(tierId: string) {
    change('access', { ...access, tierIds: toggleTierId(access.tierIds ?? [], tierId) });
  }

  function selectTiersFrom(tierId: string) {
    change('access', { ...access, tierIds: selectFromTier(access.tierIds ?? [], tierId, orgTiers) });
  }

  /** What a save sends for the access group: what the card and the button read. */
  const flags = $derived(accessGroupToFlags(access, organizationId));
  const forSale = $derived(flags.isPurchasable && (flags.priceCents ?? 0) > 0);

  // ── How it looks in lists ──────────────────────────────────────────────
  /** A cover set or removed here (CoverLine's, bound); undefined until then, so the saved one shows. */
  let coverSet = $state<string | null | undefined>(undefined);
  const cover = $derived(coverSet === undefined ? content.thumbnailUrl : coverSet);
  /** A cover set or removed here: a refusal for a deleted frame no longer holds. */
  function setCover(next: string | null | undefined) {
    coverSet = next;
    if (refusal?.gap === 'THUMBNAIL_MEDIA_DELETED') refusal = null;
  }
  /** A cover is going up or coming off: Publish waits for it. */
  let coverBusy = $state(false);
  /** Its saved cover is a frame of a video since deleted (Codex-tqvmx), until another is set. */
  const coverDeleted = $derived(coverSet === undefined && content.thumbnailFrame?.deletedAt != null);

  // The media, read again here and watched while it is on its way, so the
  // checklist says how far it has got and Publish opens once it is ready.
  const mediaId = $derived(values.mediaItemId);
  const mediaQuery = $derived(mediaId ? getMediaItem(mediaId) : null);
  watchMediaItem(() => mediaQuery);
  const mediaRow = $derived(
    mediaQuery?.current ?? (mediaId !== null && content.mediaItemId === mediaId ? content.mediaItem : null) ?? null
  );
  /** Deleted, or no longer theirs: the read says so. */
  const mediaGone = $derived(remoteErrorStatus(mediaQuery?.error) === 404);
  /** Never read: the arrival's status is not taken for the media's now. */
  const mediaUnread = $derived(!mediaGone && mediaQuery?.error != null && mediaQuery.current === undefined);
  // The watch's settled refresh leaves its failure here too.
  $effect(() => {
    const error = mediaQuery?.error;
    if (error == null) return;
    logReadFailure(mediaGone ? 'studio_publish.media_gone' : 'studio_publish.media_unread', error, { mediaId });
  });
  /** A failure shows through the query's `.error`, logged above. */
  function rereadMedia() {
    mediaQuery?.refresh().catch(() => undefined);
  }
  const media = $derived.by(() => {
    if (!mediaId || mediaUnread) return null;
    if (mediaGone) return { status: mediaRow?.status ?? 'ready', deleted: true, progress: null };
    if (!mediaRow) return null;
    const live = mediaStatus.items.get(mediaId);
    return {
      status: live?.lifecycle ?? mediaRow.status,
      deleted: mediaRow.deletedAt != null,
      progress: live?.progress ?? mediaRow.transcodingProgress ?? null,
    };
  });

  const cardType = $derived(contentType === 'written' ? 'article' : contentType);
  // The media's poster comes with its own read (the row's media has none).
  const cardThumbnail = $derived(getDisplayThumbnail({ thumbnailUrl: cover, mediaItem: mediaQuery?.current ?? null }));

  // ── Where it appears ───────────────────────────────────────────────────
  // Names only for a piece filed under some: OrganizeSection reads the same
  // query (cached by org) once the fold opens.
  const categoriesQuery = $derived(
    organizationId && values.categoryIds.length > 0 ? getCategories(organizationId) : null
  );
  /** The fold's one line: its categories (an org's), and whether it is on the homepage. */
  const whereSummary = $derived.by(() => {
    const parts: string[] = [];
    const categories = categoriesQuery?.current;
    if (categoriesQuery?.error != null && !categories) parts.push(m.studio_publish_where_categories_unread());
    else if (organizationId && (categories || values.categoryIds.length === 0)) {
      const names = (categories ?? []).filter((c) => values.categoryIds.includes(c.id)).map((c) => c.name);
      parts.push(names.length > 0 ? names.join(', ') : m.studio_publish_where_no_categories());
    }
    parts.push(values.featured ? m.studio_publish_where_featured() : m.studio_publish_where_not_featured());
    return parts.join(' · ');
  });

  $effect(() => {
    if (categoriesQuery?.error != null) {
      logReadFailure('studio_publish.categories_unread', categoriesQuery.error, { organizationId });
    }
  });

  /** What is typed in the slug field is not a slug: Publish would send the last one that was. */
  let slugInvalid = $state(false);
  /** A category created in the fold is on its way: Publish waits to save it. */
  let categoryBusy = $state(false);

  // ── Before this can go live ────────────────────────────────────────────
  const gaps = $derived(
    publishGaps({
      contentType,
      values,
      needsTitle: session.needsTitle,
      media,
      coverDeleted,
      connectReady,
      organizationId,
    })
  );
  /**
   * What the last Publish was refused for: its row, or its own words. Cleared
   * by the next, or by a change here that may put it right
   * (`refusalPutRightBy`). `unsent`: it stopped at its save.
   */
  let refusal = $state<{ gap: PublishGap | null; message: string; unsent: boolean; slow: boolean } | null>(null);
  /**
   * A refusal's words, when it has no row. One that stopped at its save is
   * said as the save now stands: saved since (so Publish again), still out
   * (`slow`), or in the save's own words until its retry fails too, which
   * the bar then says.
   */
  const refusalWords = $derived.by(() => {
    if (!refusal || refusal.gap !== null) return null;
    if (!refusal.unsent) return refusal.message;
    if (session.status === 'error') return null;
    if (session.status === 'saved') return m.studio_publish_saved_press_again();
    return refusal.slow ? m.studio_editor_publish_save_slow() : refusal.message;
  });
  const rows = $derived.by(() => {
    const extra = refusal?.gap;
    const listed = extra && !gaps.includes(extra) ? [...gaps, extra] : gaps;
    return listed.map((gap) => gapRow(gap, { contentType, media }));
  });

  let publishing = $state(false);
  /** It went live: held still until the next page takes over. */
  let done = $state(false);
  const held = $derived(publishing || done);
  const waitHint = $derived(
    coverBusy ? m.studio_editor_next_needs_cover() : categoryBusy ? m.studio_publish_wait_category() : null
  );
  const blocked = $derived(gaps.length > 0 || coverBusy || categoryBusy || slugInvalid);
  /** Nothing is missing, and nothing it checks by went unread. */
  const ready = $derived(rows.length === 0 && !slugInvalid && !mediaUnread && !connectUnread);
  /**
   * The checklist's one live region: the wait, the all-clear, or (heard
   * only) how much is left, so a row going (the media ready) is told.
   */
  const left = $derived(rows.length + Number(slugInvalid));
  const statusWords = $derived.by(() => {
    if (waitHint) return waitHint;
    if (ready) return m.studio_publish_gaps_none();
    if (left > 0) return m.studio_publish_gaps_left({ count: left });
    if (mediaUnread) return m.studio_publish_media_unread({ type: TYPE_WORD[contentType]() });
    return connectUnread ? m.studio_publish_connect_unread() : '';
  });
  /** What Publish is doing, outside what it holds still, so it is heard and keeps focus. */
  const progressWords = $derived.by(() => {
    if (done) return m.studio_publish_live({ title: values.title.trim() });
    if (!publishing) return '';
    return session.holdingMove ? m.studio_publish_publishing_then_move() : m.studio_publish_publishing();
  });
  let progressEl = $state<HTMLElement | null>(null);
  const publishWords = $derived(
    forSale ? m.studio_publish_button_price({ price: formatPrice(flags.priceCents) }) : m.studio_publish_button()
  );
  const gapsId = $props.id();
  let gapsEl = $state<HTMLElement | null>(null);

  /** Unmounted (its host closed it): nothing left here to show or move. */
  let gone = false;
  $effect(() => () => {
    gone = true;
  });

  /** Where Publish leads, or a move asked for meanwhile: a failed move still lands. */
  function leave(to: string | URL) {
    goto(to).catch((err) => {
      logger.warn('studio_publish.leave_failed', { contentId: content.id, ...describeThrown(err) });
      location.assign(to);
    });
  }

  /**
   * Save what is on screen, then publish. Live, it is listed with the
   * creator's other pieces, or goes where the creator moved to meanwhile;
   * refused, the checklist says why, and focus goes there, as the screen is
   * held still meanwhile (a move waits: the session holds it).
   */
  async function publish() {
    // A move already under way is the creator's last word: Publish waits.
    if (held || blocked || navigating.to !== null) return;
    publishing = true;
    refusal = null;
    // The button goes busy, so focus goes where the progress is said.
    void tick().then(() => progressEl?.focus());
    try {
      const result = await session.publish(publishContent);
      const heldMove = session.takeHeldMove();
      if (result.ok) {
        done = true;
        toast.success(m.studio_publish_live({ title: values.title.trim() }));
        if (!gone) leave(heldMove ?? CONTENT_LIST_HREF);
        return;
      }
      const message = result.message ?? m.studio_editor_publish_failed();
      if (gone) {
        toast.error(message);
        return;
      }
      refusal = {
        gap: asPublishGap(result.code),
        message,
        unsent: result.unsent === true,
        slow: result.code === 'SAVE_SLOW',
      };
    } finally {
      publishing = false;
    }
    await tick();
    gapsEl?.focus();
  }
</script>

<!-- Held still while Publish runs and once it has gone live, the bar's way
     back included; only the foot, which says what is happening, is not. -->
<div class="editor">
  <div class="publish-held" inert={held}>
    <WriteBar {session} {contentType} step="publish" backHref={writeHref} />
  </div>

  <div class="publish">
    <div class="publish-held" inert={held}>
      <header class="publish-head">
        <h1 class="publish-title">{values.title}</h1>
        <p class="publish-intro">{m.studio_publish_intro()}</p>
      </header>

      <section class="publish-section" aria-labelledby="{gapsId}-who">
        <h2 class="publish-heading" id="{gapsId}-who">
          <span class="publish-ordinal" aria-hidden="true">1</span>
          {m.studio_publish_who()}
        </h2>
        <AccessSection
          {organizationId}
          layout="row"
          tiers={orgTiers}
          {tiersState}
          onRetryTiers={rereadTiers}
          accessTypeVal={access.kind}
          priceVal={typedPrice}
          selectedTierIds={access.tierIds ?? []}
          {connectReady}
          onAccessChange={changeKind}
          onPriceChange={changePrice}
          onTierToggle={toggleTier}
          onSelectFromTier={selectTiersFrom}
        />
      </section>

      <section class="publish-section" aria-labelledby="{gapsId}-card">
        <h2 class="publish-heading" id="{gapsId}-card">
          <span class="publish-ordinal" aria-hidden="true">2</span>
          {m.studio_publish_card()}
        </h2>
        <div class="publish-card">
          <!-- A picture of the card it becomes: its words are on this page already. -->
          <div class="publish-card-preview" inert>
            <ContentCard
              variant="grid"
              id={content.id}
              title={values.title}
              thumbnail={cardThumbnail}
              contentType={cardType}
              duration={mediaRow?.durationSeconds ?? null}
              creator={{ displayName: authorName }}
              price={flags.priceCents == null ? null : { amount: flags.priceCents, currency: 'GBP' }}
              contentAccessType={access.kind}
            />
          </div>
          <div class="publish-card-words">
            <p class="publish-hint">{m.studio_publish_card_hint()}</p>
            <CoverLine
              contentId={content.id}
              {contentType}
              thumbnailUrl={content.thumbnailUrl}
              image={false}
              bind:changed={() => coverSet, setCover}
              onbusy={(busy) => (coverBusy = busy)}
            />
          </div>
        </div>
      </section>

      <section class="publish-section" aria-labelledby="{gapsId}-where">
        <Accordion.Root>
          <Accordion.Item value="where">
            <Accordion.Trigger class="publish-fold" level={2}>
              <span class="publish-fold-words">
                <span class="publish-heading" id="{gapsId}-where">
                  <span class="publish-ordinal" aria-hidden="true">3</span>
                  {m.studio_publish_where()}
                  <span class="publish-optional">{m.studio_publish_optional()}</span>
                </span>
                <span class="publish-summary">{whereSummary}</span>
              </span>
            </Accordion.Trigger>
            <Accordion.Content>
              <div class="publish-where">
                <OrganizeSection
                  {organizationId}
                  tags={values.tags}
                  featured={values.featured}
                  selectedCategoryIds={values.categoryIds}
                  onTagsChange={(tags) => change('tags', tags)}
                  onFeaturedChange={(featured) => change('featured', featured)}
                  onCategoryChange={(ids) => change('categoryIds', ids)}
                  onbusy={(busy) => (categoryBusy = busy)}
                />
                <SlugField
                  value={values.slug}
                  onchange={(slug) => change('slug', slug)}
                  oninvalid={(invalid) => (slugInvalid = invalid)}
                  {orgSlug}
                  {creatorUsername}
                  {organizationId}
                  contentId={content.id}
                />
              </div>
            </Accordion.Content>
          </Accordion.Item>
        </Accordion.Root>
      </section>

      <section class="publish-section" aria-labelledby="{gapsId}-gaps">
        <h2 class="publish-heading" id="{gapsId}-gaps">
          <span class="publish-ordinal" aria-hidden="true">4</span>
          {m.studio_publish_gaps()}
        </h2>
        <div class="publish-gaps" id={gapsId} tabindex="-1" bind:this={gapsEl}>
          {#if !ready}
            <ul class="publish-gap-list">
              {#each rows as row (row.gap)}
                <li class="publish-gap">
                  <span>{row.words}</span>
                  {#if row.fix === 'write'}
                    <a class="publish-gap-fix" href={writeHref}>{m.studio_publish_gap_fix_on_write()}</a>
                  {:else if row.fix === 'payouts'}
                    <a class="publish-gap-fix" href={payoutsHref}>{m.studio_content_form_access_payouts_link()}</a>
                  {/if}
                </li>
              {/each}
              {#if slugInvalid}
                <li class="publish-gap">
                  <span>{m.studio_publish_gap_slug()}</span>
                  <button type="button" class="publish-gap-fix" onclick={() => document.getElementById('slug')?.focus()}>
                    {m.studio_publish_gap_fix_here()}
                  </button>
                </li>
              {/if}
              {#if mediaUnread}
                <li class="publish-gap publish-gap--unread">
                  <span>{m.studio_publish_media_unread({ type: TYPE_WORD[contentType]() })}</span>
                  <button type="button" class="publish-gap-fix" onclick={rereadMedia}>{m.common_try_again()}</button>
                </li>
              {/if}
              {#if connectUnread}
                <li class="publish-gap publish-gap--unread">
                  <span>{m.studio_publish_connect_unread()}</span>
                  <button type="button" class="publish-gap-fix" onclick={rereadConnect}>
                    {m.common_try_again()}
                  </button>
                </li>
              {/if}
            </ul>
          {/if}
          <p
            class={[
              'publish-status',
              { 'publish-ready': ready && !waitHint, 'publish-hint': waitHint !== null, 'sr-only': !ready && !waitHint },
            ]}
            role="status"
          >
            {statusWords}
          </p>
          {#if refusalWords}
            <p class="publish-refusal" role="alert">{refusalWords}</p>
          {/if}
        </div>
      </section>
    </div>

    <div class="publish-foot">
      <p class={['publish-progress', { 'sr-only': !held }]} role="status" tabindex="-1" bind:this={progressEl}>
        {progressWords}
      </p>
      <Button
        type="button"
        disabled={blocked || navigating.to !== null}
        loading={held}
        aria-describedby={blocked ? gapsId : undefined}
        onclick={publish}
      >
        {publishWords}
      </Button>
    </div>
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    min-block-size: 100%;
  }

  .publish {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    inline-size: 100%;
    max-inline-size: 760px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-4) var(--space-12);
  }

  .publish-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .publish-title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    line-height: var(--leading-tight);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .publish-intro,
  .publish-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .publish-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-block-start: var(--space-6);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  .publish-heading {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .publish-ordinal {
    display: inline-grid;
    place-items: center;
    inline-size: var(--space-6);
    block-size: var(--space-6);
    border-radius: var(--radius-full);
    background: var(--color-surface-tertiary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
  }

  .publish-optional {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .publish-card {
    display: grid;
    gap: var(--space-4);
  }

  .publish-card-preview {
    max-inline-size: 18rem;
  }

  .publish-card-words {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (--breakpoint-md) {
    .publish-card {
      grid-template-columns: 18rem minmax(0, 1fr);
      align-items: start;
    }
  }

  /* The fold's trigger: the heading over its summary, the chevron at the end. */
  .publish-section :global(.publish-fold) {
    justify-content: space-between;
    gap: var(--space-3);
    padding-inline: 0;
    text-align: start;
  }

  .publish-fold-words {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .publish-summary {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .publish-where {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-block: var(--space-2);
  }

  .publish-gaps {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border-radius: var(--radius-md);
  }

  .publish-gaps:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .publish-gap-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .publish-gap {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  /* A read it checks by failed: said plainly, not as something to fix. */
  .publish-gap--unread {
    background: var(--color-surface-secondary);
  }

  .publish-gap-fix {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-weight: var(--font-medium);
    color: var(--color-link);
    text-decoration: underline;
    cursor: pointer;
  }

  .publish-gap-fix:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .publish-status {
    margin: 0;
    font-size: var(--text-sm);
  }

  .publish-ready {
    color: var(--color-status-success-text);
  }

  .publish-refusal {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-error-700);
  }

  /* No box of its own: what it holds lays out as the step's own children. */
  .publish-held {
    display: contents;
  }

  .publish-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2) var(--space-4);
  }

  .publish-progress {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
  }

  .publish-progress:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (--below-md) {
    .publish-foot {
      position: sticky;
      inset-block-end: 0;
      z-index: var(--z-sticky);
      margin-inline: calc(-1 * var(--space-4));
      padding: var(--space-3) var(--space-4) calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
      border-block-start: var(--border-width) var(--border-style) var(--color-border);
      background: var(--color-surface);
    }

    .publish-foot > :global(*) {
      flex: 1;
    }

    .publish-progress {
      flex-basis: 100%;
    }
  }
</style>
