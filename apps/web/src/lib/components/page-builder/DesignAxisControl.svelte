<!--
  @component DesignAxisControl

  ONE design axis on ONE section (journey sections · F-B2). The unit the
  inherited-vs-overridden model is made visible in.

  THE PROBLEM IT SOLVES. Resolution is per axis: `section.design[axis]` → page
  `design[axis]` → the axis default. So a control showing only "Wide" is lying by
  omission — it cannot tell the creator whether this section CHOSE wide or is
  simply following the page's look, and therefore cannot tell them that changing
  the page preset will (or will not) move it. Every axis row states three things:

    1. the EFFECTIVE value — what the section renders as, selected in the control;
    2. WHERE that value comes from;
    3. the WAY BACK — a reset, present only when there is an override to clear (a
       permanently-visible reset would imply an override that is not there).

  ONE LINE PER AXIS, AND WHY THAT IS NOT A LOSS OF ANY OF THE THREE. Nine of
  these stack in a 360px rail. The first shape stated (2) twice in ink — an
  `Inherited` / `Overridden` chip on its own line, PLUS a sentence naming the
  fallback value — and kept the axis hint permanently below it. MEASURED on
  of-blood-and-bones/bone-deep at 1512×950: one row 117px, the nine 1056px, a
  third of a 3573px inspector. Eight of those chips read `Inherited`, which is
  the default and the unremarkable case; the control the creator came for was the
  least prominent thing in its own row.

  So (2) is now carried by three signals that cost no vertical space, all of
  which were already here:

    · the coloured SPINE and the tinted select border mark which axes this
      section has opinions about — scannable down the whole group at once;
    · the OPTION LIST still suffixes the inherited value with `· page look` /
      `· default`. In TEXT, which is the reason this is a native `<select>` and
      not a segmented button row: the inheritance is readable by a screen reader
      rather than encoded in a colour;
    · the RESET's presence IS the override signal, and its accessible name states
      the value being returned to.

  NOTHING ANNOUNCED BEFORE IS ANNOUNCED LESS. The state sentence is kept in the
  DOM as `sr-only` and still wired through `aria-describedby`; only its ink is
  gone, replaced by the three signals above. The axis hint JOINS it there, which
  is a gain — the hint was visible-only and reached assistive tech not at all.
  Visually the hint is revealed on hover or focus as an overlay, absolutely
  positioned so revealing it cannot reflow the row under the pointer.
-->
<script lang="ts">
  import { XIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';

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
    inheritedFrom === 'page'
      ? m.studio_builder_axis_source_page()
      : m.studio_builder_axis_source_default()
  );
  /**
   * The full sentence, wired to the select via `aria-describedby` so the state is
   * announced rather than only shown. It names the value the creator would fall
   * back to, which is the thing a reset button alone leaves implicit.
   */
  const description = $derived(
    isOverridden
      ? m.studio_builder_axis_desc_overridden({ source: inheritedNote, value: inheritedLabel })
      : m.studio_builder_axis_desc_inherited({ source: inheritedNote, value: inheritedLabel })
  );
  /**
   * The reset's accessible name, and its tooltip. This is where the words the
   * chip used to spend a whole line on now live — it names the axis AND the value
   * being returned to, so an icon-only control is still self-describing.
   */
  const resetName = $derived(
    m.studio_builder_axis_use_source_title({
      source: inheritedNote,
      axis: label.toLowerCase(),
    })
  );
  const selectId = $derived(`dax-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`);
</script>

<div class="dax" data-state={isOverridden ? 'set' : 'inherited'}>
  <label class="dax__label" for={selectId}>{label}</label>

  <select
    id={selectId}
    class="dax__select"
    value={effective}
    aria-describedby={`${selectId}-desc ${selectId}-hint`}
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
      aria-label={resetName}
      title={resetName}
    >
      <XIcon size={14} />
    </button>
  {/if}

  <p class="sr-only" id={`${selectId}-desc`}>{description}</p>
  <p class="dax__hint" id={`${selectId}-hint`}>{hint}</p>
</div>

<style>
  .dax {
    position: relative;
    display: grid;
    /* BOTH outer columns are fixed, and each fixes a different raggedness.
       The label column, so every select starts at one x rather than wherever its
       own label happens to end. The reset column RESERVED rather than `auto`,
       because `auto` collapses on the rows that inherit — MEASURED: the two
       inheriting axes' selects grew past the seven overridden ones, ending the
       group at three different right edges. An empty 28px column costs nothing
       and buys one straight edge down the whole group. */
    grid-template-columns: 4.75rem 1fr var(--space-7);
    align-items: center;
    gap: var(--space-2);
    padding-inline-start: var(--space-2);
    /* The overridden state also reads as a coloured spine down the row, so a
       scan of the panel shows WHICH axes this section has opinions about without
       reading nine chips. `transparent` (not `none`) keeps the text aligned
       between the two states — and an edge token of `none` would poison the
       shorthand rather than merely hide the line. */
    border-inline-start: var(--border-width-thick) var(--border-style) transparent;
  }

  .dax[data-state='set'] {
    border-inline-start-color: var(--color-status-info-border);
  }

  .dax__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
  }

  .dax__select {
    /* `min-width: 0` so a long option label shrinks the select instead of
       widening the grid and pushing the reset out of the rail. */
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 28px: clears WCAG 2.2 AA 2.5.8's 24px target floor while keeping the row on
       one line. The select beside it still carries the full `--tap-target-min`,
       so the row's primary control is unaffected. */
    inline-size: var(--space-7);
    block-size: var(--space-7);
    padding: 0;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
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

  /*
    The axis hint: in the DOM and in `aria-describedby` at all times, revealed
    visually only while the row is hovered or focused.

    `opacity`, NOT `visibility: hidden` or `display: none` — those two remove a
    node from the accessibility tree, which would silently unwire the
    `aria-describedby` this element exists to serve. Absolutely positioned, so
    revealing it overlays what follows instead of reflowing the row out from
    under the pointer that triggered it.
  */
  .dax__hint {
    position: absolute;
    inset-inline: 0;
    top: 100%;
    z-index: var(--z-tooltip);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-secondary);
    /* MEASURED ON THE SURFACE THIS ACTUALLY PAINTS ON, which is the whole point
       of re-measuring: the hint now sits on `--color-surface-secondary` (its own
       overlay), not on the panel, and `panel-contrast.test.ts`'s note is explicit
       that the ratio is a function of the background and not a constant.

       Canvas readback, of-blood-and-bones, LIGHT theme, 13px computed:
         --color-text-secondary on --color-surface-secondary   7.57:1
         the same ink on the panel background, for comparison  8.28:1
       So the overlay costs 0.71 and stays clear of the 4.5 floor — and 13px is
       not WCAG "large text", so 4.5 is the floor with no exemption.

       `--color-text-muted` is what this must NOT be: 2.52:1 light on this panel,
       i.e. failing before the overlay makes it worse. DARK is not quoted because
       this org declares no dark overrides, so a figure read here would not
       reproduce — that gap is `Codex-ckqbi`, not something to guess at. */
    color: var(--color-text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-out);
  }

  .dax:hover .dax__hint,
  .dax:focus-within .dax__hint {
    opacity: 1;
  }
</style>
