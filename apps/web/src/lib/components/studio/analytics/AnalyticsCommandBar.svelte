<!--
  @component AnalyticsCommandBar

  Control surface for the studio analytics page. Writes four URL params
  (startDate, endDate, compareFrom, compareTo) that the server load reads
  back. Controlled — the parent hands in the URL-derived values; the bar
  navigates via goto() to update them.

  @prop {string} startDate       ISO YYYY-MM-DD — current window start
  @prop {string} endDate         ISO YYYY-MM-DD — current window end
  @prop {string} [compareFrom]   ISO YYYY-MM-DD — compare window start
  @prop {string} [compareTo]     ISO YYYY-MM-DD — compare window end
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Popover, Switch } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    startDate: string;
    endDate: string;
    compareFrom?: string;
    compareTo?: string;
  }

  const { startDate, endDate, compareFrom, compareTo }: Props = $props();

  // ─── URL helpers ──────────────────────────────────────────────────────
  const MS_PER_DAY = 1000 * 60 * 60 * 24;

  function toISODate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Derive which preset (if any) the current URL window matches.
   * Uses a small ±1-day tolerance to survive clock boundary drift.
   */
  const activePreset = $derived.by((): '7d' | '30d' | '90d' | 'year' | null => {
    const now = new Date();
    const from = new Date(startDate);
    const to = new Date(endDate);
    const diffDays = Math.round((now.getTime() - from.getTime()) / MS_PER_DAY);
    const toDiff = Math.round((now.getTime() - to.getTime()) / MS_PER_DAY);

    // endDate must be within 1 day of today for a preset to be "active"
    if (toDiff > 1) return null;

    if (diffDays >= 6 && diffDays <= 8) return '7d';
    if (diffDays >= 29 && diffDays <= 31) return '30d';
    if (diffDays >= 89 && diffDays <= 91) return '90d';
    if (diffDays >= 364 && diffDays <= 366) return 'year';
    return null;
  });

  const compareEnabled = $derived(Boolean(compareFrom && compareTo));

  /**
   * Build a URLSearchParams snapshot of the four analytics params, merged
   * with everything else currently in page.url.searchParams so we don't
   * clobber sibling state (e.g. future filters).
   */
  function baseParams(): URLSearchParams {
    const params = new URLSearchParams(page.url.searchParams);
    params.delete('startDate');
    params.delete('endDate');
    params.delete('compareFrom');
    params.delete('compareTo');
    return params;
  }

  function navigate(params: URLSearchParams) {
    // Guard against no-op navigations. Melt UI's Switch echoes its `checked`
    // prop through `onCheckedChange` on mount/sync, which would otherwise
    // trigger `handleCompareToggle` → `navigate` with the same URL we're
    // already on — Chrome's IPC flood guard treats rapid identical goto()s
    // as an infinite loop and throttles the whole tab. Diffing the search
    // string breaks that cycle cleanly.
    const target = params.toString();
    const current = page.url.searchParams.toString();
    if (target === current) return;
    goto(`${page.url.pathname}?${target}`, {
      keepFocus: true,
      noScroll: true,
    });
  }

  /**
   * Compute the window immediately preceding [from, to] with the same duration.
   * Inclusive-day semantics: a 30-day window's previous-period sits 30 days earlier.
   */
  function previousPeriod(
    from: string,
    to: string
  ): { compareFrom: string; compareTo: string } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const durationDays = Math.max(
      1,
      Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1
    );
    const prevTo = new Date(fromDate);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (durationDays - 1));
    return { compareFrom: toISODate(prevFrom), compareTo: toISODate(prevTo) };
  }

  // ─── Preset actions ───────────────────────────────────────────────────
  function applyPreset(days: number) {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - days);

    const params = baseParams();
    params.set('startDate', toISODate(from));
    params.set('endDate', toISODate(now));

    if (compareEnabled) {
      const prev = previousPeriod(toISODate(from), toISODate(now));
      params.set('compareFrom', prev.compareFrom);
      params.set('compareTo', prev.compareTo);
    }

    navigate(params);
  }

  // ─── Custom main range popover ────────────────────────────────────────
  // Drafts start empty and re-sync from props each time the popover opens
  // (see $effect below). Keeping them as $state — not $derived — because
  // the date inputs bind directly to them while the popover is open.
  let customRangeOpen = $state(false);
  let draftStart = $state('');
  let draftEnd = $state('');

  $effect(() => {
    if (customRangeOpen) {
      draftStart = startDate;
      draftEnd = endDate;
    }
  });

  function applyCustomRange() {
    if (!draftStart || !draftEnd) return;

    const params = baseParams();
    params.set('startDate', draftStart);
    params.set('endDate', draftEnd);

    if (compareEnabled) {
      const prev = previousPeriod(draftStart, draftEnd);
      params.set('compareFrom', prev.compareFrom);
      params.set('compareTo', prev.compareTo);
    }

    customRangeOpen = false;
    navigate(params);
  }

  // ─── Compare toggle ───────────────────────────────────────────────────
  function handleCompareToggle(next: boolean) {
    // Bail when the toggle is echoing its current state — Melt UI's Switch
    // fires onCheckedChange during mount/re-render sync, which otherwise
    // loops through navigate → URL update → prop re-derive → Switch syncs.
    if (next === compareEnabled) return;

    const params = baseParams();
    params.set('startDate', startDate);
    params.set('endDate', endDate);

    if (next) {
      const prev = previousPeriod(startDate, endDate);
      params.set('compareFrom', prev.compareFrom);
      params.set('compareTo', prev.compareTo);
    }
    // else: compareFrom / compareTo already stripped by baseParams()

    navigate(params);
  }

  // ─── Custom compare popover ───────────────────────────────────────────
  let compareCustomOpen = $state(false);
  let draftCompareFrom = $state('');
  let draftCompareTo = $state('');

  $effect(() => {
    if (compareCustomOpen) {
      draftCompareFrom = compareFrom ?? '';
      draftCompareTo = compareTo ?? '';
    }
  });

  function applyCustomCompare() {
    if (!draftCompareFrom || !draftCompareTo) return;

    const params = baseParams();
    params.set('startDate', startDate);
    params.set('endDate', endDate);
    params.set('compareFrom', draftCompareFrom);
    params.set('compareTo', draftCompareTo);

    compareCustomOpen = false;
    navigate(params);
  }

  // ─── Window-chip label (count-chip analog in the identity zone) ───────
  // When a preset is active we show "LAST N DAYS"; on a custom range we
  // format the start–end pair. The chip mirrors the count-chip vocabulary
  // from ContentListCommandBar so the studio header family stays coherent.
  const chipDateFormatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  });

  const windowLabel = $derived.by(() => {
    if (activePreset === '7d') return m.analytics_cmd_window_last_7d();
    if (activePreset === '30d') return m.analytics_cmd_window_last_30d();
    if (activePreset === '90d') return m.analytics_cmd_window_last_90d();
    if (activePreset === 'year') return m.analytics_cmd_window_last_year();
    // Custom range: "21 Mar – 20 Apr"
    try {
      const from = chipDateFormatter.format(new Date(startDate));
      const to = chipDateFormatter.format(new Date(endDate));
      return `${from} – ${to}`;
    } catch {
      return m.analytics_cmd_window_custom();
    }
  });
