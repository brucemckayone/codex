<!--
  @component StudioLayout

  The main layout shell for the Studio interface within an organization context.
  Provides responsive navigation with a mobile header, collapsible sidebar,
  and main content area.

  @prop {LayoutData} data - Server-loaded data containing org info, user role, and organizations list
  @prop {Snippet} children - Child route content to render in the main area
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import StudioSidebar from '$lib/components/layout/StudioSidebar/StudioSidebar.svelte';
  import StudioSwitcher from '$lib/components/layout/StudioSidebar/StudioSwitcher.svelte';
  import type { LayoutData } from './$types';
  import { MenuIcon, XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  // Mobile menu state
  let mobileMenuOpen = $state(false);

  // Close menu handler for reuse
  const closeMenu = () => (mobileMenuOpen = false);

  // Close drawer on navigation (route change)
  $effect(() => {
    page.url.pathname;
    mobileMenuOpen = false;
  });

  // Keyboard handler: ESC key closes mobile menu
  $effect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        closeMenu();
      }
    };

    if (mobileMenuOpen) {
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  });
</script>

<!-- Child pages set their own titles -->

<div class="studio-layout">
  <!-- Mobile Header -->
  <header class="studio-header mobile">
    <div class="header-content">
      <button
        class="menu-toggle"
        aria-label={m.studio_toggle_menu()}
        aria-expanded={mobileMenuOpen}
        onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
      >
        <MenuIcon size={24} />
      </button>

      <a href="/studio" class="context-brand">
        {#if data.org.logoUrl}
          <img src={data.org.logoUrl} alt="{data.org.name} logo" class="context-logo" />
        {/if}
        <span class="context-name">{data.org.name}</span>
      </a>

      <StudioSwitcher
        currentContext="org"
        currentSlug={data.org.slug}
        orgs={data.orgs}
      />
    </div>
  </header>

  <!-- Desktop Header -->
  <header class="studio-header desktop">
    <a href="/studio" class="context-brand">
      {#if data.org.logoUrl}
        <img src={data.org.logoUrl} alt="{data.org.name} logo" class="context-logo" />
      {/if}
      <span class="context-name">{data.org.name}</span>
    </a>
    <StudioSwitcher
      currentContext="org"
      currentSlug={data.org.slug}
      orgs={data.orgs}
    />
  </header>

  <div class="studio-content">
    <!-- Overlay for mobile (outside aside so sidebar paints on top) -->
    {#if mobileMenuOpen}
      <div class="sidebar-overlay" onclick={closeMenu}></div>
    {/if}

    <!-- Sidebar -->
    <aside class="studio-sidebar" class:open={mobileMenuOpen}>
      <StudioSidebar role={data.userRole} context="org" />

      <!-- Mobile close button -->
      <button
        class="sidebar-close"
        aria-label={m.studio_close_menu()}
        onclick={closeMenu}
      >
        <XIcon size={24} />
      </button>
    </aside>

    <!-- Main Content -->
    <main class="studio-main">
      {@render children()}
    </main>
  </div>
</div>

<style>
  /* Layout structure */
  .studio-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
  }

  /* Mobile Header */
  .studio-header.mobile {
    display: flex;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  .studio-header.mobile .header-content {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .menu-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1-5);
    border: none;
    background: none;
    color: var(--color-text);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .menu-toggle:hover {
    background-color: var(--color-surface-secondary);
  }

  .context-brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    text-decoration: none;
  }

  .context-logo {
    height: var(--space-8);
    width: auto;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .context-name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
  }

  /* Desktop Header - hidden by default */
  .studio-header.desktop {
    display: none;
  }

  /* Content area */
  .studio-content {
    display: flex;
    flex: 1;
    position: relative;
  }

  /* Sidebar */
  .studio-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: var(--sidebar-width, 240px);
    background-color: var(--color-surface);
    border-right: var(--border-width) var(--border-style) var(--color-border);
    transform: translateX(-100%);
    transition: transform var(--transition-duration) var(--transition-timing);
    z-index: var(--z-fixed);
    overflow-y: auto;
  }

  .studio-sidebar.open {
    transform: translateX(0);
  }

  .sidebar-close {
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: var(--space-4);
    right: var(--space-4);
    padding: var(--space-1-5);
    border: none;
    background: none;
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .sidebar-close:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background-color: var(--color-overlay);
    z-index: calc(var(--z-fixed) - 1);
  }

  /* Main content */
  .studio-main {
    flex: 1;
    width: 100%;
    padding: var(--space-4) var(--space-4);
    overflow-y: auto;
  }

  /* Desktop breakpoint: aligns with --breakpoint-lg (1024px) for sidebar visibility */
  @media (--breakpoint-lg) {
    .studio-header.mobile {
      display: none;
    }

    .studio-header.desktop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) var(--space-6);
      border-bottom: var(--border-width) var(--border-style) var(--color-border);
      background-color: var(--color-surface);
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
    }

    .studio-sidebar {
      position: sticky;
      top: 0;
      height: calc(100vh - var(--space-16));
      transform: translateX(0);
      border-right: var(--border-width) var(--border-style) var(--color-border);
      z-index: auto;
    }

    .sidebar-close,
    .sidebar-overlay {
      display: none;
    }

    .studio-main {
      padding: var(--space-6);
    }
  }

  /* Dark mode overrides */
  :global([data-theme='dark']) .studio-layout {
    background-color: var(--color-background-dark);
  }

  :global([data-theme='dark']) .studio-header.mobile,
  :global([data-theme='dark']) .studio-header.desktop {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .studio-sidebar {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .menu-toggle:hover,
  :global([data-theme='dark']) .sidebar-close:hover {
    background-color: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .menu-toggle,
  :global([data-theme='dark']) .sidebar-close {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .context-name {
    color: var(--color-text-dark);
  }

  :global([data-theme='dark']) .sidebar-close {
    color: var(--color-text-muted-dark);
  }
</style>
