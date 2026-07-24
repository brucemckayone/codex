<!--
  @component SectionSkeleton

  Generic loading placeholder for a STREAMED section payload (shell+stream). Used
  as the `{#await}` pending branch when a section is waiting on the streamed
  sell-preview media. Token-driven; the shimmer collapses under
  prefers-reduced-motion via the shared `Skeleton` primitive.

  @prop {'media' | 'text'} [shape='media'] - Placeholder silhouette
  @prop {string} [label='Loading preview'] - sr-only status label
-->
<script lang="ts">
  import { Skeleton } from '$lib/components/ui/Skeleton';

  interface Props {
    shape?: 'media' | 'text';
    label?: string;
  }

  const { shape = 'media', label = 'Loading preview' }: Props = $props();
</script>

<div class="section-skeleton" aria-hidden="true" data-shape={shape}>
  {#if shape === 'media'}
    <Skeleton width="100%" height="100%" />
  {:else}
    <Skeleton width="60%" height="var(--text-2xl)" />
    <Skeleton width="90%" height="var(--text-base)" />
    <Skeleton width="75%" height="var(--text-base)" />
  {/if}
</div>
<span class="sr-only" role="status">{label}…</span>

<style>
  .section-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
  }

  .section-skeleton[data-shape='media'] {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-card);
    overflow: hidden;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
