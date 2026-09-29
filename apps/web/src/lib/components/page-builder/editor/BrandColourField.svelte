<!--
  @component BrandColourField

  One page-brand colour. The swatch is the kit's own `brand` / `accent` fill
  in the page's Style and theme, so it shows the colour the page really uses
  — the organisation's, or this page's override — through every fallback.
  "Change" opens the brand editor's picker seeded with that painted colour,
  so opening it changes nothing until the creator moves it.
-->
<script lang="ts">
  import OklchColorPicker from '$lib/components/brand-editor/color-picker/OklchColorPicker.svelte';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import type { PageStyleId } from '$lib/page-builder/kit';
  import { brandOverridesToStyleAttr } from '$lib/page-builder/render/brand-overrides';
  import * as m from '$paraglide/messages';
  import { paintedHex } from './brand-colour';

  interface Props {
    label: string;
    scheme: 'brand' | 'accent';
    /** This page's override, or empty when the organisation's colour applies. */
    value: string | null | undefined;
    style: PageStyleId;
    theme?: 'light' | 'dark';
    brandOverrides?: BrandTokenOverrides | null;
    onChange: (hex: string | undefined) => void;
  }

  const { label, scheme, value, style, theme, brandOverrides = null, onChange }: Props = $props();

  const id = $props.id();
  const brandStyle = $derived(brandOverridesToStyleAttr(brandOverrides));
  let tile = $state<HTMLElement>();
  let editing = $state(false);
  let seed = $state('#000000');

  function toggle(): void {
    if (!editing) seed = value || paintedHex(tile) || seed;
    editing = !editing;
  }
</script>

<div class="brand-colour" data-overridden={value ? '' : undefined}>
  <div class="brand-colour__row">
    <span
      class="lp brand-colour__lp"
      data-lp-style={style}
      data-lp-theme={theme}
      data-org-brand={brandStyle ? '' : undefined}
      style={brandStyle}
      aria-hidden="true"
    >
      <span class="brand-colour__swatch" data-lp-scheme={scheme} bind:this={tile}></span>
    </span>
    <span class="brand-colour__text">
      <span class="brand-colour__label" id="{id}-label">{label}</span>
      <span class="brand-colour__source">
        {value ? m.studio_page_editor_brand_overridden() : m.studio_page_editor_brand_inherited()}
      </span>
    </span>
    <button
      type="button"
      class="brand-colour__button"
      aria-expanded={editing}
      aria-controls="{id}-picker"
      aria-describedby="{id}-label"
      onclick={toggle}
    >
      {editing ? m.studio_page_editor_brand_close() : m.studio_page_editor_brand_change()}
    </button>
  </div>
  <div class="brand-colour__picker" id="{id}-picker" hidden={!editing}>
    {#if editing}
      <OklchColorPicker value={seed} swatches={[]} onchange={(hex) => onChange(hex)} />
    {/if}
  </div>
  {#if value}
    <button type="button" class="brand-colour__reset" onclick={() => onChange(undefined)}>
      {m.studio_page_editor_brand_reset()}
    </button>
  {/if}
</div>

<style>
  .brand-colour {
    display: grid;
    gap: var(--space-2);
  }

  .brand-colour__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }

  .brand-colour__lp {
    display: block;
  }

  /* The kit's scheme paints it; nothing here names a colour. */
  .brand-colour__swatch {
    display: block;
    inline-size: var(--space-10);
    block-size: var(--space-10);
    border-radius: var(--radius-md);
    background: var(--lp-bg);
    box-shadow: inset 0 0 0 var(--border-width) var(--lp-line);
  }

  .brand-colour__text {
    display: grid;
    gap: var(--space-0-5);
  }

  .brand-colour__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .brand-colour__source {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .brand-colour[data-overridden] .brand-colour__source {
    color: var(--color-text);
  }

  .brand-colour__button {
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

  .brand-colour__button:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .brand-colour__picker[hidden] {
    display: none;
  }

  .brand-colour__reset {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    cursor: pointer;
  }

  .brand-colour__button:focus-visible,
  .brand-colour__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
