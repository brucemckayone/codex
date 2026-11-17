<!--
  @component BrandFontField

  One page-brand font, through the brand editor's `FontPicker`.

  THE PICKER PREVIEWS ON THE ORGANISATION: its hover preview writes
  `--brand-font-*` onto `.org-layout` (right for the org brand editor, which
  it was built for). Each preview puts back what it found when it ends, so the
  organisation's font survives it (Codex-q01h8). The canvas is unaffected: a
  page font lives on the page's own brand wrapper.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import FontPicker from '$lib/components/brand-editor/FontPicker.svelte';
  import * as m from '$paraglide/messages';
  import { orgFontFamily } from './org-fonts';

  interface Props {
    mode: 'heading' | 'body';
    label: string;
    /** This page's font, or empty when the organisation's applies. */
    value: string | null | undefined;
    onChange: (family: string | undefined) => void;
  }

  const { mode, label, value, onChange }: Props = $props();

  // The organisation's own family, which the picker shows when the page has
  // none. Read on mount, before the picker can preview over it.
  let orgFamily = $state('');

  onMount(() => {
    orgFamily = orgFontFamily(mode);
  });

  function choose(family: string): void {
    // The picker echoes the family it shows; the org's own is not an override.
    if (!value && family === orgFamily) return;
    onChange(family || undefined);
  }
</script>

<div class="brand-font" data-overridden={value ? '' : undefined}>
  <FontPicker {mode} {label} value={value || orgFamily} onValueChange={choose} />
  <div class="brand-font__meta">
    <span class="brand-font__source">
      {value ? m.studio_page_editor_brand_overridden() : m.studio_page_editor_brand_inherited()}
    </span>
    {#if value}
      <button type="button" class="brand-font__reset" onclick={() => onChange(undefined)}>
        {m.studio_page_editor_brand_reset()}
      </button>
    {/if}
  </div>
</div>

<style>
  .brand-font {
    display: grid;
    gap: var(--space-1);
  }

  .brand-font__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .brand-font__source {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .brand-font[data-overridden] .brand-font__source {
    color: var(--color-text);
  }

  .brand-font__reset {
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

  .brand-font__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
