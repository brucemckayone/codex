<!--
  @component TierChecklist

  "What's in {tier}" (Codex-2hxff.91, owner decisions 5 and U6): every film
  and course a tier can include, ticked or not, so a bundle is edited in one
  place instead of film by film. Reached from each tier row's count on
  Monetisation › Subscriptions (owner only, like the tier list).

  - Lists what a tier CAN include: subscriber and paid films, and every
    course. Free, follower-only and team-only films are counted in the
    footnote with a link to the editor, never listed for bulk ticking (a
    search can show them, as disabled rows with the reason): ticking one here
    would quietly put a free film behind a subscription.
  - Ticks are DRAFTS until "Save changes". A save sends capped, idempotent
    DELTAS (adds and removes), so it never overwrites ticks on rows this
    page never showed, and a resend lands the same state. A draft past one
    request's per-list cap goes as two requests.
  - After a save the rows keep showing what was saved until the re-read
    lands (kit keeps the old page meanwhile, and for good if the re-read
    fails, which the page then says).
  - Unticking the last tier of a subscribers-only film leaves it CLOSED,
    never free: the row says "Closed after save" and the save bar warns.
  - A list that failed to load shows "We couldn't load what's in {tier}"
    with Retry and no save bar: a list nobody has seen can't be saved.
  - Leaving with unsaved ticks asks first, as the content editor does.

  Reads (all studio-only and uncached): the tier list (name, price, the
  names of other tiers), the subscription stats (its subscriber count), the
  access summary (counts and the guidance note) and one page of items. No
  polling: the items and the summary are re-read after a save, or on Retry.
