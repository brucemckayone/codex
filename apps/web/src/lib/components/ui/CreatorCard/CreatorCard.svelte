<!--
  @component CreatorCard

  Displays a creator's profile. Three variants:
  - default: horizontal card with avatar, name, bio, social links
  - compact: minimal row layout for lists
  - showcase: photo-dominant portrait card for creator directories

  @prop {string} username - Creator's unique username
  @prop {string} displayName - Creator's display name
  @prop {string} avatar - Avatar image URL (lg variant used for showcase photo)
  @prop {string} bio - Optional biography text
  @prop {number} contentCount - Number of content items
  @prop {{ website?: string; twitter?: string; youtube?: string; instagram?: string }} socialLinks - Social media links
  @prop {Snippet} actions - Action buttons snippet
  @prop {'default' | 'compact' | 'showcase'} variant - Display variant
  @prop {() => void} onclick - Click handler (showcase: opens drawer)
-->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import type { ContentItem, SocialLinks } from './types';
  import * as m from '$paraglide/messages';
  import { Avatar, AvatarImage, AvatarFallback } from '../Avatar';
  import {
    GlobeIcon,
    TwitterIcon,
    YoutubeIcon,
    InstagramIcon,
    FilmIcon,
    MicIcon,
    FileTextIcon,
  } from '$lib/components/ui/Icon';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    username: string;
    displayName: string;
    avatar?: string | null;
    bio?: string | null;
    contentCount?: number;
    /** Creator's role in the org — 'owner' gets featured treatment */
    role?: string;
    socialLinks?: SocialLinks | null;
    /** Recent content items (showcase: shown as thumbnail strip on card) */
    recentContent?: ContentItem[];
    /** Override profile link URL (for cross-subdomain navigation) */
    profileUrl?: string;
    /** Click handler — used by showcase variant to open drawer */
    onclick?: () => void;
    actions?: Snippet;
    variant?: 'default' | 'compact' | 'showcase';
  }

  const {
    username,
    displayName,
    avatar,
    bio,
    contentCount,
    role,
    socialLinks,
    recentContent = [],
    profileUrl,
    onclick,
    actions,
    variant = 'default',
    class: className,
    ...rest
  }: Props = $props();

  const profileHref = $derived(profileUrl ?? `/@${username}`);
  const initial = $derived(displayName.charAt(0).toUpperCase());
  const isOwner = $derived(role === 'owner');

  /** Content type breakdown from recentContent for type icons */
  const contentTypes = $derived.by(() => {
    if (!recentContent.length) return [];
    const counts = new Map<string, number>();
    // Use recentContent to infer types, but base on total contentCount
    for (const item of recentContent) {
      counts.set(item.contentType, (counts.get(item.contentType) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
  });

  /** Up to 3 thumbnails for the card surface */
  const cardThumbnails = $derived(
    recentContent
      .filter((item) => item.thumbnailUrl)
      .slice(0, 3)
  );
</script>

{#if variant === 'showcase'}
  <!-- ══════════════════════════════════════════════════════════
       SHOWCASE: Soft padded card with photo, details, thumbnails
       ══════════════════════════════════════════════════════════ -->
  <button
    type="button"
    class="showcase {className ?? ''}"
    class:showcase--featured={isOwner}
    onclick={onclick}
  >
    <!-- Photo area (3:4 portrait) -->
    <div class="showcase__photo">
      {#if avatar}
        <img
          src={avatar}
          alt={displayName}
          class="showcase__photo-img"
          loading="lazy"
          decoding="async"
        />
      {:else}
        <div class="showcase__photo-fallback">
          <span class="showcase__photo-initial">{initial}</span>
        </div>
      {/if}
    </div>

    <!-- Details below photo -->
    <div class="showcase__details">
      <h3 class="showcase__name">{displayName}</h3>

      {#if username}
        <p class="showcase__username">@{username}</p>
      {/if}

      {#if bio}
        <p class="showcase__bio">{bio}</p>
      {/if}

      <!-- Content type breakdown with icons -->
      {#if contentTypes.length > 0}
        <div class="showcase__types">
          {#each contentTypes as { type, count } (type)}
            <span class="showcase__type-badge">
              {#if type === 'video'}
                <FilmIcon size={12} />
              {:else if type === 'audio'}
                <MicIcon size={12} />
              {:else}
                <FileTextIcon size={12} />
              {/if}
              {count}
            </span>
          {/each}
        </div>
      {:else if contentCount !== undefined && contentCount > 0}
        <p class="showcase__count">{m.creator_content_count({ count: contentCount })}</p>
      {/if}
    </div>

    <!-- Content thumbnails strip -->
    {#if cardThumbnails.length > 0}
      <div class="showcase__thumbs">
        {#each cardThumbnails as item (item.slug)}
          <img
            src={item.thumbnailUrl}
            alt=""
            class="showcase__thumb"
            loading="lazy"
            decoding="async"
          />
        {/each}
      </div>
    {/if}
  </button>

{:else}
  <!-- ══════════════════════════════════════════════════════════
       DEFAULT / COMPACT: Standard card variants
       ══════════════════════════════════════════════════════════ -->
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
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════
     SHOWCASE VARIANT — Soft, padded portrait card
     Photo inset with rounded corners, soft background tint
     ═══════════════════════════════════════════════════════════ */
  .showcase {
    display: flex;
    flex-direction: column;
    background: var(--color-surface-secondary);
    border-radius: var(--radius-xl);
    cursor: pointer;
    padding: var(--space-3);
    text-align: left;
    font: inherit;
    color: inherit;
    border: none;
    width: 100%;
    gap: var(--space-4);
    transition:
      box-shadow var(--duration-normal) var(--ease-default),
      transform var(--duration-normal) var(--ease-default);
  }

  .showcase:hover {
    box-shadow: var(--shadow-lg);
    transform: translateY(calc(-1 * var(--space-0-5)));
  }

  .showcase:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* ── Photo area — inset with rounded corners ── */
  .showcase__photo {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }

  .showcase__photo-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center 20%;
    transition: transform var(--duration-slow) var(--ease-default);
  }

  .showcase:hover .showcase__photo-img {
    transform: scale(1.03);
  }

  .showcase__photo-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface);
  }

  .showcase__photo-initial {
    font-size: var(--text-4xl);
    font-weight: var(--font-bold);
    color: var(--color-text-muted);
    user-select: none;
    opacity: var(--opacity-30, 0.3);
  }

  /* ── Details — below photo, inside the padded card ── */
  .showcase__details {
    padding: 0 var(--space-2) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .showcase__name {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  .showcase__meta {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    flex-wrap: wrap;
  }

  .showcase__username {
    color: var(--color-text-secondary);
  }

  .showcase__dot {
    font-size: var(--text-xs);
  }

  .showcase__bio {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .showcase__count {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Content type badges ── */
  .showcase__types {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-2);
    flex-wrap: wrap;
  }

  .showcase__type-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    background: var(--color-surface);
    border-radius: var(--radius-full);
  }

  /* ── Content thumbnail strip ── */
  .showcase__thumbs {
    display: flex;
    gap: var(--space-1-5);
    padding: 0 var(--space-2) var(--space-1);
  }

  .showcase__thumb {
    flex: 1;
    min-width: 0;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  /* ── Featured owner card ── */
  .showcase--featured {
    border: var(--border-width) var(--border-style) var(--color-brand-primary-subtle, var(--color-border));
  }

  .showcase--featured .showcase__photo {
    aspect-ratio: 4 / 5;
  }

  /* ═══════════════════════════════════════════════════════════
     DEFAULT / COMPACT VARIANTS — Standard card
     ═══════════════════════════════════════════════════════════ */
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
    line-height: var(--leading-normal);
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
</style>
