<!--
  @component PublishSettings

  Everything about a piece that isn't the piece itself, as numbered sections
  (Codex-a6ofh.2.4, mockup W4): who can watch, how it looks in lists (the
  card it becomes), and where it appears, folded to a one-line summary. The
  Publish step lays them out above its checklist; a live piece's Settings
  tab (Codex-a6ofh.2.5, mockup W5) above what only a live piece has.

  Each change goes to the host (`onchange`), which sets the session, so a
  host can clear what it was refused for first. On a live piece (`live`)
  the link is locked: Change unlocks it with a warning that old links stop
  working (no redirects). The fold also lists the portals it is in.

  @prop {DraftSession} session - The editor's draft session, read here
  @prop {PublishReads} reads - Payouts, plans and the media (`createPublishReads`)
  @prop {ContentWithRelations} content - The piece as read on arriving
  @prop {EditorContentType} contentType - The piece's type
  @prop {string | null} organizationId - The org it is filed in; null in the personal studio
  @prop {string | null} orgSlug - The org's slug, for the piece's address
  @prop {string | null} [creatorUsername] - A personal piece's address
  @prop {string} authorName - Who it is by, on the card
  @prop {(key, value) => void} onchange - A change made here
  @prop {string | null} savedCover - The cover as saved; a live piece's as its host holds it, staged for Update
  @prop {string | null | undefined} [coverChanged] - A draft's cover set or removed here; undefined until then
  @prop {(next: string | null | undefined) => void} oncoverchange - The cover line set or removed one (a live piece's: staged)
  @prop {boolean} [live] - A piece that has been live: its cover is staged for Update, its link locked
  @prop {(busy: boolean, failed: boolean) => void} [oncoverbusy] - A cover is going up or coming off; failed once that ended in a problem, said here
  @prop {(busy: boolean) => void} [oncategorybusy] - A category made in the fold is on its way
  @prop {(invalid: boolean) => void} [onslugcheck] - What is typed in the link is not one
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { Alert, Button } from '$lib/components/ui';
  import * as Accordion from '$lib/components/ui/Accordion';
  import ContentCard from '$lib/components/ui/ContentCard/ContentCard.svelte';
  import { LockIcon } from '$lib/components/ui/Icon';
  import { getCategories } from '$lib/remote/categories.remote';
  import type { ContentWithRelations } from '$lib/types';
  import { accessGroupToFlags, type ContentAccessKind } from '$lib/utils/content-access';
  import { getDisplayThumbnail } from '$lib/utils/thumbnail';
  import * as m from '$paraglide/messages';
  import AccessSection from '../content-form/AccessSection.svelte';
  import OrganizeSection from '../content-form/OrganizeSection.svelte';
  import SlugField from '../content-form/SlugField.svelte';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { selectFromTier, toggleTierId } from '../plan-picker/select-from-tier';
  import CoverLine from './CoverLine.svelte';
  import type { DraftSession, DraftValues } from './draft-session.svelte';
  import EditorHeading from './EditorHeading.svelte';
  import EditorSection from './EditorSection.svelte';
  import type { EditorContentType } from './editor-url';
  import PortalUses from './PortalUses.svelte';
  import { priceText, withKind, withPrice } from './publish-access';
  import type { PublishReads } from './publish-reads.svelte';

  interface Props {
    session: DraftSession;
    reads: PublishReads;
    content: ContentWithRelations;
    contentType: EditorContentType;
    organizationId: string | null;
    orgSlug: string | null;
    creatorUsername?: string | null;
    authorName: string;
    onchange: <K extends keyof DraftValues>(key: K, value: DraftValues[K]) => void;
    savedCover: string | null;
    coverChanged?: string | null | undefined;
    oncoverchange: (next: string | null | undefined) => void;
    live?: boolean;
    oncoverbusy?: (busy: boolean, failed: boolean) => void;
    oncategorybusy?: (busy: boolean) => void;
    onslugcheck?: (invalid: boolean) => void;
  }

  const {
    session,
    reads,
    content,
    contentType,
    organizationId,
    orgSlug,
    creatorUsername = null,
    authorName,
    onchange,
    savedCover,
    coverChanged,
    oncoverchange,
    live = false,
    oncoverbusy,
    oncategorybusy,
    onslugcheck,
  }: Props = $props();

  /** The session's own values, the same object for its life. */
  const values = untrack(() => session.values);
  const access = $derived(session.values.access);
  const ids = $props.id();

  // ── Who can watch ──────────────────────────────────────────────────────
  /** The price as typed; the session holds it in pence. */
  let typedPrice = $state(untrack(() => priceText(session.values.access.priceCents)));

  function changeKind(kind: string) {
    // AccessSection's options are the five kinds.
    const next = withKind(access, kind as ContentAccessKind);
    if (next.priceCents !== access.priceCents) typedPrice = priceText(next.priceCents);
    onchange('access', next);
  }

  function changePrice(text: string) {
    typedPrice = text;
    onchange('access', withPrice(access, text));
  }

  function toggleTier(tierId: string) {
    onchange('access', { ...access, tierIds: toggleTierId(access.tierIds ?? [], tierId) });
  }

  function selectTiersFrom(tierId: string) {
    onchange('access', { ...access, tierIds: selectFromTier(access.tierIds ?? [], tierId, reads.orgTiers) });
  }

  /** What a save sends for the access group: what the card reads. */
  const flags = $derived(accessGroupToFlags(access, organizationId));

  // ── How it looks in lists ──────────────────────────────────────────────
  const cover = $derived(coverChanged === undefined ? savedCover : coverChanged);
  const cardType = $derived(contentType === 'written' ? 'article' : contentType);
  // The media's poster comes with its own read (the row's media has none).
  const cardThumbnail = $derived(
    getDisplayThumbnail({ thumbnailUrl: cover, mediaItem: reads.mediaQuery?.current ?? null })
  );

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

  /**
   * A live piece's link is locked: it moves only deliberately, from here,
   * past a warning that links people already have stop working.
   */
  let linkOpen = $state(false);
  async function openLink() {
    linkOpen = true;
    // The button goes: focus moves to the field it opened.
    await tick();
    document.getElementById('slug')?.focus();
  }
</script>

<EditorSection headingId="{ids}-who" ordinal={1} title={m.studio_publish_who()}>
  <AccessSection
    {organizationId}
    layout="row"
    tiers={reads.orgTiers}
    tiersState={reads.tiersState}
    onRetryTiers={reads.rereadTiers}
    accessTypeVal={access.kind}
    priceVal={typedPrice}
    selectedTierIds={access.tierIds ?? []}
    connectReady={reads.connectReady}
    onAccessChange={changeKind}
    onPriceChange={changePrice}
    onTierToggle={toggleTier}
    onSelectFromTier={selectTiersFrom}
  />
  <!-- The Publish step says this in its checklist; a live piece has none, so here, by the options it affects. -->
  {#if live && reads.connectUnread}
    <Alert variant="warning">
      {m.studio_live_connect_unread()}
      <Button type="button" size="sm" variant="ghost" onclick={reads.rereadConnect}>{m.common_try_again()}</Button>
    </Alert>
  {/if}
</EditorSection>

<EditorSection headingId="{ids}-card" ordinal={2} title={m.studio_publish_card()}>
  <div class="settings-card">
    <!-- A picture of the card it becomes: its words are on this page already. -->
    <div class="settings-card-preview" inert>
      <ContentCard
        variant="grid"
        id={content.id}
        title={values.title}
        thumbnail={cardThumbnail}
        contentType={cardType}
        duration={reads.mediaRow?.durationSeconds ?? null}
        creator={{ displayName: authorName }}
        price={flags.priceCents == null ? null : { amount: flags.priceCents, currency: 'GBP' }}
        contentAccessType={access.kind}
      />
    </div>
    <div class="settings-card-words">
      <p class="settings-hint">{m.studio_publish_card_hint()}</p>
      <CoverLine
        contentId={content.id}
        {contentType}
        thumbnailUrl={savedCover}
        image={false}
        onstaged={live ? oncoverchange : undefined}
        bind:changed={() => coverChanged, oncoverchange}
        onbusy={(busy, failed) => oncoverbusy?.(busy, failed)}
      />
    </div>
  </div>
</EditorSection>

<EditorSection headingId="{ids}-where">
  <div class="settings-where-fold">
  <Accordion.Root>
    <Accordion.Item value="where">
      <Accordion.Trigger class="settings-fold" level={2}>
        <span class="settings-fold-words">
          <EditorHeading id="{ids}-where" ordinal={3} title={m.studio_publish_where()} optional />
          <span class="settings-summary">{whereSummary}</span>
        </span>
      </Accordion.Trigger>
      <Accordion.Content>
        <div class="settings-where">
          <OrganizeSection
            {organizationId}
            tags={values.tags}
            featured={values.featured}
            selectedCategoryIds={values.categoryIds}
            onTagsChange={(tags) => onchange('tags', tags)}
            onFeaturedChange={(featured) => onchange('featured', featured)}
            onCategoryChange={(categoryIds) => onchange('categoryIds', categoryIds)}
            onbusy={(busy) => oncategorybusy?.(busy)}
          />
          {#if live && organizationId}
            <PortalUses contentId={content.id} />
          {/if}
          {#if live && !linkOpen}
            <div class="settings-link">
              <span class="settings-link-label">{m.studio_live_link_label()}</span>
              <span class="settings-link-path">
                <LockIcon size={14} />
                <span>{m.studio_live_link_path({ slug: values.slug })}</span>
              </span>
              <Button type="button" size="sm" variant="secondary" onclick={openLink}>
                {m.studio_live_link_change()}
              </Button>
            </div>
          {:else}
            {#if live}
              <Alert variant="warning">{m.studio_live_link_warning()}</Alert>
            {/if}
            <SlugField
              value={values.slug}
              onchange={(slug) => onchange('slug', slug)}
              oninvalid={(invalid) => onslugcheck?.(invalid)}
              {orgSlug}
              {creatorUsername}
              {organizationId}
              contentId={content.id}
            />
          {/if}
        </div>
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
  </div>
</EditorSection>

<style>
  .settings-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .settings-card {
    display: grid;
    gap: var(--space-4);
  }

  .settings-card-preview {
    max-inline-size: 18rem;
  }

  .settings-card-words {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  @media (--breakpoint-md) {
    .settings-card {
      grid-template-columns: 18rem minmax(0, 1fr);
      align-items: start;
    }
  }

  /* The fold's trigger: the heading over its summary, the chevron at the end. */
  .settings-where-fold :global(.settings-fold) {
    justify-content: space-between;
    gap: var(--space-3);
    padding-inline: 0;
    text-align: start;
  }

  .settings-fold-words {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .settings-summary {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .settings-where {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-block: var(--space-2);
  }

  .settings-link {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
  }

  .settings-link-label {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .settings-link-path {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-inline-size: 0;
    color: var(--color-text-secondary);
    overflow-wrap: anywhere;
  }
</style>
