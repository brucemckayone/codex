<script lang="ts">
  import { brandEditor, HOME_CATEGORIES, LEVELS, BRAND_PRESETS } from '$lib/brand-editor';
  import type { LevelId } from '$lib/brand-editor';

  function navigateToCategory(id: LevelId) {
    brandEditor.navigateTo(id);
  }
</script>

<div class="home">
  <div class="home__categories">
    {#each HOME_CATEGORIES as catId}
      {@const cat = LEVELS[catId]}
      <button class="home__category" onclick={() => navigateToCategory(catId)}>
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

  <div class="home__presets">
    <span class="home__presets-label">Presets</span>
    <div class="home__presets-row">
      {#each BRAND_PRESETS as preset}
        <button
          class="home__preset-pill"
          onclick={() => brandEditor.applyPreset(preset)}
          title={preset.description}
        >
          <span
            class="home__preset-swatch"
            style="background-color: {preset.values.primaryColor}"
          ></span>
          {preset.name}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
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
    outline-offset: 2px;
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

  /* ── Presets ────────────────────────────────────── */

  .home__presets {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .home__presets-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .home__presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .home__preset-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background: var(--color-surface);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .home__preset-pill:hover {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .home__preset-pill:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .home__preset-swatch {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }
</style>
