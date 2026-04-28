<script lang="ts">
  import {
    BRAND_DEFAULT_ACCENT,
    BRAND_DEFAULT_PRIMARY,
    BRAND_DEFAULT_SECONDARY,
    brandEditor,
    LEVELS,
  } from '$lib/brand-editor';
  import { generateFullPalettes, type FullPalette } from '$lib/brand-editor/palette-generator';
  import type { LevelId } from '$lib/brand-editor';
  import {
    ChevronDownIcon,
    ChevronRightIcon,
    ChevronUpIcon,
  } from '$lib/components/ui/Icon';

  const CUSTOMIZE_CATEGORIES: LevelId[] = ['typography', 'shape'];
  const HERO_CATEGORIES: LevelId[] = ['header-layout', 'hero-effects', 'intro-video'];
  const ADVANCED_CATEGORIES: LevelId[] = ['shadows', 'logo'];

  let showPalettes = $state(false);

  const palettes = $derived(
    showPalettes
      ? generateFullPalettes(brandEditor.pending?.primaryColor ?? BRAND_DEFAULT_PRIMARY)
      : []
  );

  function applyFullPalette(palette: FullPalette) {
    brandEditor.updateField('primaryColor', palette.primary);
    brandEditor.updateField('secondaryColor', palette.secondary);
    brandEditor.updateField('accentColor', palette.accent);
    brandEditor.updateField('backgroundColor', palette.background);
    showPalettes = false;
  }
</script>

