<!--
  @component MediaUsesSkeleton

  "Checking where it's used…" over two skeleton rows: the uses list while
  `GET /api/media/:id/usage` is under way (the chip's popover, and the delete
  dialog's F1). Codex-6sbn1.
-->
<script lang="ts">
  import { Skeleton } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
</script>

<div class="uses-skeleton" aria-busy="true">
  <p class="uses-skeleton__label" role="status">{m.media_uses_checking()}</p>
  {#each [0, 1] as i (i)}
    <div class="uses-skeleton__row" aria-hidden="true">
      <Skeleton width="var(--space-8)" height="var(--space-8)" />
      <span class="uses-skeleton__lines">
        <Skeleton height="var(--space-2)" />
        <Skeleton width="55%" height="var(--space-2)" />
      </span>
    </div>
  {/each}
</div>

<style>
  .uses-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .uses-skeleton__label {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .uses-skeleton__row {
    display: grid;
    grid-template-columns: var(--space-8) 1fr;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) 0;
  }

  .uses-skeleton__lines {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }
</style>
