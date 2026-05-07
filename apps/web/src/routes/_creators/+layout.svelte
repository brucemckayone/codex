<!--
  @component CreatorsLayout

  Layout shell for the creators subdomain (creators.revelations.studio).
  Auth state is rendered inline (avatar dropdown / sign-in links) so this
  layout has no dependency on the legacy Header/UserMenu + Header/MobileNav
  components — those have been removed as part of the nav-redesign cleanup.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { page } from '$app/state';
  import { buildPlatformUrl } from '$lib/utils/subdomain';
  import { submitFormPost } from '$lib/utils/navigation';
  import { useStudioAccess } from '$lib/utils/studio-access.svelte';
  import { getInitials } from '$lib/utils/format';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
  import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
  import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
  import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
  import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';
  import * as m from '$paraglide/messages';

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  const isStudio = $derived(page.url.pathname.startsWith('/studio'));

  const navLinks = $derived([
    { href: '/', label: 'Creators' },
    { href: buildPlatformUrl(page.url, '/discover'), label: 'Discover' },
    { href: buildPlatformUrl(page.url, '/library'), label: m.nav_library() },
  ]);

  const studioAccess = useStudioAccess(() => ({ user: data.user, url: page.url }));
</script>

<div class="creators-layout">
  {#if !isStudio}
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
          {#if data.user}
            <DropdownMenu>
              <DropdownMenuTrigger class="user-trigger">
                <Avatar class="user-trigger__avatar">
                  {#if data.user.image}
                    <AvatarImage src={data.user.image} alt={data.user.name} />
                  {/if}
                  <AvatarFallback>{getInitials(data.user.name)}</AvatarFallback>
                </Avatar>
                <span class="user-trigger__name">{data.user.name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <div class="user-info">
                  <span class="user-info__name">{data.user.name}</span>
                  <span class="user-info__email">{data.user.email}</span>
                </div>
                <DropdownMenuSeparator />
                <a href={buildPlatformUrl(page.url, '/account')} class="menu-link">
                  <DropdownMenuItem>{m.nav_account()}</DropdownMenuItem>
                </a>
                <a href={buildPlatformUrl(page.url, '/library')} class="menu-link">
                  <DropdownMenuItem>{m.nav_library()}</DropdownMenuItem>
                </a>
                {#if studioAccess.canAccessStudio}
                  <a href={studioAccess.studioHref} class="menu-link">
                    <DropdownMenuItem>{m.nav_studio()}</DropdownMenuItem>
                  </a>
                {/if}
                <DropdownMenuSeparator />
                <button
                  type="button"
                  class="logout-btn"
                  onclick={() => submitFormPost('/logout')}
                >
                  <DropdownMenuItem>{m.nav_log_out()}</DropdownMenuItem>
                </button>
              </DropdownMenuContent>
            </DropdownMenu>
          {:else}
            <nav class="auth-links" aria-label="Account">
              <a href={buildPlatformUrl(page.url, '/login')} class="auth-link">
                {m.sidebar_sign_in()}
              </a>
              <a
                href={buildPlatformUrl(page.url, '/register')}
                class="auth-link auth-link--register"
              >
                {m.nav_register()}
              </a>
            </nav>
          {/if}
        </div>
      </div>
    </header>
  {/if}

  <main class="creators-main" id="main-content">
    {@render children()}
  </main>

  {#if !isStudio}
    <footer class="creators-footer">
      <p>&copy; {new Date().getFullYear()} Revelations Studio. All rights reserved.</p>
    </footer>
  {/if}
</div>

<style>
  .creators-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
  }

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
    max-width: var(--container-max);
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
    letter-spacing: var(--tracking-tight);
    white-space: nowrap;
  }

  .logo:hover {
    color: var(--color-interactive);
  }

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

  :global(.user-trigger) {
    display: flex !important;
    align-items: center !important;
    gap: var(--space-2) !important;
    padding: var(--space-1) var(--space-2) !important;
    border-radius: var(--radius-md) !important;
    transition: var(--transition-colors) !important;
    color: var(--color-text) !important;
    cursor: pointer !important;
  }

  :global(.user-trigger:hover) {
    background-color: var(--color-surface-secondary) !important;
  }

  :global(.user-trigger__avatar) {
    width: var(--space-8) !important;
    height: var(--space-8) !important;
    flex-shrink: 0 !important;
  }

  .user-trigger__name {
    display: none;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  @media (--breakpoint-md) {
    .user-trigger__name {
      display: inline;
    }
  }

  .user-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-2) var(--space-3);
  }

  .user-info__name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .user-info__email {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .menu-link {
    text-decoration: none;
    color: inherit;
  }

  .logout-btn {
    width: 100%;
    padding: 0;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
  }

  .auth-links {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .auth-link {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .auth-link:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .auth-link--register {
    background-color: var(--color-interactive);
    color: var(--color-on-interactive, var(--color-surface));
  }

  .auth-link--register:hover {
    background-color: color-mix(in oklch, var(--color-interactive) 88%, var(--color-text));
    color: var(--color-on-interactive, var(--color-surface));
  }

  .creators-main {
    flex: 1;
  }

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
</style>