<div class="home">
  <!-- Colors (primary element) -->
  <section class="home__section">
    <button
      type="button"
      class="home__colors-row"
      onclick={() => brandEditor.navigateTo('colors')}
    >
      <div class="home__color-swatches">
        <span class="home__swatch" style:background={brandEditor.pending?.primaryColor ?? BRAND_DEFAULT_PRIMARY}></span>
        <span class="home__swatch home__swatch--sm" style:background={brandEditor.pending?.secondaryColor ?? BRAND_DEFAULT_SECONDARY}></span>
        <span class="home__swatch home__swatch--sm" style:background={brandEditor.pending?.accentColor ?? BRAND_DEFAULT_ACCENT}></span>
      </div>
      <div class="home__colors-text">
        <span class="home__colors-label">Colors</span>
        <span class="home__colors-hex">{brandEditor.pending?.primaryColor ?? BRAND_DEFAULT_PRIMARY}</span>
      </div>
      <span class="home__chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  </section>

  <!-- Generate Palette -->
  <section class="home__section">
    <button
      type="button"
      class="home__palette-btn"
      onclick={() => (showPalettes = !showPalettes)}
      aria-expanded={showPalettes}
    >
      Generate Palette
      <span class="home__chevron" aria-hidden="true">
        {#if showPalettes}
          <ChevronUpIcon size={16} />
        {:else}
          <ChevronDownIcon size={16} />
        {/if}
      </span>
    </button>

    {#if showPalettes && palettes.length > 0}
      <div class="home__palette-grid">
        {#each palettes as palette (palette.name)}
          <button
            type="button"
            class="home__palette-card"
            onclick={() => applyFullPalette(palette)}
            title={palette.name}
          >
            <div class="home__palette-bars" style:background={palette.background ?? 'var(--color-surface)'}>
              <span class="home__palette-bar" style:background={palette.primary}></span>
              <span class="home__palette-bar" style:background={palette.secondary}></span>
              <span class="home__palette-bar" style:background={palette.accent}></span>
            </div>
            <span class="home__palette-name">{palette.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Hero -->
  <section class="home__section">
    <span class="home__section-label">Hero</span>
    <div class="home__categories">
      {#each HERO_CATEGORIES as catId (catId)}
        {@const cat = LEVELS[catId]}
        <button type="button" class="home__category" onclick={() => brandEditor.navigateTo(catId)}>
          <div class="home__category-left">
            <span class="home__category-icon" aria-hidden="true">{cat.icon}</span>
            <div class="home__category-text">
              <span class="home__category-name">{cat.label}</span>
              {#if cat.description}
                <span class="home__category-desc">{cat.description}</span>
              {/if}
            </div>
          </div>
          <span class="home__chevron" aria-hidden="true">
            <ChevronRightIcon size={16} />
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Customize -->
  <section class="home__section">
    <span class="home__section-label">Customize</span>
    <div class="home__categories">
      {#each CUSTOMIZE_CATEGORIES as catId (catId)}
        {@const cat = LEVELS[catId]}
        <button type="button" class="home__category" onclick={() => brandEditor.navigateTo(catId)}>
          <div class="home__category-left">
            <span class="home__category-icon" aria-hidden="true">{cat.icon}</span>
            <div class="home__category-text">
              <span class="home__category-name">{cat.label}</span>
              {#if cat.description}
                <span class="home__category-desc">{cat.description}</span>
              {/if}
            </div>
          </div>
          <span class="home__chevron" aria-hidden="true">
            <ChevronRightIcon size={16} />
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Advanced -->
  <section class="home__section">
    <span class="home__section-label">Advanced</span>
    <div class="home__categories">
      {#each ADVANCED_CATEGORIES as catId (catId)}
        {@const cat = LEVELS[catId]}
        <button type="button" class="home__category" onclick={() => brandEditor.navigateTo(catId)}>
          <div class="home__category-left">
            <span class="home__category-icon" aria-hidden="true">{cat.icon}</span>
            <div class="home__category-text">
              <span class="home__category-name">{cat.label}</span>
              {#if cat.description}
                <span class="home__category-desc">{cat.description}</span>
              {/if}
            </div>
          </div>
          <span class="home__chevron" aria-hidden="true">
            <ChevronRightIcon size={16} />
          </span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Presets link -->
  <button
    type="button"
    class="home__presets-link"
    onclick={() => brandEditor.navigateTo('presets')}
  >
    <span class="home__category-icon" aria-hidden="true">✦</span>
    <span class="home__presets-link-text">Browse Presets</span>
    <span class="home__chevron" aria-hidden="true">
      <ChevronRightIcon size={16} />
    </span>
  </button>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* ── Sections ──────────────────────────────────── */

  .home__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .home__section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .home__chevron {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Colors Row (primary element) ──────────────── */

  .home__colors-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: left;
    width: 100%;
  }

  .home__colors-row:hover {
    border-color: var(--color-interactive);
    background: var(--color-surface-secondary);
  }

  .home__colors-row:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .home__color-swatches {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .home__swatch {
    width: var(--space-7);
    height: var(--space-7);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }

  .home__swatch--sm {
    width: var(--space-5);
    height: var(--space-5);
  }

  .home__colors-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    flex: 1;
    min-width: 0;
  }

  .home__colors-label {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .home__colors-hex {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  /* ── Palette Generation ────────────────────────── */

  .home__palette-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    background: none;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .home__palette-btn:hover {
    background: var(--color-interactive-subtle);
    border-color: var(--color-interactive);
  }

  .home__palette-btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .home__palette-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }

  .home__palette-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2-5);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .home__palette-card:hover {
    border-color: var(--color-interactive);
    background: var(--color-surface-secondary);
  }

  .home__palette-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .home__palette-bars {
    display: flex;
    height: var(--space-10);
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .home__palette-bar {
    flex: 1;
  }

  .home__palette-bar:first-child {
    flex: 2;
  }

  .home__palette-name {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-tight);
  }

  /* ── Category List ──────────────────────────────── */

  .home__categories {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .home__category {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: left;
    width: 100%;
  }

  .home__category:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .home__category:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .home__category-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .home__category-icon {
    font-size: var(--text-lg);
    flex-shrink: 0;
    width: var(--space-7);
    text-align: center;
  }

  .home__category-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .home__category-name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .home__category-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── Presets Link ──────────────────────────────── */

  .home__presets-link {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-interactive);
    border-radius: var(--radius-lg);
    background: var(--color-interactive-subtle);
    cursor: pointer;
    transition: var(--transition-colors);
    width: 100%;
  }

  .home__presets-link:hover {
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
  }

  .home__presets-link:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .home__presets-link:hover .home__presets-link-text,
  .home__presets-link:hover .home__category-icon,
  .home__presets-link:hover .home__chevron {
    color: var(--color-text-on-brand);
  }

  .home__presets-link-text {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-interactive);
    text-align: left;
  }
</style>
