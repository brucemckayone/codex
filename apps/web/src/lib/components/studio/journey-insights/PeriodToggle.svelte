<!--
  @component PeriodToggle

  Controlled segmented control for the reporting window. The parent owns the
  value (driven by the `?period=` URL param on the insights page) and re-fires
  the query on change.

  @prop {InsightsPeriod} value               Current period.
  @prop {(p: InsightsPeriod) => void} onChange Called with the chosen period.
-->
<script lang="ts">
  import type { InsightsPeriod } from './metric-model';

  interface Props {
    value: InsightsPeriod;
    onChange: (period: InsightsPeriod) => void;
  }

  const { value, onChange }: Props = $props();

  const options: { id: InsightsPeriod; label: string }[] = [
    { id: '7d', label: '7 days' },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
    { id: 'all', label: 'All time' },
  ];
</script>

<div class="period-toggle" role="group" aria-label="Reporting period">
  {#each options as option (option.id)}
    <button
      type="button"
      class="period-toggle__btn"
      data-active={value === option.id}
      aria-pressed={value === option.id}
      onclick={() => onChange(option.id)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .period-toggle {
    display: inline-flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .period-toggle__btn {
    appearance: none;
    border: none;
    background: transparent;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    line-height: var(--leading-none);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .period-toggle__btn:hover {
    color: var(--color-text);
  }

  .period-toggle__btn[data-active='true'] {
    background-color: var(--color-surface-card);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .period-toggle__btn:focus-visible {
    outline: var(--border-width-thick) var(--border-style) var(--color-focus-ring);
    outline-offset: var(--space-1);
  }
</style>
