<!--
  @component RevenueKindsLine

  The line under a revenue figure that says what it is made of: One-off ·
  Courses · Subscriptions · Course plans (Codex-2hxff.20 WEB-02, owner
  decision Q1 "Count everything now"). The four add up to the figure above
  it, so the line uses that figure's rounding: `exact` pence under an exact
  figure (Dashboard, Billing), `compact` pounds under a rounded one
  (Analytics).

  Used on the Studio dashboard's Revenue tile, the Analytics Revenue KPI and
  Billing's Gross (tile and statement).

  @prop {Record<RevenueKind, number>} kinds  Cents per kind, from the revenue block.
  @prop {'exact'|'compact'} [format]  `exact` → formatPrice, `compact` → formatPriceCompact.
  @prop {string} [label]  Accessible name of the list. Default "Revenue by kind".
-->
<script lang="ts">
  import type { RevenueKind } from '@codex/admin';
  import * as m from '$paraglide/messages';
  import { formatPrice, formatPriceCompact } from '$lib/utils/format';

  interface Props {
    kinds: Record<RevenueKind, number>;
    format?: 'exact' | 'compact';
    label?: string;
    class?: string;
  }

  const {
    kinds,
    format = 'exact',
    label = m.analytics_revenue_kinds_label(),
    class: className,
  }: Props = $props();

  const rows = $derived([
    { kind: 'one_off', name: m.analytics_revenue_kind_one_off() },
    { kind: 'course', name: m.analytics_revenue_kind_course() },
    { kind: 'subscription', name: m.analytics_revenue_kind_subscription() },
    { kind: 'course_plan', name: m.analytics_revenue_kind_course_plan() },
  ] satisfies Array<{ kind: RevenueKind; name: string }>);

  function money(cents: number): string {
    return format === 'exact' ? formatPrice(cents) : formatPriceCompact(cents);
  }
</script>

<ul
  class="revenue-kinds {className ?? ''}"
  aria-label={label}
  data-testid="revenue-kinds"
>
  {#each rows as row (row.kind)}
    <li data-kind={row.kind}>
      {row.name}
      <span class="revenue-kinds__amount">{money(kinds[row.kind] ?? 0)}</span>
    </li>
  {/each}
</ul>

<style>
  .revenue-kinds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-0-5) var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .revenue-kinds li {
    margin: 0;
    white-space: nowrap;
  }

  /* The separator goes AFTER each item, so a wrapped line never starts with
     a dot. */
  .revenue-kinds li:not(:last-child)::after {
    content: '·';
    margin-inline-start: var(--space-2);
  }

  .revenue-kinds__amount {
    font-weight: var(--font-medium);
    color: var(--color-text);
  }
</style>
