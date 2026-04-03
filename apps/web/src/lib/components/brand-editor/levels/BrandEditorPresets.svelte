<script lang="ts">
  import { brandEditor, BRAND_PRESETS } from '$lib/brand-editor';
  import type { PresetCategory } from '$lib/brand-editor';

  const categories: PresetCategory[] = ['Professional', 'Creative', 'Bold', 'Minimal'];

  const presetsByCategory = $derived(
    categories.map((cat) => ({
      category: cat,
      presets: BRAND_PRESETS.filter((p) => p.category === cat),
    }))
  );
</script>

<div class="presets-level">
  {#each presetsByCategory as group}
    <section class="presets-level__group">
      <h3 class="presets-level__group-label">{group.category}</h3>
      <div class="presets-level__grid">
        {#each group.presets as preset}
          <button
            class="presets-level__card"
            onclick={() => brandEditor.applyPreset(preset)}
            title={preset.description}
          >
            <div class="presets-level__swatches">
              <span class="presets-level__swatch presets-level__swatch--lg" style:background={preset.values.primaryColor}></span>
              {#if preset.values.secondaryColor}
                <span class="presets-level__swatch" style:background={preset.values.secondaryColor}></span>
              {/if}
              {#if preset.values.accentColor}
                <span class="presets-level__swatch" style:background={preset.values.accentColor}></span>
              {/if}
            </div>
            <span class="presets-level__name">{preset.name}</span>
            <span class="presets-level__desc">{preset.description}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .presets-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .presets-level__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .presets-level__group-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  .presets-level__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .presets-level__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .presets-level__card:hover {
    border-color: var(--color-interactive);
    background: var(--color-surface-secondary);
  }

  .presets-level__swatches {
    display: flex;
    gap: var(--space-1);
  }

  .presets-level__swatch {
    width: var(--space-4);
    height: var(--space-4);
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .presets-level__swatch--lg {
    width: var(--space-5);
    height: var(--space-5);
  }

  .presets-level__name {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .presets-level__desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-tight);
  }
</style>
