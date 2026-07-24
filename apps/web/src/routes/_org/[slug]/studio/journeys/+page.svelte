<!--
  @component Studio Journeys — home / index (Codex-2pryk.3.3 · WP-5)

  The creator's list of journeys + landing pages. Mirrors the studio `content/`
  list page: a client `query()` reactive off a status filter (URL-driven), no
  server load — the studio `+layout.server.ts` already gates creator/admin/owner,
  and the studio subtree is `ssr = false`.

  AGGRESSIVE-MODE MOCKS: data comes from `journey-queries.mock` (the frozen
  `ListJourneysQuery` shape). The conductor swaps it for the real remote after
  WP-2 — the `.current` / `.loading` access stays identical.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { PageStatus } from '@codex/shared-types';
  import EmptyState from '$lib/components/ui/EmptyState/EmptyState.svelte';
  import { CompassIcon, PlusIcon } from '$lib/components/ui/Icon';
  import { listJourneysMock } from '$lib/components/page-builder/journey-queries.mock.svelte';

  const { data } = $props();

  type StatusFilter = 'all' | PageStatus;
  const FILTERS: readonly { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Draft' },
    { id: 'published', label: 'Published' },
    { id: 'archived', label: 'Archived' },
  ];

  const urlStatus = $derived.by<StatusFilter>(() => {
    const raw = page.url.searchParams.get('status');
    if (raw === 'draft' || raw === 'published' || raw === 'archived') return raw;
    return 'all';
  });

  const journeysQuery = $derived(
    listJourneysMock({
      organizationId: data.org.id,
      ...(urlStatus !== 'all' && { status: urlStatus }),
    })
  );

  const items = $derived(journeysQuery.current ?? []);
  const loading = $derived(journeysQuery.loading);

  const gbp = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  });
  function money(cents: number | null): string | null {
    return cents == null ? null : gbp.format(cents / 100);
  }

  const relative = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  function when(iso: string): string {
    return relative.format(new Date(iso));
  }

  function setStatus(next: StatusFilter): void {
    const params = new URLSearchParams(page.url.searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    const query = params.toString();
    goto(`/studio/journeys${query ? `?${query}` : ''}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }
</script>

<svelte:head>
  <title>Journeys | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="journeys">
  <header class="journeys__bar">
    <div class="journeys__heading">
      <h1 class="journeys__title">Journeys</h1>
      <p class="journeys__count" aria-live="polite">
        {loading ? 'Loading…' : `${items.length} ${items.length === 1 ? 'page' : 'pages'}`}
      </p>
    </div>

    <div class="journeys__filter" role="group" aria-label="Filter by status">
      {#each FILTERS as f (f.id)}
        <button
          type="button"
          class="journeys__filter-btn"
          aria-pressed={urlStatus === f.id}
          onclick={() => setStatus(f.id)}
        >
          {f.label}
        </button>
      {/each}
    </div>

    <a href="/studio/journeys/new" class="journeys__create">
      <PlusIcon size={16} />
      New journey
    </a>
  </header>

  <div class="journeys__body">
    {#if loading}
      <ul class="journeys__rows" role="list">
        {#each Array(3) as _, i (i)}
          <li class="journeys__skeleton" aria-hidden="true"></li>
        {/each}
      </ul>
    {:else if items.length > 0}
      <ol class="journeys__rows" role="list">
        {#each items as j (j.id)}
          <li class="journey-row">
            <div class="journey-row__main">
              <div class="journey-row__title-line">
                <a class="journey-row__title" href="/studio/journeys/{j.id}/page">
                  {j.title}
                </a>
                <span class="journey-row__status" data-status={j.status}>{j.status}</span>
              </div>
              {#if j.tagline}
                <p class="journey-row__tagline">{j.tagline}</p>
              {/if}
              <p class="journey-row__meta">
                {#if j.stageCount != null}
                  <span>{j.stageCount} stages</span>
                  <span aria-hidden="true">·</span>
                  <span>{j.practiceCount} practices</span>
                  <span aria-hidden="true">·</span>
                {/if}
                {#if j.enrolledCount != null}
                  <span>{j.enrolledCount} enrolled</span>
                  <span aria-hidden="true">·</span>
                {/if}
                {#if money(j.revenueCents)}
                  <span>{money(j.revenueCents)}</span>
                  <span aria-hidden="true">·</span>
                {/if}
                <span class="journey-row__updated">Updated {when(j.updatedAt)}</span>
              </p>
            </div>
            <div class="journey-row__actions">
              {#if j.subjectType === 'course'}
                <a class="journey-row__action" href="/studio/journeys/{j.id}/curriculum">
                  Curriculum
                </a>
              {/if}
              <a class="journey-row__action journey-row__action--primary" href="/studio/journeys/{j.id}/page">
                Edit page
              </a>
            </div>
          </li>
        {/each}
      </ol>
    {:else}
      <div class="journeys__empty">
        <EmptyState
          title="No journeys yet"
          description="Create a course landing page and start shaping its curriculum."
          icon={CompassIcon}
        >
          {#snippet action()}
            <a href="/studio/journeys/new" class="journeys__empty-cta">New journey</a>
          {/snippet}
        </EmptyState>
      </div>
    {/if}
  </div>
</div>

<style>
  .journeys {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--container-studio);
  }

  .journeys__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .journeys__heading {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin-right: auto;
  }

  .journeys__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .journeys__count {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .journeys__filter {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-full);
  }

  .journeys__filter-btn {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .journeys__filter-btn:hover {
    color: var(--color-text);
  }

  .journeys__filter-btn[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .journeys__filter-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .journeys__create {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .journeys__create:hover {
    background-color: var(--color-interactive-hover);
  }

  .journeys__create:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .journeys__body {
    padding-top: var(--space-5);
  }

  .journeys__rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .journeys__skeleton {
    height: var(--space-20, 5rem);
    border-radius: var(--radius-lg);
    background-image: linear-gradient(
      100deg,
      var(--color-surface-secondary) 30%,
      var(--color-surface) 50%,
      var(--color-surface-secondary) 70%
    );
    background-size: 200% 100%;
    animation: journeys-shimmer var(--duration-slower) var(--ease-default) infinite;
  }

  @keyframes journeys-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .journeys__skeleton {
      animation: none;
    }
  }

  .journey-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    transition: var(--transition-colors);
  }

  .journey-row:hover {
    border-color: var(--color-border-strong, var(--color-interactive));
  }

  .journey-row__main {
    min-width: 0;
  }

  .journey-row__title-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .journey-row__title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    text-decoration: none;
  }

  .journey-row__title:hover {
    color: var(--color-interactive);
  }

  .journey-row__status {
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-2xs, 0.6875rem);
    font-weight: var(--font-medium);
    text-transform: capitalize;
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .journey-row__status[data-status='published'] {
    background-color: var(--color-success-subtle, var(--color-surface-secondary));
    color: var(--color-success, var(--color-text));
  }

  .journey-row__tagline {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .journey-row__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1-5);
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .journey-row__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .journey-row__action {
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .journey-row__action:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .journey-row__action--primary {
    border-color: transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .journey-row__action--primary:hover {
    background-color: var(--color-interactive-hover);
    color: var(--color-text-on-brand, var(--color-background));
  }

  .journey-row__action:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .journeys__empty {
    padding: var(--space-8) var(--space-4);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) dashed var(--color-border);
  }

  .journeys__empty-cta {
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    text-decoration: none;
  }

  .journeys__empty-cta:hover {
    background-color: var(--color-interactive-hover);
  }
</style>
