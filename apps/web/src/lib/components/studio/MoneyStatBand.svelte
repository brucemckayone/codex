<!--
  @component MoneyStatBand

  The summary band for a money surface: a small number of facts, stated once,
  above the detail they summarise.

  Treatment is deliberately `studio/customers`' measured one — `--color-surface-
  secondary` fill, uppercase micro-label, tabular value — because customers is
  the studio page this work was asked to match. `studio/StatCard` (which wraps
  `ui/Card`, i.e. `--color-surface`) measures 1.18:1 against a dark page where
  customers' band measures 1.73:1, so the two treatments are visibly different
  weights on dark. This component converges the monetisation surfaces onto the
  heavier one WITHOUT editing `StatCard`, which is also consumed by
  `studio/billing` and the creators studio — changing it would restyle another
  agent's live surface mid-session.

  Each stat may carry an `href`, which makes the whole tile a link. That closes
  the gap where a creator could read "2 active subscribers" and have no path to
  the two people.

  @prop {MoneyStat[]} stats - 2–4 facts. More than four stops being a summary.
    Shape lives in `./money-stat.ts`.
  @prop {string} label - Accessible name for the group.
-->
<script lang="ts">
  import { ArrowRightIcon } from '$lib/components/ui/Icon';
  import type { MoneyStat } from './money-stat';

  interface Props {
    stats: MoneyStat[];
    label: string;
    class?: string;
  }

  const { stats, label, class: className }: Props = $props();
</script>

<section
  class="money-stats {className ?? ''}"
  role="group"
  aria-label={label}
  style:--_stat-columns={stats.length}
>
  {#each stats as stat (stat.label)}
    {#if stat.href}
      <a class="money-stats__tile money-stats__tile--link" href={stat.href}>
        <span class="money-stats__label">{stat.label}</span>
        <span class="money-stats__value">{stat.value}</span>
        {#if stat.hint}
          <span class="money-stats__hint">{stat.hint}</span>
        {/if}
        <span class="money-stats__chevron" aria-hidden="true">
          <ArrowRightIcon size={14} />
        </span>
      </a>
    {:else}
      <div class="money-stats__tile">
        <span class="money-stats__label">{stat.label}</span>
        <span class="money-stats__value">{stat.value}</span>
        {#if stat.hint}
          <span class="money-stats__hint">{stat.hint}</span>
        {/if}
      </div>
    {/if}
  {/each}
</section>

<style>
  .money-stats {
    display: grid;
    grid-template-columns: repeat(var(--_stat-columns, 3), minmax(0, 1fr));
    gap: var(--space-3);
  }

  @media (--below-sm) {
    .money-stats {
      grid-template-columns: 1fr;
    }
  }

  .money-stats__tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .money-stats__tile--link {
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .money-stats__tile--link:hover {
    border-color: var(--color-border-strong, var(--color-border));
  }

  .money-stats__tile--link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .money-stats__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-transform: var(--text-transform-label, uppercase);
    letter-spacing: var(--tracking-wider);
  }

  .money-stats__value {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-tight);
  }

  .money-stats__hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .money-stats__chevron {
    position: absolute;
    inset-block-start: var(--space-4);
    inset-inline-end: var(--space-4);
    display: inline-flex;
    color: var(--color-text-secondary);
    transition: var(--transition-transform);
  }

  .money-stats__tile--link:hover .money-stats__chevron {
    transform: translateX(var(--space-1));
  }
</style>
