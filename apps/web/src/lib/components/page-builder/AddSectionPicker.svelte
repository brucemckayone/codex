<!--
  @component AddSectionPicker

  The add-section catalogue (Codex-2pryk.3.3 · WP-5): a search field over the
  course-template section catalogue (`$lib/page-builder` `SECTION_CATALOG`) and a
  GRID of the section types it offers. Picking one calls `onadd(type)`; the store
  appends it. Pure catalogue search — reuses the frozen inert
  `sectionMatchesQuery` matcher so the editor and any future consumer rank the
  same way.

  ── WHY A GRID, AND WHY THE RAIL VERSION TAKES THE WHOLE RAIL ──────────────
  This was a DISCLOSURE inside the 260px sections rail: opening it pushed a
  bordered card in above the section list, so the list it was meant to add to
  slid 468px down the rail, and the catalogue itself became a 320px scroll box
  holding 1036px of content — 3 of 11 section types visible, in one column, each
  209px wide. Two nested scroll regions stacked in a 260px column, and the thing
  you were editing displaced by the thing you were choosing from.

  So the rail version is no longer a disclosure at all. `SectionList` REPLACES
  itself with this panel (`mode="panel"`), the rail widens while it is open, and
  the whole catalogue lays out as a grid — nothing is displaced, because nothing
  else is on screen. The in-canvas version (`mode="popover"`) keeps the bordered
  floating card it has always been; it is anchored to a block's toolbar and has a
  scrim, so it cannot take a whole column over.

  The grid is `auto-fill` rather than a fixed column count, so the SAME markup is
  3-up in the widened rail and 2-up in the 272px popover with no mode-specific
  layout rule.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import {
    firstSectionMatch,
    listSectionDefinitions,
    sectionMatchesQuery,
    type SectionDefinition,
  } from '$lib/page-builder';
  import { ChevronLeftIcon, SearchIcon, XIcon } from '$lib/components/ui/Icon';
  import { sectionIcon } from './section-icons';

  interface Props {
    /** Add a section of this type to the page. */
    onadd: (type: string) => void;
    /** Close the picker without adding. */
    onclose?: () => void;
    /**
     * Which of the two surfaces this is drawn on.
     *
     * `'panel'` — the sections rail, where this component has REPLACED the
     * section list. It owns the whole column, so it carries a "back to sections"
     * control and no border of its own: it IS the rail, and a card outline
     * inside a column it already fills is a box drawn around nothing.
     *
     * `'popover'` — the in-canvas floating picker anchored to a block toolbar.
     * It is a card over other content, so it keeps its border, and its dismiss
     * control is a close X rather than a "back", because there is nothing behind
     * it to go back to.
     *
     * REPLACES the old `focusOnMount` prop, which encoded the same rail/canvas
     * split for a different purpose: the rail copy deliberately did NOT take
     * focus, because it opened next to the button that revealed it and a creator
     * might only have wanted to look. That reasoning died with the disclosure —
     * the rail version now replaces the section list outright, so opening it is
     * a committed mode switch and the search field is the right landing spot on
     * BOTH surfaces. A prop whose two values had become the same value is worse
     * than no prop, so the focus move is now unconditional.
     */
    mode?: 'panel' | 'popover';
  }

  const { onadd, onclose, mode = 'panel' }: Props = $props();

  // `$props.id()` may only be a bare top-level const — it is a compile error
  // inside a template literal (see `render/sections/InviteSection.svelte`), so
  // the derived id is a second line rather than an interpolation.
  const uid = $props.id();
  const headingId = `${uid}-title`;

  let query = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);

  const total = listSectionDefinitions().length;

  // Unconditional: see `mode`. Reads only `searchInput`, which is assigned once
  // on mount, so this fires once per instance.
  $effect(() => {
    searchInput?.focus();
  });

  const matches = $derived<readonly SectionDefinition[]>(
    listSectionDefinitions().filter((def) => sectionMatchesQuery(def, query))
  );

  /**
   * The one line that says how much of the catalogue is on screen, and the
   * picker's only live region.
   *
   * ALWAYS POPULATED, deliberately. A live region that is created empty and
   * filled in the same tick frequently does not announce at all — the region has
   * to be registered before its content changes. Rendering the unfiltered count
   * ("11 section types") keeps it registered AND is worth reading: it is the
   * only place the size of the catalogue is stated.
   */
  const status = $derived(
    matches.length === 0
      ? m.studio_builder_add_section_no_match({ query })
      : query.trim() === ''
        ? m.studio_builder_add_section_total({ total })
        : m.studio_builder_add_section_filtered({ count: matches.length, total })
  );

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onclose?.();
      return;
    }
    // Enter adds the first match in ship order. `firstSectionMatch` has carried
    // the docstring "the jump target for the add-picker" since it was written
    // and had no caller until now; it returns null on an empty query, so Enter
    // in an untouched field cannot add a section nobody chose.
    if (event.key === 'Enter') {
      const first = firstSectionMatch(query);
      if (!first) return;
      event.preventDefault();
      onadd(first.type);
    }
  }
</script>