-->
<script lang="ts">
  import {
    PLAN_ITEMS_DELTA_LIST_MAX,
    PLAN_ITEMS_DELTA_MAX,
    PLAN_ITEMS_PAGE_MAX,
  } from '@codex/validation';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert, Badge, ConfirmDialog, PageHeader } from '$lib/components/ui';
  import { Breadcrumb } from '$lib/components/ui/Breadcrumb';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Card from '$lib/components/ui/Card';
  import Pagination from '$lib/components/ui/Pagination/Pagination.svelte';
  import SearchPill from '$lib/components/ui/SearchPill/SearchPill.svelte';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';
  import PlanGuidanceNote, {
    type GuidanceAction,
  } from '$lib/components/studio/plan-picker/PlanGuidanceNote.svelte';
  import { countsAnd } from '$lib/components/studio/plan-picker/plan-counts';
  import { joinNames } from '$lib/components/studio/plan-picker/select-from-tier';
  import {
    getSubscriptionStats,
    getTierAccessSummary,
    listTierItems,
    listTiers,
    setTierItems,
  } from '$lib/remote/subscription.remote';
  import type { QueryResult } from '$lib/remote/query-result';
  import type { SubscriptionStats, SubscriptionTier } from '$lib/types';
  import { connectQueryState } from '$lib/utils/connect-readiness';
  import { formatPrice } from '$lib/utils/format';
  import { logger } from '$lib/observability';

  let { data } = $props();

  // Owner only, as the Subscriptions tab. ssr=false: wait for the role.
  $effect(() => {
    if (data.userRole !== undefined && data.userRole !== 'owner') goto('/studio');
  });
  const isOwner = $derived(data.userRole === 'owner');
  const orgId = $derived<string | undefined>(data.org?.id);
  const tierId = $derived(page.params.tierId ?? '');

  type ItemsPage = NonNullable<Awaited<ReturnType<typeof listTierItems>>>;
  type PlanItemRow = ItemsPage['items'][number];
  type TierAccessSummary = NonNullable<Awaited<ReturnType<typeof getTierAccessSummary>>>;
  type Filter = 'all' | 'included' | 'excluded' | 'missing';

  // ── The view: seeded once from the URL ("Review" / "Show them" links) ───
  const params = page.url.searchParams;
  const seededCheaper = params.get('cheaper');
  const seededFilterParam = params.get('filter');
  // `missing` needs the cheaper tier it compares with; without one it is `all`.
  const seededFilter: Filter =
    seededFilterParam === 'included' || seededFilterParam === 'excluded'
      ? seededFilterParam
      : seededFilterParam === 'missing' && seededCheaper
        ? 'missing'
        : 'all';
  let filter = $state<Filter>(seededFilter);
  let cheaperTierId = $state<string | null>(seededFilter === 'missing' ? seededCheaper : null);
  let search = $state('');
  let pageNo = $state(1);

  // ── Reads ────────────────────────────────────────────────────────────────
  const tiersQuery = $derived(orgId ? listTiers(orgId) : null);
  const statsQuery = $derived(orgId ? getSubscriptionStats(orgId) : null);
  const summaryQuery = $derived(orgId ? getTierAccessSummary(orgId) : null);
  const itemsQuery = $derived(
    orgId && tierId
      ? listTierItems({
          orgId,
          tierId,
          query: {
            filter,
            ...(filter === 'missing' && cheaperTierId ? { cheaperTierId } : {}),
            ...(search ? { search } : {}),
            page: pageNo,
            limit: PLAN_ITEMS_PAGE_MAX,
          },
        })
      : null
  );

  const tiersState = $derived(
    connectQueryState(tiersQuery as QueryResult<SubscriptionTier[]> | null)
  );
  const tiers = $derived(tiersState.kind === 'ok' ? tiersState.status : []);
  const tierById = $derived(new Map(tiers.map((t) => [t.id, t])));
  const tier = $derived(tierById.get(tierId) ?? null);
  const statsState = $derived(
    connectQueryState(statsQuery as QueryResult<SubscriptionStats> | null)
  );
  const subscriberCount = $derived(
    statsState.kind === 'ok'
      ? (statsState.status.tierBreakdown.find((row) => row.tierId === tierId)
          ?.subscriberCount ?? 0)
      : null
  );
  const summaryState = $derived(
    connectQueryState(summaryQuery as QueryResult<TierAccessSummary> | null)
  );
  const summary = $derived(summaryState.kind === 'ok' ? summaryState.status : null);
  const summaryRow = $derived(summary?.tiers.find((row) => row.tierId === tierId) ?? null);
  const itemsState = $derived(connectQueryState(itemsQuery as QueryResult<ItemsPage> | null));
  const rows = $derived<PlanItemRow[]>(itemsState.kind === 'ok' ? itemsState.status.items : []);
  const totalPages = $derived(
    itemsState.kind === 'ok' ? itemsState.status.pagination.totalPages : 0
  );

  // A page past the end (a save emptied the last page of "Not included", or
  // the list shrank meanwhile) steps back, never an empty dead end.
  $effect(() => {
    if (itemsState.kind !== 'ok' || pageNo <= 1 || rows.length > 0) return;
    pageNo = Math.max(1, Math.min(pageNo - 1, totalPages));
  });

  // A tier that is not live (deleted, or hidden): back to the list.
  $effect(() => {
    if (isOwner && tiersState.kind === 'ok' && !tier) {
      goto('/studio/monetisation', { replaceState: true });
    }
  });

  const tierName = $derived(tier?.name ?? '');

  // ── Draft ticks ──────────────────────────────────────────────────────────
  interface Change {
    kind: 'film' | 'course';
    id: string;
    /** true = add to this tier, false = remove from it. */
    add: boolean;
    /** A subscribers-only film this removal leaves in no tier: CLOSED. */
    closes: boolean;
  }
  let changes = $state<Record<string, Change>>({});
  /**
   * Changes a save wrote that the rows on screen may not show yet: kit's
   * `Query` keeps the old page in `current` while it re-reads, and for good
   * if the re-read fails. Until a re-read lands, a row's stored tick is read
   * through this, so a just-saved row never flips back to its old tick.
   */
  let justSaved = $state<Record<string, Change>>({});
  const keyOf = (kind: 'film' | 'course', id: string) => `${kind}:${id}`;
  const changeList = $derived(Object.values(changes));
  const changeCount = $derived(changeList.length);
  const closingCount = $derived(changeList.filter((c) => c.closes).length);

  /** The row's tick as stored: the list's, or what a save just wrote. */
  function stored(row: PlanItemRow): boolean {
    const saved = justSaved[keyOf(row.kind, row.id)];
    return saved ? saved.add : row.included;
  }

  function isOn(row: PlanItemRow): boolean {
    const change = changes[keyOf(row.kind, row.id)];
    return change ? change.add : stored(row);
  }

  /** A removal that leaves a subscribers-only film (not for sale) in no tier. */
  function closesWhenRemoved(row: PlanItemRow): boolean {
    return (
      row.kind === 'film' &&
      row.access === 'subscribers' &&
      !row.priceCents &&
      row.otherTierIds.length === 0
    );
  }

  function setRow(row: PlanItemRow, on: boolean) {
    if (!row.eligible) return;
    const key = keyOf(row.kind, row.id);
    const next = { ...changes };
    if (on === stored(row)) delete next[key];
    else next[key] = { kind: row.kind, id: row.id, add: on, closes: !on && closesWhenRemoved(row) };
    changes = next;
    notice = null;
    saveError = '';
  }

  const eligibleRows = $derived(rows.filter((row) => row.eligible));
  const shownIn = $derived(eligibleRows.filter(isOn).length);
  const cantTick = $derived(rows.length - eligibleRows.length);
  const filtered = $derived(filter !== 'all' || search !== '');

  function tickAllShown(on: boolean) {
    const next = { ...changes };
    for (const row of eligibleRows) {
      const key = keyOf(row.kind, row.id);
      if (on === stored(row)) delete next[key];
      else next[key] = { kind: row.kind, id: row.id, add: on, closes: !on && closesWhenRemoved(row) };
    }
    changes = next;
    notice = null;
    saveError = '';
  }

  /** Films and courses this tier will include once the draft is saved. */
  const willInclude = $derived.by(() => {
    if (!summaryRow) return null;
    let films = summaryRow.films;
    let courses = summaryRow.courses;
    for (const change of changeList) {
      const delta = change.add ? 1 : -1;
      if (change.kind === 'film') films += delta;
      else courses += delta;
    }
    return { films: Math.max(0, films), courses: Math.max(0, courses) };
  });

  // ── The guidance note (per tier) ─────────────────────────────────────────
  const gaps = $derived(
    (summaryRow?.missingFromCheaper ?? [])
      .filter((gap) => tierById.has(gap.cheaperTierId))
      // A small gap the draft (or a save the summary hasn't re-read yet)
      // closes goes away, as the mockup's L3 shows.
      .filter((gap) => {
        const count = gap.films + gap.courses;
        if (count > gap.sampleItems.length) return true;
        return !gap.sampleItems.every((item) => {
          const key = keyOf(item.kind, item.id);
          return (changes[key] ?? justSaved[key])?.add;
        });
      })
  );

  function tickGap(gap: (typeof gaps)[number]) {
    const next = { ...changes };
    for (const item of gap.sampleItems) {
      next[keyOf(item.kind, item.id)] = { kind: item.kind, id: item.id, add: true, closes: false };
    }
    changes = next;
    notice = null;
  }

  function gapActions(gap: (typeof gaps)[number]): GuidanceAction[] {
    const count = gap.films + gap.courses;
    const show: GuidanceAction = {
      label: count === 1 ? m.plan_gap_show_it() : m.plan_gap_show_them(),
      onclick: () => showFilter('missing', gap.cheaperTierId),
    };
    if (count > gap.sampleItems.length) return [show];
    const tick =
      count === 1
        ? m.plan_gap_tick_it()
        : count === 2
          ? m.plan_gap_tick_both()
          : m.plan_gap_tick_all({ count });
    return [{ label: tick, onclick: () => tickGap(gap) }, show];
  }

  function gapNames(gap: (typeof gaps)[number]): string {
    const titles = gap.sampleItems.map((item) => item.title);
    const count = gap.films + gap.courses;
    return count > titles.length
      ? m.plan_gap_names_more({ names: joinNames(titles), count: count - titles.length })
      : joinNames(titles);
  }

  // ── Filters and search ───────────────────────────────────────────────────
  function showFilter(next: Filter, cheaper: string | null = null) {
    filter = next;
    cheaperTierId = next === 'missing' ? cheaper : null;
    pageNo = 1;
  }

  const allCount = $derived(summary ? summary.eligibleFilms + summary.totalCourses : null);
  const includedCount = $derived(summaryRow ? summaryRow.films + summaryRow.courses : null);
  const missingGap = $derived(
    filter === 'missing'
      ? (summaryRow?.missingFromCheaper.find((gap) => gap.cheaperTierId === cheaperTierId) ?? null)
      : null
  );
  const filterTabs = $derived<{ value: Filter; label: string; count: number | null }[]>([
    { value: 'all', label: m.monetisation_tier_items_filter_all(), count: allCount },
    { value: 'included', label: m.monetisation_tier_items_filter_included(), count: includedCount },
    {
      value: 'excluded',
      label: m.monetisation_tier_items_filter_excluded(),
      count: allCount !== null && includedCount !== null ? allCount - includedCount : null,
    },
    ...(filter === 'missing' && cheaperTierId
      ? [
          {
            value: 'missing' as const,
            label: m.monetisation_tier_items_filter_missing({
              cheaper: tierById.get(cheaperTierId)?.name ?? '',
              name: tierName,
            }),
            count: missingGap ? missingGap.films + missingGap.courses : null,
          },
        ]
      : []),
  ]);

  function onSearch(value: string) {
    search = value.trim();
    pageNo = 1;
  }

  // ── Rows' sub-lines ──────────────────────────────────────────────────────
  function lengthLabel(row: PlanItemRow): string | null {
    if (row.kind === 'film') {
      if (!row.durationSeconds) return null;
      return m.monetisation_tier_items_minutes({
        count: Math.max(1, Math.round(row.durationSeconds / 60)),
      });
    }
    if (row.stageCount == null) return null;
    return row.stageCount === 1
      ? m.monetisation_tier_items_stages_one()
      : m.monetisation_tier_items_stages_other({ count: row.stageCount });
  }

  function ineligibleReason(row: PlanItemRow): string | null {
    if (row.eligible) return null;
    if (row.access === 'free') return m.monetisation_tier_items_ineligible_free();
    if (row.access === 'followers') return m.monetisation_tier_items_ineligible_followers();
    if (row.access === 'team') return m.monetisation_tier_items_ineligible_team();
    return null;
  }

  function otherTiersLabel(row: PlanItemRow): string | null {
    if (row.otherTierIds.length === 0) return m.monetisation_tier_items_no_other();
    // Names come from the active list; an inactive tier has none to show.
    const names = row.otherTierIds
      .map((id) => tierById.get(id)?.name)
      .filter((name): name is string => !!name);
    return names.length > 0 ? m.monetisation_tier_items_also_in({ tiers: joinNames(names) }) : null;
  }

  function subLine(row: PlanItemRow): string[] {
    const parts = [row.kind === 'film' ? m.plan_item_kind_film() : m.plan_item_kind_course()];
    const length = lengthLabel(row);
    if (length) parts.push(length);
    if (row.priceCents) {
      parts.push(m.monetisation_tier_items_to_buy({ price: formatPrice(row.priceCents) }));
    }
    const reason = ineligibleReason(row);
    const others = reason ?? otherTiersLabel(row);
    if (others) parts.push(others);
    return parts;
  }

  const filmRows = $derived(rows.filter((row) => row.kind === 'film'));
  const courseRows = $derived(rows.filter((row) => row.kind === 'course'));

  // ── Save ─────────────────────────────────────────────────────────────────
  let saving = $state(false);
  let saveError = $state('');
  let notice = $state<{ saved: string; closed: number } | null>(null);
  /** A re-read after a save failed: the list may show the old ticks. */
  let rereadFailed = $state(false);
  let rereadRun = 0;

  /**
   * The draft as one or more requests, each within the command's caps:
   * PLAN_ITEMS_DELTA_LIST_MAX ids per list, so "Tick all" on three pages of
   * "Not included" (150 film adds) is two requests. The total is checked
   * against PLAN_ITEMS_DELTA_MAX first, so no request goes over it either.
   */
  function batchesOf(draft: Change[]): Change[][] {
    const lists = [
      draft.filter((c) => c.kind === 'film' && c.add),
      draft.filter((c) => c.kind === 'course' && c.add),
      draft.filter((c) => c.kind === 'film' && !c.add),
      draft.filter((c) => c.kind === 'course' && !c.add),
    ];
    const count = Math.max(...lists.map((list) => Math.ceil(list.length / PLAN_ITEMS_DELTA_LIST_MAX)));
    return Array.from({ length: count }, (_, i) =>
      lists.flatMap((list) =>
        list.slice(i * PLAN_ITEMS_DELTA_LIST_MAX, (i + 1) * PLAN_ITEMS_DELTA_LIST_MAX)
      )
    );
  }

  function deltaOf(batch: Change[]) {
    const ids = (kind: 'film' | 'course', add: boolean) =>
      batch.filter((c) => c.kind === kind && c.add === add).map((c) => c.id);
    return {
      add: { contentIds: ids('film', true), courseIds: ids('course', true) },
      remove: { contentIds: ids('film', false), courseIds: ids('course', false) },
    };
  }

  async function save() {
    if (!orgId || saving || changeCount === 0) return;
    if (changeCount > PLAN_ITEMS_DELTA_MAX) {
      saveError = m.monetisation_tier_items_too_many({ max: PLAN_ITEMS_DELTA_MAX });
      return;
    }
    const draft = changeList;
    const written: Change[] = [];
    let closed = 0;
    let tierNow: { films: number; courses: number } | null = null;
    saving = true;
    saveError = '';
    notice = null;
    try {
      for (const batch of batchesOf(draft)) {
        const result = await setTierItems({ orgId, tierId, delta: deltaOf(batch) });
        if (!('result' in result)) {
          // Refused: this request wrote nothing. Keep the rest of the draft.
          saveError =
            written.length > 0
              ? partialError(draft.length - written.length)
              : result.detailsCode === 'CREATOR_CONNECT_REQUIRED'
                ? m.monetisation_tier_items_save_payouts()
                : m.monetisation_tier_items_save_error({ name: tierName });
          logError(
            'save refused',
            `${result.status} ${result.detailsCode ?? result.code ?? 'unknown'}`,
            result.status >= 500 ? 'error' : 'warn'
          );
          return;
        }
        written.push(...batch);
        closed += result.result.closedNow.contentIds.length;
        tierNow = result.result;
      }
      if (tierNow) {
        notice = {
          saved: m.monetisation_tier_items_saved({
            name: tierName,
            counts: countsAnd(tierNow.films, tierNow.courses),
          }),
          closed,
        };
      }
    } catch (error) {
      saveError =
        written.length > 0
          ? partialError(draft.length - written.length)
          : m.monetisation_tier_items_save_error({ name: tierName });
      logError('save failed', error);
    } finally {
      commit(written);
      saving = false;
    }
  }

  function partialError(unsaved: number): string {
    return unsaved === 1
      ? m.monetisation_tier_items_save_partial_one({ name: tierName })
      : m.monetisation_tier_items_save_partial_other({ name: tierName, count: unsaved });
  }

  /** Move what a save wrote out of the draft, show it as stored, re-read. */
  function commit(written: Change[]) {
    if (written.length === 0) return;
    const draft = { ...changes };
    const saved = { ...justSaved };
    for (const change of written) {
      const key = keyOf(change.kind, change.id);
      delete draft[key];
      saved[key] = change;
    }
    changes = draft;
    justSaved = saved;
    reread();
  }

  /**
   * Re-read the page and the summary after a save, or on Retry. A failed
   * re-read keeps the old values in kit's `current`, so it is said here, and
   * the just-saved ticks stay shown until a re-read of the page lands.
   */
  function reread() {
    const run = ++rereadRun;
    void Promise.allSettled([itemsQuery?.refresh(), summaryQuery?.refresh()]).then(
      ([items, summary]) => {
        // A later save's re-read owns the outcome.
        if (run !== rereadRun) return;
        if (items.status === 'fulfilled') justSaved = {};
        else logError('items re-read failed', items.reason);
        if (summary.status === 'rejected') logError('summary re-read failed', summary.reason);
        rereadFailed = items.status === 'rejected' || summary.status === 'rejected';
      }
    );
  }

  function logError(what: string, error: unknown, level: 'error' | 'warn' = 'error') {
    logger[level](`studio/tier-checklist: ${what}`, {
      organizationId: orgId,
      tierId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // A failed first read stays on the query's `.error`, which keeps its alert up.
  function retryItems() {
    void itemsQuery?.refresh().catch(() => {});
  }

  function retryTiers() {
    void tiersQuery?.refresh().catch(() => {});
  }

  // ── Unsaved ticks: ask before leaving ────────────────────────────────────
  let leaveOpen = $state(false);
  let leaving = false;
  let leaveTo: URL | null = null;

  beforeNavigate((navigation) => {
    if (leaving || changeCount === 0 || !navigation.to) return;
    if (navigation.to.url.pathname === page.url.pathname) return;
    navigation.cancel();
    leaveTo = navigation.to.url;
    leaveOpen = true;
  });

  function confirmLeave() {
    leaving = true;
    leaveOpen = false;
    if (leaveTo) goto(leaveTo.pathname + leaveTo.search);
  }

  $effect(() => {
    if (changeCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });

  const changesLabel = $derived(
    changeCount === 1
      ? m.monetisation_tier_items_changes_one()
      : m.monetisation_tier_items_changes_other({ count: changeCount })
  );
</script>

<svelte:head>
  <title>{tierName ? m.monetisation_tier_items_title({ name: tierName }) : m.monetisation_subscriptions_title()}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if isOwner}
  <div class="checklist-page">
    <Breadcrumb
      items={[
        { label: m.monetisation_subscriptions_title(), href: '/studio/monetisation' },
        { label: tierName ? m.monetisation_tier_items_title({ name: tierName }) : '…' },
      ]}
    />

    {#if tiersState.kind === 'failed'}
      <!-- The tier list failed: say so, never an endless skeleton. -->
      <Alert variant="error" data-testid="tier-checklist-tiers-failed">
        <span class="alert-row">
          <span>{m.monetisation_tier_items_tier_load_failed()}</span>
          <Button variant="secondary" size="sm" type="button" onclick={retryTiers}>
            {m.monetisation_tier_items_retry()}
          </Button>
        </span>
      </Alert>
    {:else if !tier}
      <div class="checklist-loading" aria-hidden="true">
        <Skeleton width="40%" height="var(--text-xl)" />
        <Skeleton width="70%" height="var(--text-sm)" />
      </div>
    {:else}
      <div class="checklist-head">
        <PageHeader
          variant="compact"
          title={m.monetisation_tier_items_title({ name: tierName })}
          description={subscriberCount === null || subscriberCount === 0
            ? m.monetisation_tier_items_description_none({ name: tierName })
            : subscriberCount === 1
              ? m.monetisation_tier_items_description_one({ name: tierName })
              : m.monetisation_tier_items_description_other({
                  name: tierName,
                  count: subscriberCount,
                })}
        />
        <ul class="checklist-meta">
          <li>{m.monetisation_tier_items_price({ price: formatPrice(tier.priceMonthly) })}</li>
          {#if subscriberCount !== null}
            <li>
              {subscriberCount === 0
                ? m.monetisation_tier_items_no_subscribers()
                : subscriberCount === 1
                  ? m.monetisation_tier_subscribers_one()
                  : m.monetisation_tier_subscribers({ count: String(subscriberCount) })}
            </li>
          {/if}
          {#if summaryRow}
            <li>{m.monetisation_tier_items_includes({ counts: countsAnd(summaryRow.films, summaryRow.courses) })}</li>
          {/if}
        </ul>

        {#each gaps as gap (gap.cheaperTierId)}
          {@const count = gap.films + gap.courses}
          {@const cheaper = tierById.get(gap.cheaperTierId)?.name ?? ''}
          <PlanGuidanceNote data-testid="tier-checklist-gap" actions={gapActions(gap)}>
            <b>
              {count === 1
                ? m.plan_gap_tier_list_one({ dearer: tierName, cheaper })
                : m.plan_gap_tier_list_other({ dearer: tierName, count, cheaper })}
            </b>
            {gapNames(gap)}.
            {count === 1
              ? m.plan_gap_tier_list_body_one({ dearer: tierName })
              : m.plan_gap_tier_list_body_other({ dearer: tierName })}
          </PlanGuidanceNote>
        {/each}
      </div>

      {#if notice}
        <Alert variant="success" data-testid="tier-checklist-saved">
          {notice.saved}
          {#if notice.closed > 0}
            {notice.closed === 1
              ? m.monetisation_tier_items_closed_now_one()
              : m.monetisation_tier_items_closed_now_other({ count: notice.closed })}
          {/if}
        </Alert>
      {/if}

      {#if rereadFailed}
        <Alert variant="warning" data-testid="tier-checklist-reread-failed">
          <span class="alert-row">
            <span>{m.monetisation_tier_items_reread_failed()}</span>
            <Button variant="secondary" size="sm" type="button" onclick={reread}>
              {m.monetisation_tier_items_retry()}
            </Button>
          </span>
        </Alert>
      {/if}

      <Card.Root>
        <Card.Content>
          <div class="checklist-body">
            {#if itemsState.kind === 'failed'}
              <!-- In place of the toolbar and the list, and no save bar. -->
              <Alert variant="error" data-testid="tier-checklist-failed">
                <span class="alert-row">
                  <span>{m.monetisation_tier_items_load_failed({ name: tierName })}</span>
                  <Button variant="secondary" size="sm" type="button" onclick={retryItems}>
                    {m.monetisation_tier_items_retry()}
                  </Button>
                </span>
              </Alert>
            {:else}
              <div class="checklist-toolbar">
                <div class="checklist-search">
                  <SearchPill
                    value={search}
                    placeholder={m.monetisation_tier_items_search()}
                    clearLabel={m.monetisation_tier_items_search_clear()}
                    debounce={300}
                    onChange={onSearch}
                  />
                </div>
                <div class="bar-filters" role="group" aria-label={m.monetisation_tier_items_filter_label()}>
                  {#each filterTabs as tab (tab.value)}
                    <button
                      type="button"
                      class="filter-tab"
                      aria-pressed={filter === tab.value}
                      onclick={() => showFilter(tab.value, tab.value === 'missing' ? cheaperTierId : null)}
                    >
                      {tab.label}{#if tab.count !== null}<span class="filter-count">{tab.count}</span>{/if}
                    </button>
                  {/each}
                </div>
              </div>

              {#if itemsState.kind === 'loading'}
                <div class="checklist-loading" aria-hidden="true">
                  {#each Array(4) as _, i (i)}
                    <Skeleton width="100%" height="var(--space-12)" />
                  {/each}
                </div>
              {:else if rows.length === 0}
                <p class="checklist-empty" data-testid="tier-checklist-empty">
                  {search
                    ? m.monetisation_tier_items_no_results({ search })
                    : filter !== 'all'
                      ? m.monetisation_tier_items_empty_filter()
                      : m.monetisation_tier_items_empty()}
                </p>
              {:else}
                <div class="bulk-bar">
                  <span>
                    {shownIn === 1
                      ? m.monetisation_tier_items_shown_in_one({ count: shownIn, total: rows.length, name: tierName })
                      : m.monetisation_tier_items_shown_in_other({ count: shownIn, total: rows.length, name: tierName })}{#if cantTick > 0}
                      · {m.monetisation_tier_items_cant_tick({ count: cantTick })}{/if}
                  </span>
                  <span class="bulk-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={saving || shownIn === eligibleRows.length}
                      onclick={() => tickAllShown(true)}
                    >
                      {filtered
                        ? m.monetisation_tier_items_tick_all_count({ count: eligibleRows.length })
                        : m.monetisation_tier_items_tick_all()}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={saving || shownIn === 0}
                      onclick={() => tickAllShown(false)}
                    >
                      {m.monetisation_tier_items_untick_all()}
                    </Button>
                  </span>
                </div>

                <ul class="check-list" data-testid="tier-checklist">
                  {#each [{ kind: 'film', list: filmRows }, { kind: 'course', list: courseRows }] as group (group.kind)}
                    {#if group.list.length > 0}
                      <li class="check-group">
                        {group.kind === 'film'
                          ? m.monetisation_tier_items_group_films({ count: group.list.length })
                          : m.monetisation_tier_items_group_courses({ count: group.list.length })}
                      </li>
                      {#each group.list as row (row.kind + row.id)}
                        {@const on = isOn(row)}
                        {@const change = changes[keyOf(row.kind, row.id)]}
                        <li
                          class="check-row"
                          data-changed={change ? '' : undefined}
                          data-disabled={row.eligible ? undefined : ''}
                          data-testid="tier-checklist-row"
                        >
                          <label class="check-label">
                            <input
                              type="checkbox"
                              class="check-box"
                              checked={on}
                              disabled={!row.eligible || saving}
                              onchange={(e) => setRow(row, e.currentTarget.checked)}
                            />
                            <span class="check-main">
                              <span class="check-title">{row.title}</span>
                              <span class="check-sub">{subLine(row).join(' · ')}</span>
                            </span>
                          </label>
                          <span class="check-tags">
                            {#if row.status === 'draft'}
                              <Badge variant="neutral">{m.monetisation_tier_items_tag_draft()}</Badge>
                            {/if}
                            {#if change?.add}
                              <Badge variant="info">{m.monetisation_tier_items_tag_added()}</Badge>
                            {:else if change}
                              <Badge variant="info">{m.monetisation_tier_items_tag_removed()}</Badge>
                            {/if}
                            {#if change?.closes}
                              <Badge variant="warning">{m.monetisation_tier_items_tag_closed()}</Badge>
                            {/if}
                          </span>
                        </li>
                      {/each}
                    {/if}
                  {/each}
                </ul>

                {#if totalPages > 1}
                  <Pagination currentPage={pageNo} {totalPages} onPageChange={(next) => (pageNo = next)} />
                {/if}
              {/if}
            {/if}
          </div>
        </Card.Content>
      </Card.Root>

      {#if changeCount > 0 && itemsState.kind !== 'failed'}
        <div class="save-bar" data-testid="tier-checklist-save-bar">
          <span class="save-bar__text" role="status">
            <span>
              <b>{changesLabel}</b>{#if willInclude}
                · {m.monetisation_tier_items_will_include({
                  name: tierName,
                  counts: countsAnd(willInclude.films, willInclude.courses),
                })}{/if}
            </span>
            {#if closingCount > 0}
              <small>
                {closingCount === 1
                  ? m.monetisation_tier_items_will_close_one()
                  : m.monetisation_tier_items_will_close_other({ count: closingCount })}
              </small>
            {/if}
          </span>
          {#if saveError}
            <span class="save-bar__error" role="alert">{saveError}</span>
          {/if}
          <span class="save-bar__actions">
            <Button variant="ghost" size="sm" type="button" disabled={saving} onclick={() => (changes = {})}>
              {m.monetisation_tier_items_discard()}
            </Button>
            <Button size="sm" type="button" loading={saving} onclick={save}>
              {saving ? m.monetisation_tier_items_saving() : m.monetisation_tier_items_save()}
            </Button>
          </span>
        </div>
      {/if}

      {#if summary && summary.ineligibleFilms > 0}
        <p class="checklist-foot">
          {summary.ineligibleFilms === 1
            ? m.monetisation_tier_items_ineligible_note_one()
            : m.monetisation_tier_items_ineligible_note_other({ count: summary.ineligibleFilms })}
          <a href="/studio/content">{m.monetisation_tier_items_ineligible_link()}</a>
        </p>
      {/if}
    {/if}
  </div>

  <ConfirmDialog
    bind:open={leaveOpen}
    title={m.monetisation_tier_items_leave_title()}
    description={changeCount === 1
      ? m.monetisation_tier_items_leave_body_one({ name: tierName })
      : m.monetisation_tier_items_leave_body_other({ count: changeCount, name: tierName })}
    confirmText={m.monetisation_tier_items_leave_confirm()}
    cancelText={m.monetisation_tier_items_leave_stay()}
    variant="destructive"
    onConfirm={confirmLeave}
  />
{/if}

<style>
  .checklist-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .checklist-head {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .checklist-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .checklist-meta li {
    margin: 0;
  }

  .checklist-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .checklist-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .checklist-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .checklist-search {
    flex: 1 1 14rem;
    max-width: 18rem;
  }

  /* The studio content list's filter track (ContentListCommandBar). */
  .bar-filters {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5);
    max-width: 100%;
    padding: var(--space-0-5);
    overflow-x: auto;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface));
  }

  .filter-tab {
    appearance: none;
    padding: var(--space-1-5) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
  }

  .filter-tab[aria-pressed='true'] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .filter-tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .filter-count {
    margin-left: var(--space-1);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  @media (--below-sm) {
    .checklist-search {
      max-width: none;
    }

    /* Three filters with counts fit a 390px card without scrolling. */
    .filter-tab {
      padding-inline: var(--space-2);
      letter-spacing: var(--tracking-wide);
    }
  }

  .bulk-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .bulk-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .check-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .check-group {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .check-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    row-gap: var(--space-1);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .check-list > .check-row:last-child {
    border-bottom: 0;
  }

  .check-row[data-changed] {
    background: color-mix(in oklab, var(--color-interactive) 6%, var(--color-surface));
  }

  .check-row[data-disabled] {
    opacity: var(--opacity-50);
  }

  .check-label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-3);
    min-width: 0;
    cursor: pointer;
  }

  .check-row[data-disabled] .check-label {
    cursor: not-allowed;
  }

  .check-box {
    width: var(--space-5);
    height: var(--space-5);
    margin: 0;
    accent-color: var(--color-interactive);
    cursor: inherit;
  }

  .check-box:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .check-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .check-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    overflow-wrap: anywhere;
  }

  .check-sub {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .check-tags {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-1-5);
  }

  @media (--below-sm) {
    .check-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .check-tags {
      justify-content: flex-start;
      padding-inline-start: var(--space-8);
    }
  }

  .checklist-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .alert-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
  }

  /* Sticks to the bottom of the studio's scrolling column. */
  .save-bar {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: color-mix(in srgb, var(--color-surface) 92%, transparent);
    box-shadow: var(--shadow-md);
  }

  .save-bar__text {
    display: flex;
    flex: 1 1 14rem;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .save-bar__text b {
    font-weight: var(--font-semibold);
  }

  .save-bar__text small {
    font-size: var(--text-xs);
    color: var(--color-status-warning-text);
  }

  .save-bar__error {
    flex-basis: 100%;
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .save-bar__actions {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
  }

  .checklist-foot {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .checklist-foot a {
    color: var(--color-interactive);
  }
</style>
