<!--
  @component LayoutPicker

  One real render of THIS section — its own words, colour and spacing — in
  each of its type's layouts, so a creator picks the arrangement they can see
  rather than a name. The layout the page's Style would use is marked.
-->
<script lang="ts">
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import type {
    BlockLayout,
    ColourSchemeId,
    KitPage,
    KitSection,
  } from '$lib/page-builder/kit';
  import type { JourneySalesContext } from '$lib/page-builder/render/types';
  import * as m from '$paraglide/messages';
  import MiniPreview from './MiniPreview.svelte';

  interface Props {
    page: KitPage;
    section: KitSection;
    layouts: readonly BlockLayout[];
    /** The layout the section renders in now. */
    value: string;
    styleDefault: string;
    /** The section's resolved scheme, pinned so every thumbnail matches the canvas. */
    scheme: ColourSchemeId;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
    onChoose: (layout: string) => void;
  }

  const {
    page,
    section,
    layouts,
    value,
    styleDefault,
    scheme,
    context,
    brandOverrides = null,
    theme,
    onChoose,
  }: Props = $props();

  const previews = $derived(
    layouts.map((layout) => ({
      layout,
      page: {
        design: page.design,
        sections: [
          {
            ...section,
            enabled: true,
            variant: layout.id,
            design: { ...section.design, scheme },
          },
        ],
      } satisfies KitPage,
    }))
  );
  const current = $derived(layouts.find((layout) => layout.id === value));
</script>

<div class="layouts">
  <div class="layouts__grid" role="group" aria-label={m.studio_page_editor_layout_title()}>
    {#each previews as preview (preview.layout.id)}
      {@const isDefault = preview.layout.id === styleDefault}
      <button
        type="button"
        class="layout"
        data-layout={preview.layout.id}
        aria-pressed={value === preview.layout.id}
        title={preview.layout.description}
        onclick={() => onChoose(preview.layout.id)}
      >
        <MiniPreview
          class="layout__thumb"
          page={preview.page}
          {context}
          {brandOverrides}
          {theme}
        />
        <span class="layout__label">
          {preview.layout.label}
          {#if isDefault}
            <span class="layout__default">{m.studio_page_editor_default_short()}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>
  {#if current}
    <p class="layouts__description">{current.description}</p>
  {/if}
</div>

<style>
  .layouts {
    display: grid;
    gap: var(--space-2);
  }

  .layouts__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .layout {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .layout:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: var(--color-text);
  }

  .layout :global(.layout__thumb) {
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-border);
  }

  .layout[aria-pressed='true'] {
    color: var(--color-text);
  }

  .layout[aria-pressed='true'] :global(.layout__thumb) {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width-thick);
  }

  .layout:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .layout__label {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1);
    padding-inline: var(--space-0-5);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-tight);
  }

  .layout__default {
    font-weight: normal;
    color: var(--color-text-secondary);
  }

  .layouts__description {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }
</style>
