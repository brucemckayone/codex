<!--
  @component IncludedField

  The pricing section's "What's included" (Codex-61zsk.73): the lines a
  single way in stands beside. Until the creator touches it the list is the
  course's own lines, shown as the canvas draws them; the first edit (a
  rewrite, a move, a delete, a line of their own) writes them out as rows,
  and the rows they leave alone stay live, so their counts follow the
  curriculum. Each row is tagged with where its words come from: Live,
  Rewritten or Your line. "Show this list" switches the list off (`[]`);
  "Reset to the course's lines" takes the key away. The row mechanics are
  every list's (`SortableRows`).
-->
<script lang="ts">
  import { tick } from 'svelte';
  import Switch from '$lib/components/ui/Switch/Switch.svelte';
  import {
    courseRows,
    factLine,
    INCLUDED_LINE_MAX,
    INCLUDED_MAX,
    type IncludedFact,
    type IncludedRow,
  } from '$lib/page-builder/kit/blocks/pricing/included';
  import type { CourseFacts } from '$lib/page-builder/kit/model/facts';
  import * as m from '$paraglide/messages';
  import { moveItem } from './field-values';
  import { editableRows, type IncludedKind, kindOf, oneLine, retyped } from './included-field';
  import SortableRows from './SortableRows.svelte';

  interface Props {
    value: unknown;
    /** The course's shape, as the canvas counts it. */
    facts: CourseFacts;
    /** Whether the page draws the list now: one way in, in a layout with room for it. */
    shown: boolean;
    onChange: (value: IncludedRow[] | undefined) => void;
  }

  const { value, facts, shown, onChange }: Props = $props();

  const FACT_NAMES: Record<IncludedFact, () => string> = {
    stages: m.studio_page_editor_included_fact_stages,
    practices: m.studio_page_editor_included_fact_practices,
    length: m.studio_page_editor_included_fact_length,
    mix: m.studio_page_editor_included_fact_mix,
  };

  const TAGS: Record<IncludedKind, () => string> = {
    live: m.studio_page_editor_included_live,
    rewritten: m.studio_page_editor_included_rewritten,
    own: m.studio_page_editor_included_own,
  };

  const id = $props.id();
  const stored = $derived(editableRows(value));
  const rows = $derived(stored ?? courseRows(facts));
  const on = $derived(stored === null || stored.length > 0);
  const inputs: HTMLTextAreaElement[] = $state([]);
  /**
   * The rows "Show this list" put away when it switched the list off, so
   * switching it back on in the same visit brings the same lines back (undo
   * does too). With none put away it comes back as the course's own.
   */
  let parked: IncludedRow[] | undefined;

  function liveOf(row: IncludedRow): string | null {
    return row.fact ? factLine(row.fact, facts) : null;
  }

  function lineOf(row: IncludedRow): string {
    return row.text ?? liveOf(row) ?? '';
  }

  function sourceOf(row: IncludedRow): string {
    if (!row.fact) return m.studio_page_editor_included_source_own();
    const fact = FACT_NAMES[row.fact]();
    return row.text === undefined
      ? m.studio_page_editor_included_source_live({ fact })
      : m.studio_page_editor_included_source_rewritten({ fact });
  }

  function rowLabel(index: number): string {
    return m.studio_page_editor_row_label({
      field: m.studio_page_editor_included_title(),
      position: String(index + 1),
    });
  }

  /** A row's grip and remove buttons are named by its line, as an item's are by its title. */
  function nameOf(index: number): string {
    const entry = rows[index];
    return (entry && lineOf(entry).trim()) || rowLabel(index);
  }

  function retype(index: number, text: string): void {
    onChange(
      rows.map((row, at) => (at === index ? retyped(row, oneLine(text), liveOf(row)) : row))
    );
  }

  /** Enter would break the line, which the page draws as one. */
  function keepOneLine(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.isComposing) event.preventDefault();
  }

  async function relive(index: number): Promise<void> {
    onChange(rows.map((row, at) => (at === index && row.fact ? { fact: row.fact } : row)));
    await tick();
    inputs[index]?.focus();
  }

  async function add(): Promise<void> {
    const index = rows.length;
    onChange([...rows, { text: '' }]);
    await tick();
    inputs[index]?.focus();
  }

  function show(checked: boolean): void {
    if (checked) {
      onChange(parked);
      parked = undefined;
      return;
    }
    parked = stored ?? undefined;
    onChange([]);
  }

  function reset(): void {
    parked = undefined;
    onChange(undefined);
  }
