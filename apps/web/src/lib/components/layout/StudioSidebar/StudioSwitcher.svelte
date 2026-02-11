<script lang="ts">
  import type { LayoutOrganization } from '$lib/types';
  import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
  import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
  import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
  import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
  import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';

  interface Props {
    currentContext: 'personal' | 'org';
    orgs: LayoutOrganization[];
  }

  const { currentContext, orgs }: Props = $props();

  const label = $derived(
    currentContext === 'personal' ? 'Personal' : 'Organization'
  );
</script>

<DropdownMenu>
  <DropdownMenuTrigger class="switcher-trigger">
    <svg class="switcher-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    <span class="switcher-label">{label}</span>
    <svg class="switcher-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <a href="/studio">
      <DropdownMenuItem>
        <span class="item-content">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Personal Studio
        </span>
        {#if currentContext === 'personal'}
          <svg class="check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
        {/if}
      </DropdownMenuItem>
    </a>

    {#if orgs.length > 0}
      <DropdownMenuSeparator />
      {#each orgs as orgItem}
        <a href="/studio/org/{orgItem.slug}">
          <DropdownMenuItem>
            <span class="item-content">
              {#if orgItem.logoUrl}
                <img src={orgItem.logoUrl} alt="" class="org-icon" />
              {:else}
                <span class="org-icon-fallback">{orgItem.name[0]}</span>
              {/if}
              {orgItem.name}
            </span>
          </DropdownMenuItem>
        </a>
      {/each}
    {/if}
  </DropdownMenuContent>
</DropdownMenu>

<style>
  :global(.switcher-trigger) {
    display: flex;
    align-items: center;
    gap: var(--space-1-5, var(--space-1));
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-colors);
  }

  :global(.switcher-trigger:hover) {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .switcher-icon {
    flex-shrink: 0;
  }

  .switcher-label {
    font-weight: var(--font-medium);
  }

  .switcher-chevron {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .item-content {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
  }

  .check {
    color: var(--color-primary-500);
    flex-shrink: 0;
  }

  .org-icon {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    object-fit: contain;
  }

  .org-icon-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
  }
</style>
