<script lang="ts">
  import type { LayoutUser } from '$lib/types';
  import { page } from '$app/state';
  import { submitFormPost } from '$lib/utils/navigation';
  import { buildCreatorsUrl, buildPlatformUrl } from '$lib/utils/subdomain';
  import { ChevronDownIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import Avatar from '$lib/components/ui/Avatar/Avatar.svelte';
  import AvatarImage from '$lib/components/ui/Avatar/AvatarImage.svelte';
  import AvatarFallback from '$lib/components/ui/Avatar/AvatarFallback.svelte';
  import DropdownMenu from '$lib/components/ui/DropdownMenu/DropdownMenu.svelte';
  import DropdownMenuTrigger from '$lib/components/ui/DropdownMenu/DropdownMenuTrigger.svelte';
  import DropdownMenuContent from '$lib/components/ui/DropdownMenu/DropdownMenuContent.svelte';
  import DropdownMenuItem from '$lib/components/ui/DropdownMenu/DropdownMenuItem.svelte';
  import DropdownMenuSeparator from '$lib/components/ui/DropdownMenu/DropdownMenuSeparator.svelte';

  interface Props {
    user: LayoutUser | null;
  }

  const { user }: Props = $props();

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
</script>

{#if user}
  <DropdownMenu>
    <DropdownMenuTrigger class="user-menu-trigger">
      <Avatar src={user.image} class="user-avatar">
        {#if user.image}
          <AvatarImage src={user.image} alt={user.name} />
        {/if}
        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
      </Avatar>
      <span class="user-name">{user.name}</span>
      <ChevronDownIcon size={16} class="chevron" />
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <div class="user-info">
        <span class="user-info-name">{user.name}</span>
        <span class="user-info-email">{user.email}</span>
      </div>
      <DropdownMenuSeparator />
      <a href={buildPlatformUrl(page.url, '/account')}>
        <DropdownMenuItem>{m.nav_account()}</DropdownMenuItem>
      </a>
      <a href={buildPlatformUrl(page.url, '/library')}>
        <DropdownMenuItem>{m.nav_library()}</DropdownMenuItem>
      </a>
      <a href={buildCreatorsUrl(page.url, '/studio')}>
        <DropdownMenuItem>{m.nav_studio()}</DropdownMenuItem>
      </a>
      <DropdownMenuSeparator />
      <button type="button" class="logout-button" onclick={() => submitFormPost('/logout')}>
        <DropdownMenuItem>{m.nav_log_out()}</DropdownMenuItem>
      </button>
    </DropdownMenuContent>
  </DropdownMenu>
{:else}
  <nav class="auth-links" aria-label="Account">
    <a href="/login" class="auth-link">{m.common_sign_in()}</a>
    <a href="/register" class="auth-link auth-link--register">{m.nav_register()}</a>
  </nav>
{/if}

<style>
  :global(.user-menu-trigger) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    color: var(--color-text);
  }

  :global(.user-menu-trigger:hover) {
    background-color: var(--color-surface-secondary);
  }

  :global(.user-avatar) {
    width: var(--space-8);
    height: var(--space-8);
  }

  .user-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    display: none;
  }

  @media (--breakpoint-md) {
    .user-name {
      display: inline;
    }
  }

  .chevron {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .user-info {
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .user-info-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .user-info-email {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .logout-button {
    width: 100%;
    padding: 0;
    text-align: left;
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
    transition: var(--transition-colors);
  }

  .auth-link:hover {
    color: var(--color-text);
  }

  .auth-link--register {
    padding: var(--space-1) var(--space-3);
    background-color: var(--color-interactive);
    color: var(--color-text-inverse);
    border-radius: var(--radius-md);
  }

  .auth-link--register:hover {
    background-color: var(--color-interactive-hover);
    color: var(--color-text-inverse);
  }
</style>
