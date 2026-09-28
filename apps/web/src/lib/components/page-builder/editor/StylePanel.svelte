<!--
  @component StylePanel

  The Style tab: the eight Styles as live thumbnails of THIS page's hero — its
  own words and any layout or colour the creator chose, re-composed by each
  Style — then the page's own brand: two colours and two fonts, each saying
  whether it follows the organisation or is set for this page only.

  A Style may SUGGEST a font pair (03 §1, §9). When the chosen Style's pair is
  not what the page renders now, a row offers it with a sample of each face;
  accepting writes both of the page's own brand fonts in one step, so the font
  fields below show them and "Use organisation brand" undoes them. Choosing a
  Style never touches the fonts. The row sticks to the foot of the panel while
  the Styles run on below it, so it is seen the moment a Style is chosen
  without moving the card under the pointer. "Keep my fonts" declines the pair
  for this page and Style; the page model has no place for that, so this
  browser remembers it (and, with no storage, this visit does).

  Eight live renders are this panel's cost, so the shell mounts it only while
  the Style tab is open.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { findFont } from '$lib/brand-editor/font-catalog';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    DEFINITIONS,
    type KitPage,
    type KitSection,
    PAGE_STYLE_IDS,
    resolveStyle,
    STYLES,
  } from '$lib/page-builder/kit';
  import { brandFontsHref } from '$lib/page-builder/kit/model/fonts';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import type { JourneySalesContext } from '$lib/page-builder/render/types';
  import * as m from '$paraglide/messages';
  import BrandColourField from './BrandColourField.svelte';
  import BrandFontField from './BrandFontField.svelte';
  import MiniPreview from './MiniPreview.svelte';
  import { orgFonts } from './org-fonts';

  interface Props {
    page: KitPage;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
  }

  const { page, context, brandOverrides = null, theme }: Props = $props();

  // Read once, before a font picker below can preview over it (org-fonts.ts).
  const organisation = orgFonts();

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

  /** The chosen Style's pair, while it is not what the page renders now. */
  const suggestion = $derived.by(() => {
    const fonts = STYLES[current].fonts;
    if (!fonts) return null;
    const heading = overrides.fontHeading || organisation.heading;
    const body = overrides.fontBody || organisation.body;
    return fonts.heading === heading && fonts.body === body ? null : fonts;
  });
  // The page's own request for override fonts, so accepting reuses it.
  const suggestionHref = $derived(
    suggestion
      ? brandFontsHref({ fontHeading: suggestion.heading, fontBody: suggestion.body })
      : undefined
  );
  /** The page's own words in each face: its headline, then its opening line. */
  const sample = $derived({
    heading: textOf(hero.props.heading) ?? context.course.title,
    body:
      textOf(hero.props.body) ?? textOf(context.course.lede) ?? STYLES[current].description,
  });

  function textOf(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function faceOf(family: string): string {
    return `'${family}', ${findFont(family)?.fallback ?? 'sans-serif'}`;
  }

  function setBrand(patch: BrandTokenOverrides): void {
    pageBuilder.updateBrandOverrides(patch);
  }

  function useSuggestedFonts(): void {
    if (suggestion) setBrand({ fontHeading: suggestion.heading, fontBody: suggestion.body });
    returnFocus();
  }

  // "Keep my fonts", per page and Style. Storage can be missing or refuse
  // (a private window, blocked site data), so every access is guarded; the
  // dismissals made here stand for this visit whatever it says.
  const KEPT = 'lp-keep-fonts';
  let keptNow = $state<readonly string[]>([]);
  const keptKey = $derived(`${KEPT}:${pageBuilder.pageId ?? 'unsaved'}:${current}`);
  const kept = $derived(keptNow.includes(keptKey) || stored(keptKey));

  function stored(key: string): boolean {
    try {
      return window.localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function keepFonts(): void {
    keptNow = [...keptNow, keptKey];
    try {
      window.localStorage.setItem(keptKey, '1');
    } catch {
      // Remembered for this visit only.
    }
    returnFocus();
  }

  // Either answer takes the row away; focus goes back to the Style it was about.
  let styles = $state<HTMLElement>();
  function returnFocus(): void {
    void tick().then(() => styles?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus());
  }
</script>

<svelte:head>
  {#if suggestionHref}<link rel="stylesheet" href={suggestionHref} />{/if}
</svelte:head>

<div class="style-panel">
  <section class="style-panel__group" aria-labelledby="style-panel-styles">
    <h2 class="style-panel__title" id="style-panel-styles">{m.studio_page_editor_style_title()}</h2>
    <p class="style-panel__body">{m.studio_page_editor_style_body()}</p>
    <div
      class="style-panel__styles"
      role="group"
      aria-labelledby="style-panel-styles"
      bind:this={styles}
    >
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

    <div class="style-fonts" aria-live="polite">
      {#if suggestion && !kept}
        <div class="style-fonts__row" role="group" aria-labelledby="style-fonts-text">
          <p class="style-fonts__text" id="style-fonts-text">
            {m.studio_page_editor_style_fonts({ heading: suggestion.heading, body: suggestion.body })}
          </p>
          <button type="button" class="style-fonts__use" onclick={useSuggestedFonts}>
            {m.studio_page_editor_style_fonts_use()}
          </button>
          <div class="style-fonts__sample" aria-hidden="true">
            <span class="style-fonts__heading" style:font-family={faceOf(suggestion.heading)}>
              {sample.heading}
            </span>
            <span class="style-fonts__line" style:font-family={faceOf(suggestion.body)}>
              {sample.body}
            </span>
          </div>
          <button type="button" class="style-fonts__keep" onclick={keepFonts}>
            {m.studio_page_editor_style_fonts_keep()}
          </button>
        </div>
      {/if}
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

  /* Pinned to the panel's foot while the grid runs below it; scrolled past,
     it rests under the grid. Later in the tree than the cards, so it paints
     over them without a stacking order of its own. */
  .style-fonts {
    position: sticky;
    inset-block-end: 0;
    margin-inline: calc(-1 * var(--space-4));
  }

  .style-fonts__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
    background: var(--color-surface);
  }

  .style-fonts__text {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .style-fonts__use {
    min-block-size: var(--space-10);
    padding-inline: var(--space-4);
    border: var(--border-width) var(--border-style) var(--color-text);
    border-radius: var(--radius-md);
    background: var(--color-text);
    color: var(--color-background);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
  }

  .style-fonts__use:hover {
    background: color-mix(in oklab, var(--color-text) 86%, var(--color-background));
  }

  .style-fonts__use:focus-visible,
  .style-fonts__keep:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }

  /* The quiet answer: a plain text button under the sample, where the eye
     lands after reading it, as tall as the button beside the offer. */
  .style-fonts__keep {
    grid-column: 1 / -1;
    justify-self: end;
    min-block-size: var(--space-10);
    padding-inline: var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: var(--space-1);
    cursor: pointer;
  }

  .style-fonts__keep:hover {
    color: var(--color-text);
  }

  .style-fonts__sample {
    grid-column: 1 / -1;
    display: grid;
    gap: var(--space-0-5);
    min-inline-size: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 5%, transparent);
  }

  .style-fonts__heading,
  .style-fonts__line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .style-fonts__heading {
    font-size: var(--text-lg);
    line-height: var(--leading-tight);
  }

  .style-fonts__line {
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .style-panel__brand {
    display: grid;
    gap: var(--space-5);
  }
</style>
