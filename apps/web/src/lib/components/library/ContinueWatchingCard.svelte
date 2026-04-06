<!--
  @component ContinueWatchingCard

  Displays a single in-progress library item with thumbnail, progress bar, title,
  and "Resume from X:XX" text. Links to the content detail page.

  @prop {import('$lib/collections').LibraryItem} item - Library item with progress
  @prop {'default' | 'large'} size - Card size variant. 'large' shows wider card, 2-line title, and Resume pill.
-->
<script lang="ts">
  import { page } from '$app/state';
  import type { LibraryItem } from '$lib/collections';
  import { PlayIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import { buildContentUrl } from '$lib/utils/subdomain';
  import { formatDuration } from '$lib/utils/format';
  import { calculateProgressPercent } from '$lib/utils/progress';

  interface Props {
    item: LibraryItem;
    size?: 'default' | 'large';
  }

  const { item, size = 'default' }: Props = $props();

  const progressPercent = $derived(calculateProgressPercent(item.progress));

  const resumeTime = $derived(formatDuration(item.progress?.positionSeconds ?? 0));

  const href = $derived(buildContentUrl(page.url, item.content));
</script>

<a {href} class="cw-card" class:cw-card--large={size === 'large'}>
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
    <p class="cw-card__resume-text">{m.library_resume_from({ time: resumeTime })}</p>
    {#if size === 'large'}
      <span class="cw-card__resume-btn">
        <PlayIcon size={14} />
        {m.library_resume()}
      </span>
    {/if}
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
    background-color: var(--color-surface-secondary);
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
    background-color: var(--color-surface-tertiary);
  }

  .cw-card__progress-track {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--space-1);
    background: color-mix(in srgb, white 30%, transparent);
  }

  .cw-card__progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    transition: width var(--duration-slow) var(--ease-default);
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
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

  .cw-card__resume-text {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* Large size variant */
  .cw-card--large {
    min-width: 280px;
    max-width: 400px;
  }

  .cw-card--large .cw-card__title {
    -webkit-line-clamp: 2;
  }

  .cw-card__resume-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background-color: transparent;
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-full);
    transition: var(--transition-colors);
  }

  .cw-card:hover .cw-card__resume-btn {
    background-color: var(--color-interactive);
    color: var(--color-text-inverse);
  }
</style>
