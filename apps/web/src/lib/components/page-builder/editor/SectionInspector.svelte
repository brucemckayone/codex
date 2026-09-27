<!--
  @component SectionInspector

  Everything about the selected section, top to bottom in the order a creator
  decides it: which section it is (and its own name in the outline), how it
  is arranged, what colour its band is, how much room it has, then its words
  and media, then duplicate · hide · delete.

  Every value SHOWN is the resolved one — what the canvas draws — including
  a Style default that steps back to the page colour so two identical bands
  never touch. Every write goes through the store, so undo, autosave and the
  canvas see it at once.
-->
<script lang="ts">
  import { CopyIcon, EyeIcon, EyeOffIcon, TrashIcon } from '$lib/components/ui/Icon';
  import type { BrandTokenOverrides } from '$lib/page-builder';
  import {
    DEFINITIONS,
    type KitPage,
    type KitSection,
    resolveLayout,
    resolveScheme,
    resolveSections,
    resolveSpacing,
    resolveStyle,
  } from '$lib/page-builder/kit';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import type { JourneySalesContext } from '$lib/page-builder/render/types';
  import * as m from '$paraglide/messages';
  import FieldControl from './FieldControl.svelte';
  import { fieldsForLayout, sameValue } from './field-values';
  import LayoutPicker from './LayoutPicker.svelte';
  import { sectionIcon } from './outline';
  import SchemeSwatches from './SchemeSwatches.svelte';
  import SpacingControl from './SpacingControl.svelte';

  interface Props {
    page: KitPage;
    section: KitSection;
    context: JourneySalesContext;
    brandOverrides?: BrandTokenOverrides | null;
    theme?: 'light' | 'dark';
    onDuplicate: (id: string) => void;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
  }

  const {
    page,
    section,
    context,
    brandOverrides = null,
    theme,
    onDuplicate,
    onToggle,
    onDelete,
  }: Props = $props();

  const id = $props.id();
  const definition = $derived(DEFINITIONS[section.type]);
  const Glyph = $derived(sectionIcon(section.type));
  const style = $derived(resolveStyle(page.design));
  const hidden = $derived(section.enabled === false);

  /** A hidden section is not on the page, so it has no neighbour to step back from. */
  function resolvedIn(target: KitPage) {
    return resolveSections(target).find((s) => s.id === section.id);
  }

  const current = $derived(resolvedIn(page));
  const layout = $derived(current?.layout ?? resolveLayout(section.type, section.variant, style));
  const scheme = $derived(current?.scheme ?? resolveScheme(section.type, section.design, style));
  const spacing = $derived(current?.spacing ?? resolveSpacing(section.design, layout));
  const styleLayout = $derived(resolveLayout(section.type, undefined, style));
  const styleScheme = $derived.by(() => {
    const unset = {
      ...page,
      sections: page.sections.map((s) =>
        s.id === section.id ? { ...s, design: { ...s.design, scheme: undefined } } : s
      ),
    };
    return resolvedIn(unset)?.scheme ?? resolveScheme(section.type, undefined, style);
  });
  // Item fields follow the layout too: a benefits tile's image only shows in `grid`.
  const fields = $derived(
    fieldsForLayout(definition.fields, layout).map((field) =>
      field.itemFields
        ? { ...field, itemFields: fieldsForLayout(field.itemFields, layout) }
        : field
    )
  );

  function writeProp(key: string, value: unknown): void {
    if (sameValue(section.props[key], value)) return;
    pageBuilder.setSectionProp(section.id, key, value);
  }

  function rename(next: string): void {
    const name = next.trim() ? next : undefined;
    if ((section.name ?? undefined) === name) return;
    const sections = $state.snapshot(pageBuilder.sections).map((s) => {
      if (s.id !== section.id) return s;
      const { name: _old, ...rest } = s;
      return name === undefined ? rest : { ...rest, name };
    });
    pageBuilder.updateMeta('sections', sections);
  }
</script>