</script>

<div class="command-bar" role="toolbar" aria-label={m.analytics_cmd_date_range_label()}>
  <div class="bar-identity">
    <a href="/studio" class="breadcrumb">
      <span class="breadcrumb-root">{m.analytics_cmd_eyebrow()}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-leaf">{m.analytics_title()}</span>
    </a>
    <span class="window-chip" aria-label={m.analytics_cmd_window_aria({ label: windowLabel })}>
      <span class="window-chip__value">{windowLabel}</span>
    </span>
  </div>

  <div class="bar-filters" role="tablist" aria-label={m.analytics_cmd_date_range_label()}>
    <button
      type="button"
      role="tab"
      class="filter-tab"
      data-active={activePreset === '7d' || undefined}
      aria-selected={activePreset === '7d'}
      onclick={() => applyPreset(7)}
    >
      {m.analytics_date_7d()}
    </button>
    <button
      type="button"
      role="tab"
      class="filter-tab"
      data-active={activePreset === '30d' || undefined}
      aria-selected={activePreset === '30d'}
      onclick={() => applyPreset(30)}
    >
      {m.analytics_date_30d()}
    </button>
    <button
      type="button"
      role="tab"
      class="filter-tab"
      data-active={activePreset === '90d' || undefined}
      aria-selected={activePreset === '90d'}
      onclick={() => applyPreset(90)}
    >
      {m.analytics_date_90d()}
    </button>
    <button
      type="button"
      role="tab"
      class="filter-tab"
      data-active={activePreset === 'year' || undefined}
      aria-selected={activePreset === 'year'}
      onclick={() => applyPreset(365)}
    >
      {m.analytics_date_year()}
    </button>

    <Popover.Root bind:open={customRangeOpen}>
      <Popover.Trigger
        class="filter-tab"
        data-active={activePreset === null || undefined}
      >
        {m.analytics_cmd_custom_range()}
      </Popover.Trigger>
      <Popover.Content class="range-popover">
        <h3 class="range-popover__title">{m.analytics_cmd_custom_range_heading()}</h3>
        <div class="range-popover__field">
          <label for="analytics-cmd-start" class="range-popover__label">
            {m.analytics_cmd_start_date()}
          </label>
          <input
            id="analytics-cmd-start"
            type="date"
            class="range-popover__input"
            bind:value={draftStart}
            max={draftEnd || undefined}
          />
        </div>
        <div class="range-popover__field">
          <label for="analytics-cmd-end" class="range-popover__label">
            {m.analytics_cmd_end_date()}
          </label>
          <input
            id="analytics-cmd-end"
            type="date"
            class="range-popover__input"
            bind:value={draftEnd}
            min={draftStart || undefined}
            max={toISODate(new Date())}
          />
        </div>
        <div class="range-popover__actions">
          <button
            type="button"
            class="apply-btn"
            onclick={applyCustomRange}
            disabled={!draftStart || !draftEnd}
          >
            {m.analytics_cmd_apply()}
          </button>
        </div>
      </Popover.Content>
    </Popover.Root>
  </div>

  <div class="bar-actions">
    <label class="compare-toggle">
      <Switch
        checked={compareEnabled}
        onCheckedChange={handleCompareToggle}
        aria-label={m.analytics_cmd_compare_toggle()}
      />
      <span class="compare-toggle__text">{m.analytics_cmd_compare_toggle()}</span>
    </label>

    {#if compareEnabled}
      <Popover.Root bind:open={compareCustomOpen}>
        <Popover.Trigger class="compare-custom-link">
          {m.analytics_cmd_compare_custom_link()}
        </Popover.Trigger>
        <Popover.Content class="range-popover">
          <h3 class="range-popover__title">{m.analytics_cmd_compare_custom_heading()}</h3>
          <div class="range-popover__field">
            <label for="analytics-cmd-compare-from" class="range-popover__label">
              {m.analytics_cmd_compare_from()}
            </label>
            <input
              id="analytics-cmd-compare-from"
              type="date"
              class="range-popover__input"
              bind:value={draftCompareFrom}
              max={draftCompareTo || undefined}
            />
          </div>
          <div class="range-popover__field">
            <label for="analytics-cmd-compare-to" class="range-popover__label">
              {m.analytics_cmd_compare_to()}
            </label>
            <input
              id="analytics-cmd-compare-to"
              type="date"
              class="range-popover__input"
              bind:value={draftCompareTo}
              min={draftCompareFrom || undefined}
            />
          </div>
          <div class="range-popover__actions">
            <button
              type="button"
              class="apply-btn"
              onclick={applyCustomCompare}
              disabled={!draftCompareFrom || !draftCompareTo}
            >
              {m.analytics_cmd_apply()}
            </button>
          </div>
        </Popover.Content>
      </Popover.Root>
    {/if}
  </div>
</div>

<style>
  /* Mirrors ContentListCommandBar / DashboardCommandBar vocabulary — sticky,
     backdrop-blurred surface with a 3-zone grid: identity | filters | actions.
     Keeps the studio header family visually coherent across routes. */
  .command-bar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, auto);
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-5);
    background-color: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-2xl, 24px));
    -webkit-backdrop-filter: blur(var(--blur-2xl, 24px));
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow:
      0 var(--space-1) var(--space-4)
        color-mix(in srgb, var(--color-text) 6%, transparent);
  }

  @media (--below-lg) {
    .command-bar {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'identity actions'
        'filters  filters';
      row-gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
    }
    .bar-identity { grid-area: identity; }
    .bar-filters  { grid-area: filters; overflow-x: auto; flex-wrap: nowrap; }
    .bar-actions  { grid-area: actions; }
  }

  /* ── Identity (breadcrumb + window chip) ────────────────── */
  .bar-identity {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .breadcrumb {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    min-width: 0;
    transition: var(--transition-colors);
  }

  .breadcrumb:hover { color: var(--color-interactive); }

  .breadcrumb:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .breadcrumb-root {
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .breadcrumb-sep {
    color: var(--color-text-muted);
    font-weight: var(--font-normal);
  }

  .breadcrumb-leaf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .window-chip {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full, 9999px);
    background: var(--color-surface);
    white-space: nowrap;
  }

  .window-chip__value {
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /* ── Segmented filter pills ─────────────────────────────── */
  .bar-filters {
    display: inline-flex;
    align-items: center;
    gap: var(--space-0-5, 2px);
    padding: var(--space-0-5, 2px);
    border-radius: var(--radius-full, 9999px);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface-secondary) 60%, var(--color-surface));
    justify-self: center;
  }

  @media (--below-lg) {
    .bar-filters { justify-self: start; }
  }

  .filter-tab {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    padding: var(--space-1-5, 6px) var(--space-3);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .filter-tab:hover { color: var(--color-text-secondary); }

  .filter-tab[data-active] {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow:
      0 1px 0 color-mix(in srgb, var(--color-text) 6%, transparent),
      0 1px 2px color-mix(in srgb, var(--color-text) 8%, transparent);
  }

  .filter-tab:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Actions (compare toggle + customise link) ──────────── */
  .bar-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    justify-content: flex-end;
    white-space: nowrap;
  }

  .compare-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
    user-select: none;
  }

  .compare-toggle__text {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .compare-custom-link {
    appearance: none;
    background: transparent;
    border: 0;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-interactive);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .compare-custom-link:hover {
    color: var(--color-interactive-hover);
  }

  .compare-custom-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ─── Range popovers ─────────────────────────────────────────────── */
  :global(.range-popover) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 16rem;
  }

  .range-popover__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .range-popover__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .range-popover__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .range-popover__input {
    padding: var(--space-2) var(--space-3);
    font-family: inherit;
    font-size: var(--text-sm);
    color: var(--color-text);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .range-popover__input:hover {
    border-color: var(--color-border-strong, var(--color-border));
  }

  .range-popover__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-color: var(--color-interactive);
  }

  .range-popover__actions {
    display: flex;
    justify-content: flex-end;
    margin-block-start: var(--space-1);
  }

  .apply-btn {
    padding: var(--space-1) var(--space-4);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-on-brand);
    background-color: var(--color-interactive);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .apply-btn:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
    border-color: var(--color-interactive-hover);
  }

  .apply-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .apply-btn:disabled {
    opacity: var(--opacity-50);
    cursor: not-allowed;
  }
</style>
