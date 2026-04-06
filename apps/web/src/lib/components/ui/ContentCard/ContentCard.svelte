<!--
  @component ContentCard

  Displays a content item with thumbnail, title, description, and creator info.
  Supports video, audio, and article content types with duration display.
  Optional progress bar overlay and price badge on the thumbnail.

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
  @prop {{ positionSeconds?: number; durationSeconds?: number; completed?: boolean; percentComplete?: number } | null} progress - Playback progress
  @prop {{ amount: number; currency: string } | null} price - Price info (null = hidden, amount 0 = Free)
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import * as m from '$paraglide/messages';
  import { getThumbnailSrcset, DEFAULT_SIZES } from '$lib/utils/image';
  import { formatDurationHuman } from '$lib/utils/format';
  import { calculateProgressPercent } from '$lib/utils/progress';
  import { Avatar, AvatarImage, AvatarFallback } from '../Avatar';
  import { Skeleton } from '../Skeleton';
  import { PriceBadge } from '../PriceBadge';
  import { PlayIcon, MusicIcon, FileTextIcon } from '$lib/components/ui/Icon';
  import { extractPlainText } from '$lib/editor/render';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    /** Card display variant. @default 'explore' */
    variant?: 'explore' | 'library' | 'featured' | 'compact';
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
    progress?: {
      positionSeconds?: number;
      durationSeconds?: number;
      completed?: boolean;
      percentComplete?: number;
    } | null;
    price?: {
      amount: number;
      currency: string;
    } | null;
    purchased?: boolean;
  }

  const {
    variant = 'explore',
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
    progress = null,
    price = null,
    purchased = false,
    class: className,
    ...rest
  }: Props = $props();

  const contentTypeLabels = {
    video: m.content_type_video(),
    audio: m.content_type_audio(),
    article: m.content_type_article(),
  };

  const profileHref = $derived(creator?.username ? `/@${creator.username}` : '#');

  const progressPercent = $derived(calculateProgressPercent(progress));

  const hasProgress = $derived(progress != null && (progress.completed || progressPercent > 0));
</script>

