<!--
  @component TopContentLeaderboard

  Row-dense leaderboard of top-performing content for the rebuilt studio
  analytics page. Consumes `TopContentItem[]` from
  `/api/admin/analytics/top-content` via `getAnalyticsTopContent`.

  Differs from the predecessor `TopContentTable` in three ways:
    - small 16:9 thumbnail per row (falls back to a typed placeholder)
    - per-period distinct-viewer count (`viewsInPeriod`)
    - trend delta column (only rendered when the caller has a compare window)

  Rows are compact (≈56px) and use a semantic `<table>` with scoped headers so
  screen readers can navigate the grid. The delta cell carries an sr-only
  sentence ("increased by X pounds") so the visual glyph+colour pattern stays
  accessible.

  @prop {TopContentItem[]} items               Rows to render (may be empty).
  @prop {boolean}          hasCompareWindow    When false the trend column is hidden entirely.
  @prop {boolean}          [loading]           Skeleton state.
  @prop {number}           [limit=10]          Display cap.
-->
<script lang="ts">
  import type { TopContentItem } from '@codex/admin';
  import { page } from '$app/state';
  import { FilmIcon } from '$lib/components/ui/Icon';
  import { formatPriceCompact } from '$lib/utils/format';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import * as m from '$paraglide/messages';

  interface Props {
    items: TopContentItem[];
    hasCompareWindow: boolean;
    loading?: boolean;
    limit?: number;
  }

  const {
    items,
    hasCompareWindow,
    loading = false,
    limit = 10,
  }: Props = $props();

  const numberFormatter = new Intl.NumberFormat('en-GB');

  // Cap + keep row identity stable for :key blocks.
  const visibleItems = $derived(items.slice(0, limit));

  // Pad rank to 2 digits once the list is dense enough that single-digit
  // ranks would visually shift against "10" — keeps the leading column
  // column-aligned under tabular-nums.
  const padRank = $derived(visibleItems.length >= 10);

  function formatRank(index: number): string {
    const rank = index + 1;
    return padRank ? String(rank).padStart(2, '0') : String(rank);
  }

  function deltaDirection(delta: number | null): 'up' | 'down' | 'flat' {
    if (delta === null || delta === 0) return 'flat';
    return delta > 0 ? 'up' : 'down';
  }

  function deltaDisplay(delta: number): string {
    const sign = delta > 0 ? '+' : '-';
    return `${sign}${formatPriceCompact(Math.abs(delta))}`;
  }

  function deltaAriaLabel(delta: number): string {
    const amount = formatPriceCompact(Math.abs(delta));
    return delta > 0
      ? m.analytics_leaderboard_delta_increase({ amount })
      : m.analytics_leaderboard_delta_decrease({ amount });
  }

  // Skeleton rows — visible count mirrors the cap so the swap is low-CLS.
  const skeletonRows = $derived(
    Array.from({ length: Math.min(limit, 5) }, (_, i) => i)
  );
</script>

<div
  class="leaderboard"
  data-loading={loading ? 'true' : 'false'}
  aria-busy={loading}
