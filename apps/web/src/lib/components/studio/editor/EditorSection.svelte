<!--
  @component EditorSection

  One numbered section of the Publish step or a live piece's Settings
  (Codex-a6ofh.2.4, .2.5): a rule above, its heading, then what it holds. A
  section that folds gives no `title` and puts the heading in its trigger
  (`EditorHeading`), naming the section by `headingId`.

  @prop {string} headingId - The heading's id, which names the section
  @prop {number} [ordinal] - Its place on the screen, with `title`
  @prop {string} [title] - Its heading; none when its children hold one
  @prop {Snippet} children - What it holds
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import EditorHeading from './EditorHeading.svelte';

  interface Props {
    headingId: string;
    ordinal?: number;
    title?: string;
    children: Snippet;
  }

  const { headingId, ordinal, title, children }: Props = $props();
</script>

<section class="editor-section" aria-labelledby={headingId}>
  {#if title !== undefined && ordinal !== undefined}
    <h2 class="editor-section-heading">
      <EditorHeading id={headingId} {ordinal} {title} />
    </h2>
  {/if}
  {@render children()}
</section>

<style>
  .editor-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-block-start: var(--space-6);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  .editor-section-heading {
    margin: 0;
  }
</style>
