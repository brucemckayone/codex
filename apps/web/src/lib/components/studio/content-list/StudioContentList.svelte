<!--
  @component StudioContentList

  The studio content list, one component for the org and personal studios
  (Codex-a6ofh.3.1; mockups content-list.html L1 table, L5 cards). It owns
  its read: `listContent` for the view the URL describes, 24 a page, with
  "Show more" appending the next page (`PagedList`, as the media library).
  Every read renders three states (data-design §0): a skeleton while nothing
  has arrived, the failure with Try again when the read failed, and the
  data. A failed read never falls through to "No content yet", which reads
  as if it had all been deleted.

  The URL is the view (`list-url.ts`): status, type, access, sort, view and
  search, so a link reproduces it. Below `sm` it is always the cards. Above
  the rows, "Needs you" (Codex-a6ofh.3.4) counts what the creator's pieces
  need, and each of its chips lists those pieces.

  Bulk actions and the row menu (Codex-a6ofh.3.5, mockup L2, data-design
  §4.2): up to CONTENT_BULK_MAX rows selected, one request per action, a
  result for each piece, and a line that says what it did. Afterwards the
  list and "Needs you" are read again in place.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { type ContentAttentionKind, CONTENT_STATUS, ERROR_CODES } from '@codex/constants';
  import type { ContentBulkAction } from '@codex/shared-types';
  import { boundSearchParam, type ContentQueryInput, gateSearchQuery } from '@codex/validation';
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { MOBILE_QUERY } from '$lib/components/ui/FilterDrawer/breakpoint';
  import { FileIcon, SearchXIcon } from '$lib/components/ui/Icon';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { remoteErrorMessage } from '$lib/page-builder/builder-save';
  import { getCategories } from '$lib/remote/categories.remote';
  import {
    deleteContent,
    getContentAttention,
    getContentWhereCounts,
    listContent,
    runContentBulk,
  } from '$lib/remote/content.remote';
  import { remoteErrorCode, remoteErrorStatus } from '$lib/remote/query-result';
  import type { ContentWithRelations } from '$lib/types';
  import type { accessGroupToFlags } from '$lib/utils/content-access';
  import { listTiers } from '$lib/remote/subscription.remote';
  import * as m from '$paraglide/messages';
  import ActionLink from '../ActionLink.svelte';
  import { pieceHref } from '../editor/editor-url';
  import LoadFailedAlert from '../LoadFailedAlert.svelte';
  import { createFacetRetry } from '../list-toolbar/facet-retry.svelte';
  import type { FacetUnread } from '../list-toolbar/list-option';
  import { createListSearch, createListUrlWriter } from '../list-url-writer';
  import { logReadFailure } from '../media-library/log-read-failure';
  import { PagedList } from '../paged-list.svelte';
  import PagedListMore from '../PagedListMore.svelte';
  import { createPayoutsRead } from '../payouts-read.svelte';
  import BulkResultLine from './BulkResultLine.svelte';
  import { type BulkProblem, bulkBusyWords, bulkReport } from './bulk-report';
  import ChangeAccessDialog from './ChangeAccessDialog.svelte';
  import ContentBulkBar from './ContentBulkBar.svelte';
  import ContentRowMenu from './ContentRowMenu.svelte';
  import { ContentSelection } from './content-selection.svelte';
  import DeleteContentDialog, { type DeleteTarget } from './DeleteContentDialog.svelte';
  import ContentListCommandBar from './ContentListCommandBar.svelte';
  import ContentListGrid from './ContentListGrid.svelte';
  import ContentListTable from './ContentListTable.svelte';
  import ContentListToolbar from './ContentListToolbar.svelte';
  import { categoryOptions, whereOptions } from './list-options';
  import {
    CATEGORY_ANY,
    CONTENT_LIST_DEFAULTS,
    contentListArgs,
    FACETS_CLEARED,
    isContentListNarrowed,
    needsPatch,
    readContentListState,
    whereArgs,
  } from './list-url';
  import NeedsYouStrip from './NeedsYouStrip.svelte';
  import NewContentMenu from './NewContentMenu.svelte';

  interface Props {
    /** The org studio's org; null lists the personal studio's content. */
    organizationId: string | null;
    /** Shown in the browser tab: the org's name, or "My Studio". */
    studioName: string;
    /**
     * The personal studio's orgs (its layout's), to name the org its Where
     * is on while the counts, which name the rest, are not read.
     */
    orgs?: readonly { id: string; name: string }[];
    /**
     * The viewer holds a platform role the category routes admit
     * (`readsCategoryRoutes`). An org studio admits team members without
     * one: their list asks for no categories and offers no Category menu.
     * Required, so an org caller cannot lose the facet by leaving it out.
     */
    canReadCategories: boolean;
    /** Optional class forwarded to the root for layout composition (R13). */
    class?: string;
  }

  const {
    organizationId,
    studioName,
    orgs = [],
    canReadCategories,
    class: className,
  }: Props = $props();

  const studio = $derived(organizationId ? 'org' : 'personal');

  // ── The view, from the URL ────────────────────────────────────────────
  const view = $derived(readContentListState(page.url));
  // The search floor (Codex-k618q) sits on the query argument: below
  // SEARCH_MIN_QUERY_LENGTH this is null and the list asks for no pattern.
  // Bounded first (Codex-osuqt): an over-long `?search=` is cut to the
  // API's limit, never refused as a 400 that no Try again could fix.
  const search = $derived(gateSearchQuery(boundSearchParam(view.search)));
  const narrowed = $derived(isContentListNarrowed(view, search, organizationId));

  // Below `sm` the cards are the only view, so the toggle is moot.
  const phone = new MediaQuery(MOBILE_QUERY);
  const layout = $derived(phone.current ? 'grid' : view.view);

  // ── Reads ─────────────────────────────────────────────────────────────
  // Where a failed read looked, from its args: never over the studio's own.
  const whereLog = (args: Pick<ContentQueryInput, 'scope' | 'organizationId'>) => ({
    scope: args.scope ?? (args.organizationId ? 'org' : 'all'),
    listedOrganizationId: args.organizationId ?? null,
  });
  // What a failure log says about a list read: where it looked, its page,
  // facets and sort, and whether it searched, never the text.
  const readLog = (args: ContentQueryInput) => ({
    page: args.page,
    ...whereLog(args),
    statusFilter: args.status ?? 'all',
    type: args.contentType ?? 'all',
    access: args.accessType ?? 'any',
    sortBy: args.sortBy,
    hasSearch: args.search !== undefined,
  });

  // Args pinned: kit types `listContent`'s input `void | …`, so inferred args
  // would not be the parsed ones `readLog` reads.
  type ContentPage = Awaited<ReturnType<typeof listContent>>;
  const list = new PagedList<ContentQueryInput, ContentPage>({
    args: (pageNumber) => contentListArgs(view, search, organizationId, pageNumber),
    read: listContent,
    onMoreFailed: (error, args) =>
      logReadFailure('studio_content.show_more_failed', error, {
        studio,
        organizationId,
        ...readLog(args),
      }),
  });

  // Once per failed read: the view is context, read untracked, so a view
  // toggle while the read is failed never logs the same failure again. A
  // refetch whose rows kit kept is a lesser failure than a list never read.
  $effect(() => {
    const error = list.first.error;
    if (error == null) return;
    const kept = untrack(() => list.landed);
    logReadFailure(kept ? 'studio_content.list_refetch_failed' : 'studio_content.list_unread', error, {
      studio,
      organizationId,
      ...untrack(() => readLog(contentListArgs(view, search, organizationId, 1))),
    });
  });

  // The page's one payouts read, for every draft's step (Codex-a6ofh.2.6).
  const payouts = createPayoutsRead('studio_content.connect_unread', () => ({
    studio,
    organizationId,
  }));

  // The org's plans, to name them in the Access column. Decoration: unread
  // or failed, a subscribers piece says "Subscribers" without the names.
  const tiers = $derived(organizationId ? listTiers(organizationId) : null);
  $effect(() => {
    if (tiers?.error != null) {
      logReadFailure('studio_content.tiers_unread', tiers.error, { organizationId });
    }
  });
  const tierNames = $derived(
    new Map((tiers?.current ?? []).map((tier) => [tier.id, tier.name] as const))
  );
  const tierName = (id: string) => tierNames.get(id);

  // The personal studio's Where (Codex-a6ofh.3.2, mockup L4b): Everywhere,
  // Personal, then each org it has pieces in. The counts are decoration:
  // unread or failed, the options show without numbers. Made in `untrack`,
  // one query for the page, as PagedList's first page is.
  const whereCounts = $derived.by(() =>
    organizationId === null ? untrack(() => getContentWhereCounts()) : null
  );
  $effect(() => {
    if (whereCounts?.error != null) {
      logReadFailure('studio_content.where_counts_unread', whereCounts.error, { studio });
    }
  });
  const whereMenu = $derived(
    organizationId === null ? whereOptions(whereCounts?.current, view.where, orgs) : undefined
  );

  // The org studio's Category (Codex-a6ofh.3.3): the org's categories, read
  // once (untracked, as the counts above), for a viewer the route admits.
  // The rows name their own either way. A read that failed is never shown
  // as an org with none (owner): the menu says so, with a Try again. One
  // that is not read (a member without the role) has no menu, unless the
  // URL is on a category, which the menu then clears.
  const categories = $derived.by(() => {
    const org = organizationId;
    return org === null || !canReadCategories
      ? null
      : untrack(() => getCategories(org));
  });
  $effect(() => {
    if (categories?.error != null) {
      logReadFailure('studio_content.list_categories_unread', categories.error, {
        studio,
        organizationId,
      });
    }
  });
  const categoryMenu = $derived(
    organizationId === null || (categories === null && view.category === CATEGORY_ANY)
      ? undefined
      : categoryOptions(categories?.current, view.category)
  );
  // Refreshed in place: the query is held untracked, so the derivation keeps
  // it rather than making a new one. Its failures are logged above.
  const categoriesRetry = createFacetRetry({
    failed: () => m.studio_content_categories_unread(),
    failedAgain: () => m.studio_content_categories_unread_again(),
    read: () => categories?.refresh() ?? Promise.resolve(),
  });
  const categoryUnread = $derived(
    categories !== null && categories.current === undefined && categories.error != null
      ? categoriesRetry
      : undefined
  );

  // "Needs you" (Codex-a6ofh.3.4): what the creator's pieces need, counted
  // where the list looks and nothing else of its view (owner: a to-do, not a
  // view), so only a new Where reads again. Held untracked, as the counts
  // above, so a Try again refreshes it in place. A read that failed says so
  // (owner): it is never shown as nothing needing you.
  const attentionWhere = $derived(view.where);
  const attentionArgs = $derived(whereArgs(attentionWhere, organizationId));
  const attention = $derived.by(() => {
    const args = attentionArgs;
    return untrack(() => getContentAttention(args));
  });
  $effect(() => {
    if (attention.error != null) {
      logReadFailure('studio_content.attention_unread', attention.error, {
        studio,
        organizationId,
        ...untrack(() => whereLog(attentionArgs)),
      });
    }
  });
  // One per query, as the query is one per Where: a Try again that failed on
  // one Where never makes the next Where's first failure "Still couldn't".
  const attentionRetry = $derived.by(() => {
    const query = attention;
    return createFacetRetry({
      failed: () => m.studio_content_needs_unread(),
      failedAgain: () => m.studio_content_needs_unread_again(),
      read: () => query.refresh(),
    });
  });
  const attentionUnread = $derived(
    attention.current === undefined && attention.error != null ? attentionRetry : undefined
  );

  // ── What the body shows ───────────────────────────────────────────────
  // A filter or search the API refuses (a 4xx): Clear filters is the way out.
  const refusedView = $derived(list.refused && narrowed);

  const countText = $derived.by(() => {
    // Only this view's own count: a held list's is another view's.
    if (list.unread || list.total === null) return null;
    if (narrowed) return m.studio_content_list_count_narrowed({ count: list.total });
    return list.total === 1
      ? m.studio_content_list_count_one()
      : m.studio_content_list_count({ count: list.total });
  });

  // ── Bulk actions and the row menu (Codex-a6ofh.3.5) ──────────────────
  // A new one for each view (Where, a filter, the sort, the search): the
  // selection holds only rows it shows.
  const selection = $derived.by(() => {
    void list.key;
    return new ContentSelection();
  });
  /** The selected rows, in the list's order: the order they are sent in. */
  const picked = $derived(list.items.filter((row) => selection.has(row.id)));

  // The org's categories for Add to category: the Category menu's own read.
  const addCategories = $derived(
    studio === 'org' ? (categories?.current ?? undefined) : undefined
  );

  let busy = $state<string | null>(null);
  let result = $state<{ line: string; problems: BulkProblem[] } | null>(null);
  let deleteTarget = $state<DeleteTarget | null>(null);
  let accessPieces = $state<ContentWithRelations[] | null>(null);

  // A re-read after a change that failed: the rows shown are the last that
  // arrived. One Try again for each failure, so a later one starts afresh.
  let stale = $state<FacetUnread | null>(null);

  /**
   * The list read again in place, as held: kit drops a query whose first
   * read failed, so `invalidateAll` would skip it (E3.1). Rejects when it
   * fails, for the Try again. The selection keeps the rows still shown.
   */
  async function readListAgain(): Promise<void> {
    try {
      await list.refresh();
      stale = null;
      selection.keepOnly(list.items.map((row) => row.id));
    } catch (error) {
      logReadFailure('studio_content.refresh_after_change_failed', error, {
        studio,
        organizationId,
      });
      stale ??= createFacetRetry({
        failed: () => m.studio_content_refresh_failed(),
        failedAgain: () => m.studio_content_refresh_failed_again(),
        read: readListAgain,
      });
      throw error;
    }
  }

  /**
   * What a change moves, read again: the list always; "Needs you" unless it
   * only filed pieces (categories are none of its counts); the Where
   * counts only for a delete, the one change that moves a piece out of one.
   */
  async function refreshAfterChange(action: ContentBulkAction): Promise<void> {
    if (action !== 'categories') void attention.refresh().catch(() => undefined);
    if (action === 'delete') void whereCounts?.refresh().catch(() => undefined);
    await readListAgain().catch(() => undefined);
  }

  /**
   * The command's body without its ids: the rows give those. Kit types the
   * argument `void | …`; each action's body keeps its own fields.
   */
  type BulkBody = Exclude<Parameters<typeof runContentBulk>[0], void>;
  type BulkCall = BulkBody extends infer Body ? (Body extends unknown ? Omit<Body, 'ids'> : never) : never;

  interface BulkOptions {
    /** The category's name, for the line: Add to category. */
    category?: string;
    /**
     * The rows are the selection's (the bulk bar, its Delete…): afterwards
     * it holds only the pieces that did not go through. A row menu's
     * leaves the selection as it is.
     */
    fromSelection?: boolean;
  }

  /**
   * One request for the action, then the line that says what it did. A
   * request that failed as a whole may still have changed some: the list
   * is read again either way.
   */
  async function runBulk(
    rows: readonly ContentWithRelations[],
    call: BulkCall,
    { category = '', fromSelection = true }: BulkOptions = {}
  ): Promise<void> {
    if (busy !== null || rows.length === 0) return;
    const ids = rows.map((row) => row.id);
    busy = bulkBusyWords(call.action, ids.length, category);
    result = null;
    try {
      const { results } = await runContentBulk({ ...call, ids });
      const report = bulkReport(
        call.action,
        results,
        new Map(rows.map((row) => [row.id, row] as const)),
        category
      );
      result = { line: report.line, problems: report.problems };
      if (fromSelection) selection.keepOnly(report.keep);
    } catch (error) {
      logReadFailure('studio_content.bulk_failed', error, {
        studio,
        organizationId,
        action: call.action,
        count: ids.length,
      });
      result = {
        line:
          remoteErrorStatus(error) === 429
            ? m.studio_content_bulk_rate_limited()
            : m.studio_content_bulk_request_failed(),
        problems: [],
      };
    } finally {
      busy = null;
      await refreshAfterChange(call.action);
    }
  }

  const bulkDrafts = $derived(picked.filter((row) => row.status !== CONTENT_STATUS.PUBLISHED));
  const bulkLive = $derived(picked.filter((row) => row.status === CONTENT_STATUS.PUBLISHED));

  // Delete…: the bulk bar's names how many; the row menu's, one piece.
  async function confirmDelete() {
    const target = deleteTarget;
    if (target === null) return;
    if (target.mode === 'many') {
      await runBulk(picked, { action: 'delete' });
      deleteTarget = null;
      return;
    }
    // One at a time stays possible for a piece people bought (owner D-b4):
    // the per-piece delete, which the server does not refuse for buyers.
    const { piece } = target;
    busy = bulkBusyWords('delete', 1);
    try {
      await deleteContent(piece.id).catch((error: unknown) => {
        // Gone already (another tab): what was asked for is so.
        if (remoteErrorCode(error) !== ERROR_CODES.CONTENT_NOT_FOUND) throw error;
      });
      result = { line: m.studio_content_deleted_one({ title: piece.title }), problems: [] };
      selection.drop(piece.id);
      deleteTarget = null;
    } catch (error) {
      logReadFailure('studio_content.row_delete_failed', error, { studio, contentId: piece.id });
      toast.error(remoteErrorMessage(error) ?? m.studio_content_delete_failed({ title: piece.title }));
    } finally {
      busy = null;
      await refreshAfterChange('delete');
    }
  }

  async function unpublishInstead(ids: string[]) {
    const fromSelection = deleteTarget?.mode === 'many';
    const rows = list.items.filter((row) => ids.includes(row.id));
    deleteTarget = null;
    await runBulk(rows, { action: 'unpublish' }, { fromSelection });
  }

  async function submitAccess(access: ReturnType<typeof accessGroupToFlags>) {
    const rows = accessPieces ?? [];
    await runBulk(rows, { action: 'access', access });
    accessPieces = null;
  }

  /** A piece's public address while it is live: its org's, or its creator's. */
  function liveHref(row: ContentWithRelations): string | null {
    if (row.status !== CONTENT_STATUS.PUBLISHED) return null;
    return pieceHref(
      page.url,
      {
        orgSlug: row.organization?.slug ?? null,
        creatorUsername: row.creator?.username ?? null,
      },
      { slug: row.slug, id: row.id }
    );
  }

  // ── Writing the view back to the URL ──────────────────────────────────
  const setParams = createListUrlWriter(CONTENT_LIST_DEFAULTS);

  // The box as typed: a writable derived, so typing overrides it. It
  // re-derives only when the URL's search text itself changes (Clear, back):
  // `urlSearch` is a string, so another param's write while typing (a status
  // click) leaves it, and what was typed, alone.
  const urlSearch = $derived(view.search);
  let searchValue = $derived(urlSearch);
  const searchInput = createListSearch((value) => setParams({ search: value }));
  onDestroy(searchInput.cancel);

  function clearFilters() {
    searchInput.cancel();
    setParams({ ...FACETS_CLEARED, where: null, needs: null });
  }

  // A chip pressed lists its pieces and only those (`needsPatch`): a search
  // still waiting to be written would put its text back over them.
  function showNeeds(kind: ContentAttentionKind) {
    searchInput.cancel();
    setParams(needsPatch(kind, view));
  }
