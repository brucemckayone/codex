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
      <!--
        h2, NOT h3. The only consumer of this component renders an `<h1>`
        ("Let's brand …") and no `<h2>`, so an `<h3>` here skipped a level —
        Lighthouse `heading-order`. Pinned by a test, because the correct
        level depends on the consumer's hierarchy rather than on this file.
      -->
      <h2 class="presets__group-label">{group.category}</h2>

      {#each group.presets as preset (preset.id)}
        {@const signature = preset.variants[0]}
        {@const appliedHere = preset.variants.some((v) => v.id === appliedId)}
        <!--
          THE CARD carries the applied state, not the header. Only a single
          chip used to light up, so the gallery could not answer "which brand
          am I on?" — you had to read three chips per card across 27 cards.
          The card says which PRESET is live; the chip says which of its looks.
        -->
        <article class="presets__card" class:is-applied={appliedHere}>
          <button
            type="button"
            class="presets__head"
            aria-pressed={appliedId === signature.id}
            title={signature.note}
            onclick={() => apply(signature, signature.axes)}
          >
            <!--
              THE PALETTE IS THE PRODUCT, so it is rendered as a specimen
              rather than three 20px dots. The lead colour takes the largest
              share because that is the one the brand is actually read by.
            -->
            <span class="presets__palette" aria-hidden="true">
              <span
                class="presets__stop presets__stop--primary"
                style:background={preset.values.primaryColor}
              ></span>
              {#if preset.values.secondaryColor}
                <span
                  class="presets__stop"
                  style:background={preset.values.secondaryColor}
                ></span>
              {/if}
              {#if preset.values.accentColor}
                <span
                  class="presets__stop"
                  style:background={preset.values.accentColor}
                ></span>
              {/if}
              {#if preset.values.backgroundColor}
                <span
                  class="presets__stop"
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

  /* Same neutral system: this label measured 4.74 light but 3.19 dark. */
  .presets__filter-chip {
    appearance: none;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-text) 16%, transparent);
    border-radius: var(--radius-full);
    background: none;
    color: color-mix(in oklab, var(--color-text) 72%, transparent);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .presets__filter-chip:hover {
    border-color: color-mix(in oklab, var(--color-text) 34%, transparent);
    color: var(--color-text);
  }

  /* Neutral for the same reason as the variant chip — this pair failed too. */
  .presets__filter-chip.is-active {
    border-color: color-mix(in oklab, var(--color-text) 38%, transparent);
    background: color-mix(in oklab, var(--color-text) 11%, transparent);
    color: var(--color-text);
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

  /* Last --color-text-muted consumer here; same neutral system as the chips. */
  .presets__group-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: color-mix(in oklab, var(--color-text) 62%, transparent);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /*
   * TRANSPARENT BY DEFAULT. Twenty-seven filled, bordered cards in a 370px
   * rail read as noise — when every card carries chrome, nothing is
   * hierarchical. At rest a card is a palette, a name and a row of looks on
   * the panel ground; hover is what says "I am about to apply this".
   */
  .presets__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) transparent;
    border-radius: var(--radius-md);
    background: none;
    transition: var(--transition-colors);
  }

  /* The whole card, so the chip row lights with the head it belongs to. */
  .presets__card:hover {
    background: color-mix(in oklab, var(--color-text) 4%, transparent);
  }

  /*
   * THE APPLIED STATE IS NEUTRAL, DELIBERATELY — and this is the important
   * comment in this file.
   *
   * This gallery PREVIEWS brand colour, and it renders inside the org-brand
   * scope it is editing. So painting its own selected state in a
   * brand-derived token means the chooser restyles itself on every click, in
   * the colour being trialled. Measured with a probe calibrated to 21.00 on
   * white/black: applying `Vibrant` resolved --color-interactive-subtle to
   * `oklch(0.15 0.032 293.554)` — near-black purple — and put
   * --color-text (#171717) on it at 2.55:1, against a 4.5 floor. The preset's
   * own NAME disappeared. The same pair failed on the variant chip (2.58) and
   * the category filter chip, both pre-existing.
   *
   * A tint mixed from --color-text inverts with the theme and can never
   * follow the brand, so the chooser stays legible whatever is applied.
   * Brand colour belongs in the swatches, where it is CONTENT, not chrome.
   */
  .presets__card.is-applied {
    background: color-mix(in oklab, var(--color-text) 7%, transparent);
    border-color: color-mix(in oklab, var(--color-text) 24%, transparent);
  }

  /*
   * The card's primary action. A `<button>` needs its own reset here: the
   * browser default supplies a centred text alignment, its own font and a
   * grey background, all of which would fight the card.
   *
   * It paints NO surface of its own — the card does. An earlier pass gave the
   * header its own border and background and the result was a filled box
   * inside a bordered box, with the chip row stranded beneath it.
   */
  .presets__head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    appearance: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font: inherit;
    color: inherit;
    text-align: start;
    cursor: pointer;
  }

  /* R14 */
  .presets__head:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  /*
   * The palette specimen. A hairline ring keeps a pale or white-grounded
   * palette from dissolving into the panel, and is mixed from --color-text so
   * it survives both themes without a second token.
   */
  .presets__palette {
    display: flex;
    flex: none;
    width: var(--space-10);
    height: var(--space-6);
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow: inset 0 0 0 var(--border-width)
      color-mix(in oklab, var(--color-text) 14%, transparent);
  }

  .presets__stop {
    flex: 1 1 0;
    min-width: 0;
  }

  /* The lead colour dominates — it is the one a brand is read by. */
  .presets__stop--primary {
    flex-grow: 2.2;
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

  /*
   * --color-text-muted is unfit for real text at :root (Codex-00fui, P1, ~416
   * consumers) and the card's applied tint made it worse still: measured 2.78
   * -> 2.16 against a 4.5 floor with a calibrated canvas probe. Mixed from
   * --color-text instead, which tracks whatever the surrounding theme scope
   * resolves to — including the brand editor's own [data-editing-theme]
   * preview scope, where a fixed grey cannot be correct for both.
   */
  .presets__desc {
    font-size: var(--text-xs);
    color: color-mix(in oklab, var(--color-text) 72%, transparent);
    line-height: var(--leading-tight);
  }

  /* ── Variants ── */
  .presets__variants {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  /*
   * ONE NEUTRAL SYSTEM for every chip surface in this gallery, all mixed from
   * --color-text. Two things this defends against, both measured:
   *   · brand drift — see `.presets__card.is-applied`;
   *   · the [data-editing-theme] preview scope, which re-themes this subtree,
   *     so --color-surface-secondary and --color-text-muted can resolve from
   *     different poles at once. The chip label measured 2.19:1 against a 4.5
   *     floor. A pair mixed from one source cannot disagree with itself.
   */
  .presets__variant {
    appearance: none;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style)
      color-mix(in oklab, var(--color-text) 16%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--color-text) 6%, transparent);
    color: color-mix(in oklab, var(--color-text) 72%, transparent);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .presets__variant:hover {
    border-color: color-mix(in oklab, var(--color-text) 34%, transparent);
    color: var(--color-text);
  }

  /*
   * NEUTRAL, for the reason spelled out on `.presets__card.is-applied`: this
   * pair was --color-interactive on --color-interactive-subtle, which is
   * brand-on-brand. Measured at 2.58:1 against a 4.5 floor once a dark preset
   * was applied — the applied look's own label became unreadable, in the one
   * control that tells you what is selected. Stronger than the card's tint so
   * the chosen LOOK still reads as the emphasis inside a selected card.
   */
  .presets__variant.is-applied {
    border-color: color-mix(in oklab, var(--color-text) 38%, transparent);
    background: color-mix(in oklab, var(--color-text) 11%, transparent);
    color: var(--color-text);
  }

  /* R14 */
  .presets__variant:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
