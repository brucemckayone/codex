<!--
  @component ArrayField

  THE GENERIC ARRAY CONTROL (`Codex-28ifd`) — the editor for both array-shaped
  control kinds the catalogue declares:

    · `list`     an array of STRINGS  (`ache.points`, `invite.offers[].bullets`)
    · `repeater` an array of OBJECTS  (`guide.facts`, `feel.inclusions`), whose
                 entry shape is the field's own `itemFields`

  One component for both because they are the same interaction — ordered rows,
  add, remove, reorder, a cap — differing only in whether a row is one input or
  several. `itemFields` presence is the discriminant.

  ── WHY THIS EXISTS ────────────────────────────────────────────────────────
  These kinds were DECLARED by F-C and never built, and until recently the
  dispatch fell through to a catch-all `<input type="text">`: a creator saw a
  field labelled "Credentials", typed into it, saved, and got nothing, because
  `coerce.ts`'s `asObjectArray` discards a non-array at its first line. That
  control was removed rather than left corrupting data; this is the real one.

  ── RECOVERING WHAT THE BROKEN CONTROL CAPTURED ────────────────────────────
  A stored STRING on an array key is not treated as absent. The old text box
  persisted real authored copy into these keys — `studio-alpha/bone-deep` still
  holds `facts: "20 years teaching — somatics and grief work"` as a bare string,
  invisible on the published page — so a string is read as a ONE-ROW array and
  shown in the first input. The creator sees their words, in a control that can
  now save them in a shape the renderer reads.

  The alternative (treat a non-array as empty) would render an empty control over
  real stored content, and a creator "filling in the blank" would overwrite it.
  That is the data-loss trap this control was sequenced to avoid, so it must not
  reintroduce it from the other side.

  Nesting is one level by contract: an entry field may be a `list`, never another
  `repeater`. A doubly-nested array is an editor nobody can use, and no renderer
  reads one. The component renders ITSELF for a nested `list`, and the contract is
  what bounds the recursion: a `list` declares no `itemFields`, so its rows are
  single string inputs and there is no third level to reach.

  ── AND THE ENTRY DISPATCH IS THE SAME RULE ────────────────────────────────
  The row cells dispatched on `textarea` ALONE and fell through to that same
  catch-all `<input type="text">` for every other kind — so the bug above was
  reintroduced one nesting level down, on `invite.offers`, the editor for the copy
  at the page's primary conversion moment. Each of the three kinds it swallowed
  corrupts silently, and each was traced to its reader:

    · `id`      declared `select` over three canonical path ids. As free text the
                legal values were never shown, and `readDecorations` drops an
                entry naming no real path — so a creator who typed the label they
                could SEE ("One-off purchase") authored an entry that decorated
                nothing.
    · `bullets` declared `list`. As one text input it persisted a bare STRING into
                a key read by `fieldStringArray`, which returns `[]` for a
                non-array: every bullet typed was discarded.
    · `best`    declared `toggle`. As a text input it wrote a STRING into a key
                read by `fieldBool` (`=== true`), so no value a creator could type
                ever flagged a way in as recommended.

  So an entry field now gets the same real control its top-level twin gets, and
  the branches mirror `SectionEditor`'s own arms so the two dispatches cannot
  drift. A kind with no branch here still lands in the text input — which is
  correct for `text` and wrong for anything else, so
  `section-editor-controls.svelte.test.ts` asserts the ELEMENT KIND per declared
  entry field rather than trusting this list.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { TrashIcon, PlusIcon, ChevronUpIcon, ChevronDownIcon } from '$lib/components/ui/Icon';
  // Self-import, which is how a Svelte 5 component recurses (`<svelte:self>` is
  // the legacy form). Used for ONE case only — a `list` entry field — and the
  // depth bound is the declaration contract, not a counter.
  import ArrayField from './ArrayField.svelte';
  import type { SectionFieldDef } from './section-fields';

  interface Props {
    field: SectionFieldDef;
    /** The stored prop value, whatever shape it is currently in. */
    value: unknown;
    /** Commit the whole array back to the section's props. */
    onchange: (next: unknown[]) => void;
  }

  const { field, value, onchange }: Props = $props();

  /** `repeater` when the field declares an entry shape; `list` otherwise. */
  const isObjectRows = $derived((field.itemFields?.length ?? 0) > 0);
  const itemNoun = $derived(field.itemLabel ?? m.studio_builder_array_item());
  const cap = $derived(field.maxItems ?? Number.POSITIVE_INFINITY);

  /**
   * The stored value as rows, tolerant of every shape the key has held.
   *
   * A bare string becomes one row rather than nothing — see the header note on
   * recovering what the old text box captured.
   */
  const rows = $derived.by((): unknown[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      return [isObjectRows ? { [field.itemFields?.[0]?.key ?? 'label']: value } : value];
    }
    return [];
  });

  const atCap = $derived(rows.length >= cap);

  /** Read one cell for an input `value` — never `undefined`, never a non-string. */
  function cellOf(row: unknown, key?: string): string {
    if (key === undefined) return typeof row === 'string' ? row : '';
    if (row === null || typeof row !== 'object') return '';
    const v = (row as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : '';
  }

  /**
   * Read one cell UNCOERCED — the stored value in whatever shape it holds.
   *
   * A nested `list` needs this rather than {@link cellOf}, which flattens every
   * non-string to `''` and would hand the nested control an empty value over a
   * stored array — the creator would then see a blank list above real content and
   * "fill in the blank" straight over it. That is the same data-loss trap the
   * header note is about, from the other side.
   */
  function rawCellOf(row: unknown, key: string): unknown {
    if (row === null || typeof row !== 'object') return undefined;
    return (row as Record<string, unknown>)[key];
  }

  /** Read one cell as a boolean — `=== true`, the shape `fieldBool` tests for. */
  function boolCellOf(row: unknown, key: string): boolean {
    return rawCellOf(row, key) === true;
  }

  /**
   * Replace one row's cell, preserving every other key on an object row.
   *
   * `next` is the union of the three shapes a cell may legally hold, because that
   * is the point of this control: a `toggle` cell must land as a real boolean and
   * a nested `list` as a real array, or the reader discards it. It is not widened
   * to `unknown` — the union is the contract, and the reader for each kind is
   * named in the header.
   */
  function writeCell(
    index: number,
    key: string | undefined,
    next: string | boolean | unknown[]
  ): void {
    const copy = [...rows];
    if (key === undefined) {
      copy[index] = next;
    } else {
      const existing = copy[index];
      const base = existing !== null && typeof existing === 'object' ? existing : {};
      copy[index] = { ...(base as Record<string, unknown>), [key]: next };
    }
    onchange(copy);
  }

  function addRow(): void {
    if (atCap) return;
    onchange([...rows, isObjectRows ? {} : '']);
  }

  function removeRow(index: number): void {
    onchange(rows.filter((_, i) => i !== index));
  }

  /** Reorder by one step. Order is meaning here — these render as ordered beats. */
  function moveRow(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const copy = [...rows];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    onchange(copy);
  }
</script>

<div class="af">
  {#if rows.length === 0}
    <p class="af__empty">{m.studio_builder_array_empty({ noun: itemNoun })}</p>
  {/if}

  {#each rows as row, i (i)}
    <!-- `{@const}` hoists the narrowed row out of the handler closures below:
         inside an iterator callback the narrowing does not survive into an event
         handler, so the value is bound here instead. -->
    {@const rowIndex = i}
    <div class="af__row" class:af__row--group={isObjectRows}>
      <div class="af__cells">
        {#if isObjectRows}
          {#each field.itemFields ?? [] as sub (sub.key)}
            {#if sub.control === 'list'}
              <!-- A `<div>`, not a `<label>`: a nested list renders MANY inputs,
                   and a label wrapping more than one control labels none of them.
                   The group gets a plain heading and each row labels itself. -->
              <div class="af__cell">
                <span class="af__cell-label">{sub.label}</span>
                <ArrayField
                  field={sub}
                  value={rawCellOf(row, sub.key)}
                  onchange={(next) => writeCell(rowIndex, sub.key, next)}
                />
                {#if sub.hint}
                  <span class="af__cell-hint">{sub.hint}</span>
                {/if}
              </div>
            {:else if sub.control === 'toggle'}
              <label class="af__cell af__cell--inline">
                <input
                  class="af__check"
                  type="checkbox"
                  checked={boolCellOf(row, sub.key)}
                  onchange={(e) => writeCell(rowIndex, sub.key, e.currentTarget.checked)}
                />
                <span class="af__cell-label">{sub.label}</span>
                {#if sub.hint}
                  <span class="af__cell-hint">{sub.hint}</span>
                {/if}
              </label>
            {:else}
              <label class="af__cell">
                <span class="af__cell-label">{sub.label}</span>
                {#if sub.control === 'textarea'}
                  <textarea
                    class="af__input af__input--area"
                    rows="2"
                    placeholder={sub.placeholder}
                    value={cellOf(row, sub.key)}
                    oninput={(e) => writeCell(rowIndex, sub.key, e.currentTarget.value)}
                  ></textarea>
                {:else if sub.control === 'select'}
                  <select
                    class="af__input"
                    value={cellOf(row, sub.key)}
                    onchange={(e) => writeCell(rowIndex, sub.key, e.currentTarget.value)}
                  >
                    <!-- An explicit unset choice, FIRST: without it a new row
                         would read as the first legal value while storing none,
                         and the entry decorates nothing. -->
                    <option value="">{m.studio_builder_array_choose()}</option>
                    {#each sub.options ?? [] as opt (opt.value)}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                {:else}
                  <input
                    class="af__input"
                    type="text"
                    placeholder={sub.placeholder}
                    value={cellOf(row, sub.key)}
                    oninput={(e) => writeCell(rowIndex, sub.key, e.currentTarget.value)}
                  />
                {/if}
                {#if sub.hint}
                  <span class="af__cell-hint">{sub.hint}</span>
                {/if}
              </label>
            {/if}
          {/each}
        {:else}
          <input
            class="af__input"
            type="text"
            placeholder={field.placeholder}
            aria-label={m.studio_builder_array_row_label({
              field: field.label,
              noun: itemNoun,
              index: rowIndex + 1,
            })}
            value={cellOf(row)}
            oninput={(e) => writeCell(rowIndex, undefined, e.currentTarget.value)}
          />
        {/if}
      </div>

      <div
        class="af__tools"
        role="group"
        aria-label={m.studio_builder_array_row_actions({ noun: itemNoun, index: rowIndex + 1 })}
      >
        <button
          type="button"
          class="af__btn"
          title={m.studio_builder_move_up()}
          disabled={rowIndex === 0}
          onclick={() => moveRow(rowIndex, -1)}
        >
          <ChevronUpIcon size={14} />
        </button>
        <button
          type="button"
          class="af__btn"
          title={m.studio_builder_move_down()}
          disabled={rowIndex === rows.length - 1}
          onclick={() => moveRow(rowIndex, 1)}
        >
          <ChevronDownIcon size={14} />
        </button>
        <button
          type="button"
          class="af__btn af__btn--danger"
          title={m.studio_builder_array_remove_row({ noun: itemNoun, index: rowIndex + 1 })}
          onclick={() => removeRow(rowIndex)}
        >
          <TrashIcon size={13} />
        </button>
      </div>
    </div>
  {/each}

  <button type="button" class="af__add" disabled={atCap} onclick={addRow}>
    <PlusIcon size={14} />
    {m.studio_builder_array_add({ noun: itemNoun })}
  </button>
  {#if atCap}
    <p class="af__cap">
      {m.studio_builder_array_cap({ cap })}
    </p>
  {/if}
</div>

<style>
  .af {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .af__empty,
  .af__cap {
    margin: 0;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }

  .af__row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
  }

  /* An object row stacks its cells, so its tools align to the top of the group
     rather than floating beside a single line. */
  .af__row--group {
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-secondary);
  }

  .af__cells {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .af__cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  /* A toggle reads as one line — the box beside its own label, not under it. */
  .af__cell--inline {
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
  }

  .af__cell-label {
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  /* Matches the inspector's own hint register — say what the control does and
     what happens when it is unset. An entry field's hint carried the constraint
     ("Must name a path the course actually offers") and had nowhere to render. */
  .af__cell-hint {
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
  }

  .af__check {
    flex: none;
    width: var(--space-4);
    height: var(--space-4);
    accent-color: var(--color-interactive);
    cursor: pointer;
  }

  .af__check:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .af__input {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }

  .af__input--area {
    resize: vertical;
  }

  .af__input:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .af__tools {
    display: flex;
    gap: var(--space-0-5);
  }

  .af__btn,
  .af__add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    /* The ring goes on `outline`, not inside a shorthand — an edge token that
       resolves to a keyword invalidates whatever list composes it. */
    min-width: var(--tap-target-min, 0);
    min-height: var(--tap-target-min, 0);
    justify-content: center;
  }

  .af__add {
    align-self: flex-start;
    padding: var(--space-1) var(--space-2);
    color: var(--color-interactive);
    font-weight: var(--font-medium);
  }

  .af__btn:hover:not(:disabled),
  .af__add:hover:not(:disabled) {
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .af__btn:disabled,
  .af__add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .af__btn--danger:hover:not(:disabled) {
    border-color: var(--color-error);
    color: var(--color-error);
  }

  .af__btn:focus-visible,
  .af__add:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
</style>
