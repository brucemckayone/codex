<!--
  @component PageDesignPanel

  The "Look" page-mode panel (journey sections · F-B2) — the eight-preset picker
  that writes `PageBuilderState.design`, the page-level design-axis bundle every
  section inherits per axis
  (`docs/design/journey-sections/02-axis-contract.md` A21, research §4).

  WHOLE BUNDLES, NOT AXES, AT PAGE LEVEL. A preset is a coherent look: its nine
  values were chosen together (the research measures contrast per family), so the
  page-level control writes all nine or none. Per-axis freedom is deliberate at
  SECTION level, where "a vast hero above a compact FAQ" is good design — see
  `DesignAxisControl`.

  WHY THE RESOLVED SUMMARY IS SHOWN. A preset name alone is opaque, and the panel
  would be unreadable to anyone who has not read the research. The summary lists
  what an inheriting section actually gets, resolved through the same
  `resolveDesign` the renderer uses — so it also surfaces the case where the stored
  bundle is partial and some axes are falling back to their defaults.

  IT ALSO SAYS WHAT A PRESET WILL NOT DO: sections carrying their own overrides are
  named, because a creator who has overridden three sections and then switches
  preset would otherwise read those three as broken.
-->
<script lang="ts">
  import {
    findSectionDefinition,
    resolveDesign,
    SECTION_DESIGN_AXES,
  } from '$lib/page-builder';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { Badge } from '$lib/components/ui/Badge';
  import {
    AXIS_LABELS,
    AXIS_VALUE_LABELS,
    findDesignPreset,
    SECTION_DESIGN_PRESETS,
  } from './design-vocabulary';

  const pending = $derived(pageBuilder.pending);

  /** Which preset the stored bundle IS, or null → "Custom". */
  const current = $derived(findDesignPreset(pending?.design));

  /**
   * What a section that overrides nothing resolves to. Passed `null` for the
   * section, so this is page → default only — the same call the renderer makes.
   */
  const resolved = $derived(resolveDesign(null, pending));

  /** Sections with at least one axis of their own, in page order. */
  const overriding = $derived(
    (pending?.sections ?? [])
      .filter((section) => Object.keys(section.design ?? {}).length > 0)
      .map(
        (section) =>
          section.name ??
          findSectionDefinition(section.type)?.label ??
          section.type
      )
  );
</script>

{#if pending}
  <div class="panel">
    <header class="panel__head">
      <h2 class="panel__title">Look</h2>
      <p class="panel__sub">Page-level</p>
    </header>

    <p class="panel__note">
      Every section inherits these settings. Any section can override them one at a
      time in its own Design group.
    </p>

    <div class="panel__current">
      <span class="panel__current-label">This page</span>
      <!--
        Always NEUTRAL. The selected preset CARD already carries the state (its
        `aria-pressed` + interactive border), so a coloured chip here would be a
        second signal for the same fact — and the only brand-accent badge variant
        resolves to the warning colour, which "this is your look" is not.
      -->
      <Badge>{current ? current.name : 'Custom'}</Badge>
    </div>

    <div class="panel__presets">
      {#each SECTION_DESIGN_PRESETS as preset (preset.id)}
        <button
          type="button"
          class="preset"
          class:preset--on={current?.id === preset.id}
          aria-pressed={current?.id === preset.id}
          onclick={() => pageBuilder.setPageDesign(preset.design)}
        >
          <span class="preset__name">{preset.name}</span>
          <span class="preset__desc">{preset.description}</span>
        </button>
      {/each}
    </div>

    <div class="panel__summary">
      <p class="panel__label">What a section inherits</p>
      <dl class="axes">
        {#each SECTION_DESIGN_AXES as axis (axis)}
          {@const value = resolved[axis]}
          <div class="axes__row" data-unset={pending.design?.[axis] ? null : 'true'}>
            <dt>{AXIS_LABELS[axis]}</dt>
            <dd>
              {AXIS_VALUE_LABELS[axis][value] ?? value}
              {#if !pending.design?.[axis]}
                <span class="axes__fallback">· default</span>
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    </div>

    {#if overriding.length > 0}
      <p class="panel__note">
        {overriding.length === 1
          ? '1 section sets its own values and will not follow a preset:'
          : `${overriding.length} sections set their own values and will not follow a preset:`}
        <b>{overriding.join(', ')}</b>
      </p>
    {/if}
  </div>
{/if}

<style>
  /* NO `--color-text-muted` in here, deliberately. Measured on the studio panel
     surface by canvas readback: muted at `--text-xs` is 2.52:1 light / 3.19:1
     dark, under the 4.5 floor, and 13px is not WCAG "large text". Every string in
     this panel is something a creator has to read to choose a look, so the whole
     panel sits on `--color-text-secondary` (7.81 / 10.21) or stronger. */
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .panel__sub,
  .panel__note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }

  .panel__current {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .panel__current-label,
  .panel__label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .panel__label {
    margin: 0 0 var(--space-2);
    display: block;
  }

  .panel__presets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .preset {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: var(--tap-target-min);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .preset:hover {
    color: var(--color-text);
    border-color: var(--color-border-strong);
  }

  .preset:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }

  .preset--on {
    border-color: var(--color-interactive);
    color: var(--color-text);
    background-color: color-mix(in oklab, var(--color-interactive) 10%, var(--color-surface));
  }

  .preset__name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .preset__desc {
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    color: var(--color-text-secondary);
  }

  .axes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
  }

  .axes__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--text-xs);
  }

  .axes__row dt {
    color: var(--color-text-secondary);
  }

  .axes__row dd {
    margin: 0;
    color: var(--color-text);
    font-weight: var(--font-medium);
  }

  /* An axis the stored bundle does not state — resolved from the axis default, so
     the summary never implies the page said something it did not. */
  .axes__row[data-unset='true'] dd {
    font-weight: var(--font-normal);
    color: var(--color-text-secondary);
  }

  .axes__fallback {
    color: var(--color-text-secondary);
  }
</style>
