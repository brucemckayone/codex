<script lang="ts">
  import type { LayoutUser, LayoutOrganization } from '$lib/types';
  import { STUDIO_NAV } from '$lib/config/navigation';
  import { PageContainer } from '$lib/components/ui';
  import UserMenu from './UserMenu.svelte';
  import MobileNav from './MobileNav.svelte';
  import StudioSwitcher from '../StudioSidebar/StudioSwitcher.svelte';

  interface Props {
    user: LayoutUser | null;
    context: 'personal' | 'org';
    org?: LayoutOrganization;
    orgs?: LayoutOrganization[];
  }

  const { user, context, org, orgs = [] }: Props = $props();

  const studioLinks = STUDIO_NAV;
</script>

<header class="header">
  <PageContainer class="studio-header-inner">
    <div class="header-left">
      {#if context === 'org' && org}
        <a href="/studio/org/{org.slug}" class="context-brand">
          {#if org.logoUrl}
            <img src={org.logoUrl} alt="{org.name} logo" class="context-logo" />
          {/if}
          <span class="context-name">{org.name}</span>
        </a>
      {:else}
        <a href="/studio" class="context-brand">
          <span class="context-name">Studio</span>
        </a>
      {/if}

      <div class="desktop-only">
        <StudioSwitcher
          currentContext={context}
          {orgs}
        />
      </div>
    </div>

    <div class="header-actions">
      <div class="desktop-only">
        <UserMenu {user} />
      </div>
      <MobileNav variant="studio" {user} links={studioLinks} />
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

  :global(.studio-header-inner) {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .context-brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
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
