<script lang="ts">
  import { navigating, page } from '$app/state';
  import {
    SIDEBAR_BASE_LINKS,
    SIDEBAR_ADMIN_LINKS,
    SIDEBAR_OWNER_LINKS,
    SIDEBAR_PERSONAL_LINKS,
  } from '$lib/config/navigation';
  import {
    LayoutDashboardIcon,
    FileIcon,
    VideoIcon,
    TrendingUpIcon,
    UsersIcon,
    UserPlusIcon,
    SettingsIcon,
    CreditCardIcon,
  } from '$lib/components/ui/Icon';
  import type { SidebarIcon } from '$lib/config/navigation';
  import type { Component } from 'svelte';

  const ICON_MAP: Record<SidebarIcon, Component<any>> = {
    dashboard: LayoutDashboardIcon,
    content: FileIcon,
    media: VideoIcon,
    analytics: TrendingUpIcon,
    team: UsersIcon,
    customers: UserPlusIcon,
    settings: SettingsIcon,
    billing: CreditCardIcon,
  };

  interface Props {
    role: string;
    context: 'personal' | 'org';
  }

  const { role, context }: Props = $props();

  const isAdmin = $derived(role === 'admin' || role === 'owner');
  const isOwner = $derived(role === 'owner');

  const baseLinks = SIDEBAR_BASE_LINKS;
  const adminLinks = SIDEBAR_ADMIN_LINKS;
  const ownerLinks = SIDEBAR_OWNER_LINKS;
  const personalLinks = SIDEBAR_PERSONAL_LINKS;

  function isActive(href: string, currentPath: string): boolean {
    if (href === '/studio') {
      return currentPath === '/studio';
    }
    return currentPath.startsWith(href);
  }
</script>

<aside class="sidebar" aria-label="Studio navigation">
  <nav class="sidebar-nav">
    <ul class="nav-section" role="list">
      {#each baseLinks as link}
        {@const Icon = ICON_MAP[link.icon]}
        <li>
          <a
            href={link.href}
            class="nav-item"
            class:active={isActive(link.href, page.url.pathname)}
            class:loading={navigating?.to?.url.pathname != null && isActive(link.href, navigating.to.url.pathname)}
            aria-current={isActive(link.href, page.url.pathname) ? 'page' : undefined}
          >
            <Icon size={18} class="nav-icon" />
            {link.label}
          </a>
        </li>
      {/each}
    </ul>

    {#if isAdmin && context === 'org'}
      <div class="section-divider"></div>
      <span class="section-label">Admin</span>
      <ul class="nav-section" role="list">
        {#each adminLinks as link}
          {@const Icon = ICON_MAP[link.icon]}
          <li>
            <a
              href={link.href}
              class="nav-item"
              class:active={isActive(link.href, page.url.pathname)}
              aria-current={isActive(link.href, page.url.pathname) ? 'page' : undefined}
            >
              <Icon size={18} class="nav-icon" />
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if isOwner && context === 'org'}
      <div class="section-divider"></div>
      <span class="section-label">Owner</span>
      <ul class="nav-section" role="list">
        {#each ownerLinks as link}
          {@const Icon = ICON_MAP[link.icon]}
          <li>
            <a
              href={link.href}
              class="nav-item"
              class:active={isActive(link.href, page.url.pathname)}
              aria-current={isActive(link.href, page.url.pathname) ? 'page' : undefined}
            >
              <Icon size={18} class="nav-icon" />
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if context === 'personal'}
      <div class="section-divider"></div>
      <ul class="nav-section" role="list">
        {#each personalLinks as link}
          {@const Icon = ICON_MAP[link.icon]}
          <li>
            <a
              href={link.href}
              class="nav-item"
              class:active={isActive(link.href, page.url.pathname)}
              aria-current={isActive(link.href, page.url.pathname) ? 'page' : undefined}
            >
              <Icon size={18} class="nav-icon" />
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </nav>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-width);
    height: 100%;
    background-color: var(--color-surface);
    border-right: var(--border-width) var(--border-style) var(--color-border);
    padding: var(--space-4) 0;
    flex-shrink: 0;
    overflow-y: auto;
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
  }

  .nav-section {
    list-style: none;
    padding: 0 var(--space-3);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .nav-item:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .nav-item.loading {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .nav-item.active {
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive);
  }

  .nav-icon {
    flex-shrink: 0;
  }

  .section-divider {
    height: 1px;
    background-color: var(--color-border);
    margin: var(--space-3) var(--space-3);
  }

  .section-label {
    display: block;
    padding: var(--space-1) var(--space-6);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
</style>
