<!--
  @component LibraryCard

  Progress-focused card for library context. Shows progress bar overlay,
  time remaining or completion state, and NO price (user already owns it).
  Replaces the inline card markup previously duplicated in both library pages.

  @prop {import('$lib/collections').LibraryItem} item - Library item with content and progress
  @prop {string} href - Link to content detail page
-->
<script lang="ts">
  import type { LibraryItem } from '$lib/collections';
  import { PlayIcon, MusicIcon, FileTextIcon, CheckIcon } from '$lib/components/ui/Icon';
  import { formatDurationHuman } from '$lib/utils/format';
  import * as m from '$paraglide/messages';

  interface Props {
    item: LibraryItem;
    href: string;
  }

  const { item, href }: Props = $props();

  const progressPercent = $derived.by(() => {
    if (!item.progress) return 0;
    if (item.progress.completed) return 100;
    if (item.progress.percentComplete != null) return item.progress.percentComplete;
    if (item.progress.durationSeconds > 0) {
      return Math.round((item.progress.positionSeconds / item.progress.durationSeconds) * 100);
    }
    return 0;
  });

  const timeRemaining = $derived.by(() => {
    if (!item.progress || item.progress.completed) return null;
    const remaining = item.progress.durationSeconds - item.progress.positionSeconds;
    if (remaining <= 0) return null;
    return formatDurationHuman(remaining);
  });

  const isCompleted = $derived(item.progress?.completed ?? false);
  const hasStarted = $derived(
    item.progress != null && item.progress.positionSeconds > 0
  );

  const contentTypeLabel = $derived.by(() => {
    switch (item.content.contentType) {
      case 'video': return m.content_type_video();
      case 'audio': return m.content_type_audio();
      case 'article': return m.content_type_article();
      default: return item.content.contentType;
    }
  });
</script>

<a {href} class="library-card">
  <div class="library-card__thumb">
    {#if item.content.thumbnailUrl}
      <img
        src={item.content.thumbnailUrl}
        alt={item.content.title}
        class="library-card__image"
        loading="lazy"
        onerror={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    {:else}
      <div class="library-card__placeholder">
        {#if item.content.contentType === 'video'}
          <PlayIcon size={32} />
        {:else if item.content.contentType === 'audio'}
          <MusicIcon size={32} />
        {:else}
          <FileTextIcon size={32} />
        {/if}
      </div>
    {/if}

    {#if hasStarted || isCompleted}
      <div
        class="library-card__progress-track"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          class="library-card__progress-fill"
          class:library-card__progress-fill--completed={isCompleted}
          style="width: {progressPercent}%"
        ></div>
      </div>
    {/if}
  </div>

  <div class="library-card__body">
    <h3 class="library-card__title">{item.content.title}</h3>

    <div class="library-card__meta">
      <span class="library-card__type-duration">
        {contentTypeLabel}
        {#if item.content.durationSeconds}
          · {formatDurationHuman(item.content.durationSeconds)}
        {/if}
      </span>
    </div>

    {#if isCompleted}
      <div class="library-card__progress-status library-card__progress-status--completed">
        <CheckIcon size={14} />
        {m.content_progress_completed()}
      </div>
    {:else if hasStarted}
      <div class="library-card__progress-status">
        {m.content_progress_percent({ percent: progressPercent })}
        {#if timeRemaining}
          · {m.library_time_remaining({ time: timeRemaining })}
        {/if}
      </div>
    {/if}
  </div>
</a>

<style>
  .library-card {
    display: block;
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
    text-decoration: none;
    border: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-transform), var(--transition-shadow);
  }

  .library-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .library-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .library-card__thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background-color: var(--color-surface-secondary);
    overflow: hidden;
  }

  .library-card__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .library-card__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
    background-color: var(--color-surface-tertiary);
  }

  .library-card__progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--space-1);
    background: var(--color-overlay-light);
  }

  .library-card__progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    transition: width var(--duration-slow) var(--ease-default);
  }

  .library-card__progress-fill--completed {
    background-color: var(--color-success);
  }

  .library-card__body {
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .library-card__title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .library-card:hover .library-card__title {
    color: var(--color-interactive);
    transition: var(--transition-colors);
  }

  .library-card__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .library-card__type-duration {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .library-card__progress-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .library-card__progress-status--completed {
    color: var(--color-success);
  }
</style>
