<!--
  @component SectionGallery

  "Add a section": every section type, grouped the way a sales page is told,
  each shown as a REAL render of its sample content in this page's Style,
  brand and theme — so a creator chooses what they can see. A type the page
  already has as many of as it may (one hero) is shown, disabled, with the
  reason. A dialog rather than a popover: it opens from every '+' on the
  canvas and from the outline, and Melt's popover anchors to one trigger.
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    DEFINITIONS,
    GROUP_ORDER,
    type KitPage,
    type PageStyleId,
    SECTION_TYPE_IDS,
    type SectionTypeId,
    sampleContext,
  } from '$lib/page-builder/kit';
  import * as m from '$paraglide/messages';
  import MiniPreview from './MiniPreview.svelte';

  interface Props {
    open: boolean;
    style: PageStyleId;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
    /** The section the new one goes after; null for the top of the page. */
    afterLabel: string | null;
    /** How many sections of each type the page already has (hidden included). */
    counts: Partial<Record<SectionTypeId, number>>;
    onChoose: (type: SectionTypeId) => void;
    /** Where focus returns when the gallery closes. */
    returnFocus?: () => HTMLElement | null;
  }

  let {
    open = $bindable(),
    style,
    brandOverrides = null,
    theme,
    afterLabel,
    counts,
    onChoose,
    returnFocus,
  }: Props = $props();

  // Sample content prices and lists itself against a sample course, offer and
  // curriculum. Built per gallery, never at module scope (sample.ts).
  const context = sampleContext();

  const groups = $derived(
    GROUP_ORDER.map((group) => ({
      ...group,
      types: SECTION_TYPE_IDS.filter((type) => DEFINITIONS[type].group === group.id),
    })).filter((group) => group.types.length > 0)
  );

  function samplePageOf(type: SectionTypeId): KitPage {
    return {
      design: { style },
      sections: [
        { id: `gallery-${type}`, type, enabled: true, props: { ...DEFINITIONS[type].sample } },
      ],
    };
  }

  function atMax(type: SectionTypeId): boolean {
    const max = DEFINITIONS[type].max;
    return max !== undefined && (counts[type] ?? 0) >= max;
  }

  function choose(type: SectionTypeId): void {
    open = false;
    onChoose(type);
  }
</script>

<Dialog.Root bind:open closeFocus={() => returnFocus?.() ?? null}>
  <Dialog.Content size="lg" class="gallery">
    <Dialog.Header>
      <Dialog.Title>{m.studio_builder_add_section()}</Dialog.Title>
      <Dialog.Description>
        {afterLabel
          ? m.studio_page_editor_picker_after({ section: afterLabel })
          : m.studio_page_editor_picker_top()}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
      <div class="gallery__groups">
        {#each groups as group (group.id)}
          <section class="gallery__group" aria-labelledby="gallery-group-{group.id}">
            <h3 class="gallery__group-title" id="gallery-group-{group.id}">{group.label}</h3>
            <ul class="gallery__list">
              {#each group.types as type (type)}
                {@const definition = DEFINITIONS[type]}
                {@const full = atMax(type)}
                <li>
                  <button
                    type="button"
                    class="gallery__item"
                    data-type={type}
                    disabled={full}
                    aria-label={m.studio_page_editor_gallery_add({ section: definition.label })}
                    aria-describedby="gallery-{type}-description"
                    onclick={() => choose(type)}
                  >
                    <MiniPreview
                      class="gallery__thumb"
                      page={samplePageOf(type)}
                      {context}
                      {brandOverrides}
                      {theme}
                    />
                    <span class="gallery__label">{definition.label}</span>
                    <span class="gallery__description" id="gallery-{type}-description">
                      {full ? m.studio_page_editor_picker_at_max() : definition.description}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    </Dialog.Body>
  </Dialog.Content>
</Dialog.Root>

<style>
  .gallery__groups {
    display: grid;
    gap: var(--space-6);
  }

  .gallery__group {
    display: grid;
    gap: var(--space-2);
  }

  .gallery__group-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .gallery__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 12.5rem), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .gallery__item {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    inline-size: 100%;
    block-size: 100%;
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
  }

  .gallery__item:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .gallery__item:disabled {
    cursor: default;
  }

  .gallery__item:disabled :global(.gallery__thumb) {
    opacity: 0.45;
  }

  .gallery__item:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: calc(var(--focus-offset) * -1);
  }

  .gallery__item :global(.gallery__thumb) {
    margin-block-end: var(--space-1);
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 var(--border-width) var(--color-border);
  }

  .gallery__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .gallery__description {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }
</style>
