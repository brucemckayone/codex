<!--
  @component ContentListSkeleton

  Loading placeholder that mirrors the real ContentFeatureSlab + ContentRow
  shape so there's no layout shift when the data resolves. Shimmer animation
  collapses under prefers-reduced-motion.

  @prop rowCount  Number of row placeholders (default 5)
  @prop showSlab  Whether to render the feature slab placeholder (default true)
-->
<script lang="ts">
  interface Props {
    rowCount?: number;
    showSlab?: boolean;
  }

  const { rowCount = 5, showSlab = true }: Props = $props();

  const rows = $derived(Array.from({ length: rowCount }, (_, i) => i));
</script>

<div class="skeleton-wrap" aria-busy="true" aria-live="polite">
  {#if showSlab}
    <div class="slab-skel">
      <div class="skel slab-thumb-skel"></div>
      <div class="slab-body-skel">
        <div class="skel slab-eyebrow-skel"></div>
        <div class="skel slab-title-skel"></div>
        <div class="skel slab-strap-skel"></div>
        <div class="skel slab-strap-skel slab-strap-skel--short"></div>
        <div class="slab-actions-skel">
          <div class="skel slab-action-skel"></div>
          <div class="skel slab-action-skel slab-action-skel--narrow"></div>
        </div>
      </div>
    </div>
  {/if}

  <div class="row-list-skel">
    {#each rows as i (i)}
      <div class="row-skel">
        <div class="skel row-thumb-skel"></div>
        <div class="skel row-ordinal-skel"></div>
        <div class="row-body-skel">
          <div class="skel row-title-skel" style="width: {55 + (i % 3) * 10}%;"></div>
          <div class="row-meta-skel">
            <div class="skel row-chip-skel"></div>
            <div class="skel row-chip-skel row-chip-skel--narrow"></div>
          </div>
        </div>
        <div class="skel row-status-skel"></div>
        <div class="skel row-action-skel"></div>
      </div>
    {/each}
  </div>
</div>

<style>
  .skeleton-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  /* ── Shared shimmer ─────────────────────────────────────── */
  .skel {
    background: linear-gradient(
      90deg,
      var(--color-surface-secondary) 25%,
      var(--color-surface-tertiary, var(--color-surface-secondary)) 50%,
      var(--color-surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: content-list-shimmer 1.5s linear infinite;
    border-radius: var(--radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .skel { animation: none; }
  }

  /* ── Feature slab skeleton ──────────────────────────────── */
  .slab-skel {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: var(--space-6);
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  @media (--below-md) {
    .slab-skel {
      grid-template-columns: 1fr;
      gap: var(--space-4);
      padding: var(--space-4);
    }
  }

  .slab-thumb-skel {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
  }

  .slab-body-skel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .slab-eyebrow-skel { width: 8rem; height: var(--space-4); }
  .slab-title-skel   { width: 80%; height: var(--space-8); }
  .slab-strap-skel   { width: 100%; height: var(--space-3); }
  .slab-strap-skel--short { width: 60%; }

  .slab-actions-skel {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .slab-action-skel {
    width: 7rem;
    height: calc(var(--space-8) + var(--space-1));
    border-radius: var(--radius-full, 9999px);
  }

  .slab-action-skel--narrow { width: 4rem; }

  /* ── Row list skeleton ──────────────────────────────────── */
  .row-list-skel {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .row-skel {
    display: grid;
    grid-template-columns:
      minmax(9rem, 12rem) auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
  }

  @media (--below-md) {
    .row-skel {
      grid-template-columns: 6rem minmax(0, 1fr) auto;
      gap: var(--space-3);
    }
    .row-skel .row-ordinal-skel,
    .row-skel .row-status-skel { display: none; }
  }

  .row-thumb-skel {
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
  }

  .row-ordinal-skel {
    width: var(--space-5);
    height: var(--space-4);
  }

  .row-body-skel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .row-title-skel { height: var(--space-4); }

  .row-meta-skel {
    display: inline-flex;
    gap: var(--space-1-5);
  }

  .row-chip-skel {
    width: 4rem;
    height: var(--space-4);
    border-radius: var(--radius-full, 9999px);
  }

  .row-chip-skel--narrow { width: 3rem; }

  .row-status-skel {
    width: 5rem;
    height: var(--space-5);
    border-radius: var(--radius-full, 9999px);
  }

  .row-action-skel {
    width: 5rem;
    height: var(--space-6);
    border-radius: var(--radius-md);
  }

  @keyframes content-list-shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
