<!--
  @component StudioLayout (org context)

  Sidebar-only studio shell. The horizontal header has been retired — every
  piece of chrome it carried (org brand, studio switcher, auth/user menu)
  now lives inside the rail sidebar, which hover-expands on desktop and
  slides in as a drawer on mobile.

  @prop {LayoutData} data - Server-loaded org/role/orgs/badgeCounts/studioUser
  @prop {Snippet} children - Studio sub-route content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import StudioSidebar from '$lib/components/layout/StudioSidebar/StudioSidebar.svelte';
  import CommandPalette from '$lib/components/command-palette/CommandPalette.svelte';
  import type { LayoutData } from './$types';
  import { MenuIcon, XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  let mobileMenuOpen = $state(false);

  const closeMenu = () => (mobileMenuOpen = false);

  // Close drawer on route change
  $effect(() => {
    page.url.pathname;
    mobileMenuOpen = false;
  });

  // ESC-to-close on mobile
  $effect(() => {
    if (!mobileMenuOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  });

  const brand = $derived({
    name: data.org.name,
    imageUrl: data.org.logoUrl,
    initial: data.org.name[0],
  });

  const switcher = $derived({
    currentContext: 'org' as const,
    currentSlug: data.org.slug,
    orgs: data.orgs,
  });
</script>

<div class="studio-layout">
  <!-- Minimal mobile top bar — only renders on narrow viewports.
       Desktop is header-free (the rail absorbs all chrome). -->
  <header class="studio-topbar" aria-label="Studio">
    <button
      type="button"
      class="studio-topbar__menu"
      aria-label={m.studio_open_menu()}
      aria-expanded={mobileMenuOpen}
      aria-controls="studio-drawer"
      onclick={() => (mobileMenuOpen = true)}
    >
      <MenuIcon size={22} />
    </button>

    <a href="/studio" class="studio-topbar__brand">
      {#if data.org.logoUrl}
        <img src={data.org.logoUrl} alt="" class="studio-topbar__logo" />
      {/if}
      <span class="studio-topbar__name">{data.org.name}</span>
    </a>
  </header>

  <!-- Desktop rail — persists; hovers open -->
  <aside class="studio-layout__rail studio-layout__rail--desktop">
    <StudioSidebar
      role={data.userRole}
      context="org"
      user={data.studioUser}
      badgeCounts={data.badgeCounts}
      {brand}
      {switcher}
      mode="desktop"
    />
  </aside>

  <!-- Mobile drawer — fixed slide-in, fully expanded sidebar -->
  {#if mobileMenuOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="studio-drawer__scrim" role="presentation" onclick={closeMenu}></div>
  {/if}
  <aside
    id="studio-drawer"
    class="studio-layout__rail studio-layout__rail--mobile"
    class:studio-layout__rail--open={mobileMenuOpen}
    aria-hidden={!mobileMenuOpen}
  >
    <StudioSidebar
      role={data.userRole}
      context="org"
      user={data.studioUser}
      badgeCounts={data.badgeCounts}
      {brand}
      {switcher}
      mode="mobile"
    />
    <button
      type="button"
      class="studio-drawer__close"
      aria-label={m.studio_close_menu()}
      onclick={closeMenu}
    >
      <XIcon size={22} />
    </button>
  </aside>

  <main class="studio-layout__main">
    {@render children()}
  </main>
</div>

<!-- CommandPalette lives at layout root, independent of the chrome it used
     to live next to. Cmd/Ctrl-K hotkey is self-wired inside the component. -->
<CommandPalette orgSlug={data.org.slug} />

<style>
  .studio-layout {
    display: grid;
    grid-template-columns: var(--space-16) 1fr;
    grid-template-rows: 1fr;
    min-height: 100vh;
    background: color-mix(in srgb, var(--color-background) 80%, transparent);
    position: relative;
    z-index: 1;
  }

  /* Desktop rail occupies column 1; its width is fixed when collapsed, so
     content never reflows when the rail expands (glass overlay pattern). */
  .studio-layout__rail--desktop {
    grid-column: 1;
    grid-row: 1;
    position: sticky;
    top: 0;
    height: 100vh;
    z-index: var(--z-fixed);
  }

  .studio-layout__rail--desktop :global(.studio-rail) {
    position: absolute;
    inset: 0;
    height: 100%;
  }

  .studio-layout__main {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
    padding: var(--space-4);
    /* `clip` (Baseline Widely) clips horizontally without creating a
       scroll container. `overflow-x: hidden` would promote overflow-y
       to `auto` and break `position: sticky` on children that expect
       the window as their scroll container (e.g. ContentForm's command
       bar + section rail). See iter-11 fix notes. */
    overflow-x: clip;
  }

  @media (--breakpoint-md) {
    .studio-layout__main {
      padding: var(--space-6);
    }
  }

  /* ── Mobile-only top bar ───────────────────────────────────────── */
  .studio-topbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background-color: var(--color-surface);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    grid-column: 1 / -1;
    grid-row: 1;
  }

  /* Topbar stays above main on mobile; becomes grid row 1 alongside rail. */
  .studio-topbar {
    grid-column: 1 / -1;
  }

  .studio-topbar__menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .studio-topbar__menu:hover {
    background-color: var(--color-surface-secondary);
  }

  .studio-topbar__menu:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .studio-topbar__brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    color: var(--color-text);
    min-width: 0;
  }

  .studio-topbar__brand:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .studio-topbar__logo {
    height: var(--space-8);
    width: var(--space-8);
    object-fit: contain;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .studio-topbar__name {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Mobile drawer ─────────────────────────────────────────────── */
  .studio-layout__rail--mobile {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(320px /* px */, 85vw);
    z-index: var(--z-fixed);
    background-color: var(--color-surface);
    border-right: var(--border-width) var(--border-style) var(--color-border);
    transform: translateX(-100%);
    transition: transform var(--duration-slow) var(--ease-spring);
    overflow-y: auto;
  }

  .studio-layout__rail--mobile.studio-layout__rail--open {
    transform: translateX(0);
  }

  .studio-drawer__scrim {
    position: fixed;
    inset: 0;
    background-color: var(--color-overlay);
    z-index: calc(var(--z-fixed) - 1);
    animation: studio-scrim-in var(--duration-normal) var(--ease-default);
  }

  @keyframes studio-scrim-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .studio-drawer__close {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    width: var(--space-10);
    height: var(--space-10);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .studio-drawer__close:hover {
    background-color: var(--color-surface-secondary);
    color: var(--color-text);
  }

  .studio-drawer__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  @media (prefers-reduced-motion: reduce) {
    .studio-layout__rail--mobile {
      transition: transform var(--duration-fast) var(--ease-default);
    }
    .studio-drawer__scrim {
      animation: none;
    }
  }

  /* ── Viewport breakpoints ──────────────────────────────────────── */
  /* Below the desktop breakpoint, the rail is hidden, the top bar is
     visible, main spans both columns. */
  @media (--below-lg) {
    .studio-layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
    .studio-layout__rail--desktop {
      display: none;
    }
    .studio-layout__main {
      grid-column: 1;
      grid-row: 2;
    }
  }

  @media (--breakpoint-lg) {
    .studio-topbar {
      display: none;
    }
    .studio-layout__rail--mobile {
      display: none;
    }
    .studio-drawer__scrim {
      display: none;
    }
  }
</style>
