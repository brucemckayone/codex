<!--
  @component PracticePlaylist

  The in-course player's left rail: the whole course sequence grouped by stage,
  the current practice highlighted, completion state per row, each linking to
  its practice page. Presentational — completion set + current id are supplied.

  @prop {PlaylistEntry[]} playlist - Ordered course sequence from the load.
  @prop {ReadonlySet<string>} completedIds - Content ids with a completion row.
  @prop {string} currentContentId - The practice open in the working pane.
  @prop {string} courseSlug - For building practice hrefs.
-->
<script lang="ts">
  import {
    CheckCircleIcon,
    CircleIcon,
    FileTextIcon,
    MusicIcon,
    VideoIcon,
  } from '$lib/components/ui/Icon';
  import type { PlaylistEntry, PracticeContentType } from '$lib/journeys/types';

  interface Props {
    playlist: PlaylistEntry[];
    completedIds: ReadonlySet<string>;
    currentContentId: string;
    courseSlug: string;
  }

  const { playlist, completedIds, currentContentId, courseSlug }: Props =
    $props();

  interface Group {
    stageId: string;
    stageName: string;
    entries: PlaylistEntry[];
  }

  // Group the flattened playlist by stage, preserving order.
  const groups = $derived.by(() => {
    const out: Group[] = [];
    for (const entry of playlist) {
      let group = out.at(-1);
      if (!group || group.stageId !== entry.stageId) {
        group = {
          stageId: entry.stageId,
          stageName: entry.stageName,
          entries: [],
        };
        out.push(group);
      }
      group.entries.push(entry);
    }
    return out;
  });

  function iconFor(type: PracticeContentType) {
    if (type === 'video') return VideoIcon;
    if (type === 'audio') return MusicIcon;
    return FileTextIcon;
  }

  function entryHref(entry: PlaylistEntry): string {
    return `/journeys/${courseSlug}/practice/${entry.slug ?? entry.contentId}`;
  }
</script>

<nav class="playlist" aria-label="Course practices">
  {#each groups as group (group.stageId)}
    <div class="playlist__group">
      <h2 class="playlist__stage">{group.stageName}</h2>
      <ul class="playlist__items">
        {#each group.entries as entry (entry.contentId)}
          {@const done = completedIds.has(entry.contentId)}
          {@const current = entry.contentId === currentContentId}
          {@const Icon = iconFor(entry.contentType)}
          <li>
            <a
              class="item"
              class:item--current={current}
              class:item--done={done}
              href={entryHref(entry)}
              aria-current={current ? 'page' : undefined}
            >
              <span class="item__status" aria-hidden="true">
                {#if done}
                  <CheckCircleIcon />
                {:else}
                  <CircleIcon />
                {/if}
              </span>
              <span class="item__type" aria-hidden="true"><Icon /></span>
              <span class="item__title">{entry.title}</span>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</nav>

<style>
  .playlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .playlist__stage {
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    text-transform: var(--text-transform-label);
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .playlist__items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    text-decoration: none;
    transition: background-color var(--duration-fast) ease;
  }

  .item:hover {
    background: var(--color-surface-secondary);
  }

  .item:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .item--current {
    background: var(--color-surface-secondary);
    color: var(--color-heading);
    font-weight: var(--font-medium);
  }

  .item__status {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .item--done .item__status {
    color: var(--color-success);
  }

  .item__type {
    display: inline-flex;
    color: var(--color-text-muted);
  }

  .item__title {
    flex: 1;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
