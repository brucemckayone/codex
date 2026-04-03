<script lang="ts">
  import type { Snippet, Component } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    icon?: Component<{ size?: number; 'stroke-width'?: string }>;
    action?: Snippet;
  }

  const { title, description, icon: Icon, action }: Props = $props();
</script>

<div class="empty-state">
  {#if Icon}
    <div class="empty-state__icon">
      <Icon size={48} stroke-width="1" />
    </div>
  {/if}

  <h3 class="empty-state__title">{title}</h3>

  {#if description}
    <p class="empty-state__description">{description}</p>
  {/if}

  {#if action}
    <div class="empty-state__action">
      {@render action()}
    </div>
  {/if}
</div>

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-12) var(--space-4);
    text-align: center;
  }

  .empty-state__icon {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .empty-state__title {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .empty-state__description {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    max-width: 300px;
  }

  .empty-state__action {
    margin-top: var(--space-2);
  }
</style>
