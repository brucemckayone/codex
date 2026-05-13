<!--
  @component CreatorRevenueTable

  Per-creator revenue split visibility for the studio analytics page
  (Codex-mtv05). Renders one row per active creator in a multi-creator
  org with their current split, last drained payout, and unresolved
  pending balance.

  The page-level conditional (`items.length > 1`) determines whether the
  parent section renders at all — this component does NOT decide
  visibility; it simply renders whatever rows it is given.

  Compact semantic <table> with scoped <th> headers so screen readers can
  navigate the grid; aria-busy on the skeleton state; aria-live for the
  empty inline state.

  @prop {CreatorRevenueSplitItem[]} items     Rows to render (may be empty).
  @prop {boolean}                   [loading] Skeleton state.
-->
<script lang="ts">
  import type { CreatorRevenueSplitItem } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import {
    Avatar,
    AvatarFallback,
    AvatarImage,
  } from '$lib/components/ui/Avatar';
  import { Badge } from '$lib/components/ui/Badge';
  import {
    formatDate,
    formatPrice,
    getInitials,
  } from '$lib/utils/format';

  interface Props {
    items: CreatorRevenueSplitItem[];
    loading?: boolean;
  }

  const { items, loading = false }: Props = $props();

  // Skeleton row count mirrors the cap so the swap is low-CLS.
  const skeletonRows = $derived(Array.from({ length: 3 }, (_, i) => i));

  /**
   * Format split percent for display. Service layer already converts bps→%,
   * so this is a presentation-only trim (drop trailing zeros, max 2 dp).
   */
  function formatSplitPercent(value: number): string {
    // Avoid `12.50%` — render `12.5%` and `100%`.
    const fixed = Number(value.toFixed(2));
    return `${fixed}%`;
  }
</script>

<div
  class="creator-revenue"
  data-test="creator-revenue-table"
  data-loading={loading ? 'true' : 'false'}
  aria-busy={loading}
>
  {#if loading}
    <span class="sr-only">{m.analytics_creator_revenue_loading_label()}</span>
    <div class="skeleton" aria-hidden="true">
      {#each skeletonRows as i (i)}
        <div class="skeleton-row">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-text skeleton-text--title"></div>
          <div class="skeleton-text skeleton-text--short"></div>
          <div class="skeleton-text skeleton-text--short"></div>
          <div class="skeleton-text skeleton-text--short"></div>
          <div class="skeleton-text skeleton-text--short"></div>
        </div>
      {/each}
    </div>
  {:else if items.length === 0}
    <p class="empty" role="status">
      {m.analytics_creator_revenue_empty()}
    </p>
  {:else}
    <table class="table">
      <thead>
        <tr>
          <th scope="col" class="col-avatar" aria-hidden="true"></th>
          <th scope="col" class="col-name">
            {m.analytics_creator_revenue_col_creator()}
          </th>
          <th scope="col" class="col-numeric">
            {m.analytics_creator_revenue_col_revenue()}
          </th>
          <th scope="col" class="col-numeric col-hide-sm">
            {m.analytics_creator_revenue_col_split()}
          </th>
          <th scope="col" class="col-date col-hide-sm">
            {m.analytics_creator_revenue_col_last_payout()}
          </th>
          <th scope="col" class="col-numeric">
            {m.analytics_creator_revenue_col_pending()}
          </th>
        </tr>
      </thead>
      <tbody>
        {#each items as item (item.creatorId)}
          <tr>
            <td class="col-avatar">
              <Avatar class="creator-revenue__avatar">
                {#if item.avatarUrl}
                  <AvatarImage src={item.avatarUrl} alt="" />
                {/if}
                <AvatarFallback>{getInitials(item.name)}</AvatarFallback>
              </Avatar>
            </td>
            <td class="col-name">
              <span class="name" title={item.name}>{item.name}</span>
            </td>
            <td class="col-numeric revenue">
              {formatPrice(item.totalRevenueCents)}
            </td>
            <td class="col-numeric col-hide-sm">
              <Badge variant="info">
                {formatSplitPercent(item.splitPercent)}
              </Badge>
            </td>
            <td class="col-date col-hide-sm muted">
              {#if item.lastPayoutAt}
                <time datetime={item.lastPayoutAt}>
                  {formatDate(item.lastPayoutAt)}
                </time>
              {:else}
                <span aria-label={m.analytics_creator_revenue_no_payout()}>
                  —
                </span>
              {/if}
            </td>
            <td class="col-numeric muted">
              {formatPrice(item.pendingPayoutCents)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .creator-revenue {
    background-color: var(--color-surface-card);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    container-type: inline-size;
  }

  /* ── Table chrome ─────────────────────────────────────────── */
  .table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-sans);
  }

  thead th {
    padding: var(--space-3) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    letter-spacing: var(--tracking-wider);
    text-transform: uppercase;
    color: var(--color-text-secondary);
    text-align: left;
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface-secondary);
    white-space: nowrap;
  }

  tbody td {
    padding: var(--space-2) var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    vertical-align: middle;
    color: var(--color-text);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr {
    transition: background-color var(--transition-colors);
  }

  tbody tr:hover {
    background-color: color-mix(
      in srgb,
      var(--color-surface-secondary) 50%,
      transparent
    );
  }

  /* ── Columns ──────────────────────────────────────────────── */
  .col-avatar {
    width: var(--space-10);
    padding-left: var(--space-3);
    padding-right: 0;
  }

  .col-name {
    width: auto;
    min-width: 0;
  }

  .col-numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .col-date {
    text-align: right;
    white-space: nowrap;
  }

  /* ── Cells ────────────────────────────────────────────────── */
  :global(.creator-revenue__avatar) {
    width: var(--space-8);
    height: var(--space-8);
  }

  .name {
    display: block;
    max-width: 100%;
    color: var(--color-text);
    font-weight: var(--font-semibold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .revenue {
    font-weight: var(--font-medium);
  }

  .muted {
    color: var(--color-text-secondary);
  }

  /* ── Empty state ──────────────────────────────────────────── */
  .empty {
    margin: 0;
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-secondary);
    font-size: var(--text-sm);
  }

  /* ── Skeleton ─────────────────────────────────────────────── */
  .skeleton {
    display: flex;
    flex-direction: column;
  }

  .skeleton-row {
    display: grid;
    grid-template-columns:
      var(--space-10) minmax(0, 1fr) var(--space-16) var(--space-16)
      var(--space-20) var(--space-16);
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .skeleton-row:last-child {
    border-bottom: none;
  }

  .skeleton-avatar {
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
    animation: creator-revenue-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-text {
    height: var(--text-sm);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    animation: creator-revenue-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-text--title {
    width: 70%;
  }

  .skeleton-text--short {
    width: 60%;
    justify-self: end;
  }

  @keyframes creator-revenue-pulse {
    0%,
    100% {
      opacity: var(--opacity-40);
    }
    50% {
      opacity: var(--opacity-80);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-avatar,
    .skeleton-text {
      animation: none;
    }
  }

  /* ── Responsive: drop split + payout columns on narrow widths ──── */
  @container (max-width: 560px) {
    .col-hide-sm {
      display: none;
    }
  }

  @media (max-width: 560px) {
    .col-hide-sm {
      display: none;
    }
    .skeleton-row {
      grid-template-columns:
        var(--space-10) minmax(0, 1fr) var(--space-16) var(--space-16);
    }
  }

  /* ── sr-only ──────────────────────────────────────────────── */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
