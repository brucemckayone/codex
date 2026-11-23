<!--
  @component TopicChannels

  PLACEHOLDER for the "Channels" topic selector (Codex-8swlj.7). WP-4 ships it
  so BrowseModule's selector slot compiles and dispatches; the WP-7 lane
  replaces this file wholesale against the same props.

  The selector contract (shared by TopicBar, TopicWindows, TopicChannels):
  @prop {TopicItem[]} topics - The org's curated topics, in curator order.
  @prop {string | null} active - The active topic slug, or null.
  @prop {(slug: string | null) => void} onSelect - Pick a topic (null = all).
  Channels only:
  @prop {BrowseItem[]} items - The loaded catalogue, for each page's mini cards.
-->
<script lang="ts">
  import type { BrowseItem } from '$lib/components/browse/browse-module.types';
  import type { TopicItem } from '$lib/components/topic/topic-card.types';

  interface Props {
    topics: TopicItem[];
    active: string | null;
    onSelect: (slug: string | null) => void;
    items: BrowseItem[];
  }

  // `items` is part of the contract; this placeholder renders no mini cards.
  const { topics, active, onSelect }: Props = $props();
</script>

<ul class="topic-channels" aria-label="Topics">
  {#each topics as topic (topic.slug)}
    <li>
      <button
        type="button"
        class="topic-channels__item"
        aria-pressed={active === topic.slug}
        onclick={() => onSelect(topic.slug)}
      >
        {topic.name}
      </button>
    </li>
  {/each}
</ul>

<style>
  .topic-channels {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .topic-channels__item {
    font: inherit;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .topic-channels__item[aria-pressed='true'] {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  .topic-channels__item:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
