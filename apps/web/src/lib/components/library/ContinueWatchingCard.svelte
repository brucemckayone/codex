<!--
  @component ContinueWatchingCard

  Displays a single in-progress library item with thumbnail, progress bar, title,
  and "Resume from X:XX" text. Links to the content detail page.

  @prop {import('$lib/collections').LibraryItem} item - Library item with progress
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { LibraryItem } from '$lib/collections';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { formatDuration } from '$lib/utils/format';

  interface Props {
    item: LibraryItem;
  }

  const { item }: Props = $props();

  const progressPercent = $derived.by(() => {
    if (!item.progress) return 0;
    if (item.progress.percentComplete != null) return item.progress.percentComplete;
    if (item.progress.durationSeconds && item.progress.durationSeconds > 0) {
      return Math.round((item.progress.positionSeconds / item.progress.durationSeconds) * 100);
    }
    return 0;
  });

  const resumeTime = $derived(formatDuration(item.progress?.positionSeconds ?? 0));

  const href = $derived(buildContentUrl(page.url, item.content));
</script>

<a {href} class="cw-card">
  <div class="cw-card__thumb">
    {#if item.content.thumbnailUrl}
      <img
        src={item.content.thumbnailUrl}
        alt={item.content.title}
        class="cw-card__image"
        loading="lazy"
      />
    {:else}
      <div class="cw-card__placeholder">
        <PlayIcon size={24} />
      </div>
    {/if}

    <div class="cw-card__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
      <div class="cw-card__progress-fill" style="width: {progressPercent}%"></div>
    </div>
  </div>

  <div class="cw-card__body">
    <h3 class="cw-card__title">{item.content.title}</h3>
    <p class="cw-card__resume">{m.library_resume_from({ time: resumeTime })}</p>
  </div>
</a>

<style>
  .cw-card {
    display: block;
    min-width: 220px;
    max-width: 300px;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    overflow: hidden;
    text-decoration: none;
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    transition: var(--transition-transform), var(--transition-shadow);
    scroll-snap-align: start;
  }

  .cw-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .cw-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .cw-card__thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background-color: var(--color-neutral-100);
    overflow: hidden;
  }

  .cw-card__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cw-card__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-text-muted);
    background-color: var(--color-neutral-200);
  }

  .cw-card__progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: color-mix(in srgb, white 30%, transparent);
  }

  .cw-card__progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    transition: width var(--duration-slow) var(--ease-default);
    border-radius: 0 2px 2px 0;
  }

  .cw-card__body {
    padding: var(--space-3);
  }

  .cw-card__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cw-card:hover .cw-card__title {
    color: var(--color-interactive);
    transition: var(--transition-colors);
  }

  .cw-card__resume {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

</style>
