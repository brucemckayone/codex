<!--
  @component BrandFontField

  One page-brand font, through the brand editor's `FontPicker`.

  THE PICKER PREVIEWS ON THE ORGANISATION, and this field undoes that. Its
  hover preview writes `--brand-font-*` onto `.org-layout` (right for the org
  brand editor, which it was built for), and on close it "reverts" to ITS
  value — here the page's font, or nothing — so left alone it would re-font
  the whole studio, or strip the organisation's font until a reload. The org
  layout's own value is captured on mount and put back each time the picker
  closes, and on unmount. The canvas is unaffected: a page font lives on the
  page's own brand wrapper.
-->
<script lang="ts">
  import FontPicker from '$lib/components/brand-editor/FontPicker.svelte';
  import * as m from '$paraglide/messages';

  interface Props {
    mode: 'heading' | 'body';
    label: string;
    /** This page's font, or empty when the organisation's applies. */
    value: string | null | undefined;
    onChange: (family: string | undefined) => void;
  }

  const { mode, label, value, onChange }: Props = $props();

  let orgFamily = $state('');

  function guardOrgFont(root: HTMLElement) {
    const layout = document.querySelector<HTMLElement>('.org-layout');
    if (!layout) return;
    const property = mode === 'heading' ? '--brand-font-heading' : '--brand-font-body';
    const original = layout.style.getPropertyValue(property);
    orgFamily = original.trim().replace(/^['"]|['"]$/g, '');
    const restore = () => {
      if (layout.style.getPropertyValue(property) === original) return;
      if (original) layout.style.setProperty(property, original);
      else layout.style.removeProperty(property);
    };
    const observer = new MutationObserver((records) => {
      const closed = records.some(
        (record) =>
          record.target instanceof Element && record.target.getAttribute('aria-expanded') === 'false'
      );
      if (closed) requestAnimationFrame(restore);
    });
    observer.observe(root, { subtree: true, attributeFilter: ['aria-expanded'] });
    return () => {
      observer.disconnect();
      restore();
    };
  }

  function choose(family: string): void {
    // The picker echoes the family it shows; the org's own is not an override.
    if (!value && family === orgFamily) return;
    onChange(family || undefined);
  }
</script>

<div class="brand-font" data-overridden={value ? '' : undefined} {@attach guardOrgFont}>
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
