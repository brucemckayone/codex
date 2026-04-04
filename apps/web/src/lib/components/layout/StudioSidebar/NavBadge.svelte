<script lang="ts">
  interface Props {
    count: number;
  }

  const { count }: Props = $props();
</script>

{#if count > 0}
  <span class="nav-badge" aria-label="{count} items">
    {count > 99 ? '99+' : count}
  </span>
{/if}

<style>
  .nav-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-5);
    height: var(--space-5);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: var(--leading-none);
    margin-left: auto;
  }
</style>
