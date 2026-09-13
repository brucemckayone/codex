<!--
  @component BrandEditorPresets

  The preset gallery, grouped by category, with every preset's VARIANTS
  exposed as first-class choices rather than hidden behind the signature.

  Structure note: the card's HEADER is a button and the variant chips are
  buttons beside it — siblings, never nested. An earlier shape made the whole
  card a single `<button>`, which cannot legally contain the variant buttons;
  nested interactive elements are invalid and collapse for screen readers.
  That constraint still holds and is why the header, not the `<article>`, is
  the clickable element.

  The header applies `variants[0]`, the signature — identical to the preset's
  own top-level values. It exists because a card whose swatches, name and
  description were all inert read as broken: clicking the obvious target did
  nothing, and only the three small chips at the bottom applied anything.
-->
<script lang="ts">
  import {
    BRAND_PRESETS,
    brandEditor,
    PRESET_CATEGORY_ORDER,
    type PresetAxisPoint,
    type PresetCategory,
  } from '$lib/brand-editor';
  import type { BrandPreset } from '$lib/brand-editor/types';

  interface Props {
    /** Reported after any apply, so a parent mixer can follow the selection. */
    onapply?: (axes: PresetAxisPoint, id: string) => void;
    /** Id of the currently-applied look, for the selected state. */
    appliedId?: string | null;
    class?: string;
  }

  const { onapply, appliedId = null, class: className }: Props = $props();

  // 27 presets x 3 looks is a long scroll, and "show me the playful ones" is
  // how an admin actually arrives. null = show every category.
  let filter = $state<PresetCategory | null>(null);

  const presetsByCategory = $derived(
    PRESET_CATEGORY_ORDER.filter((c) => filter === null || c === filter)
      .map((category) => ({
        category,
        presets: BRAND_PRESETS.filter((p) => p.category === category),
      }))
      .filter((group) => group.presets.length > 0)
  );

  function apply(look: BrandPreset, axes: PresetAxisPoint): void {
    brandEditor.applyPreset(look);
    onapply?.(axes, look.id);
  }
</script>

<div class="presets {className ?? ''}">
  <div class="presets__filter" role="group" aria-label="Filter by direction">
    <button
      type="button"
      class="presets__filter-chip"
      class:is-active={filter === null}
      aria-pressed={filter === null}
      onclick={() => {
        filter = null;
      }}
    >
      All
    </button>
    {#each PRESET_CATEGORY_ORDER as category (category)}
      <button
        type="button"
        class="presets__filter-chip"
        class:is-active={filter === category}
        aria-pressed={filter === category}
        onclick={() => {
          filter = filter === category ? null : category;
        }}
      >
        {category}
      </button>
    {/each}
  </div>

  {#each presetsByCategory as group (group.category)}
    <section class="presets__group">
      <h3 class="presets__group-label">{group.category}</h3>

      {#each group.presets as preset (preset.id)}
        {@const signature = preset.variants[0]}
        <article class="presets__card">
          <button
            type="button"
            class="presets__head"
            class:is-applied={appliedId === signature.id}
            aria-pressed={appliedId === signature.id}
            title={signature.note}
            onclick={() => apply(signature, signature.axes)}
          >
            <span class="presets__swatches" aria-hidden="true">
              <span
                class="presets__swatch presets__swatch--lg"
                style:background={preset.values.primaryColor}
              ></span>
              {#if preset.values.secondaryColor}
                <span
                  class="presets__swatch"
                  style:background={preset.values.secondaryColor}
                ></span>
              {/if}
              {#if preset.values.accentColor}
                <span
                  class="presets__swatch"
                  style:background={preset.values.accentColor}
                ></span>
              {/if}
              {#if preset.values.backgroundColor}
                <span
                  class="presets__swatch presets__swatch--bg"
                  style:background={preset.values.backgroundColor}
                ></span>
              {/if}
            </span>
            <span class="presets__meta">
              <span class="presets__name">{preset.name}</span>
              <span class="presets__desc">{preset.description}</span>
            </span>
          </button>

          <div
            class="presets__variants"
            role="group"
            aria-label="{preset.name} looks"
          >
            {#each preset.variants as variant (variant.id)}
              {@const selected = appliedId === variant.id}
              <button
                type="button"
                class="presets__variant"
                class:is-applied={selected}
                aria-pressed={selected}
                title={variant.note}
                onclick={() => apply(variant, variant.axes)}
              >
                {variant.label}
              </button>
            {/each}
          </div>
        </article>
      {/each}
    </section>
  {/each}
</div>

<style>
  .presets {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  /* ── Category filter ── */
  .presets__filter {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .presets__filter-chip {
    appearance: none;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .presets__filter-chip:hover {
    border-color: var(--color-border);
    color: var(--color-text);
  }

  .presets__filter-chip.is-active {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
    color: var(--color-interactive);
  }

  /* R14 */
  .presets__filter-chip:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .presets__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .presets__group-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .presets__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  /*
   * The card's primary action. A `<button>` needs its own reset here: the
   * browser default supplies a centred text alignment, its own font and a
   * grey background, all of which would fight the card.
   *
   * The negative margin cancels the padding, so the RESTING layout is
   * pixel-identical to the inert `<header>` this replaced — the padding
   * exists only to give the hover and focus surface some room to breathe.
   * Flex `gap` is measured between items' outer edges, so the row below
   * keeps its `--space-2` separation.
   */
  .presets__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    appearance: none;
    margin: calc(var(--space-1) * -1);
    padding: var(--space-1);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    background: none;
    font: inherit;
    color: inherit;
    text-align: start;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .presets__head:hover {
    border-color: var(--color-interactive);
    background: var(--color-surface-secondary);
  }

  .presets__head.is-applied {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  /* R14 */
  .presets__head:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .presets__swatches {
    display: flex;
    gap: var(--space-1);
    flex: none;
  }

  .presets__swatch {
    width: var(--space-4);
    height: var(--space-4);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .presets__swatch--lg {
    width: var(--space-5);
    height: var(--space-5);
  }

  .presets__swatch--bg {
    border-radius: var(--radius-xs);
  }

  .presets__meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .presets__name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .presets__desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-tight);
  }

  /* ── Variants ── */
  .presets__variants {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .presets__variant {
    appearance: none;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
    background: var(--color-surface-secondary);
    color: var(--color-text-muted);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .presets__variant:hover {
    border-color: var(--color-interactive);
    color: var(--color-text);
  }

  .presets__variant.is-applied {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
    color: var(--color-interactive);
  }

  /* R14 */
  .presets__variant:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
