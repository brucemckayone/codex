<!--
  @component CreatorCard

  Displays a creator's profile with avatar, name, bio, and social links.
  Supports both default and compact variants.

  @prop {string} username - Creator's unique username
  @prop {string} displayName - Creator's display name
  @prop {string} avatar - Avatar image URL
  @prop {string} bio - Optional biography text
  @prop {number} contentCount - Number of content items
  @prop {{ website?: string; twitter?: string; youtube?: string; instagram?: string }} socialLinks - Social media links
  @prop {Snippet} actions - Action buttons snippet
  @prop {'default' | 'compact'} variant - Display variant
-->
<script lang="ts">
  import type { Snippet, HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { Avatar, AvatarImage, AvatarFallback } from '../Avatar';

  interface SocialLinks {
    website?: string;
    twitter?: string;
    youtube?: string;
    instagram?: string;
  }

  interface Props extends HTMLAttributes<HTMLDivElement> {
    username: string;
    displayName: string;
    avatar?: string | null;
    bio?: string | null;
    contentCount?: number;
    socialLinks?: SocialLinks | null;
    actions?: Snippet;
    variant?: 'default' | 'compact';
  }

  const {
    username,
    displayName,
    avatar,
    bio,
    contentCount,
    socialLinks,
    actions,
    variant = 'default',
    class: className,
    ...rest
  }: Props = $props();

  const profileHref = $derived(`/@${username}`);
  const initial = $derived(displayName.charAt(0).toUpperCase());
</script>

<div
  class="creator-card creator-card--{variant} {className ?? ''}"
  {...rest}
>
  <a href={profileHref} class="creator-card__link">
    <span class="sr-only">{m.creator_view_profile({ name: displayName })}</span>
  </a>

  <div class="creator-card__body">
    <a href={profileHref} class="creator-card__avatar-link">
      <Avatar src={avatar} class="creator-card__avatar-{variant === 'compact' ? 'md' : 'lg'}">
        {#if avatar}
          <AvatarImage src={avatar} alt={displayName} />
        {/if}
        <AvatarFallback>{initial}</AvatarFallback>
      </Avatar>
    </a>

    <div class="creator-card__info">
      <h3 class="creator-card__name">
        <a href={profileHref}>{displayName}</a>
      </h3>

      {#if variant === 'default' && bio}
        <p class="creator-card__bio">{bio}</p>
      {/if}

      {#if contentCount !== undefined}
        <p class="creator-card__count">
          {m.creator_content_count({ count: contentCount })}
        </p>
      {/if}
    </div>
  </div>

  {#if variant === 'default' && socialLinks && Object.keys(socialLinks).length > 0}
    <div class="creator-card__social">
      {#if socialLinks.website}
        <a
          href={socialLinks.website}
          target="_blank"
          rel="noopener noreferrer"
          class="creator-card__social-link"
          aria-label={m.creator_visit_website()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
          </svg>
        </a>
      {/if}

      {#if socialLinks.twitter}
        <a
          href={socialLinks.twitter}
          target="_blank"
          rel="noopener noreferrer"
          class="creator-card__social-link"
          aria-label={m.creator_visit_twitter()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2 0 1.6-1 3-2 4 .8.1 2-.2 2-.5-3.2 3.2-8 2-10.5-3C-.4 7.3 3.3 1.2 8.5 1c2.1-.1 4 1.2 5.5 1.2.8 0 2.2-1.2 3.5-1.5z"></path>
          </svg>
        </a>
      {/if}

      {#if socialLinks.youtube}
        <a
          href={socialLinks.youtube}
          target="_blank"
          rel="noopener noreferrer"
          class="creator-card__social-link"
          aria-label={m.creator_visit_youtube()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path>
            <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon>
          </svg>
        </a>
      {/if}

      {#if socialLinks.instagram}
        <a
          href={socialLinks.instagram}
          target="_blank"
          rel="noopener noreferrer"
          class="creator-card__social-link"
          aria-label={m.creator_visit_instagram()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
            <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
            <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
          </svg>
        </a>
      {/if}
    </div>
  {/if}

  {#if actions}
    <div class="creator-card__actions">{@render actions()}</div>
  {/if}
</div>

<style>
  .creator-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    transition: var(--transition-colors), var(--transition-shadow);
  }

  .creator-card:hover {
    border-color: var(--color-border-hover);
    box-shadow: var(--shadow-md);
  }

  .creator-card--compact {
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .creator-card__link {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .creator-card__body {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    flex: 1;
  }

  .creator-card--compact .creator-card__body {
    align-items: center;
  }

  .creator-card__avatar-link {
    position: relative;
    z-index: 2;
    flex-shrink: 0;
  }

  .creator-card__info {
    flex: 1;
    min-width: 0;
  }

  .creator-card__name {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
  }

  .creator-card--compact .creator-card__name {
    font-size: var(--text-sm);
  }

  .creator-card__name a {
    color: inherit;
    text-decoration: none;
    position: relative;
    z-index: 2;
  }

  .creator-card__name a:hover {
    color: var(--color-primary-500);
  }

  .creator-card__bio {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .creator-card__count {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }

  .creator-card__social {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .creator-card--compact .creator-card__social {
    margin-top: 0;
    margin-left: auto;
  }

  .creator-card__social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    transition: var(--transition-colors);
    position: relative;
    z-index: 2;
  }

  .creator-card__social-link:hover {
    color: var(--color-text);
    background: var(--color-surface-variant);
  }

  .creator-card__actions {
    margin-top: var(--space-3);
    display: flex;
    gap: var(--space-2);
  }

  .creator-card--compact .creator-card__actions {
    margin-top: 0;
  }

  /* Dark mode */
  :global([data-theme='dark']) .creator-card {
    background: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  :global([data-theme='dark']) .creator-card:hover {
    border-color: var(--color-border-hover-dark);
  }

  :global([data-theme='dark']) .creator-card__bio,
  :global([data-theme='dark']) .creator-card__count,
  :global([data-theme='dark']) .creator-card__social-link {
    color: var(--color-text-secondary-dark);
  }

  :global([data-theme='dark']) .creator-card__name a:hover {
    color: var(--color-primary-400);
  }

  :global([data-theme='dark']) .creator-card__social-link {
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .creator-card__social-link:hover {
    background: var(--color-neutral-800);
  }
</style>
