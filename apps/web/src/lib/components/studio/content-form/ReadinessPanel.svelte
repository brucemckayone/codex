<!--
  @component ReadinessPanel

  Inline summary of the publish-readiness checklist. Lives at the bottom
  of the form body (not in a sidebar) so every item is visible at the
  natural scroll terminus.

  @prop checks   Array of { label, met } readiness checks
-->
<script lang="ts">
  import { CheckIcon, CircleIcon } from '$lib/components/ui/Icon';

  interface ReadinessCheck {
    label: string;
    met: boolean;
  }

  interface Props {
    checks: ReadinessCheck[];
  }

  const { checks }: Props = $props();

  const metCount = $derived(checks.filter((c) => c.met).length);
  const isComplete = $derived(metCount === checks.length && checks.length > 0);
</script>

<div class="readiness-panel" data-complete={isComplete || undefined}>
  <header class="panel-header">
    <span class="panel-eyebrow">Pre-flight</span>
    <h3 class="panel-title">Publish readiness</h3>
    <span class="panel-count">
      <span class="count-met">{metCount}</span>
      <span class="count-sep" aria-hidden="true">/</span>
      <span class="count-total">{checks.length}</span>
    </span>
  </header>

  <ul class="checks">
    {#each checks as check (check.label)}
      <li class="check-row" data-met={check.met || undefined}>
        <span class="check-icon" aria-hidden="true">
          {#if check.met}
            <CheckIcon size={12} />
          {:else}
            <CircleIcon size={12} />
          {/if}
        </span>
        <span class="check-label">{check.label}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .readiness-panel {
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
    transition: border-color var(--duration-normal) var(--ease-out),
                background-color var(--duration-normal) var(--ease-out);
  }

  .readiness-panel[data-complete] {
    border-color: color-mix(in srgb, var(--color-success-500) 35%, var(--color-border));
    background-color: color-mix(in srgb, var(--color-success-500) 3%, var(--color-surface));
  }

  .panel-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'eyebrow count'
      'title   count';
    align-items: baseline;
    gap: var(--space-1) var(--space-4);
    margin-bottom: var(--space-4);
  }

  .panel-eyebrow {
    grid-area: eyebrow;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
  }

  .panel-title {
    grid-area: title;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-tight);
    color: var(--color-text);
    margin: 0;
  }

  .panel-count {
    grid-area: count;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-0-5);
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
  }

  .count-met {
    font-size: var(--text-3xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tighter);
    line-height: var(--leading-none);
  }

  .readiness-panel[data-complete] .count-met {
    color: var(--color-success-600);
  }

  .count-sep,
  .count-total {
    font-size: var(--text-lg);
    color: var(--color-text-muted);
  }

  .checks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }

  @media (--breakpoint-md) {
    .checks { grid-template-columns: repeat(2, 1fr); }
  }

  .check-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    transition: background-color var(--duration-normal) var(--ease-out),
                color var(--duration-normal) var(--ease-out);
  }

  .check-row[data-met] {
    color: var(--color-success-700);
    background-color: color-mix(in srgb, var(--color-success-500) 8%, var(--color-surface-secondary));
  }

  .check-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-full, 9999px);
    flex-shrink: 0;
    color: var(--color-text-muted);
    border: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .check-row[data-met] .check-icon {
    color: var(--color-surface);
    background: var(--color-success-500);
    border-color: var(--color-success-500);
  }

  .check-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
