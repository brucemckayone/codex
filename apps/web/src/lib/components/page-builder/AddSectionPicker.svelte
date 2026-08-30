<!--
  @component AddSectionPicker

  The add-section picker (Codex-2pryk.3.3 · WP-5): a search field over the
  course-template section catalogue (`$lib/page-builder` `SECTION_CATALOG`) with
  a filtered, keyboard-reachable list. Picking a section calls `onadd(type)`;
  the store appends it. Pure catalogue search — reuses the frozen inert
  `sectionMatchesQuery` matcher so the editor and any future consumer rank the
  same way.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import {
    listSectionDefinitions,
    sectionMatchesQuery,
    type SectionDefinition,
  } from '$lib/page-builder';
  import { SearchIcon } from '$lib/components/ui/Icon';
  import { sectionIcon } from './section-icons';

  interface Props {
    /** Add a section of this type to the page. */
    onadd: (type: string) => void;
    /** Close the picker without adding. */
    onclose?: () => void;
  }

  const { onadd, onclose }: Props = $props();

  let query = $state('');

  const matches = $derived<readonly SectionDefinition[]>(
    listSectionDefinitions().filter((def) => sectionMatchesQuery(def, query))
  );

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onclose?.();
    }
  }
</script>

<div class="add-picker" role="group" aria-label={m.studio_builder_add_section()}>
  <div class="add-picker__search">
    <SearchIcon size={15} />
    <input
      type="text"
      class="add-picker__input"
      placeholder={m.studio_builder_add_section_search_placeholder()}
      aria-label={m.studio_builder_add_section_search()}
      bind:value={query}
      onkeydown={onKeydown}
    />
  </div>

  {#if matches.length > 0}
    <ul class="add-picker__list" role="list">
      {#each matches as def (def.type)}
        <!-- A design-system icon, not the catalogue's glyph string. `IconBase`
             marks it aria-hidden, so the row is named by its label alone. -->
        {@const Icon = sectionIcon(def.type)}
        <li>
          <button type="button" class="add-picker__item" onclick={() => onadd(def.type)}>
            <span class="add-picker__glyph"><Icon size={16} /></span>
            <span class="add-picker__text">
              <span class="add-picker__label">{def.label}</span>
              <span class="add-picker__summary">{def.summary}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="add-picker__empty">{m.studio_builder_add_section_no_match({ query })}</p>
  {/if}
</div>

<style>
  .add-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
  }

  .add-picker__search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    /* Paints the search glyph, which is the only thing marking this box as a
       search field — WCAG 1.4.11's 3:1 non-text floor, not decoration. */
    color: var(--color-text-secondary);
  }

  .add-picker__input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .add-picker__input:focus {
    outline: none;
  }

  /* The ONE muted string this file keeps, and the guard in
     `components/page-builder/panel-contrast.test.ts` allow-lists `::placeholder`
     for exactly this reason: placeholder text must read as ABSENT so a creator
     can tell an empty field from a filled one. Mirrors
     `SectionEditor.svelte`'s note on the same exemption. */
  .add-picker__input::placeholder {
    color: var(--color-text-muted);
  }

  .add-picker__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    max-height: var(--space-64, 20rem);
    overflow-y: auto;
  }

  .add-picker__item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    text-align: left;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .add-picker__item:hover {
    background-color: var(--color-surface-secondary);
  }

  .add-picker__item:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .add-picker__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
    color: var(--color-text-secondary);
  }

  .add-picker__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .add-picker__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* The one-line description that distinguishes one catalogue entry from
     another — "A montage of moments / practices from inside the journey." It is
     what a creator reads to CHOOSE, so it cannot be the weakest ink on the
     panel: muted measures 2.52:1 light / 3.19:1 dark at `--text-xs` against a
     4.5 floor, secondary 7.81 / 10.21 (Codex-6nb7i). */
  .add-picker__summary {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  /* The no-results state. An empty-state message is the only text on screen
     when it shows, so it is never decoration. */
  .add-picker__empty {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
