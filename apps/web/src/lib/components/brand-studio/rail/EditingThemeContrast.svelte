<!--
  @component EditingThemeContrast

  The colour focus's editing context, in ONE compact row: a Light/Dark segmented
  toggle (which palette the reused colour controls read + write, via the store's
  per-theme routing) beside a compact WCAG contrast PILL for text-on-brand.

  The readout mirrors the product's real auto-contrast rule (see `./contrast.ts`
  + org-brand.css): it derives the black/white text the product places on the
  brand colour and warns when that pair drops below AA (4.5:1). Both the toggle's
  pressed state and the readout re-derive from the store, so flipping the editing
  theme instantly re-evaluates against the dark palette. The full verdict lives
  in the pill's `title` (kept off-screen to stay compact).

  Epic: Codex-cijzb · WP-1.5 + rail-UX overhaul (compacted).
-->
<script lang="ts">
  import { BRAND_DEFAULT_PRIMARY, brandEditor } from '$lib/brand-editor';
  import { MoonIcon, SunIcon } from '$lib/components/ui/Icon';
  import {
    AA_CONTRAST_THRESHOLD,
    evaluateBrandContrast,
    formatContrastRatio,
  } from './contrast';

  const editingTheme = $derived(brandEditor.editingTheme);

  // The active editing theme's brand colour (dark reads darkOverrides, falling
  // back to the light value) — reactive to both edits and the theme toggle.
  const brandColor = $derived(
    brandEditor.getThemeColor('primaryColor') ?? BRAND_DEFAULT_PRIMARY
  );

  const contrast = $derived(evaluateBrandContrast(brandColor));

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
    <span class="sr-only">{verdict}</span>
  </div>
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
    color: var(--color-text-on-brand);
    background: var(--color-success);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }

  .contrast__badge--warn {
    background: var(--color-warning);
  }
</style>
