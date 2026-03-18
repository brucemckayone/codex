<!--
  @component SettingsLayout

  Tabbed navigation layout for organization settings.
  Uses Melt UI Tabs component with anchor-based triggers for SvelteKit routing.
  Active tab is derived from the current URL pathname.

  @prop {LayoutData} data - Server-loaded data (orgId from parent)
  @prop {Snippet} children - Child route content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/stores';
  import * as m from '$paraglide/messages';
  import { SETTINGS_NAV } from '$lib/config/navigation';
  import type { LayoutData } from './$types';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  const slug = $derived($page.params.slug);

  // Derive active tab from pathname
  const activeTab = $derived(
    $page.url.pathname.endsWith('/branding') ? 'branding' : 'general'
  );

  // Map nav items to tab config with i18n labels
  const tabs = $derived([
    {
      value: 'general',
      href: '/studio/settings',
      label: m.settings_general(),
    },
    {
      value: 'branding',
      href: '/studio/settings/branding',
      label: m.settings_branding(),
    },
  ]);
</script>

<svelte:head>
  <title>{m.settings_title()} | {data.org.name} Studio</title>
</svelte:head>

<div class="settings-layout">
  <header class="settings-header">
    <h1 class="settings-title">{m.settings_title()}</h1>
  </header>

  <nav class="settings-tabs" aria-label={m.settings_title()}>
    <div class="tabs-list" role="tablist">
      {#each tabs as tab (tab.value)}
        <a
          href={tab.href}
          class="tab-trigger"
          class:active={activeTab === tab.value}
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-current={activeTab === tab.value ? 'page' : undefined}
        >
          {tab.label}
        </a>
      {/each}
    </div>
  </nav>

  <div class="settings-content">
    {@render children()}
  </div>
</div>

<style>
  .settings-layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 1200px;
  }

  .settings-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .settings-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
  }

  .settings-tabs {
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .tabs-list {
    display: flex;
    gap: var(--space-4);
  }

  .tab-trigger {
    display: block;
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    transition: color var(--transition-duration) var(--transition-timing),
      border-color var(--transition-duration) var(--transition-timing);
  }

  .tab-trigger:hover {
    color: var(--color-text);
  }

  .tab-trigger:focus-visible {
    outline: 2px solid var(--color-primary-500);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .tab-trigger.active {
    color: var(--color-primary-500);
    border-bottom-color: var(--color-primary-500);
  }

  .settings-content {
    flex: 1;
    min-width: 0;
  }

  /* Mobile: stack tabs vertically */
  @media (max-width: 639px) {
    .tabs-list {
      flex-direction: column;
      gap: var(--space-1);
    }

    .tab-trigger {
      padding: var(--space-2) var(--space-3);
      border-bottom: none;
      border-radius: var(--radius-md);
      margin-bottom: 0;
    }

    .tab-trigger.active {
      background-color: var(--color-primary-50);
      border-bottom-color: transparent;
    }

    .settings-tabs {
      border-bottom: none;
    }
  }

  /* Dark mode */
  :global([data-theme='dark']) .tab-trigger.active {
    color: var(--color-primary-400);
    border-bottom-color: var(--color-primary-400);
  }

  @media (max-width: 639px) {
    :global([data-theme='dark']) .tab-trigger.active {
      background-color: var(--color-primary-900);
      border-bottom-color: transparent;
    }
  }
</style>
