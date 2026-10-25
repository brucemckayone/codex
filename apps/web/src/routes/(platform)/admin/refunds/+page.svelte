<!--
  /admin/refunds — find a charge (Codex-2hxff.28, mockup A1 and A2).

  `?lookup=` is the search, so a result can be linked and Back returns to it.
  The query runs only for a `lookup` of 3 characters or more (the route's own
  floor). Never `?q=`: that name means a free-text search, which must pass the
  search floor's gate, and this is an exact key (an email or an id).

  The order of the states matters. A REJECTED remote query leaves `current`
  undefined and `loading` false, which a naive gate reads as "no results":
  it would tell support "No charge found" when the search never ran. So the
  error is checked first, then "no answer yet", and only a real empty answer
  shows the empty state. An error from a session that ended says so, since
  trying again cannot help (R2-M1).
-->
<script lang="ts">
  import { REFUND_WINDOW_DAYS } from '@codex/constants';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { Alert, Button, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';
  import * as Card from '$lib/components/ui/Card';
  import { ReceiptIcon } from '$lib/components/ui/Icon';
  import { SearchPill } from '$lib/components/ui/SearchPill';
  import ChargeResults from '$lib/components/support/ChargeResults.svelte';
  import SessionEndedAlert from '$lib/components/support/SessionEndedAlert.svelte';
  import { isSessionEnded } from '$lib/components/support/session';
  import { matchedBy } from '$lib/components/support/support-format';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import { searchSupportCharges } from '$lib/remote/support.remote';

  const LIMIT = 20;
  const MIN_QUERY = 3;

  const lookup = $derived((page.url.searchParams.get('lookup') ?? '').trim());
  const currentPage = $derived(
    Math.max(1, Number.parseInt(page.url.searchParams.get('page') ?? '1', 10) || 1)
  );

  // The box's text before it is searched. Seeded from the URL, and re-seeded
  // when the URL's `lookup` changes (Back to an earlier search).
  let draft = $state('');
  $effect(() => {
    draft = lookup;
  });

  const tooShort = $derived(lookup.length > 0 && lookup.length < MIN_QUERY);
  const searchQuery = $derived(
    lookup.length >= MIN_QUERY
      ? searchSupportCharges({ lookup, page: currentPage, limit: LIMIT })
      : null
  );
  const results = $derived(searchQuery?.current);
  const searchError = $derived(queryErrorMessage(searchQuery?.error));
  const sessionEnded = $derived(isSessionEnded(searchQuery?.error));
  const items = $derived(results?.items ?? []);
  const pagination = $derived(results?.pagination);

  /** One buyer across every row: name them, as the mockup's summary does. */
  const soleBuyer = $derived.by(() => {
    const first = items[0]?.buyer;
    if (!first) return null;
    return items.every((item) => item.buyer.userId === first.userId)
      ? first.name
      : null;
  });

  const summary = $derived.by(() => {
    if (!pagination) return '';
    const charges =
      pagination.total === 1
        ? m.support_search_count_one()
        : m.support_search_count_many({ count: String(pagination.total) });
    const matched = matchedBy(lookup) ?? '';
    return soleBuyer
      ? m.support_search_summary_for({ charges, name: soleBuyer, matched })
      : m.support_search_summary({ charges, matched });
  });

  const emptyDescription = $derived.by(() => {
    if (lookup.includes('@')) return m.support_empty_email();
    return matchedBy(lookup) ? m.support_empty_id() : m.support_empty_other();
  });

  function search(value: string) {
    const next = value.trim();
    const target = next
      ? `/admin/refunds?${new URLSearchParams({ lookup: next })}`
      : '/admin/refunds';
    if (target === `${page.url.pathname}${page.url.search}`) {
      searchQuery?.refresh().catch(() => {});
      return;
    }
    void goto(target, { keepFocus: true });
  }

  function goToPage(next: number) {
    const params = new URLSearchParams(page.url.searchParams);
    params.set('page', String(next));
    void goto(`/admin/refunds?${params}`, { keepFocus: true });
  }
</script>

<svelte:head>
  <title>{m.support_refunds_title()} · {m.support_nav_label()}</title>
</svelte:head>

<PageHeader
  kicker={m.support_nav_label()}
  title={m.support_refunds_title()}
  description={m.support_refunds_description({ days: String(REFUND_WINDOW_DAYS) })}
/>

<div class="search">
  <div class="search__row">
    <SearchPill
      value={lookup}
      placeholder={m.support_search_placeholder()}
      clearLabel={m.support_search_clear()}
      onChange={(value) => (draft = value)}
      onSubmit={search}
    />
    <Button variant="primary" onclick={() => search(draft)}>
      {m.support_search_button()}
    </Button>
  </div>
  <p class="search__hint">
    {m.support_search_hint()} (<span class="mono">ch_</span>,
    <span class="mono">py_</span>, <span class="mono">pi_</span>,
    <span class="mono">sub_</span>).
  </p>
</div>

{#if tooShort}
  <p class="muted" role="status">{m.support_search_too_short()}</p>
{:else if searchQuery}
  {#if sessionEnded && !results}
    <SessionEndedAlert />
  {:else if searchError && !results}
    <Alert variant="error" data-testid="search-error">
      <p>
        <strong>{m.support_search_error_lead()}</strong>
        {m.support_try_again_soon()}
      </p>
    </Alert>
  {:else if !results}
    <Card.Root>
      <div class="skeleton" aria-busy="true">
        <span class="sr-only" role="status">{m.support_search_loading()}</span>
        {#each Array(4) as _, i (i)}
          <div class="skeleton__row">
            <Skeleton width="14%" height="var(--space-5)" />
            <Skeleton width="30%" height="var(--space-5)" />
            <Skeleton width="24%" height="var(--space-5)" />
            <Skeleton width="12%" height="var(--space-5)" />
          </div>
        {/each}
      </div>
    </Card.Root>
  {:else if items.length === 0}
    <Card.Root>
      <EmptyState
        title={m.support_empty_title()}
        description={emptyDescription}
        icon={ReceiptIcon}
        headingLevel={2}
      />
    </Card.Root>
  {:else}
    <p class="muted">{summary}</p>
    <Card.Root>
      <ChargeResults {items} />
    </Card.Root>
    {#if pagination && pagination.totalPages > 1}
      <nav class="pagination" aria-label={m.support_pagination_label()}>
        <Button
          variant="secondary"
          size="sm"
          disabled={currentPage <= 1}
          onclick={() => goToPage(currentPage - 1)}
        >
          {m.support_pagination_previous()}
        </Button>
        <span class="muted">
          {m.support_pagination_status({
            page: String(pagination.page),
            total: String(pagination.totalPages),
          })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={currentPage >= pagination.totalPages}
          onclick={() => goToPage(currentPage + 1)}
        >
          {m.support_pagination_next()}
        </Button>
      </nav>
    {/if}
  {/if}
{/if}

<style>
  .search {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .search__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }

  .search__hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .muted {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
  }

  .skeleton__row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) 0;
  }

  .pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
</style>