>
  {#if loading}
    <span class="sr-only">{m.analytics_leaderboard_loading_label()}</span>
    <div class="skeleton" aria-hidden="true">
      {#each skeletonRows as i (i)}
        <div class="skeleton-row">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-text skeleton-text--title"></div>
          <div class="skeleton-text skeleton-text--short"></div>
          <div class="skeleton-text skeleton-text--short"></div>
          <div class="skeleton-text skeleton-text--short"></div>
        </div>
      {/each}
    </div>
  {:else if visibleItems.length === 0}
    <p class="empty">{m.analytics_leaderboard_empty()}</p>
  {:else}
    <table class="table">
      <thead>
        <tr>
          <th scope="col" class="col-rank">
            {m.analytics_leaderboard_col_rank()}
          </th>
          <th scope="col" class="col-thumb" aria-hidden="true"></th>
          <th scope="col" class="col-title">
            {m.analytics_leaderboard_col_title()}
          </th>
          <th scope="col" class="col-numeric">
            {m.analytics_leaderboard_col_revenue()}
          </th>
          <th scope="col" class="col-numeric col-hide-sm">
            {m.analytics_leaderboard_col_purchases()}
          </th>
          <th scope="col" class="col-numeric">
            {m.analytics_leaderboard_col_views()}
          </th>
          {#if hasCompareWindow}
            <th scope="col" class="col-numeric">
              {m.analytics_leaderboard_col_trend()}
            </th>
          {/if}
        </tr>
      </thead>
      <tbody>
        {#each visibleItems as item, index (item.contentId)}
          {@const href = buildContentUrl(page.url, {
            id: item.contentId,
            slug: null,
          })}
          {@const direction = deltaDirection(item.trendDelta)}
          <tr>
            <td class="col-rank">
              <span class="rank">{formatRank(index)}</span>
            </td>
            <td class="col-thumb">
              <a class="thumb" {href} tabindex="-1" aria-hidden="true">
                {#if item.thumbnailUrl}
                  <img
                    class="thumb-img"
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                  />
                {:else}
                  <span class="thumb-placeholder">
                    <FilmIcon size={16} />
                    <span class="sr-only">
                      {m.analytics_leaderboard_no_thumbnail_alt()}
                    </span>
                  </span>
                {/if}
              </a>
            </td>
            <td class="col-title">
              <a class="title" {href} title={item.contentTitle}>
                {item.contentTitle}
              </a>
            </td>
            <td class="col-numeric revenue">
              {formatPriceCompact(item.revenueCents)}
            </td>
            <td class="col-numeric col-hide-sm muted">
              {numberFormatter.format(item.purchaseCount)}
            </td>
            <td class="col-numeric muted">
              {numberFormatter.format(item.viewsInPeriod)}
            </td>
            {#if hasCompareWindow}
              <td class="col-numeric">
                {#if item.trendDelta !== null && item.trendDelta !== 0}
                  <span class="delta" data-direction={direction}>
                    {#if direction === 'up'}
                      <svg
                        class="delta-glyph"
                        viewBox="0 0 12 12"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M6 2 L10 7 L7 7 L7 10 L5 10 L5 7 L2 7 Z"
                          fill="currentColor"
                        />
                      </svg>
                    {:else}
                      <svg
                        class="delta-glyph"
                        viewBox="0 0 12 12"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M6 10 L2 5 L5 5 L5 2 L7 2 L7 5 L10 5 Z"
                          fill="currentColor"
                        />
                      </svg>
                    {/if}
                    <span aria-hidden="true">{deltaDisplay(item.trendDelta)}</span>
                    <span class="sr-only">{deltaAriaLabel(item.trendDelta)}</span>
                  </span>
                {:else}
                  <span class="delta delta--flat" aria-hidden="true">—</span>
                {/if}
              </td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .leaderboard {
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
  .col-rank {
    width: var(--space-10);
    text-align: left;
  }

  .col-thumb {
    width: var(--space-16);
    padding-left: 0;
    padding-right: 0;
  }

  .col-title {
    width: auto;
    min-width: 0;
  }

  .col-numeric {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* ── Rank ─────────────────────────────────────────────────── */
  .rank {
    display: inline-block;
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    letter-spacing: var(--tracking-wider);
  }

  /* ── Thumbnail ────────────────────────────────────────────── */
  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    width: var(--space-12);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background-color: var(--color-surface-secondary);
    text-decoration: none;
  }

  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
  }

  /* ── Title link ───────────────────────────────────────────── */
  .title {
    display: block;
    max-width: 100%;
    color: var(--color-text);
    font-weight: var(--font-semibold);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--transition-colors);
  }

  .title:hover {
    color: var(--color-interactive);
  }

  .title:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  /* ── Numeric cells ────────────────────────────────────────── */
  .revenue {
    font-weight: var(--font-medium);
  }

  .muted {
    color: var(--color-text-secondary);
  }

  /* ── Delta ────────────────────────────────────────────────── */
  .delta {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    font-weight: var(--font-medium);
  }

  .delta[data-direction='up'] {
    color: var(--color-success);
  }

  .delta[data-direction='down'] {
    color: var(--color-error);
  }

  .delta--flat {
    color: var(--color-text-muted);
  }

  .delta-glyph {
    width: var(--space-3);
    height: var(--space-3);
    flex-shrink: 0;
  }

  /* ── Empty state (inline, not full zero-state) ────────────── */
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
      var(--space-10) var(--space-16) minmax(0, 1fr) var(--space-16)
      var(--space-16) var(--space-16);
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .skeleton-row:last-child {
    border-bottom: none;
  }

  .skeleton-thumb {
    width: var(--space-12);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    animation: leaderboard-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-text {
    height: var(--text-sm);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    animation: leaderboard-pulse 1.5s ease-in-out infinite;
  }

  .skeleton-text--title {
    width: 70%;
  }

  .skeleton-text--short {
    width: 60%;
    justify-self: end;
  }

  @keyframes leaderboard-pulse {
    0%,
    100% {
      opacity: var(--opacity-40);
    }
    50% {
      opacity: var(--opacity-80);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-thumb,
    .skeleton-text {
      animation: none;
    }
  }

  /* ── Responsive: drop Purchases on narrow widths ──────────── */
  @container (max-width: 560px) {
    .col-hide-sm {
      display: none;
    }
  }

  @media (max-width: 560px) {
    .col-hide-sm {
      display: none;
    }
    .col-thumb {
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
