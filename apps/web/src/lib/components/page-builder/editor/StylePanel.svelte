<!--
  @component StylePanel

  The Style tab's PLACEHOLDER (WP-7b). WP-8 builds the real one: the four
  Styles as live thumbnails of this page's hero, and the page brand overrides.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    styleLabel: string;
  }

  const { styleLabel }: Props = $props();
</script>

<div class="style">
  <p class="style__tag">{m.studio_page_editor_placeholder_tag()}</p>
  <h2 class="style__title">{m.studio_page_editor_style_title()}</h2>
  <p class="style__current">{m.studio_page_editor_style_current({ style: styleLabel })}</p>
  <p class="style__body">{m.studio_page_editor_style_body()}</p>
</div>

<style>
  .style {
    display: grid;
    gap: var(--space-2);
    margin: var(--space-4);
    padding: var(--space-5);
    border: var(--border-width) dashed var(--color-border-strong);
    border-radius: var(--radius-lg);
    color: var(--color-text);
  }

  .style__tag {
    justify-self: start;
    margin: 0;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 8%, transparent);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .style__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .style__current {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .style__body {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }
</style>