<div class="add-picker" data-mode={mode} role="group" aria-labelledby={headingId}>
  <div class="add-picker__head">
    {#if mode === 'panel'}
      <button type="button" class="add-picker__back" onclick={() => onclose?.()}>
        <ChevronLeftIcon size={14} />
        {m.studio_builder_add_section_back()}
      </button>
    {/if}

    <div class="add-picker__headline">
      <h2 class="add-picker__title" id={headingId}>{m.studio_builder_add_section()}</h2>
      {#if mode === 'popover'}
        <button
          type="button"
          class="add-picker__close"
          aria-label={m.studio_builder_canvas_close_picker()}
          onclick={() => onclose?.()}
        >
          <XIcon size={14} />
        </button>
      {/if}
    </div>

    <div class="add-picker__search">
      <SearchIcon size={15} />
      <input
        bind:this={searchInput}
        type="text"
        class="add-picker__input"
        placeholder={m.studio_builder_add_section_search_placeholder()}
        aria-label={m.studio_builder_add_section_search()}
        bind:value={query}
        onkeydown={onKeydown}
      />
    </div>

    <p class="add-picker__status" data-empty={matches.length === 0} aria-live="polite">
      {status}
    </p>
  </div>

  {#if matches.length > 0}
    <ul class="add-picker__list" role="list">
      {#each matches as def (def.type)}
        <!-- A design-system icon, not the catalogue's glyph string. `IconBase`
             marks it aria-hidden, so the card is named by its label and summary
             alone. -->
        {@const Icon = sectionIcon(def.type)}
        <li>
          <button type="button" class="add-picker__item" onclick={() => onadd(def.type)}>
            <span class="add-picker__glyph"><Icon size={17} /></span>
            <span class="add-picker__label">{def.label}</span>
            <span class="add-picker__summary">{def.summary}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .add-picker {
    /*
      The grid's column minimum. A local custom property rather than an inline
      literal so the one number that decides the column count is named, and in
      `rem` rather than `px` so it tracks the root font size like the type it
      has to hold.

      7rem = 112px. It is chosen against the two real container widths: the
      widened rail (420px, inner 396px) fits 3 columns and not 4, and the
      272px canvas popover (inner ~248px) fits 2 and not 3. Both with margin —
      the nearest boundary is 44px away — so a scrollbar appearing does not
      re-flow the grid.
    */
    --add-picker-card-min: 7rem;

    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    background-color: var(--color-surface);
  }

  /* The panel IS the rail column, so it draws no outline of its own; the popover
     is a card floating over the canvas, so it keeps one. `.jbc-addpop` supplies
     the shadow and the radius on that surface. */
  .add-picker[data-mode='popover'] {
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
  }

  .add-picker__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /*
    STICKY, and only in the rail. The rail scrolls (`.jb__outline` is
    `overflow-y: auto`) and on a short viewport the grid runs past the fold, so
    the search field and the way back have to stay reachable without scrolling
    up. Pinned to the panel's own padding edge, hence the negative inset pair:
    the header spans the padding it is inset by, so nothing shows through beside
    it as cards pass underneath.
  */
  .add-picker[data-mode='panel'] .add-picker__head {
    position: sticky;
    top: calc(var(--space-3) * -1);
    margin-inline: calc(var(--space-3) * -1);
    padding: var(--space-3) var(--space-3) var(--space-2);
    background-color: var(--color-surface);
  }

  .add-picker__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    align-self: flex-start;
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    /* The way out of the panel. It is the only control that restores the section
       list, so it is never decoration. */
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .add-picker__back:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .add-picker__back:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .add-picker__headline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .add-picker__title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .add-picker__close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    flex-shrink: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    /* Icon-only, so the glyph IS the control and WCAG 1.4.11's 3:1 non-text
       floor applies. */
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .add-picker__close:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .add-picker__close:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
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

  /*
    The focus ring belongs to the BOX, not the bare input. The input suppresses
    its own outline (it has no border of its own — the wrapper draws the field),
    so without this the search field had NO focus indicator at all: a WCAG 2.4.7
    fail on the picker's first tab stop.

    `:focus-within` rather than `:has(… :focus-visible)`: a text field
    conventionally shows focus when it is clicked as well as when it is tabbed
    to, because the caret is already there.
  */
  .add-picker__search:focus-within {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
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

  /* The catalogue-size / result-count line, and the no-match message when the
     search empties the grid. Either way it is the only statement of what the
     search just did, so it is never decoration. */
  .add-picker__status {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  /* When it IS the empty state it carries the whole screen, so it stops being a
     caption and gets room. */
  .add-picker__status[data-empty='true'] {
    padding: var(--space-4) 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .add-picker__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--add-picker-card-min), 1fr));
    gap: var(--space-2);
  }

  /* The `<li>` keeps a box — `display: contents` would drop it, and with it the
     list semantics `role="list"` is here to protect. It is the grid item; the
     button fills it, so every card in a row is the height of the tallest. */
  .add-picker__list > li {
    display: flex;
    min-width: 0;
  }

  .add-picker__item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
    padding: var(--space-2-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    /* Transparent by default: a card earns a fill on hover, it does not start
       with one. */
    background: none;
    text-align: left;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .add-picker__item:hover {
    border-color: var(--color-interactive);
    background-color: var(--color-surface-secondary);
  }

  .add-picker__item:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .add-picker__glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-7);
    flex-shrink: 0;
    margin-bottom: var(--space-0-5);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    color: var(--color-text-secondary);
  }

  /* The plate has to stay legible once the card itself takes the secondary
     surface on hover. */
  .add-picker__item:hover .add-picker__glyph {
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  .add-picker__label {
    max-width: 100%;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  /* The one-line description that distinguishes one catalogue entry from
     another — "A montage of moments / practices from inside the journey." It is
     what a creator reads to CHOOSE, so it cannot be the weakest ink on the
     panel: muted measures 2.52:1 light / 3.19:1 dark at `--text-xs` against a
     4.5 floor, secondary 7.81 / 10.21 (Codex-6nb7i).

     Clamped at three lines, which is what a ~126px column fits: the longest
     summary in the catalogue is 63 characters and three lines hold ~54, so the
     tail of one or two entries is elided rather than setting the height of every
     card in its row. The pair of properties follows `ContentCard.svelte` — the
     unprefixed `line-clamp` alone does not yet clamp in WebKit. */
  .add-picker__summary {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
    max-width: 100%;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }
</style>
