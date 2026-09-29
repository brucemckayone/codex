<!--
  @component StylePanel

  The Style tab: the four Styles as live thumbnails of THIS page's hero — its
  own words and any layout or colour the creator chose, re-composed by each
  Style — then the page's own brand: two colours and two fonts, each saying
  whether it follows the organisation or is set for this page only.
-->
<script lang="ts">
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    DEFINITIONS,
    type KitPage,
    type KitSection,
    PAGE_STYLE_IDS,
    resolveStyle,
    STYLES,
  } from '$lib/page-builder/kit';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import type { JourneySalesContext } from '$lib/page-builder/render/types';
  import * as m from '$paraglide/messages';
  import BrandColourField from './BrandColourField.svelte';
  import BrandFontField from './BrandFontField.svelte';
  import MiniPreview from './MiniPreview.svelte';

  interface Props {
    page: KitPage;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
  }

  const { page, context, brandOverrides = null, theme }: Props = $props();

  const current = $derived(resolveStyle(page.design));
  /** The page's hero; a page without one previews the hero's sample words. */
  const hero = $derived<KitSection>(
    page.sections.find((s) => s.type === 'hero' && s.enabled !== false) ??
      page.sections.find((s) => s.type === 'hero') ?? {
        id: 'style-hero',
        type: 'hero',
        enabled: true,
        props: { ...DEFINITIONS.hero.sample },
      }
  );
  const previews = $derived(
    PAGE_STYLE_IDS.map((id) => ({
      style: STYLES[id],
      page: { design: { style: id }, sections: [{ ...hero, enabled: true }] } satisfies KitPage,
    }))
  );
  const overrides = $derived(brandOverrides ?? {});

  function setBrand(patch: BrandTokenOverrides): void {
    pageBuilder.updateBrandOverrides(patch);
  }
</script>

<div class="style-panel">
  <section class="style-panel__group" aria-labelledby="style-panel-styles">
    <h2 class="style-panel__title" id="style-panel-styles">{m.studio_page_editor_style_title()}</h2>
    <p class="style-panel__body">{m.studio_page_editor_style_body()}</p>
    <div class="style-panel__styles" role="group" aria-labelledby="style-panel-styles">
      {#each previews as preview (preview.style.id)}
        {@const active = preview.style.id === current}
        <button
          type="button"
          class="style-card"
          data-style={preview.style.id}
          aria-pressed={active}
          aria-describedby="style-card-{preview.style.id}"
          onclick={() => pageBuilder.setPageStyle(preview.style.id)}
        >
          <MiniPreview
            class="style-card__thumb"
            page={preview.page}
            {context}
            {brandOverrides}
            {theme}
            ratio="4 / 3"
          />
          <span class="style-card__label">
            {preview.style.label}
            {#if active}<span class="style-card__badge">{m.studio_page_editor_style_in_use()}</span>{/if}
          </span>
          <span class="style-card__description" id="style-card-{preview.style.id}">
            {preview.style.description}
          </span>
        </button>
      {/each}
    </div>
  </section>

  <section class="style-panel__group" aria-labelledby="style-panel-brand">
    <h2 class="style-panel__title" id="style-panel-brand">{m.studio_page_editor_brand_title()}</h2>
    <p class="style-panel__body">{m.studio_page_editor_brand_body()}</p>
    <div class="style-panel__brand">
      <BrandColourField
        label={m.studio_page_editor_brand_primary()}
        scheme="brand"
        value={overrides.primaryColor}
        style={current}
        {theme}
        {brandOverrides}
        onChange={(hex) => setBrand({ primaryColor: hex })}
      />
      <BrandColourField
        label={m.studio_page_editor_brand_secondary()}
        scheme="accent"
        value={overrides.secondaryColor}
        style={current}
        {theme}
        {brandOverrides}
        onChange={(hex) => setBrand({ secondaryColor: hex })}
      />
      <BrandFontField
        mode="heading"
        label={m.studio_page_editor_brand_heading_font()}
        value={overrides.fontHeading}
        onChange={(family) => setBrand({ fontHeading: family })}
      />
      <BrandFontField
        mode="body"
        label={m.studio_page_editor_brand_body_font()}
        value={overrides.fontBody}
        onChange={(family) => setBrand({ fontBody: family })}
      />
    </div>
  </section>
</div>

<style>
  .style-panel {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-4);
    color: var(--color-text);
  }

  .style-panel__group {
    display: grid;
    gap: var(--space-2);
  }

  .style-panel__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
  }

  .style-panel__body {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--color-text-secondary);
  }

  .style-panel__styles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .style-card {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .style-card:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .style-card :global(.style-card__thumb) {
    margin-block-end: var(--space-1);
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-border);
  }

  .style-card[aria-pressed='true'] :global(.style-card__thumb) {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width-thick);
  }

  .style-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  .style-card__label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  .style-card__badge {
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-text);
    color: var(--color-background);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .style-card__description {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .style-panel__brand {
    display: grid;
    gap: var(--space-5);
  }
</style>
