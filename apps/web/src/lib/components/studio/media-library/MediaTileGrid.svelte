<!--
  @component MediaTileGrid

  Responsive grid of MediaTile cards plus optional ghost tiles for files
  currently being uploaded. Ghost tiles appear at the top of the grid so
  the creator sees exactly where an in-flight item will land.

  The grid uses `auto-fill, minmax(var(--tile-min), 1fr)` — tiles stay
  large on wide screens and reflow gracefully on narrow ones without a
  hardcoded column count.

  @prop items             Ready items from the server (ordinal ordering preserved)
  @prop ghosts            Optional in-flight upload ghosts (0..MAX_CONCURRENT+)
  @prop startOrdinal      Base for ordinal numbering (1 on page 1, >1 later)
  @prop onEdit / onDelete Tile-level callbacks
-->
<script lang="ts">
  import type { MediaItemWithRelations } from '$lib/types';
  import MediaTile from './MediaTile.svelte';
  import { FilmIcon, MusicIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

  type MediaTileItem = MediaItemWithRelations & { thumbnailUrl?: string | null };

  export type UploadGhost = {
    /** Stable key for {#each} — parent owns (e.g. file.name + index) */
    key: string;
    /** Display name for the ghost tile */
    name: string;
    /** Media kind (drives icon in placeholder) */
    mediaType: 'video' | 'audio';
    /** Upload progress, 0..100 */
    progress: number;
    /** Upload lifecycle status */
    status: 'queued' | 'uploading' | 'completing' | 'done' | 'error';
  };

  interface Props {
    items: MediaTileItem[];
    ghosts?: UploadGhost[];
    startOrdinal?: number;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  }

  const { items, ghosts = [], startOrdinal = 1, onEdit, onDelete }: Props = $props();

  const activeGhosts = $derived(ghosts.filter((g) => g.status !== 'done'));
</script>

<div class="tile-grid" role="list">
  {#each activeGhosts as ghost (ghost.key)}
    <div role="listitem" class="ghost-tile" data-status={ghost.status}>
      <div class="ghost-thumb">
        <span class="ghost-placeholder" aria-hidden="true">
          {#if ghost.mediaType === 'video'}
            <FilmIcon size={36} />
          {:else}
            <MusicIcon size={36} />
          {/if}
        </span>
        <span class="ghost-ordinal" aria-hidden="true">···</span>
        <div class="ghost-progress" role="progressbar"
          aria-valuenow={ghost.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Uploading {ghost.name}"
        >
          <div class="ghost-progress-meta">
            <span class="ghost-progress-step">
              {#if ghost.status === 'completing'}
                {m.media_status_processing()}
              {:else if ghost.status === 'error'}
                {m.media_status_failed()}
              {:else}
                {m.media_status_uploading()}
              {/if}
            </span>
            <span class="ghost-progress-pct">{ghost.progress}%</span>
          </div>
          <div class="ghost-progress-bar">
            <div
              class="ghost-progress-fill"
              style="width: {ghost.progress}%"
            ></div>
          </div>
        </div>
      </div>
      <div class="ghost-body">
        <p class="ghost-name" title={ghost.name}>{ghost.name}</p>
      </div>
    </div>
  {/each}

  {#each items as media, index (media.id)}
    <div role="listitem">
      <MediaTile
        ordinal={String(startOrdinal + index).padStart(2, '0')}
        {media}
        {onEdit}
        {onDelete}
      />
    </div>
  {/each}
</div>

<style>
  .tile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-min, 18rem), 1fr));
    gap: var(--space-4) var(--space-3);
    align-items: start;
  }

  @media (--below-md) {
    .tile-grid {
      --tile-min: 15rem;
      gap: var(--space-4) var(--space-2);
    }
  }

  @media (--below-sm) {
    .tile-grid {
      --tile-min: 100%;
    }
  }

  /* ── Ghost tile (in-flight upload) ────────────────────── */
  .ghost-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-lg);
    border: var(--border-width) var(--border-style-dashed, dashed)
      color-mix(in srgb, var(--color-interactive) 40%, transparent);
    background: color-mix(in srgb, var(--color-interactive-subtle) 60%, transparent);
  }

  .ghost-thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-md);
    overflow: hidden;
    background:
      repeating-linear-gradient(
        135deg,
        color-mix(in srgb, var(--color-interactive) 8%, var(--color-surface-secondary)) 0,
        color-mix(in srgb, var(--color-interactive) 8%, var(--color-surface-secondary)) 8px,
        var(--color-surface-secondary) 8px,
        var(--color-surface-secondary) 16px
      );
  }

  .ghost-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: color-mix(in srgb, var(--color-interactive) 70%, var(--color-text-muted));
    opacity: var(--opacity-60, 0.6);
  }

  .ghost-ordinal {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    display: inline-flex;
    padding: 2px var(--space-2);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-muted);
    background: color-mix(in srgb, var(--color-surface) 82%, transparent);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
    border-radius: var(--radius-full, 9999px);
  }

  .ghost-progress {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-2-5);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    backdrop-filter: blur(var(--blur-lg, 12px));
    -webkit-backdrop-filter: blur(var(--blur-lg, 12px));
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 60%, transparent);
  }

  .ghost-progress-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }

  .ghost-progress-step {
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .ghost-tile[data-status='error'] .ghost-progress-step {
    color: var(--color-error-700);
  }

  .ghost-progress-pct {
    font-family: var(--font-mono);
    font-feature-settings: 'tnum', 'zero';
    font-variant-numeric: tabular-nums slashed-zero;
    color: var(--color-text);
    font-weight: var(--font-semibold);
    flex-shrink: 0;
  }

  .ghost-progress-bar {
    height: var(--space-1);
    background-color: color-mix(in srgb, var(--color-text) 8%, transparent);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .ghost-progress-fill {
    height: 100%;
    background-color: var(--color-interactive);
    border-radius: var(--radius-full, 9999px);
    transition: width var(--duration-normal) var(--ease-default);
  }

  .ghost-tile[data-status='error'] .ghost-progress-fill {
    background-color: var(--color-error-500, var(--color-error));
  }

  .ghost-body {
    padding: 0 var(--space-1);
  }

  .ghost-name {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