<div class="section-inspector" data-type={section.type}>
  <header class="section-inspector__head">
    <span class="section-inspector__icon" aria-hidden="true"><Glyph size={18} /></span>
    <div class="section-inspector__heading">
      <h2 class="section-inspector__title">{definition.label}</h2>
      <p class="section-inspector__description">{definition.description}</p>
    </div>
  </header>

  <div class="section-inspector__name">
    <label class="section-inspector__label" for="{id}-name">
      {m.studio_page_editor_section_name()}
    </label>
    <input
      id="{id}-name"
      class="section-inspector__input"
      type="text"
      maxlength="60"
      placeholder={definition.label}
      value={section.name ?? ''}
      aria-describedby="{id}-name-hint"
      oninput={(event) => rename(event.currentTarget.value)}
    />
    <p class="section-inspector__hint" id="{id}-name-hint">
      {m.studio_page_editor_section_name_hint()}
    </p>
  </div>

  {#if hidden}
    <p class="section-inspector__notice" role="status">{m.studio_page_editor_section_hidden()}</p>
  {/if}

  {#if definition.layouts.length > 1}
    <section class="section-inspector__group" aria-labelledby="{id}-layout">
      <h3 class="section-inspector__group-title" id="{id}-layout">
        {m.studio_page_editor_layout_title()}
      </h3>
      <LayoutPicker
        {page}
        {section}
        layouts={definition.layouts}
        value={layout}
        styleDefault={styleLayout}
        {scheme}
        {context}
        {brandOverrides}
        {theme}
        onChoose={(next) => pageBuilder.setSectionLayout(section.id, next)}
      />
    </section>
  {/if}

  <section class="section-inspector__group" aria-labelledby="{id}-colour">
    <h3 class="section-inspector__group-title" id="{id}-colour">
      {m.studio_page_editor_colour_title()}
    </h3>
    <SchemeSwatches
      {style}
      {theme}
      {brandOverrides}
      value={scheme}
      styleDefault={styleScheme}
      chosen={section.design?.scheme !== undefined}
      onChoose={(next) => pageBuilder.setSectionStyle(section.id, { scheme: next })}
      onReset={() => pageBuilder.setSectionStyle(section.id, { scheme: undefined })}
    />
  </section>

  <section class="section-inspector__group" aria-labelledby="{id}-spacing">
    <h3 class="section-inspector__group-title" id="{id}-spacing">
      {m.studio_page_editor_spacing_title()}
    </h3>
    <SpacingControl
      value={spacing}
      chosen={section.design?.spacing !== undefined}
      onChoose={(next) => pageBuilder.setSectionStyle(section.id, { spacing: next })}
      onReset={() => pageBuilder.setSectionStyle(section.id, { spacing: undefined })}
    />
  </section>

  {#if fields.length > 0}
    <section class="section-inspector__group" aria-labelledby="{id}-content">
      <h3 class="section-inspector__group-title" id="{id}-content">
        {m.studio_page_editor_content_title()}
      </h3>
      <div class="section-inspector__fields">
        {#each fields as field (field.key)}
          <FieldControl
            {field}
            value={section.props[field.key]}
            onChange={(next) => writeProp(field.key, next)}
            mediaBaseUrl={context.mediaBaseUrl}
          />
        {/each}
      </div>
    </section>
  {/if}

  <footer class="section-inspector__actions">
    <button type="button" class="section-inspector__action" onclick={() => onDuplicate(section.id)}>
      <CopyIcon size={16} />
      {m.studio_builder_inspector_duplicate()}
    </button>
    <button
      type="button"
      class="section-inspector__action"
      aria-pressed={hidden}
      onclick={() => onToggle(section.id)}
    >
      {#if hidden}<EyeIcon size={16} />{:else}<EyeOffIcon size={16} />{/if}
      {hidden ? m.studio_page_editor_section_show() : m.studio_page_editor_section_hide()}
    </button>
    <button
      type="button"
      class="section-inspector__action"
      data-kind="danger"
      onclick={() => onDelete(section.id)}
    >
      <TrashIcon size={16} />
      {m.studio_builder_inspector_delete()}
    </button>
  </footer>
</div>

<style>
  .section-inspector {
    display: grid;
    gap: var(--space-5);
    padding: var(--space-4);
    color: var(--color-text);
  }

  .section-inspector__head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .section-inspector__icon {
    display: grid;
    place-items: center;
    flex: none;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--color-text) 7%, transparent);
    color: var(--color-text-secondary);
  }

  .section-inspector__heading {
    display: grid;
    gap: var(--space-0-5);
    min-inline-size: 0;
  }

  .section-inspector__title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    line-height: var(--leading-tight);
  }

  .section-inspector__description,
  .section-inspector__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .section-inspector__name,
  .section-inspector__group {
    display: grid;
    gap: var(--space-2);
  }

  .section-inspector__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .section-inspector__input {
    inline-size: 100%;
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .section-inspector__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }

  .section-inspector__notice {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in oklab, var(--color-text) 7%, transparent);
    font-size: var(--text-sm);
  }

  .section-inspector__group {
    padding-block-start: var(--space-4);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  .section-inspector__group-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
  }

  .section-inspector__fields {
    display: grid;
    gap: var(--space-4);
  }

  .section-inspector__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-block-start: var(--space-4);
    border-block-start: var(--border-width) var(--border-style) var(--color-border);
  }

  .section-inspector__action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-block-size: var(--space-8);
    padding: 0 var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .section-inspector__action:hover {
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
  }

  .section-inspector__action[data-kind='danger']:hover {
    border-color: var(--color-error);
  }

  .section-inspector__action:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
  }
</style>
