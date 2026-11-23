<!--
  @component TopicWindows

  PLACEHOLDER for the "Shader windows" topic selector (Codex-8swlj.6). WP-4
  ships it so BrowseModule's selector slot compiles and dispatches; the WP-6
  lane replaces this file wholesale against the same props.

  The selector contract (shared by TopicBar, TopicWindows, TopicChannels):
  @prop {TopicItem[]} topics - The org's curated topics, in curator order.
  @prop {string | null} active - The active topic slug, or null.
  @prop {(slug: string | null) => void} onSelect - Pick a topic (null = all).
-->
<script lang="ts">
  import type { TopicItem } from '$lib/components/topic/topic-card.types';

  interface Props {
    topics: TopicItem[];
    active: string | null;
    onSelect: (slug: string | null) => void;
  }

  const { topics, active, onSelect }: Props = $props();
</script>

<ul class="topic-windows" aria-label="Topics">
  {#each topics as topic (topic.slug)}
    <li>
      <button
        type="button"
        class="topic-windows__item"
        aria-pressed={active === topic.slug}
        onclick={() => onSelect(topic.slug)}
      >
        {topic.name}
      </button>
    </li>
  {/each}
</ul>

<style>
  .topic-windows {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .topic-windows__item {
    font: inherit;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .topic-windows__item[aria-pressed='true'] {
    background: var(--color-brand-primary);
    color: var(--color-text-on-brand);
  }

  .topic-windows__item:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
