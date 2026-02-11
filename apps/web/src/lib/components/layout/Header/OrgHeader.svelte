<script lang="ts">
  import type { LayoutUser, LayoutOrganization } from '$lib/types';
  import { getOrgNav } from '$lib/config/navigation';
  import { PageContainer } from '$lib/components/ui';
  import UserMenu from './UserMenu.svelte';
  import MobileNav from './MobileNav.svelte';

  interface Props {
    user: LayoutUser | null;
    org: LayoutOrganization;
  }

  const { user, org }: Props = $props();

  const navLinks = $derived(getOrgNav(org.slug));
</script>

<header class="header">
  <PageContainer class="header-inner">
    <a href="/{org.slug}" class="org-brand">
      {#if org.logoUrl}
        <img src={org.logoUrl} alt="{org.name} logo" class="org-logo" />
      {/if}
      <span class="org-name">{org.name}</span>
    </a>

    <nav class="desktop-nav" aria-label="Organization">
      {#each navLinks as link}
        <a href={link.href} class="nav-link">{link.label}</a>
      {/each}
    </nav>

    <div class="header-actions">
      <div class="desktop-only">
        <UserMenu {user} />
      </div>
      <MobileNav variant="org" {user} links={navLinks} />
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

  .org-brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .org-logo {
    height: var(--space-8);
    width: auto;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .org-name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--color-text);
    letter-spacing: var(--tracking-tight);
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
