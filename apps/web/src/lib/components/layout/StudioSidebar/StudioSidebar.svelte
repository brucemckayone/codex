<script lang="ts">
  import { page } from '$app/stores';
  import {
    SIDEBAR_BASE_LINKS,
    SIDEBAR_ADMIN_LINKS,
    SIDEBAR_OWNER_LINKS,
  } from '$lib/config/navigation';

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

  function isActive(href: string, currentPath: string): boolean {
    if (href === '/studio') {
      return currentPath === '/studio';
    }
    return currentPath.startsWith(href);
  }
</script>

<!-- TODO: Replace inline SVG icons with a shared icon system -->
<aside class="sidebar" aria-label="Studio navigation">
  <nav class="sidebar-nav">
    <ul class="nav-section" role="list">
      {#each baseLinks as link}
        <li>
          <a
            href={link.href}
            class="nav-item"
            class:active={isActive(link.href, $page.url.pathname)}
            aria-current={isActive(link.href, $page.url.pathname) ? 'page' : undefined}
          >
            <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              {#if link.icon === 'dashboard'}
                <rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>
              {:else if link.icon === 'content'}
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>
              {:else if link.icon === 'media'}
                <path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/>
              {:else if link.icon === 'analytics'}
                <path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>
              {/if}
            </svg>
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
          <li>
            <a
              href={link.href}
              class="nav-item"
              class:active={isActive(link.href, $page.url.pathname)}
              aria-current={isActive(link.href, $page.url.pathname) ? 'page' : undefined}
            >
              <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                {#if link.icon === 'team'}
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                {:else if link.icon === 'customers'}
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>
                {:else if link.icon === 'settings'}
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
                {/if}
              </svg>
              {link.label}
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    {#if isOwner}
      <div class="section-divider"></div>
      <span class="section-label">Owner</span>
      <ul class="nav-section" role="list">
        {#each ownerLinks as link}
          <li>
            <a
              href={link.href}
              class="nav-item"
              class:active={isActive(link.href, $page.url.pathname)}
              aria-current={isActive(link.href, $page.url.pathname) ? 'page' : undefined}
            >
              <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>
              </svg>
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
    width: 240px;
    height: 100%;
    background-color: var(--color-surface);
    border-right: var(--border-width) var(--border-style) var(--color-border);
    padding: var(--space-4) 0;
    flex-shrink: 0;
    overflow-y: auto;
    display: none;
  }

  @media (min-width: 768px) {
    .sidebar {
      display: block;
    }
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

  .nav-item.active {
    background-color: var(--color-primary-50);
    color: var(--color-primary-500);
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
