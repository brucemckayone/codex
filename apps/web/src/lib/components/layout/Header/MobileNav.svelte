<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutUser } from '$lib/types';
  import type { NavLink } from '$lib/config/navigation';
  import { page } from '$app/state';
  import { submitFormPost } from '$lib/utils/navigation';
  import { XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  interface Props {
    variant: 'platform' | 'org' | 'studio';
    user: LayoutUser | null;
    links: NavLink[];
    actions?: Snippet;
  }

  const { variant, user, links, actions }: Props = $props();

  let open = $state(false);

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }

  function isActive(href: string): boolean {
    const pathname = page.url.pathname;
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

<button
  class="hamburger"
  onclick={toggle}
  aria-label={open ? m.nav_close_menu() : m.nav_open_menu()}
  aria-expanded={open}
  aria-controls="mobile-nav"
>
  <span class="hamburger-line" class:open></span>
  <span class="hamburger-line" class:open></span>
  <span class="hamburger-line" class:open></span>
</button>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={close} aria-hidden="true"></div>

  <nav id="mobile-nav" class="drawer" aria-label="Mobile navigation">
    <div class="drawer-header">
      <button class="close-button" onclick={close} aria-label={m.nav_close_menu()}>
        <XIcon size={24} />
      </button>
    </div>

    <ul class="nav-list" role="list">
      {#each links as link}
        <li>
          <a
            href={link.href}
            class="nav-item"
            class:nav-item--active={isActive(link.href)}
            aria-current={isActive(link.href) ? 'page' : undefined}
            onclick={close}
          >
            {link.label}
          </a>
        </li>
      {/each}
    </ul>

    {#if actions}
      <div class="drawer-actions">
        {@render actions()}
      </div>
    {/if}

    <div class="drawer-footer">
      {#if user}
        <div class="user-section">
          <span class="user-name">{user.name}</span>
          <span class="user-email">{user.email}</span>
        </div>
        <a href="/account" class="nav-item" onclick={close}>{m.nav_account()}</a>
        {#if variant === 'org'}
          <a href="/studio" class="nav-item" onclick={close}>{m.nav_studio()}</a>
        {/if}
        <button type="button" class="nav-item logout-item" onclick={() => submitFormPost('/logout')}>{m.nav_log_out()}</button>
      {:else}
        <a href="/login" class="nav-item" onclick={close}>{m.common_sign_in()}</a>
        <a href="/register" class="nav-item" onclick={close}>{m.nav_register()}</a>
      {/if}
    </div>
  </nav>
{/if}

<style>
  .hamburger {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    width: var(--space-10);
    height: var(--space-10);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
  }

  .hamburger:hover {
    background-color: var(--color-surface-secondary);
  }

  @media (--breakpoint-md) {
    .hamburger {
      display: none;
    }
  }

  .hamburger-line {
    display: block;
    width: 100%;
    height: var(--border-width-thick);
    background-color: var(--color-text);
    border-radius: var(--radius-xs);
    transition: transform var(--duration-normal) var(--ease-default),
                opacity var(--duration-normal) var(--ease-default);
    transform-origin: center;
  }

  .hamburger-line.open:nth-child(1) {
    transform: translateY(7px) rotate(45deg);
  }

  .hamburger-line.open:nth-child(2) {
    opacity: 0;
  }

  .hamburger-line.open:nth-child(3) {
    transform: translateY(-7px) rotate(-45deg);
  }

  .overlay {
    position: fixed;
    inset: 0;
    background-color: var(--color-surface-overlay);
    z-index: var(--z-modal-backdrop);
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(320px, 85vw);
    background-color: var(--color-surface);
    z-index: var(--z-modal);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    box-shadow: var(--shadow-xl);
  }

  @media (--breakpoint-md) {
    .overlay,
    .drawer {
      display: none;
    }
  }

  .drawer-header {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .close-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-10);
    height: var(--space-10);
    border-radius: var(--radius-md);
    color: var(--color-text);
    transition: var(--transition-colors);
  }

  .close-button:hover {
    background-color: var(--color-surface-secondary);
  }

  .nav-list {
    list-style: none;
    padding: var(--space-4);
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .nav-item {
    display: block;
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--color-text);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    width: 100%;
    text-align: left;
  }

  .nav-item:hover {
    background-color: var(--color-surface-secondary);
  }

  .nav-item--active {
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive);
  }

  .drawer-actions {
    padding: 0 var(--space-4);
  }

  .drawer-footer {
    margin-top: auto;
    padding: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .user-section {
    display: flex;
    flex-direction: column;
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-2);
  }

  .user-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .user-email {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .logout-item {
    color: var(--color-error);
  }

  .logout-item:hover {
    background-color: var(--color-error-50);
  }
</style>
