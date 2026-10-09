<!--
  @component Inspector

  The inspector's content (the region is `BuilderShell`'s): the selected
  section's controls, or — with nothing selected — the page as a whole.
  Keyed on the section id, so switching sections starts each one's controls
  fresh (an item row left open in one section never opens in the next).
-->
<script lang="ts">
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import type { KitPage } from '$lib/page-builder/kit';
  import type { JourneySalesContext } from '$lib/page-builder/render/types';
  import PageInspector from './PageInspector.svelte';
  import SectionInspector from './SectionInspector.svelte';

  interface Props {
    page: KitPage;
    selectedId: string | null;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
    onDuplicate: (id: string) => void;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onChangeStyle: () => void;
  }

  const {
    page,
    selectedId,
    context,
    brandOverrides = null,
    theme,
    onDuplicate,
    onToggle,
    onDelete,
    onChangeStyle,
  }: Props = $props();

  const section = $derived(page.sections.find((s) => s.id === selectedId) ?? null);
</script>

{#if section}
  {#key section.id}
    <SectionInspector
      {page}
      {section}
      {context}
      {brandOverrides}
      {theme}
      {onDuplicate}
      {onToggle}
      {onDelete}
    />
  {/key}
{:else}
  <PageInspector {page} {onChangeStyle} />
{/if}
