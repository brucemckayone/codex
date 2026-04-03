<!--
  @component CreatorStudioLayout

  The main layout shell for the personal Creator Studio.
  Provides responsive navigation with a mobile header, collapsible sidebar,
  and main content area. Mirrors the org studio layout but in personal context.

  @prop {LayoutData} data - Server-loaded data containing creator info and organizations list
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

      <StudioSwitcher
        currentContext="personal"
        orgs={data.orgs}
      />
    </div>
  </header>

  <!-- Desktop Header -->
  <header class="studio-header desktop">
    <StudioSwitcher
      currentContext="personal"
      orgs={data.orgs}
    />
  </header>

  <div class="studio-content">
    {#if mobileMenuOpen}
      <div class="sidebar-overlay" onclick={closeMenu}></div>
    {/if}

    <!-- Sidebar -->
    <aside class="studio-sidebar" class:open={mobileMenuOpen}>
      <StudioSidebar role="owner" context="personal" />

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
  .studio-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
  }

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

  .studio-header.desktop {
    display: none;
  }

  .studio-content {
    display: flex;
    flex: 1;
    position: relative;
  }

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

  .studio-main {
    flex: 1;
    width: 100%;
    padding: var(--space-4) var(--space-4);
    overflow-y: auto;
  }

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
</style>
