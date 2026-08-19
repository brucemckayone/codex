<!--
  @component DesignAxisControl

  ONE design axis on ONE section (journey sections · F-B2). The unit the
  inherited-vs-overridden model is made visible in.

  THE PROBLEM IT SOLVES. Resolution is per axis: `section.design[axis]` → page
  `design[axis]` → the axis default. So a control showing only "Wide" is lying by
  omission — it cannot tell the creator whether this section CHOSE wide or is
  simply following the page's look, and therefore cannot tell them that changing
  the page preset will (or will not) move it. Every axis row here states three
  things at once:

    1. the EFFECTIVE value — what the section renders as, selected in the control;
    2. WHERE that value comes from — a chip reading `Inherited` or `Overridden`,
       plus a `· page look` / `· default` suffix on the option it would inherit;
    3. the WAY BACK — a reset button, present only when there is an override to
       clear (a permanently-visible reset would imply an override that is not there).

  A native `<select>` rather than a segmented button row: nine of these stack in a
  narrow inspector rail, the option list is where the inheritance suffix can be
  stated in TEXT (so it reaches a screen reader, not just a colour), and native
  selects are keyboard- and touch-correct without re-implementing a listbox.
-->
<script lang="ts">
  import { Badge } from '$lib/components/ui/Badge';

  interface Props {
    /** Axis label (`AXIS_LABELS[axis]`). */
    label: string;
    /** One line on what the axis does (`AXIS_HINTS[axis]`). */
    hint: string;
    /** Every legal value of this axis, with its creator-facing label. */
    options: readonly { value: string; label: string }[];
    /** The value in force — always set, because `resolveDesign` is total. */
    effective: string;
    /**
     * The value this SECTION sets, or undefined when it inherits. `undefined` vs
     * a string IS the inherited/overridden state — the caller never has to pass a
     * separate flag that could disagree with it.
     */
    override?: string;
    /** What the axis resolves to with no override — the inherited value. */
    inherited: string;
    /** Where that inherited value comes from. */
    inheritedFrom: 'page' | 'default';
    onselect: (value: string) => void;
    onclear: () => void;
  }

  const {
    label,
    hint,
    options,
    effective,
    override,
    inherited,
    inheritedFrom,
    onselect,
    onclear,
  }: Props = $props();

  const isOverridden = $derived(override !== undefined);
  const inheritedLabel = $derived(
    options.find((option) => option.value === inherited)?.label ?? inherited
  );
  const inheritedNote = $derived(
    inheritedFrom === 'page' ? 'page look' : 'default'
  );
  /**
   * The full sentence, wired to the select via `aria-describedby` so the state is
   * announced rather than only shown. It names the value the creator would fall
   * back to, which is the thing a reset button alone leaves implicit.
   */
  const description = $derived(
    isOverridden
      ? `Set on this section. The ${inheritedNote} is ${inheritedLabel}.`
      : `Inherited from the ${inheritedNote} (${inheritedLabel}).`
  );
  const selectId = $derived(`dax-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`);
</script>

<div class="dax" data-state={isOverridden ? 'set' : 'inherited'}>
  <div class="dax__head">
    <label class="dax__label" for={selectId}>{label}</label>
    <!--
      `info`, not `accent`: the accent badge reads `--color-brand-accent`, which
      resolves to the WARNING colour in both themes, and an override is a normal
      creator action rather than a caution. `info` is the status family, so the
      chip and the row's spine below agree on one colour for one state.
    -->
    <Badge variant={isOverridden ? 'info' : 'neutral'}>
      {isOverridden ? 'Overridden' : 'Inherited'}
    </Badge>
  </div>

  <div class="dax__row">
    <select
      id={selectId}
      class="dax__select"
      value={effective}
      aria-describedby={`${selectId}-desc`}
      onchange={(event) => onselect(event.currentTarget.value)}
    >
      {#each options as option (option.value)}
        <option value={option.value}>
          {option.label}{option.value === inherited ? ` · ${inheritedNote}` : ''}
        </option>
      {/each}
    </select>

    {#if isOverridden}
      <button
        type="button"
        class="dax__reset"
        onclick={onclear}
        title={`Use the ${inheritedNote} for ${label.toLowerCase()}`}
      >
        Use {inheritedNote}
      </button>
    {/if}
  </div>

  <p class="dax__desc" id={`${selectId}-desc`}>{description}</p>
  <p class="dax__hint">{hint}</p>
</div>

<style>
  .dax {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-inline-start: var(--space-2);
    /* The overridden state also reads as a coloured spine down the row, so a
       scan of the panel shows WHICH axes this section has opinions about without
       reading nine chips. `transparent` (not `none`) keeps the text aligned
       between the two states. */
    border-inline-start: var(--border-width-thick) var(--border-style) transparent;
  }

  .dax[data-state='set'] {
    border-inline-start-color: var(--color-status-info-border);
  }

  .dax__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .dax__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .dax__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .dax__select {
    flex: 1;
    min-width: 0;
    min-height: var(--tap-target-min);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    transition: var(--transition-colors);
  }

  .dax[data-state='set'] .dax__select {
    border-color: color-mix(
      in oklab,
      var(--color-status-info-border) 60%,
      var(--color-border)
    );
  }

  .dax__reset {
    flex-shrink: 0;
    min-height: var(--tap-target-min);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .dax__reset:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .dax__select:focus-visible,
  .dax__reset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .dax__desc,
  .dax__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }

  /* MEASURED, not assumed (canvas readback, both themes, studio chrome surface):
     `--color-text-muted` at `--text-xs` reads 2.52:1 light / 3.19:1 dark on this
     panel — below the 4.5 floor, and 13px is not WCAG "large text". So the state
     sentence takes `--color-text` (14.5:1) and the axis hint
     `--color-text-secondary` (7.81 / 10.21). The hierarchy is carried by the two
     rungs rather than by dropping one of them under the floor. */
  .dax__desc {
    color: var(--color-text);
  }

  .dax__hint {
    color: var(--color-text-secondary);
  }
</style>
