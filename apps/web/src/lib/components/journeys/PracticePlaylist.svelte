<!--
  @component PracticePlaylist

  The in-course player's left rail: the WHOLE journey map as a stage accordion
  (SPEC §8.6). Each stage is a collapsible `<details>` group — the current
  stage lands open, cleared stages collapse — so you can jump to any practice
  without returning to the dashboard. Presentational: completion set + current
  id are supplied by the page's live progress query.

  @prop {PlaylistEntry[]} playlist - Ordered course sequence from the load.
  @prop {ReadonlySet<string>} completedIds - Content ids with a completion row.
  @prop {string} currentContentId - The practice open in the working pane.
  @prop {string} courseSlug - For building practice hrefs.
-->
<script lang="ts">
  import {
    CheckIcon,
    ChevronRightIcon,
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

  const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

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

  function typeLabel(type: PracticeContentType): string {
    if (type === 'video') return 'Video';
    if (type === 'audio') return 'Audio';
    return 'Reflection';
  }

  function entryHref(entry: PlaylistEntry): string {
    return `/journeys/${courseSlug}/practice/${entry.slug ?? entry.contentId}`;
  }
</script>

<nav class="playlist" aria-label="Course practices">
  {#each groups as group, index (group.stageId)}
    {@const doneCount = group.entries.filter((e) => completedIds.has(e.contentId)).length}
    {@const total = group.entries.length}
    {@const allDone = doneCount === total}
    {@const isCurrent = group.entries.some((e) => e.contentId === currentContentId)}
    <details
      class="playlist__stage"
      class:playlist__stage--current={isCurrent}
      class:playlist__stage--done={allDone && !isCurrent}
      open={isCurrent}
    >
      <summary class="playlist__head">
        <span class="playlist__rn" aria-hidden="true">{ROMAN[index] ?? index + 1}</span>
        <span class="playlist__name">{group.stageName}</span>
        <span class="playlist__count" aria-label="{doneCount} of {total} complete">
          {doneCount}/{total}
        </span>
        <ChevronRightIcon size={16} class="playlist__chev" aria-hidden="true" />
      </summary>

      <ul class="playlist__items">
        {#each group.entries as entry (entry.contentId)}
          {@const done = completedIds.has(entry.contentId)}
          {@const current = entry.contentId === currentContentId}
          {@const state = done ? 'done' : current ? 'cur' : 'up'}
          {@const Icon = iconFor(entry.contentType)}
          <li>
            <a
              class="playlist__row"
              class:playlist__row--done={done}
              class:playlist__row--current={current}
              href={entryHref(entry)}
              aria-current={current ? 'page' : undefined}
            >
              <span class="playlist__lic playlist__lic--{state}" aria-hidden="true">
                {#if done}
                  <CheckIcon size={11} />
                {:else if current}
                  <span class="playlist__dot"></span>
                {:else}
                  <Icon size={11} />
                {/if}
              </span>
              <span class="playlist__col">
                <span class="playlist__title">{entry.title}</span>
                <span class="playlist__meta">{typeLabel(entry.contentType)}</span>
              </span>
              <span class="playlist__go" aria-hidden="true">
                {current ? 'Here' : 'Open →'}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </details>
  {/each}
</nav>

<style>
  .playlist {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* ── stage accordion ── */
  .playlist__stage {
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .playlist__stage[open] {
    background: color-mix(in oklab, var(--color-surface) 60%, transparent);
    border-color: var(--color-border-subtle);
  }

  .playlist__stage--current {
    border-color: color-mix(in oklab, var(--color-brand-primary) 30%, transparent);
  }

  .playlist__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2);
    cursor: pointer;
    list-style: none;
    border-radius: var(--radius-lg);
  }

  .playlist__head::-webkit-details-marker {
    display: none;
  }

  .playlist__head:hover {
    background: color-mix(in oklab, var(--color-text) 5%, transparent);
  }

  .playlist__head:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .playlist__rn {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-text) 20%, transparent);
    font-family: var(--font-heading);
    font-style: italic;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .playlist__stage--current .playlist__rn {
    border-color: var(--color-brand-primary);
    color: var(--color-brand-primary);
    box-shadow: 0 0 var(--space-2) 0
      color-mix(in oklab, var(--color-brand-primary) 32%, transparent);
  }

  .playlist__stage--done .playlist__rn {
    border-color: transparent;
    background: color-mix(in oklab, var(--color-brand-primary) 20%, transparent);
    color: var(--color-brand-primary);
  }

  .playlist__name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    line-height: var(--leading-tight);
    color: var(--color-heading);
  }

  .playlist__count {
    flex: none;
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  :global(.playlist__chev) {
    flex: none;
    color: var(--color-text-tertiary);
    transition: transform var(--duration-fast) var(--ease-out);
  }

  .playlist__stage[open] :global(.playlist__chev) {
    transform: rotate(90deg);
  }

  /* ── lesson rows ── */
  .playlist__items {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-1) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .playlist__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-out);
  }

  .playlist__row:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .playlist__row--current {
    background: color-mix(in oklab, var(--color-brand-primary) 13%, transparent);
  }

  .playlist__row:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .playlist__lic {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-full);
    border: var(--border-width-thick) var(--border-style)
      color-mix(in oklab, var(--color-text) 26%, transparent);
    color: var(--color-text-tertiary);
  }

  .playlist__lic--done {
    border-color: var(--color-brand-primary);
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  .playlist__lic--cur {
    border-color: var(--color-brand-primary);
    color: var(--color-brand-primary);
    box-shadow: 0 0 var(--space-2) 0
      color-mix(in oklab, var(--color-brand-primary) 40%, transparent);
  }

  .playlist__dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-brand-primary);
  }

  .playlist__col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .playlist__title {
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--color-heading);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .playlist__row--done .playlist__title {
    color: var(--color-text-secondary);
  }

  .playlist__meta {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
    margin-top: var(--space-0-5);
  }

  .playlist__go {
    flex: none;
    font-size: var(--text-xs);
    color: var(--color-brand-primary);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .playlist__row--current .playlist__go,
  .playlist__row:hover .playlist__go {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.playlist__chev),
    .playlist__go {
      transition: none;
    }
  }
</style>
