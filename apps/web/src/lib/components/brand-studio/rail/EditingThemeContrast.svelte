<!--
  @component EditingThemeContrast

  The colour focus's editing context, in ONE compact row: a Light/Dark segmented
  toggle (which palette the reused colour controls read + write, via the store's
  per-theme routing) beside a compact WCAG contrast PILL for text-on-brand.

  The readout mirrors the product's real auto-contrast rule (see `./contrast.ts`
  + org-brand.css): it derives the black/white text the product places on the
  brand colour and reports that pair's ratio. The luminance rule clears AA on
  every brand (floor 4.57:1), so the warn state now shows only for a colour that
  cannot be read. Both the toggle's pressed state and the readout re-derive from
  the store, so flipping the editing theme instantly re-evaluates against the
  dark palette. The full verdict lives in the pill's `title` (kept off-screen to
  stay compact).

  Below it, the colours the page nudges against its hardest ground (links, the
  focus outline and halo; `./legibility.ts`, the twin of org-brand.css's rule)
  are listed with what was moved and how far, and the pill counts them (owner,
  Codex-mik4h: "Adjust it, say so").

  Epic: Codex-cijzb · WP-1.5 + rail-UX overhaul (compacted).
-->
<script lang="ts">
  import { BRAND_DEFAULT_PRIMARY, brandEditor } from '$lib/brand-editor';
  import {
    LINK_FLOOR,
    MARK_FLOOR,
    type Nudge,
  } from '$lib/brand-editor/ground-nudge';
  import { MoonIcon, SunIcon } from '$lib/components/ui/Icon';
  import * as m from '$paraglide/messages';
  import {
    AA_CONTRAST_THRESHOLD,
    evaluateBrandContrast,
    formatContrastRatio,
  } from './contrast';
  import { hoverFill, legibilityFor, movedALot } from './legibility';

  const editingTheme = $derived(brandEditor.editingTheme);

  // The active editing theme's brand colour (dark reads darkOverrides, falling
  // back to the light value) — reactive to both edits and the theme toggle.
  const brandColor = $derived(
    brandEditor.getThemeColor('primaryColor') ?? BRAND_DEFAULT_PRIMARY
  );

  const contrast = $derived(evaluateBrandContrast(brandColor));

  // The same inputs the page's nudge reads: the light background sets the
  // ground, the dark one overrides it in dark, and the fine-tune overrides.
  const pending = $derived(brandEditor.pending);
  const legibility = $derived(
    legibilityFor({
      theme: editingTheme,
      brand: brandColor,
      background: pending?.backgroundColor,
      backgroundDark: pending?.darkOverrides?.backgroundColor,
      overrides: pending?.tokenOverrides,
    })
  );

  interface Row {
    label: string;
    nudge: Nudge;
    floor: number;
  }
  const rows = $derived(
    [
      { label: m.brand_legibility_links(), nudge: legibility.link, floor: LINK_FLOOR },
      { label: m.brand_legibility_focus(), nudge: legibility.focus, floor: MARK_FLOOR },
      { label: m.brand_legibility_halo(), nudge: legibility.halo, floor: MARK_FLOOR },
    ].filter((row): row is Row => row.nudge !== null)
  );

  const hover = $derived.by(() => {
    const fill = hoverFill(brandColor, editingTheme);
    return fill ? evaluateBrandContrast(fill) : null;
  });

  // Dark pages paint the light brand until a dark-mode one is picked.
  const usesLightBrand = $derived(
    editingTheme === 'dark' && !pending?.darkOverrides?.primaryColor
  );

  /** What the page did to one colour, in the words the owner reviewed. */
  function detail({ nudge, floor }: Row): string {
    const ratios = {
      before: formatContrastRatio(nudge.before),
      after: formatContrastRatio(nudge.after),
    };
    if (!nudge.moved) return m.brand_legibility_as_picked({ ratio: ratios.after });
    const lot = movedALot(nudge, floor);
    if (nudge.lighten) {
      return lot
        ? m.brand_legibility_lightened_lot(ratios)
        : m.brand_legibility_lightened_little(ratios);
    }
    return lot
      ? m.brand_legibility_darkened_lot(ratios)
      : m.brand_legibility_darkened_little(ratios);
  }

  // Full sentence for the pill's tooltip / screen readers (the visible pill only
  // shows the ratio + AA badge to stay to one line).
  const verdict = $derived.by(() => {
    if (contrast.ratio === null) return 'Enter a valid colour';
    if (contrast.passesAA)
      return `Passes AA (${formatContrastRatio(contrast.ratio)}) · text-on-brand`;
    return `Below AA (${AA_CONTRAST_THRESHOLD}:1) · text-on-brand`;
  });

  function selectTheme(theme: 'light' | 'dark') {
    // Idempotent: only write when actually changing (avoids redundant preview
    // re-stamps). Plain onclick, so no controlled-component echo.
    if (brandEditor.editingTheme !== theme) brandEditor.setEditingTheme(theme);
  }
</script>

<div class="editing-ctx">
  <div class="seg" role="group" aria-label="Editing theme">
    <button
      type="button"
      class="seg__btn"
      class:seg__btn--active={editingTheme === 'light'}
      aria-pressed={editingTheme === 'light'}
      onclick={() => selectTheme('light')}
    >
      <SunIcon size={14} />
      <span>Light</span>
    </button>
    <button
      type="button"
      class="seg__btn"
      class:seg__btn--active={editingTheme === 'dark'}
      aria-pressed={editingTheme === 'dark'}
      onclick={() => selectTheme('dark')}
    >
      <MoonIcon size={14} />
      <span>Dark</span>
    </button>
  </div>

  <div
    class="contrast"
    class:contrast--warn={!contrast.passesAA}
    data-passes-aa={contrast.passesAA}
    title={verdict}
  >
    <span class="contrast__swatch" aria-hidden="true" style:background={contrast.brand}>
      <span class="contrast__sample" style:color={contrast.text}>Aa</span>
    </span>
    <span class="contrast__ratio">{formatContrastRatio(contrast.ratio)}</span>
    <span class="contrast__badge" class:contrast__badge--warn={!contrast.passesAA}>
      {contrast.passesAA ? 'AA' : '!'}
    </span>
    {#if legibility.adjusted > 0}
      <span class="contrast__adjusted">
        {m.brand_legibility_adjusted({ count: legibility.adjusted })}
      </span>
    {/if}
    <span class="sr-only">{verdict}</span>
  </div>

  {#if rows.length > 0}
    <ul class="legibility" aria-label={m.brand_legibility_title()}>
      {#each rows as row (row.label)}
        <li class="legibility__row" data-moved={row.nudge.moved}>
          <span
            class="legibility__swatch"
            aria-hidden="true"
            style:background={row.nudge.hex}
          ></span>
          <span class="legibility__text">
            <span class="legibility__label">{row.label}</span>
            <span class="legibility__detail">{detail(row)}</span>
          </span>
        </li>
      {/each}
      {#if hover}
        <li class="legibility__row">
          <span
            class="legibility__swatch"
            aria-hidden="true"
            style:background={hover.brand}
            style:color={hover.text}>Aa</span
          >
          <span class="legibility__text">
            <span class="legibility__label">{m.brand_legibility_hover()}</span>
            <span class="legibility__detail">{m.brand_legibility_hover_detail()}</span>
          </span>
        </li>
      {/if}
    </ul>
    {#if usesLightBrand}
      <p class="legibility__hint">{m.brand_legibility_set_dark()}</p>
    {/if}
  {/if}
</div>

<style>
  /* One compact row: toggle left, contrast pill right; wraps only if the rail
     is unusually narrow. */
  .editing-ctx {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  /* Segmented toggle */
  .seg {
    display: inline-flex;
    padding: var(--space-0-5);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    gap: var(--space-0-5);
  }

  .seg__btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .seg__btn:hover {
    color: var(--color-text);
  }

  .seg__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .seg__btn--active {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  /* Contrast pill — swatch · ratio · AA badge on one line. */
  .contrast {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-full);
  }

  .contrast--warn {
    border-color: var(--color-warning-200);
    background: var(--color-warning-50);
  }

  .contrast__swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-6);
    height: var(--space-6);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }

  .contrast__sample {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
  }

  .contrast__ratio {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .contrast__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-5);
    height: var(--space-5);
    padding: 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--font-bold);
    /* No token names an ink for the status fills, so the label takes the
       luminance step from its own fill, as every `--color-on-*` /
       `--color-text-on-*` ink does (`--_on-fill-step`, light.css). It was the
       brand's ink (Codex-mik4h). */
    --_badge-fill: var(--color-success);
    color: oklch(from var(--_badge-fill) clamp(0, (0.62 - l) * 1000, 1) 0 0);
    background: var(--_badge-fill);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .contrast__badge--warn {
    --_badge-fill: var(--color-warning);
  }

  /* How many colours the page nudged: the status info chip, whose text holds
     on its surface in both themes (status.css). */
  .contrast__adjusted {
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-status-info-text);
    background: var(--color-status-info-surface);
    border: var(--border-width) var(--border-style) var(--color-status-info-border);
    border-radius: var(--radius-full);
    white-space: nowrap;
  }

  /* The checklist takes the row below the toggle and the pill. */
  .legibility {
    flex-basis: 100%;
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .legibility__row {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: var(--space-2);
  }

  .legibility__swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-5);
    height: var(--space-5);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    line-height: 1;
  }

  .legibility__text {
    display: grid;
    min-width: 0;
  }

  .legibility__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .legibility__detail,
  .legibility__hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .legibility__hint {
    flex-basis: 100%;
    margin: 0;
  }

  @supports (color: rgb(from red calc(255 * pow(r / 255, 2)) 0 0)) {
    .contrast__badge {
      color: rgb(from var(--_badge-fill) calc(255 * var(--_on-fill-step)) calc(255 * var(--_on-fill-step)) calc(255 * var(--_on-fill-step)));
    }
  }
</style>
