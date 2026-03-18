<!--
  @component StatCard

  Displays a single dashboard metric with optional percentage change indicator.
  Uses Card wrapper and Skeleton for loading state.

  @prop {string} label - The metric label (e.g. "Revenue")
  @prop {string | number} value - The metric value to display
  @prop {number} [change] - Percentage change (positive = green, negative = red)
  @prop {boolean} [loading=false] - Whether the card is in loading state
-->
<script lang="ts">
  import { Card, CardContent } from '$lib/components/ui/Card';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import Skeleton from '$lib/components/ui/Skeleton/Skeleton.svelte';

  interface Props {
    label: string;
    value: string | number;
    change?: number;
    loading?: boolean;
  }

  const { label, value, change, loading = false }: Props = $props();

  const changeVariant = $derived(
    change !== undefined && change > 0
      ? 'success'
      : change !== undefined && change < 0
        ? 'error'
        : 'neutral'
  );

  const changeText = $derived(
    change !== undefined && change > 0
      ? `+${change}%`
      : change !== undefined
        ? `${change}%`
        : undefined
  );
</script>

<Card class="stat-card" aria-busy={loading}>
  <CardContent class="stat-content">
    {#if loading}
      <Skeleton width="60%" height="0.875rem" />
      <Skeleton width="80%" height="2rem" />
    {:else}
      <span class="stat-label">{label}</span>
      <div class="stat-row">
        <span class="stat-value">{value}</span>
        {#if changeText !== undefined}
          <Badge variant={changeVariant}>{changeText}</Badge>
        {/if}
      </div>
    {/if}
  </CardContent>
</Card>

<style>
  :global(.stat-card) {
    height: 100%;
  }

  :global(.stat-content) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .stat-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
  }

  .stat-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .stat-value {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }
</style>
