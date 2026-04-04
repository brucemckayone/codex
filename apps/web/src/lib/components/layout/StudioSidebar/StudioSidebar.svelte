<script lang="ts">
  import { navigating, page } from '$app/state';
  import { submitFormPost } from '$lib/utils/navigation';
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
    GlobeIcon,
    UserIcon,
    ChevronsLeftIcon,
    ChevronsRightIcon,
  } from '$lib/components/ui/Icon';
  import NavBadge from './NavBadge.svelte';
  import type { SidebarIcon } from '$lib/config/navigation';
  import type { Component } from 'svelte';
  import * as m from '$paraglide/messages';

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
    user?: { name: string; email: string } | undefined;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    badgeCounts?: { draftContent: number };
  }

  const {
    role,
    context,
    user,
    collapsed = false,
    onToggleCollapse,
    badgeCounts,
  }: Props = $props();

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

<aside class="sidebar" aria-label="Studio navigation" data-collapsed={collapsed}>
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
            title={collapsed ? link.label : undefined}
          >
            <Icon size={18} class="nav-icon" />
            <span class="nav-label">{link.label}</span>
            {#if link.icon === 'content' && badgeCounts?.draftContent}
              <NavBadge count={badgeCounts.draftContent} />
            {/if}
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
              title={collapsed ? link.label : undefined}
            >
              <Icon size={18} class="nav-icon" />
              <span class="nav-label">{link.label}</span>
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
              title={collapsed ? link.label : undefined}
            >
              <Icon size={18} class="nav-icon" />
              <span class="nav-label">{link.label}</span>
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
              title={collapsed ? link.label : undefined}
            >
              <Icon size={18} class="nav-icon" />
              <span class="nav-label">{link.label}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </nav>

  <!-- Collapse toggle (desktop only) -->
  {#if onToggleCollapse}
    <button
      class="collapse-toggle"
      onclick={onToggleCollapse}
      aria-label={collapsed ? m.studio_sidebar_expand() : m.studio_sidebar_collapse()}
    >
      {#if collapsed}
        <ChevronsRightIcon size={16} />
      {:else}
        <ChevronsLeftIcon size={16} />
        <span class="collapse-label">{m.studio_sidebar_collapse()}</span>
      {/if}
    </button>
  {/if}

  <!-- Mobile footer (user section) -->
  {#if user}
    <div class="sidebar-footer">
      <div class="section-divider"></div>
      <a href="/" class="nav-item footer-link">
        <GlobeIcon size={18} />
        <span class="nav-label">{m.studio_view_public_site()}</span>
      </a>
      <div class="section-divider"></div>
      <div class="user-info">
        <span class="user-name">{user.name}</span>
        <span class="user-email">{user.email}</span>
      </div>
      <a href="/account" class="nav-item footer-link">
        <UserIcon size={18} />
        <span class="nav-label">{m.nav_account()}</span>
      </a>
      <button class="nav-item logout-item" onclick={() => submitFormPost('/logout')}>
        {m.nav_log_out()}
      </button>
    </div>
  {/if}
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
    display: flex;
    flex-direction: column;
    transition: width var(--duration-normal) var(--ease-default);
  }

  .sidebar-nav {
    display: flex;
    flex-direction: column;
    flex: 1;
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
    text-decoration: none;
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

  :global(.nav-icon) {
    flex-shrink: 0;
  }

  .nav-label {
    flex: 1;
    min-width: 0;
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

  /* Collapse toggle */
  .collapse-toggle {
    display: none;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .collapse-toggle:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  @media (--breakpoint-lg) {
    .collapse-toggle {
      display: flex;
    }
  }

  /* Collapsed mode */
  .sidebar[data-collapsed='true'] .nav-item {
    justify-content: center;
    padding: var(--space-2);
  }

  .sidebar[data-collapsed='true'] .nav-label,
  .sidebar[data-collapsed='true'] .section-label,
  .sidebar[data-collapsed='true'] .section-divider,
  .sidebar[data-collapsed='true'] .collapse-label {
    display: none;
  }

  .sidebar[data-collapsed='true'] .collapse-toggle {
    justify-content: center;
  }

  .sidebar[data-collapsed='true'] :global(.nav-badge) {
    min-width: var(--space-2);
    width: var(--space-2);
    height: var(--space-2);
    padding: 0;
    font-size: 0;
    position: absolute;
    top: var(--space-1);
    right: var(--space-1);
  }

  .sidebar[data-collapsed='true'] .nav-item {
    position: relative;
  }

  /* Mobile footer */
  .sidebar-footer {
    margin-top: auto;
    padding-bottom: var(--space-4);
  }

  .footer-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .user-info {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-6);
  }

  .user-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .user-email {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .logout-item {
    color: var(--color-error);
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    margin: 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .logout-item:hover {
    background-color: var(--color-error-50);
  }
</style>
