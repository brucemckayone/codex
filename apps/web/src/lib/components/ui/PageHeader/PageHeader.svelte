<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    actions?: Snippet;
  }

  const { title, description, actions }: Props = $props();
</script>

<header class="page-header">
  <div class="page-header__text">
    <h1 class="page-header__title">{title}</h1>
    {#if description}
      <p class="page-header__description">{description}</p>
    {/if}
  </div>
  {#if actions}
    <div class="page-header__actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .page-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  @media (min-width: 640px) {
    .page-header {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .page-header__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-header__title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
  }

  .page-header__description {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .page-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }
</style>