<article class="content-card {className ?? ''} {loading ? 'content-card--loading' : ''}" data-variant={variant} {...rest}>
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
          srcset={getThumbnailSrcset(thumbnail)}
          sizes={DEFAULT_SIZES}
          alt={m.content_thumbnail_alt({ title })}
          loading="lazy"
          class="content-card__image"
          onerror={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
        />
        <div class="content-card__placeholder hidden">
          {#if contentType === 'video'}
            <PlayIcon size={32} />
          {:else if contentType === 'audio'}
            <MusicIcon size={32} />
          {:else}
            <FileTextIcon size={32} />
          {/if}
        </div>
      {:else}
        <div class="content-card__placeholder">
          {#if contentType === 'video'}
            <PlayIcon size={32} />
          {:else if contentType === 'audio'}
            <MusicIcon size={32} />
          {:else}
            <FileTextIcon size={32} />
          {/if}
        </div>
      {/if}

      {#if duration}
        <span class="content-card__duration" aria-label="{m.content_duration()}: {formatDurationHuman(duration)}">
          {formatDurationHuman(duration)}
        </span>
      {/if}

      <span class="content-card__type-icon" aria-label={contentTypeLabels[contentType]}>
        {#if contentType === 'video'}
          <PlayIcon size={16} />
        {:else if contentType === 'audio'}
          <MusicIcon size={16} />
        {:else}
          <FileTextIcon size={16} />
        {/if}
      </span>

      {#if price != null || purchased}
        <PriceBadge
          amount={price?.amount ?? null}
          currency={price?.currency ?? 'GBP'}
          {purchased}
          class="content-card__price-badge"
        />
      {/if}

      {#if hasProgress}
        <div class="content-card__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
          <div class="content-card__progress-fill" style="width: {progressPercent}%"></div>
        </div>
      {/if}
    </div>

    <div class="content-card__body">
      <h3 class="content-card__title">
        <a href={href}>{title}</a>
      </h3>

      {#if description}
        <p class="content-card__description">{extractPlainText(description)}</p>
      {/if}

      {#if hasProgress}
        <p class="content-card__progress-text">
          {#if progress?.completed}
            {m.content_progress_completed()}
          {:else}
            {m.content_progress_percent({ percent: String(progressPercent) })}
          {/if}
        </p>
      {/if}

      {#if creator}
        <div class="content-card__creator">
          <a href={profileHref} class="content-card__creator-link">
            <Avatar src={creator.avatar} class="content-card__creator-avatar">
              <AvatarImage src={creator.avatar} alt={creator.displayName ?? 'Creator'} />
              <AvatarFallback>{creator.displayName?.charAt(0).toUpperCase() ?? '?'}</AvatarFallback>
            </Avatar>
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
    transition: var(--transition-colors), var(--transition-shadow), var(--transition-transform);
  }

  .content-card:hover,
  .content-card:focus-within {
    border-color: var(--color-border-hover);
    box-shadow: var(--shadow-lg);
    transform: scale(1.02);
    z-index: 1;
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
    background: var(--color-surface-secondary);
    overflow: hidden;
  }

  .content-card__thumbnail--skeleton {
    background: var(--color-surface);
  }

  .content-card__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .hidden {
    display: none;
  }

  .content-card__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
    background: var(--color-surface-secondary);
  }

  .content-card__duration {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-overlay);
    color: var(--color-text-inverse);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border-radius: var(--radius-sm);
  }

  .content-card__type-icon {
    position: absolute;
    bottom: var(--space-2);
    left: var(--space-2);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    background: var(--color-overlay);
    color: var(--color-text-inverse);
    border-radius: var(--radius-sm);
    line-height: 0;
  }

  /* Position PriceBadge within thumbnail */
  :global(.content-card__price-badge) {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    z-index: 1;
  }

  /* Progress bar */
  .content-card__progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--space-1);
    background: var(--color-overlay-light);
  }

  .content-card__progress-fill {
    height: 100%;
    background: var(--color-interactive);
    transition: width var(--duration-slow) var(--ease-default);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }

  /* Progress text */
  .content-card__progress-text {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-interactive);
    font-weight: var(--font-medium);
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
    line-height: var(--leading-normal);
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
    color: var(--color-interactive);
  }

  .content-card__description {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    line-height: var(--leading-normal);
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
    color: var(--color-interactive);
  }

  .content-card__creator-name {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  :global(.content-card__creator-avatar) {
    height: var(--space-6);
    width: var(--space-6);
    font-size: var(--text-xs);
  }

  .content-card__actions {
    padding: var(--space-3);
    padding-top: 0;
  }

  /* ── Variant: Library ── */
  .content-card[data-variant='library'] {
    flex-direction: row;
  }

  .content-card[data-variant='library'] .content-card__thumbnail {
    width: 180px;
    min-width: 180px;
    flex-shrink: 0;
  }

  .content-card[data-variant='library'] .content-card__body {
    flex: 1;
    min-width: 0;
  }

  .content-card[data-variant='library'] .content-card__description {
    display: none;
  }

  @media (--below-sm) {
    .content-card[data-variant='library'] {
      flex-direction: column;
    }

    .content-card[data-variant='library'] .content-card__thumbnail {
      width: 100%;
      min-width: 0;
    }
  }

  /* ── Variant: Featured ── */
  .content-card[data-variant='featured'] .content-card__thumbnail {
    aspect-ratio: 4 / 3;
  }

  .content-card[data-variant='featured'] .content-card__title {
    font-size: var(--text-lg);
  }

  /* ── Variant: Compact ── */
  .content-card[data-variant='compact'] {
    flex-direction: row;
    border: none;
    background: transparent;
    gap: var(--space-3);
  }

  .content-card[data-variant='compact'] .content-card__thumbnail {
    width: 120px;
    min-width: 120px;
    flex-shrink: 0;
    border-radius: var(--radius-md);
  }

  .content-card[data-variant='compact'] .content-card__body {
    padding: 0;
    gap: var(--space-1);
  }

  .content-card[data-variant='compact'] .content-card__title {
    font-size: var(--text-sm);
    -webkit-line-clamp: 1;
  }

  .content-card[data-variant='compact'] .content-card__description,
  .content-card[data-variant='compact'] .content-card__creator {
    display: none;
  }

</style>
