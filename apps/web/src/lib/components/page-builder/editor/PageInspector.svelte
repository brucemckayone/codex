<!--
  @component PageInspector

  The inspector with no section selected: the page as a whole — the Style it
  is in (with the way to change it), how many sections it has, and the one
  thing a creator needs to know to go further: click a section to edit it.
-->
<script lang="ts">
  import { type KitPage, resolveStyle, STYLES } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';

  interface Props {
    page: KitPage;
    onChangeStyle: () => void;
  }

  const { page, onChangeStyle }: Props = $props();

  const style = $derived(STYLES[resolveStyle(page.design)]);
  const total = $derived(page.sections.length);
  const hiddenCount = $derived(page.sections.filter((s) => s.enabled === false).length);
</script>

<div class="page-inspector">
  <h2 class="page-inspector__title">{m.studio_page_editor_inspector_page_title()}</h2>

  <section class="page-inspector__card" aria-labelledby="page-inspector-style">
    <p class="page-inspector__eyebrow" id="page-inspector-style">
      {m.studio_page_editor_style_title()}
    </p>
    <p class="page-inspector__style">{style.label}</p>
    <p class="page-inspector__text">{style.description}</p>
    <button type="button" class="page-inspector__button" onclick={onChangeStyle}>
      {m.studio_page_editor_change_style()}
    </button>
  </section>

  <dl class="page-inspector__facts">
    <div>
      <dt>{m.studio_builder_sections()}</dt>
      <dd>{total}</dd>
    </div>
    {#if hiddenCount > 0}
      <div>
        <dt>{m.studio_page_editor_outline_hidden()}</dt>
        <dd>{hiddenCount}</dd>
      </div>
    {/if}
  </dl>

  <p class="page-inspector__text">{m.studio_page_editor_inspector_page_body()}</p>
</div>

<style>
  .page-inspector {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
    color: var(--color-text);
  }

  .page-inspector__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .page-inspector__card {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .page-inspector__eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .page-inspector__style {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
  }

  .page-inspector__text {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .page-inspector__button {
    justify-self: start;
    margin-block-start: var(--space-2);
    min-block-size: var(--space-8);
    padding: 0 var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .page-inspector__button:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .page-inspector__button:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .page-inspector__facts {
    display: flex;
    gap: var(--space-6);
    margin: 0;
  }

  .page-inspector__facts div {
    display: grid;
    gap: var(--space-0-5);
  }

  .page-inspector__facts dt {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .page-inspector__facts dd {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
  }
</style>
