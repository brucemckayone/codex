<!--
  @component ProvenanceLegend

  Explains the provenance tiers that tag every metric on the insights surface
  (SPEC §14.4). Lists the two tiers that ship (`live`, `course`) with their data
  sources, then the `track` tier as an explicit "not captured yet" note — so the
  omission of reach / traffic metrics is visible and honest, not silent.
-->
<script lang="ts">
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import { METRIC_TIERS, UNTRACKED_TIER } from './metric-model';

  const tiers = [METRIC_TIERS.live, METRIC_TIERS.course];
</script>

<aside class="legend" aria-label="What the metric tiers mean">
  <p class="legend__intro">
    Each metric is tagged by where its data comes from.
  </p>
  <ul class="legend__list">
    {#each tiers as tier (tier.id)}
      <li class="legend__item">
        <Badge variant={tier.id === 'live' ? 'info' : 'neutral'}>
          {tier.label}
        </Badge>
        <span class="legend__desc">{tier.description}</span>
      </li>
    {/each}
    <li class="legend__item legend__item--muted">
      <Badge variant="neutral">{UNTRACKED_TIER.label}</Badge>
      <span class="legend__desc">{UNTRACKED_TIER.description}</span>
    </li>
  </ul>
</aside>

<style>
  .legend {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background-color: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .legend__intro {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    margin: 0;
  }

  .legend__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .legend__item {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }

  .legend__desc {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  /* The un-instrumented `track` tier reads as unavailable, not active. */
  .legend__item--muted .legend__desc {
    color: var(--color-text-tertiary);
  }
</style>
