<script lang="ts">
  /**
   * Account layout - sub-navigation for account settings
   */
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';
  import * as m from '$paraglide/messages';
  import { ACCOUNT_NAV } from '$lib/config/navigation';
  import { getStaleKeys, updateStoredVersions } from '$lib/client/version-manifest';
  import { invalidateCollection } from '$lib/collections';

  const { children, data }: { children: Snippet; data: LayoutData } = $props();

  $effect(() => {
    const staleKeys = getStaleKeys(data.versions ?? {});

    // User entity stale → library items may have changed (purchase/access updates)
    if (staleKeys.some((k) => k.startsWith('user:'))) {
      invalidateCollection('library');
    }

    updateStoredVersions(data.versions ?? {});
  });
</script>

<div class="account-layout">
  <aside class="account-sidebar">
    <h2 class="sidebar-title">{m.account_settings_title()}</h2>
    <nav class="sidebar-nav" aria-label="Account">
      {#each ACCOUNT_NAV as link (link.href)}
        <a
          href={link.href}
          class="sidebar-link"
          class:active={$page.url.pathname === link.href}
          aria-current={$page.url.pathname === link.href ? 'page' : undefined}
        >
          {link.label}
        </a>
      {/each}
    </nav>
  </aside>

  <div class="account-content">
    {@render children()}
  </div>
</div>

<style>
  .account-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-8) 0;
  }

  @media (min-width: 768px) {
    .account-layout {
      flex-direction: row;
    }
  }

  .account-sidebar {
    flex-shrink: 0;
  }

  @media (min-width: 768px) {
    .account-sidebar {
      width: 14rem;
    }
  }

  .sidebar-title {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin-bottom: var(--space-4);
  }

  .sidebar-nav {
    display: flex;
    gap: var(--space-1);
  }

  @media (min-width: 768px) {
    .sidebar-nav {
      flex-direction: column;
    }
  }

  .sidebar-link {
    display: block;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    text-decoration: none;
  }

  .sidebar-link:hover {
    color: var(--color-text);
    background-color: var(--color-neutral-100);
  }

  .sidebar-link:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
  }

  .sidebar-link.active {
    color: var(--color-primary-500);
    background-color: var(--color-primary-50);
    font-weight: var(--font-medium);
  }

  .account-content {
    flex: 1;
    min-width: 0;
  }
</style>