</script>

<svelte:head>
  <title>{m.studio_content_title()} | {studioName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="content-list {className ?? ''}">
  <ContentListCommandBar>
    {#snippet actions()}
      {#if organizationId}
        <ActionLink href="/studio/categories" variant="secondary" size="sm">
          {m.categories_title()}
        </ActionLink>
      {/if}
      <NewContentMenu {organizationId} payouts={payouts.current} />
    {/snippet}
  </ContentListCommandBar>

  <header class="list-header">
    <h1 class="list-title">
      {m.studio_content_title()}
      {#if countText}<span class="list-count">{countText}</span>{/if}
    </h1>
  </header>

  <ContentListToolbar
    {view}
    {searchValue}
    onSearchInput={(value) => {
      searchValue = value;
      searchInput.input(value);
    }}
    onSearchClear={() => {
      searchValue = '';
      searchInput.clear();
    }}
    onChange={setParams}
    whereOptions={whereMenu}
    categoryOptions={categoryMenu}
    {categoryUnread}
  />

  <NeedsYouStrip
    counts={attention.current}
    active={view.needs}
    unread={attentionUnread}
    onSelect={showNeeds}
  />

  <!-- Mounted unconditionally: it renders nothing until the read fails. -->
  <!-- A refusal of a narrowed view says so; Clear filters is offered below. -->
  <LoadFailedAlert
    query={list.first}
    message={refusedView ? m.media_library_error_refused() : m.studio_content_load_failed()}
    againMessage={refusedView ? m.media_library_error_refused() : m.studio_content_load_failed_again()}
    loadedMessage={m.studio_content_load_retry_ok()}
    data-testid="content-list-load-error"
  />
  {#if refusedView}
    <!-- A refusal comes back however often it is tried: offer the way out. -->
    <div>
      <Button variant="secondary" onclick={clearFilters}>{m.media_clear_filters()}</Button>
    </div>
  {/if}

  {#if stale && list.landed}
    {@const retry = stale}
    <!-- A re-read after a change failed: these rows are the last that arrived. -->
    <div class="stale" role="alert">
      <p class="stale-text">{retry.words}</p>
      <Button
        size="sm"
        variant="secondary"
        loading={retry.retrying}
        disabled={retry.retrying}
        onclick={() => retry.retry()}
      >
        {m.common_try_again()}
      </Button>
    </div>
  {/if}

  {#if selection.size > 0}
    <ContentBulkBar
      count={selection.size}
      max={selection.max}
      {busy}
      canPublish={bulkDrafts.length > 0}
      canUnpublish={bulkLive.length > 0}
      categories={addCategories}
      onPublish={() => runBulk(bulkDrafts, { action: 'publish' })}
      onUnpublish={() => runBulk(bulkLive, { action: 'unpublish' })}
      onAddCategory={(category) =>
        runBulk(picked, { action: 'categories', categoryIds: [category.id] }, { category: category.name })}
      onChangeAccess={() => (accessPieces = picked)}
      onDelete={() => (deleteTarget = { mode: 'many', pieces: picked })}
      onClear={() => selection.clear()}
    />
  {/if}
  {#if result}
    {#key result}
      <BulkResultLine line={result.line} problems={result.problems} />
    {/key}
  {/if}

  <div
    class="list-body"
    role="region"
    aria-label={m.studio_content_title()}
    aria-busy={list.refreshing || list.loading || undefined}
    data-refreshing={list.refreshing || undefined}
  >
    {#if list.unread}
      <!-- The alert above stands in for the list. -->
    {:else if list.loading}
      <p class="sr-only">{m.studio_content_list_loading()}</p>
      <div class="list-skeleton" data-layout={layout} aria-hidden="true">
        {#each Array(layout === 'grid' ? 6 : 5) as _, index (index)}
          <div class="skeleton-item">
            <div class="skeleton-thumb"><Skeleton width="100%" height="100%" /></div>
            <div class="skeleton-text">
              <Skeleton width="70%" height="var(--text-sm)" />
              <Skeleton width="40%" height="var(--text-xs)" />
            </div>
          </div>
        {/each}
      </div>
    {:else if list.empty}
      {#if narrowed}
        <EmptyState
          title={m.studio_content_search_empty()}
          description={m.studio_content_list_no_match()}
          icon={SearchXIcon}
        >
          {#snippet action()}
            <Button variant="secondary" onclick={clearFilters}>{m.media_clear_filters()}</Button>
          {/snippet}
        </EmptyState>
      {:else}
        <EmptyState
          title={m.studio_content_empty_title()}
          description={m.studio_content_empty_how()}
          icon={FileIcon}
        >
          {#snippet action()}
            <ActionLink href="/studio/content/new">{m.studio_content_create()}</ActionLink>
          {/snippet}
        </EmptyState>
      {/if}
    {:else}
      {#if layout === 'grid'}
        <ContentListGrid
          items={list.items}
          payouts={payouts.current}
          {tierName}
          showCategories={studio === 'org'}
          {selection}
          {rowMenu}
        />
      {:else}
        <ContentListTable
          items={list.items}
          payouts={payouts.current}
          {tierName}
          showCategories={studio === 'org'}
          {selection}
          {rowMenu}
        />
      {/if}

      <PagedListMore {list} />
    {/if}
  </div>
</div>

{#snippet rowMenu(row: ContentWithRelations, editHref: string)}
  <ContentRowMenu
    {row}
    {editHref}
    liveHref={liveHref(row)}
    busy={busy !== null}
    onPublish={() => runBulk([row], { action: 'publish' }, { fromSelection: false })}
    onUnpublish={() => runBulk([row], { action: 'unpublish' }, { fromSelection: false })}
    onDelete={() => (deleteTarget = { mode: 'one', piece: row })}
  />
{/snippet}

<DeleteContentDialog
  target={deleteTarget}
  busy={busy !== null}
  onDelete={confirmDelete}
  onUnpublish={unpublishInstead}
  onClose={() => (deleteTarget = null)}
/>

<ChangeAccessDialog
  pieces={accessPieces}
  payouts={payouts.current}
  busy={busy !== null}
  onSubmit={submitAccess}
  onClose={() => (accessPieces = null)}
/>

<style>
  .content-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    width: 100%;
  }

  .list-header {
    padding: 0 var(--space-1);
  }

  .list-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
  }

  .list-count {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    letter-spacing: normal;
    color: var(--color-text-secondary);
  }

  .stale {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-status-warning-border);
    border-radius: var(--radius-md);
    background: var(--color-status-warning-surface);
  }

  .stale-text {
    flex: 1;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .list-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
    transition: opacity var(--duration-fast) var(--ease-default);
  }

  /* A changed view loading over the last one: dimmed, never blanked. */
  .list-body[data-refreshing] {
    opacity: var(--opacity-60);
  }

  .list-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .list-skeleton[data-layout='grid'] {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
    gap: var(--space-4);
  }

  .skeleton-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .list-skeleton[data-layout='grid'] .skeleton-item {
    flex-direction: column;
    align-items: stretch;
  }

  .skeleton-thumb {
    flex-shrink: 0;
    width: var(--space-20);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .list-skeleton[data-layout='grid'] .skeleton-thumb {
    width: 100%;
    border-radius: var(--radius-md);
  }

  .skeleton-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1-5);
  }
</style>
