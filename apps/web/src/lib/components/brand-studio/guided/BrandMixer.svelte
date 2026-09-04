<!--
  @component BrandMixer

  The low-granularity end of the brand editor: three plain-language dials that
  each compose ~20 tokens.

  The fine-tune rail asks an admin what `--brand-heading-weight` should be. This
  asks whether their typography is "Editorial" or "Grotesk", and derives the
  weight, the scale, the body weight and the label casing from that one answer.
  Same for shape (radius, density, elevation, shadow hue, hover response) and
  atmosphere (shader, its tempo, the hero ink, the hero layout).

  It runs the SAME `composePreset` the built-in presets use — see
  `apply-mix.ts` for why that matters — so a mixed look is exactly as complete
  and as legible as a shipped preset, on the admin's own palette. Mixing is
  therefore not a downgrade from picking a preset; it is the same machine with
  the palette held constant.

  Each row is a real radiogroup with roving tabindex and arrow-key movement,
  because a chip row that only responds to clicks is a keyboard trap for the
  one control that changes the most.
-->
<script lang="ts">
  import {
    ATMOSPHERE_AXES,
    FORM_AXES,
    TYPE_AXES,
    type AtmosphereAxisId,
    type FormAxisId,
    type PresetAxisPoint,
    type TypeAxisId,
  } from '$lib/brand-editor';

  interface Props {
    /** The currently-applied axis point. Owned by the parent. */
    axes: PresetAxisPoint;
    /** Called with the next axis point when any dial moves. */
    onchange: (next: PresetAxisPoint) => void;
    /** Optional class forwarded to the root, per the composition-seam rule. */
    class?: string;
  }

  const { axes, onchange, class: className }: Props = $props();

  const typeOptions = Object.values(TYPE_AXES);
  const formOptions = Object.values(FORM_AXES);
  const atmosphereOptions = Object.values(ATMOSPHERE_AXES);

  function setType(id: string): void {
    onchange({ ...axes, type: id as TypeAxisId });
  }
  function setForm(id: string): void {
    onchange({ ...axes, form: id as FormAxisId });
  }
  function setAtmosphere(id: string): void {
    onchange({ ...axes, atmosphere: id as AtmosphereAxisId });
  }

  /**
   * Arrow-key movement within one row. Radiogroup semantics select on move,
   * which is what makes the live preview follow the keyboard.
   */
  function onRowKeydown(
    event: KeyboardEvent,
    ids: string[],
    current: string,
    select: (id: string) => void
  ): void {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    let nextIndex: number | null = null;

    if (event.key in deltas) {
      const index = ids.indexOf(current);
      nextIndex = (index + deltas[event.key] + ids.length) % ids.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = ids.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    select(ids[nextIndex]);
    // Move focus with selection so the roving tabindex stays on the checked
    // option — otherwise the next Tab leaves from a stale element.
    const row = event.currentTarget as HTMLElement;
    const target = row.querySelector<HTMLElement>(
      `[data-option-id="${ids[nextIndex]}"]`
    );
    target?.focus();
  }
</script>

<div class="mixer {className ?? ''}">
  <p class="mixer__lede">
    Three choices, not thirty. Each one sets the type, spacing, elevation and
    hero it implies — on the colours you already picked.
  </p>

  <!-- ── Typography ── -->
  <section class="mixer__group">
    <h3 class="mixer__label" id="mixer-type-label">Typography</h3>
    <div
      class="mixer__row"
      role="radiogroup"
      aria-labelledby="mixer-type-label"
      onkeydown={(e) =>
        onRowKeydown(
          e,
          typeOptions.map((o) => o.id),
          axes.type,
          setType
        )}
    >
      {#each typeOptions as option (option.id)}
        {@const selected = axes.type === option.id}
        <button
          type="button"
          class="mixer__chip mixer__chip--type"
          class:is-selected={selected}
          role="radio"
          aria-checked={selected}
          tabindex={selected ? 0 : -1}
          data-option-id={option.id}
          title={option.description}
          onclick={() => setType(option.id)}
        >
          <span
            class="mixer__chip-specimen"
            style:font-family={`'${option.fontHeading}', sans-serif`}
            style:font-weight={option.headingWeight}
            aria-hidden="true">Aa</span
          >
          <span class="mixer__chip-text">
            <span class="mixer__chip-name">{option.label}</span>
            <span class="mixer__chip-note">{option.description}</span>
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ── Shape & feel ── -->
  <section class="mixer__group">
    <h3 class="mixer__label" id="mixer-form-label">Shape &amp; feel</h3>
    <div
      class="mixer__row"
      role="radiogroup"
      aria-labelledby="mixer-form-label"
      onkeydown={(e) =>
        onRowKeydown(
          e,
          formOptions.map((o) => o.id),
          axes.form,
          setForm
        )}
    >
      {#each formOptions as option (option.id)}
        {@const selected = axes.form === option.id}
        <button
          type="button"
          class="mixer__chip"
          class:is-selected={selected}
          role="radio"
          aria-checked={selected}
          tabindex={selected ? 0 : -1}
          data-option-id={option.id}
          title={option.description}
          onclick={() => setForm(option.id)}
        >
          <!-- The swatch IS the preview: this option's own radius and its own
               shadow strength, so the choice is visible before it is applied. -->
          <span
            class="mixer__chip-swatch"
            style:border-radius={`${option.radius}rem`}
            style:box-shadow={`0 2px 6px hsl(${option.shadowColor} / ${Math.min(0.5, option.shadowScale * 0.28)})`}
            aria-hidden="true"
          ></span>
          <span class="mixer__chip-text">
            <span class="mixer__chip-name">{option.label}</span>
            <span class="mixer__chip-note">{option.description}</span>
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ── Atmosphere ── -->
  <section class="mixer__group">
    <h3 class="mixer__label" id="mixer-atmos-label">Atmosphere</h3>
    <div
      class="mixer__row mixer__row--dense"
      role="radiogroup"
      aria-labelledby="mixer-atmos-label"
      onkeydown={(e) =>
        onRowKeydown(
          e,
          atmosphereOptions.map((o) => o.id),
          axes.atmosphere,
          setAtmosphere
        )}
    >
      {#each atmosphereOptions as option (option.id)}
        {@const selected = axes.atmosphere === option.id}
        <button
          type="button"
          class="mixer__chip mixer__chip--atmos"
          class:is-selected={selected}
          role="radio"
          aria-checked={selected}
          tabindex={selected ? 0 : -1}
          data-option-id={option.id}
          title={option.description}
          onclick={() => setAtmosphere(option.id)}
        >
          <span class="mixer__chip-text">
            <span class="mixer__chip-name">{option.label}</span>
            <span class="mixer__chip-note">{option.description}</span>
          </span>
          <span class="mixer__chip-shader">{option.shader}</span>
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .mixer {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .mixer__lede {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  .mixer__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .mixer__label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .mixer__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .mixer__row--dense {
    grid-template-columns: 1fr 1fr 1fr;
  }

  /* ── Chip ── */
  .mixer__chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .mixer__chip:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .mixer__chip.is-selected {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  /* R14 — every interactive element carries its own focus ring. The roving
     tabindex means only the checked chip is tabbable, so this ring is the
     only signal that keyboard focus entered the row. */
  .mixer__chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .mixer__chip--atmos {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  .mixer__chip-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .mixer__chip-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .mixer__chip-note {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-tight);
  }

  /* ── Type specimen ── */
  .mixer__chip-specimen {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--space-9);
    height: var(--space-9);
    border-radius: var(--radius-sm);
    background: var(--color-surface-secondary);
    color: var(--color-text);
    font-size: var(--text-lg);
    line-height: 1;
  }

  .mixer__chip.is-selected .mixer__chip-specimen {
    background: var(--color-surface);
  }

  /* ── Form swatch ── */
  .mixer__chip-swatch {
    flex: none;
    width: var(--space-9);
    height: var(--space-9);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .mixer__chip.is-selected .mixer__chip-swatch {
    background: var(--color-surface);
  }

  /* ── Atmosphere shader tag ── */
  .mixer__chip-shader {
    font-family: var(--font-mono);
    font-size: calc(var(--text-xs) * 0.85);
    color: var(--color-interactive);
    background: var(--color-interactive-subtle);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
  }

  .mixer__chip.is-selected .mixer__chip-shader {
    background: var(--color-surface);
  }

  @media (--below-md) {
    .mixer__row,
    .mixer__row--dense {
      grid-template-columns: 1fr;
    }
  }
</style>
