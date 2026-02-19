<!--
  @component ContentCard

  Displays a content item with thumbnail, title, description, and creator info.
  Supports video, audio, and article content types with duration display.

  @prop {string} id - Unique content identifier
  @prop {string} title - Content title
  @prop {string} thumbnail - Thumbnail image URL
  @prop {string} description - Optional content description
  @prop {'video' | 'audio' | 'article'} contentType - Type of content
  @prop {number} duration - Duration in seconds
  @prop {{ username?: string; displayName?: string; avatar?: string }} creator - Creator information
  @prop {Snippet} actions - Action buttons snippet
  @prop {string} href - Link URL
  @prop {boolean} loading - Show loading state
-->
<script lang="ts">
  import type { Snippet, HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { Avatar } from '../Avatar';
  import { Skeleton } from '../Skeleton';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    id: string;
    title: string;
    thumbnail?: string | null;
    description?: string | null;
    contentType?: 'video' | 'audio' | 'article';
    duration?: number | null;
    creator?: {
      username?: string;
      displayName?: string;
      avatar?: string | null;
    };
    actions?: Snippet;
    href?: string;
    loading?: boolean;
  }

  const {
    id,
    title,
    thumbnail,
    description,
    contentType = 'video',
    duration,
    creator,
    actions,
    href = '#',
    loading = false,
    class: className,
    ...rest
  }: Props = $props();

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  const contentTypeLabels = {
    video: m.content_type_video(),
    audio: m.content_type_audio(),
    article: m.content_type_article(),
  };

  const profileHref = $derived(creator?.username ? `/@${creator.username}` : '#');
</script>

<article class="content-card {className ?? ''} {loading ? 'content-card--loading' : ''}" {...rest}>
  {#if loading}
    <div class="content-card__thumbnail content-card__thumbnail--skeleton">
      <Skeleton height="100%" />
    </div>
    <div class="content-card__body">
      <Skeleton width="75%" height="1.5rem" />
      <Skeleton width="50%" height="1rem" />
      <Skeleton width="60%" height="1rem" />
    </div>
  {:else}
    <a href={href} class="content-card__link">
      <span class="sr-only">{m.content_view({ title })}</span>
    </a>

    <div class="content-card__thumbnail">
      {#if thumbnail}
        <img
          src={thumbnail}
          alt={m.content_thumbnail_alt({ title })}
          loading="lazy"
          class="content-card__image"
        />
      {:else}
        <div class="content-card__placeholder">
          {#if contentType === 'video'}
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          {:else if contentType === 'audio'}
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
          {/if}
        </div>
      {/if}

      {#if duration}
        <span class="content-card__duration" aria-label="{m.content_duration()}: {formatDuration(duration)}">
          {formatDuration(duration)}
        </span>
      {/if}

      <span class="content-card__type">{contentTypeLabels[contentType]}</span>
    </div>

    <div class="content-card__body">
      <h3 class="content-card__title">
        <a href={href}>{title}</a>
      </h3>

      {#if description}
        <p class="content-card__description">{description}</p>
      {/if}

      {#if creator}
        <div class="content-card__creator">
          <a href={profileHref} class="content-card__creator-link">
            <Avatar
              src={creator.avatar}
              fallback={creator.displayName?.charAt(0).toUpperCase() ?? '?'}
              size="sm"
            />
            <span class="content-card__creator-name">
              {creator.displayName ?? creator.username ?? '?'}
            </span>
          </a>
        </div>
      {/if}
    </div>

    {#if actions}
      <div class="content-card__actions">{@render actions()}</div>
    {/if}
  {/if}
</article>

<style>
  .content-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: var(--transition-colors), var(--transition-shadow);
  }

  .content-card:hover {
    border-color: var(--color-border-hover);
    box-shadow: var(--shadow-md);
  }

  .content-card--loading {
    pointer-events: none;
  }

  .content-card__link {
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

  .content-card__thumbnail {
    position: relative;
    aspect-ratio: 16 / 9;
    background: var(--color-neutral-100);
    overflow: hidden;
  }

  .content-card__thumbnail--skeleton {
    background: var(--color-neutral-50);
  }

  .content-card__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .content-card__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
    background: var(--color-neutral-100);
  }

  .content-card__duration {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: rgba(0, 0, 0, 0.75);
    color: #ffffff;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
  }

  .content-card__type {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: rgba(0, 0, 0, 0.6);
    color: #ffffff;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
    text-transform: uppercase;
  }

  .content-card__body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  .content-card__title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .content-card__title a {
    color: inherit;
    text-decoration: none;
    position: relative;
    z-index: 2;
  }

  .content-card__title a:hover {
    color: var(--color-primary-500);
  }

  .content-card__description {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .content-card__creator {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: auto;
  }

  .content-card__creator-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    text-decoration: none;
    position: relative;
    z-index: 2;
  }

  .content-card__creator-link:hover .content-card__creator-name {
    color: var(--color-primary-500);
  }

  .content-card__creator-name {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .content-card__actions {
    padding: var(--space-3);
    padding-top: 0;
  }

  /* Dark mode */
  [data-theme='dark'] .content-card {
    background: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }

  [data-theme='dark'] .content-card:hover {
    border-color: var(--color-border-hover-dark);
  }

  [data-theme='dark'] .content-card__placeholder {
    background: var(--color-neutral-800);
  }

  [data-theme='dark'] .content-card__description,
  [data-theme='dark'] .content-card__creator-name {
    color: var(--color-text-secondary-dark);
  }

  [data-theme='dark'] .content-card__title a:hover {
    color: var(--color-primary-400);
  }
</style>
