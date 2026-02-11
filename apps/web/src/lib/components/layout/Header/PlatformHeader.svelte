<script lang="ts">
  import type { LayoutUser } from '$lib/types';
  import { PLATFORM_NAV } from '$lib/config/navigation';
  import { PageContainer } from '$lib/components/ui';
  import UserMenu from './UserMenu.svelte';
  import MobileNav from './MobileNav.svelte';

  interface Props {
    user: LayoutUser | null;
  }

  const { user }: Props = $props();

  const navLinks = PLATFORM_NAV;
</script>

<header class="header">
  <PageContainer class="header-inner">
    <a href="/" class="logo">Codex</a>

    <nav class="desktop-nav" aria-label="Main">
      {#each navLinks as link}
        <a href={link.href} class="nav-link">{link.label}</a>
      {/each}
    </nav>

    <div class="header-actions">
      <div class="desktop-only">
        <UserMenu {user} />
      </div>
      <MobileNav variant="platform" {user} links={navLinks} />
    </div>
  </PageContainer>
</header>

<style>
  .header {
    height: var(--space-16);
    background-color: var(--color-surface);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    display: flex;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
  }

  :global(.header-inner) {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logo {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-primary-500);
    text-transform: lowercase;
    letter-spacing: var(--tracking-tight);
    flex-shrink: 0;
  }

  .desktop-nav {
    display: none;
    align-items: center;
    gap: var(--space-6);
  }

  @media (min-width: 768px) {
    .desktop-nav {
      display: flex;
    }
  }

  .nav-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .nav-link:hover {
    color: var(--color-text);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .desktop-only {
    display: none;
  }

  @media (min-width: 768px) {
    .desktop-only {
      display: contents;
    }
  }
</style>
