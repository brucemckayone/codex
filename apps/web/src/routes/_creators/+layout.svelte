<!--
  @component CreatorsLayout

  Layout shell for the creators subdomain (creators.revelations.studio).
  Provides a proper header with responsive nav, user menu, and footer.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { page } from '$app/state';
  import { buildPlatformUrl } from '$lib/utils/subdomain';
  import UserMenu from '$lib/components/layout/Header/UserMenu.svelte';
  import MobileNav from '$lib/components/layout/Header/MobileNav.svelte';
  import * as m from '$paraglide/messages';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  const navLinks = [
    { href: '/', label: 'Creators' },
    { href: buildPlatformUrl(page.url, '/discover'), label: 'Discover' },
    { href: buildPlatformUrl(page.url, '/library'), label: m.nav_library() },
  ];
</script>

<div class="creators-layout">
  <header class="creators-header">
    <div class="header-inner">
      <div class="header-left">
        <a href={buildPlatformUrl(page.url, '/')} class="logo">Revelations</a>

        <nav class="desktop-nav" aria-label="Creators navigation">
          {#each navLinks as link}
            <a href={link.href} class="nav-link">{link.label}</a>
          {/each}
        </nav>
      </div>

      <div class="header-right">
        <div class="desktop-user">
          <UserMenu user={data.user} />
        </div>
        <MobileNav variant="platform" user={data.user} links={navLinks} />
      </div>
    </div>
  </header>

  <main class="creators-main" id="main-content">
    {@render children()}
  </main>

  <footer class="creators-footer">
    <p>&copy; {new Date().getFullYear()} Revelations Studio. All rights reserved.</p>
  </footer>
</div>

<style>
  .creators-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
  }

  /* Header */
  .creators-header {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    background-color: var(--color-surface);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .header-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-3) var(--space-4);
    width: 100%;
  }

  @media (--breakpoint-md) {
    .header-inner {
      padding: var(--space-3) var(--space-6);
    }
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .logo {
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--color-text);
    text-decoration: none;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }

  .logo:hover {
    color: var(--color-interactive);
  }

  /* Desktop Nav */
  .desktop-nav {
    display: none;
    align-items: center;
    gap: var(--space-1);
  }

  @media (--breakpoint-md) {
    .desktop-nav {
      display: flex;
    }
  }

  .nav-link {
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .nav-link:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  /* Desktop user menu - hidden on mobile (MobileNav handles it) */
  .desktop-user {
    display: none;
  }

  @media (--breakpoint-md) {
    .desktop-user {
      display: flex;
    }
  }

  /* Main content */
  .creators-main {
    flex: 1;
  }

  /* Footer */
  .creators-footer {
    border-top: var(--border-width) var(--border-style) var(--color-border);
    padding: var(--space-6) var(--space-4);
    text-align: center;
  }

  .creators-footer p {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    margin: 0;
  }

  /* Dark mode */
  :global([data-theme='dark']) .creators-header {
    background-color: var(--color-surface);
    border-color: var(--color-border);
  }

  :global([data-theme='dark']) .logo {
    color: var(--color-text);
  }

  :global([data-theme='dark']) .nav-link {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .nav-link:hover {
    color: var(--color-text);
    background-color: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .creators-layout {
    background-color: var(--color-background);
  }

  :global([data-theme='dark']) .creators-footer {
    border-color: var(--color-border);
  }
</style>
