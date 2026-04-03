<script lang="ts">
  import type { LayoutOrganization } from '$lib/types';
  import { page } from '$app/state';
  import { buildOrgUrl } from '$lib/utils/subdomain';
  import { UsersIcon, UserIcon, ChevronDownIcon, CheckIcon } from '$lib/components/ui/Icon';
  import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
  import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
  import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
  import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
  import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    currentContext: 'personal' | 'org';
    currentSlug?: string;
    orgs: LayoutOrganization[];
  }

  const { currentContext, currentSlug, orgs }: Props = $props();

  const label = $derived(
    currentContext === 'personal'
      ? m.studio_switcher_personal()
      : orgs.find(o => o.slug === currentSlug)?.name ?? m.studio_switcher_organization()
  );
</script>

<DropdownMenu>
  <DropdownMenuTrigger class="switcher-trigger">
    <UsersIcon size={16} class="switcher-icon" />
    <span class="switcher-label">{label}</span>
    <ChevronDownIcon size={14} class="switcher-chevron" />
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <a href={buildOrgUrl(page.url, 'creators', '/studio')}>
      <DropdownMenuItem>
        <span class="item-content">
          <UserIcon size={16} />
          {m.studio_switcher_personal_studio()}
        </span>
        {#if currentContext === 'personal'}
          <CheckIcon size={16} class="check" />
        {/if}
      </DropdownMenuItem>
    </a>

    {#if orgs.length > 0}
      <DropdownMenuSeparator />
      {#each orgs as orgItem}
        <a href={buildOrgUrl(page.url, orgItem.slug, '/studio')}>
          <DropdownMenuItem>
            <span class="item-content">
              {#if orgItem.logoUrl}
                <img src={orgItem.logoUrl} alt="" class="org-icon" />
              {:else}
                <span class="org-icon-fallback">{orgItem.name[0]}</span>
              {/if}
              {orgItem.name}
            </span>
            {#if currentSlug === orgItem.slug}
              <CheckIcon size={16} class="check" />
            {/if}
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
    color: var(--color-interactive);
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
