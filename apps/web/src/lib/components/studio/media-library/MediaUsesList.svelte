<!--
  @component MediaUsesList

  Where a media item is used (Codex-6sbn1): published uses first (these stop a
  delete), then drafts (these don't), each with where to swap in another media
  item. The same list draws in the library chip's popover and in every state
  of the delete dialog, so the two can't disagree.

  Only what the worker named is listed; what it counted but can't name (drafts
  the creator can't open, or past the 50-row cap) is said in one line.

  @prop usage        The `GET /api/media/:id/usage` answer
  @prop draftAction  A draft row's link: 'open' (the popover, the draft
                     warning) or 'replace' (the blocked dialog, owner round 2
                     decision 5)
-->
<script lang="ts">
  import type { MediaUse, MediaUseKind, MediaUsage } from '@codex/shared-types';
  import type { Component } from 'svelte';
  import { page } from '$app/state';
  import {
    ArrowLeftRightIcon,
    CompassIcon,
    ExternalLinkIcon,
    FilmIcon,
    HomeIcon,
    MusicIcon,
  } from '$lib/components/ui/Icon';
  import type { IconProps } from '$lib/components/ui/Icon/types';
  import * as m from '$paraglide/messages';
  import {
    splitUses,
    unlistedCounts,
    useAction,
    useHref,
    useTitle,
    useWhere,
  } from './media-usage';

  interface Props {
    usage: MediaUsage;
    draftAction?: 'open' | 'replace';
  }

  const { usage, draftAction = 'open' }: Props = $props();

  const KIND_ICON: Record<MediaUseKind, Component<IconProps>> = {
    film: FilmIcon,
    audio: MusicIcon,
    course: CompassIcon,
    intro: HomeIcon,
  };

  const groups = $derived.by(() => {
    const { live, drafts } = splitUses(usage.uses);
    return [
      { title: m.media_uses_published(), uses: live },
      { title: m.media_uses_drafts(), uses: drafts },
    ].filter((group) => group.uses.length > 0);
  });

  const unlisted = $derived(unlistedCounts(usage));
</script>

{#snippet row(use: MediaUse)}
  {@const Icon = KIND_ICON[use.kind]}
  {@const action = useAction(use, draftAction)}
  {@const href = useHref(use.link, page.url)}
  <li class="use" data-live={use.live || undefined}>
    <span class="use__icon" aria-hidden="true"><Icon size={15} /></span>
    <span class="use__text">
      <span class="use__title">{useTitle(use)}</span>
      <span class="use__where">{useWhere(use)}</span>
    </span>
    {#if href && (action === 'replace' || action === 'open')}
      <a class="use__action" {href} target="_blank" rel="noopener noreferrer">
        {#if action === 'replace'}
          <ArrowLeftRightIcon size={12} />
          {m.media_use_replace()}
        {:else}
          {m.media_use_open()}
          <ExternalLinkIcon size={12} />
        {/if}
        <span class="sr-only">{m.media_use_new_tab()}</span>
      </a>
    {:else}
      <span class="use__note">
        {action === 'ask-creator' ? m.media_use_ask_creator() : m.media_use_ask_admin()}
      </span>
    {/if}
  </li>
{/snippet}

<div class="uses-list">
  {#each groups as group (group.title)}
    <div class="uses-group">
      <p class="uses-group__title">
        {group.title} · <span class="uses-group__count">{group.uses.length}</span>
      </p>
      <ul class="uses">
        {#each group.uses as use}
          {@render row(use)}
        {/each}
      </ul>
    </div>
  {/each}

  {#if unlisted.hidden > 0}
    <p class="uses-more">
      {unlisted.hidden === 1
        ? m.media_uses_hidden_one()
        : m.media_uses_hidden({ count: unlisted.hidden })}
    </p>
  {/if}
  {#if unlisted.capped > 0}
    <p class="uses-more">{m.media_uses_capped({ count: unlisted.capped })}</p>
  {/if}
</div>

<style>
  .uses-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .uses-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .uses-group__title {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    color: var(--color-text-secondary);
  }

  .uses-group__count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums slashed-zero;
  }

  .uses {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }

  .use {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    padding: var(--space-2) 0;
    border-top: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 70%, transparent);
  }

  .use:first-child {
    border-top: 0;
  }

  .use__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  .use[data-live] .use__icon {
    background: color-mix(in oklab, var(--color-interactive) 10%, var(--color-surface));
    color: var(--color-interactive);
  }

  .use__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .use__title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .use__where {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .use__action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-interactive);
    text-decoration: none;
    white-space: nowrap;
    border-radius: var(--radius-sm);
  }

  .use__action:hover {
    text-decoration: underline;
  }

  .use__action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /* Secondary, not muted: muted at --text-xs falls under 4.5:1 on a surface. */
  .use__note {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .uses-more {
    margin: 0;
    padding: var(--space-2) 0 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
    border-top: var(--border-width) var(--border-style)
      color-mix(in srgb, var(--color-border) 70%, transparent);
  }

  @media (--below-sm) {
    .use__title,
    .use__where {
      white-space: normal;
    }
  }
</style>