</script>

<div class="included" role="group" aria-labelledby="{id}-label">
  <div class="included__head">
    <span class="included__label" id="{id}-label">{m.studio_page_editor_included_title()}</span>
    <span class="included__show">
      <span id="{id}-show">{m.studio_page_editor_included_show()}</span>
      <Switch checked={on} aria-labelledby="{id}-show" onCheckedChange={show} />
    </span>
  </div>
  {#if !shown}
    <p class="included__hint" data-note="elsewhere">{m.studio_page_editor_included_elsewhere()}</p>
  {/if}

  {#if on}
    <SortableRows
      count={rows.length}
      max={INCLUDED_MAX}
      labelFor={nameOf}
      addLabel={m.studio_page_editor_included_add()}
      onMove={(from, to) => onChange(moveItem(rows, from, to))}
      onRemove={(index) => onChange(rows.filter((_, at) => at !== index))}
      onAdd={() => void add()}
    >
      {#snippet row(index)}
        {@const entry = rows[index]}
        {@const kind = kindOf(entry)}
        {@const live = liveOf(entry)}
        <div class="included__row" data-kind={kind}>
          <p class="included__meta">
            <span class="included__tag">{TAGS[kind]()}</span>
            <span class="included__source">{sourceOf(entry)}</span>
          </p>
          <!-- A textarea so a long line wraps into view; it stays one line
               (`keepOneLine`, `oneLine`). -->
          <textarea
            class="included__input"
            rows="2"
            aria-label={rowLabel(index)}
            value={lineOf(entry)}
            maxlength={INCLUDED_LINE_MAX}
            placeholder={entry.fact ? undefined : m.studio_page_editor_included_placeholder()}
            bind:this={inputs[index]}
            onkeydown={keepOneLine}
            oninput={(event) => retype(index, event.currentTarget.value)}
          ></textarea>
          {#if kind === 'rewritten' && live}
            <p class="included__hint">
              {m.studio_page_editor_included_course_says({ line: live })}
              <button type="button" class="included__link" onclick={() => void relive(index)}>
                {m.studio_page_editor_included_relive()}
              </button>
            </p>
          {:else if kind === 'live' && !live}
            <p class="included__hint" data-note="waiting">
              {entry.fact === 'length'
                ? m.studio_page_editor_included_waiting_length()
                : m.studio_page_editor_included_waiting()}
            </p>
          {/if}
        </div>
      {/snippet}
    </SortableRows>
    <p class="included__hint">{m.studio_page_editor_included_note()}</p>
  {:else}
    <p class="included__hint" data-note="off">{m.studio_page_editor_included_off()}</p>
  {/if}

  {#if stored !== null}
    <button type="button" class="included__link" onclick={reset}>
      {m.studio_page_editor_included_reset()}
    </button>
  {/if}
</div>

<style>
  .included {
    display: grid;
    gap: var(--space-2);
  }

  .included__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-3);
  }

  .included__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .included__show {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .included__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-secondary);
  }

  .included__row {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-background);
  }

  .included__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0;
  }

  /* The items' "Leads" tag (ItemsField), with a dot on the lines that count. */
  .included__tag {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 8%, transparent);
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-normal);
  }

  [data-kind='live'] .included__tag::before {
    content: '';
    inline-size: var(--space-1-5);
    block-size: var(--space-1-5);
    border-radius: var(--radius-full);
    background: var(--color-success-600);
  }

  .included__source {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  /* Grows with its line, as FieldControl's textarea does, from a one-line
     field; a browser without `field-sizing` shows its two rows. */
  .included__input {
    display: block;
    inline-size: 100%;
    min-block-size: var(--space-10);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-background);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    field-sizing: content;
    resize: none;
  }

  .included__input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--border-width);
  }

  /* SpacingControl's reset: a plain underlined action. */
  .included__link {
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

  .included__hint .included__link {
    font-size: inherit;
  }

  .included__link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-text);
    outline-offset: var(--focus-offset);
    border-radius: var(--radius-xs);
  }
</style>
