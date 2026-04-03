<script lang="ts">
  import { brandEditor, LEVELS, BRAND_PRESETS } from '$lib/brand-editor';
  import { generatePalette, PALETTE_STRATEGIES, type PaletteStrategy } from '$lib/brand-editor/palette-generator';
  import type { LevelId } from '$lib/brand-editor';

  const CUSTOMIZE_CATEGORIES: LevelId[] = ['colors', 'typography', 'shape'];
  const ADVANCED_CATEGORIES: LevelId[] = ['shadows', 'logo'];

  let paletteOpen = $state(false);

  function applyPalette(strategy: PaletteStrategy) {
    const primary = brandEditor.pending?.primaryColor ?? '#6366F1';
    const result = generatePalette(primary, strategy);
    brandEditor.updateField('secondaryColor', result.secondary);
    brandEditor.updateField('accentColor', result.accent);
    paletteOpen = false;
  }
</script>

<div class="home">
  <!-- Quick Start -->
  <section class="home__section">
    <span class="home__section-label">Quick Start</span>
    <div class="home__quick-start">
      <button class="home__primary-swatch" onclick={() => brandEditor.navigateTo('colors')}>
        <span class="home__swatch-circle" style:background={brandEditor.pending?.primaryColor ?? '#6366F1'}></span>
        <span class="home__swatch-text">
          <span class="home__swatch-label">Primary Color</span>
          <span class="home__swatch-hex">{brandEditor.pending?.primaryColor ?? '#6366F1'}</span>
        </span>
        <span class="home__category-chevron" aria-hidden="true">›</span>
      </button>

      <div class="home__palette-inline">
        <button class="home__palette-btn" onclick={() => (paletteOpen = !paletteOpen)}>
          Generate Palette {paletteOpen ? '−' : '+'}
        </button>
        {#if paletteOpen}
          <div class="home__palette-options">
            {#each PALETTE_STRATEGIES as strategy}
              <button class="home__palette-option" onclick={() => applyPalette(strategy.id)}>
                {strategy.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </section>

  <!-- Customize -->
  <section class="home__section">
    <span class="home__section-label">Customize</span>
    <div class="home__categories">
      {#each CUSTOMIZE_CATEGORIES as catId}
        {@const cat = LEVELS[catId]}
        <button class="home__category" onclick={() => brandEditor.navigateTo(catId)}>
          <div class="home__category-left">
            <span class="home__category-icon">{cat.icon}</span>
            <div class="home__category-text">
              <span class="home__category-name">{cat.label}</span>
              {#if cat.description}
                <span class="home__category-desc">{cat.description}</span>
              {/if}
            </div>
          </div>
          <span class="home__category-chevron" aria-hidden="true">›</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Advanced -->
  <section class="home__section">
    <span class="home__section-label">Advanced</span>
    <div class="home__categories">
      {#each ADVANCED_CATEGORIES as catId}
        {@const cat = LEVELS[catId]}
        <button class="home__category" onclick={() => brandEditor.navigateTo(catId)}>
          <div class="home__category-left">
            <span class="home__category-icon">{cat.icon}</span>
            <div class="home__category-text">
              <span class="home__category-name">{cat.label}</span>
              {#if cat.description}
                <span class="home__category-desc">{cat.description}</span>
              {/if}
            </div>
          </div>
          <span class="home__category-chevron" aria-hidden="true">›</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Presets link -->
  <button class="home__presets-link" onclick={() => brandEditor.navigateTo('presets')}>
    <span class="home__category-icon">✦</span>
    <span class="home__presets-link-text">Browse Presets</span>
    <span class="home__category-chevron" aria-hidden="true">›</span>
  </button>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
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

  /* ── Quick Start ───────────────────────────────── */

  .home__quick-start {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .home__primary-swatch {
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

  .home__primary-swatch:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .home__swatch-circle {
    width: var(--space-8);
    height: var(--space-8);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }

  .home__swatch-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    flex: 1;
  }

  .home__swatch-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .home__swatch-hex {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .home__palette-inline {
    display: flex;
    flex-direction: column;
  }

  .home__palette-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-interactive);
    background: none;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .home__palette-btn:hover {
    background: var(--color-interactive-subtle);
  }

  .home__palette-options {
    display: flex;
    flex-direction: column;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-top: none;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }

  .home__palette-option {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text);
    background: none;
    border: none;
    border-bottom: var(--border-width) var(--border-style) var(--color-border-subtle);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .home__palette-option:last-child {
    border-bottom: none;
  }

  .home__palette-option:hover {
    background: var(--color-interactive-subtle);
    color: var(--color-interactive);
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

  .home__category-left {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .home__category-icon {
    font-size: var(--text-lg);
    flex-shrink: 0;
    width: 28px;
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

  .home__category-chevron {
    font-size: var(--text-lg);
    color: var(--color-text-muted);
    flex-shrink: 0;
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

  .home__presets-link:hover .home__presets-link-text,
  .home__presets-link:hover .home__category-icon,
  .home__presets-link:hover .home__category-chevron {
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
