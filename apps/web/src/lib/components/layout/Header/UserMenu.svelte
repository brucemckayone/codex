<script lang="ts">
  import type { LayoutUser } from '$lib/types';
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
      <svg class="chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <div class="user-info">
        <span class="user-info-name">{user.name}</span>
        <span class="user-info-email">{user.email}</span>
      </div>
      <DropdownMenuSeparator />
      <a href="/account">
        <DropdownMenuItem>Account</DropdownMenuItem>
      </a>
      <a href="/library">
        <DropdownMenuItem>Library</DropdownMenuItem>
      </a>
      <a href="/studio">
        <DropdownMenuItem>Studio</DropdownMenuItem>
      </a>
      <DropdownMenuSeparator />
      <form method="POST" action="/logout">
        <button type="submit" class="logout-button">
          <DropdownMenuItem>Log out</DropdownMenuItem>
        </button>
      </form>
    </DropdownMenuContent>
  </DropdownMenu>
{:else}
  <nav class="auth-links" aria-label="Account">
    <a href="/login" class="auth-link">Sign In</a>
    <a href="/register" class="auth-link auth-link--register">Register</a>
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

  @media (min-width: 768px) {
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
    background-color: var(--color-primary-500);
    color: var(--color-text-inverse);
    border-radius: var(--radius-md);
  }

  .auth-link--register:hover {
    background-color: var(--color-primary-600);
    color: var(--color-text-inverse);
  }
</style>
