<!--
  @component Inspector

  The inspector's REGION only (WP-7b). WP-8 builds what goes in it — layout
  picker, colour, spacing and fields for a section; Style and page brand for
  the page — so this renders a clearly marked placeholder for whichever of the
  two is showing, and nothing that would have to be unpicked later.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    /** The selected section's label, or null when the page is showing. */
    sectionLabel: string | null;
  }

  const { sectionLabel }: Props = $props();
</script>

<div class="inspector">
  <p class="inspector__tag">{m.studio_page_editor_placeholder_tag()}</p>
  {#if sectionLabel}
    <h2 class="inspector__title">{sectionLabel}</h2>
    <p class="inspector__body">{m.studio_page_editor_inspector_section_body()}</p>
  {:else}
    <h2 class="inspector__title">{m.studio_page_editor_inspector_page_title()}</h2>
    <p class="inspector__body">{m.studio_page_editor_inspector_page_body()}</p>
  {/if}
</div>

<style>
  .inspector {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-4);
    padding: var(--space-5);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    color: var(--color-text);
  }

  .inspector__tag {
    justify-self: start;
    margin: 0;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 8%, transparent);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .inspector__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .inspector__body {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }
</style>
