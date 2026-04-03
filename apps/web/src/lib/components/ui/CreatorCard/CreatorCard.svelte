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
  import { GlobeIcon, TwitterIcon, YoutubeIcon, InstagramIcon } from '$lib/components/ui/Icon';

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
          <GlobeIcon size={16} />
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
          <TwitterIcon size={16} />
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
          <YoutubeIcon size={16} />
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
          <InstagramIcon size={16} />
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
    color: var(--color-interactive);
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
    background: var(--color-surface);
    border-color: var(--color-border);
  }

  :global([data-theme='dark']) .creator-card:hover {
    border-color: var(--color-border-strong);
  }

  :global([data-theme='dark']) .creator-card__bio,
  :global([data-theme='dark']) .creator-card__count,
  :global([data-theme='dark']) .creator-card__social-link {
    color: var(--color-text-secondary);
  }

  :global([data-theme='dark']) .creator-card__name a:hover {
    color: var(--color-interactive);
  }

  :global([data-theme='dark']) .creator-card__social-link {
    background: var(--color-surface-variant);
  }

  :global([data-theme='dark']) .creator-card__social-link:hover {
    background: var(--color-neutral-800);
  }
</style>
