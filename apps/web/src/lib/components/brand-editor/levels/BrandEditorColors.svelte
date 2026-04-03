<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import OklchColorPicker from '../color-picker/OklchColorPicker.svelte';
  import ColorInput from '../color-picker/ColorInput.svelte';
  import HueSlider from '../color-picker/HueSlider.svelte';
  import { hexToOklch } from '$lib/brand-editor/oklch-math';

  // Compact pickers for secondary/accent/background use hue + swatch only
  function updateColor(field: 'primaryColor' | 'secondaryColor' | 'accentColor' | 'backgroundColor', hex: string) {
    brandEditor.updateField(field, hex);
  }

  function clearBackground() {
    brandEditor.updateField('backgroundColor', null);
  }
</script>

<div class="colors-level">
  <section class="colors-level__section">
    <OklchColorPicker
      label="Primary"
      value={brandEditor.pending?.primaryColor ?? '#6366F1'}
      onchange={(hex) => updateColor('primaryColor', hex)}
    />
  </section>

  <section class="colors-level__section">
    <span class="colors-level__label">Secondary</span>
    <ColorInput
      value={brandEditor.pending?.secondaryColor ?? '#737373'}
      onchange={(hex) => updateColor('secondaryColor', hex)}
    />
  </section>

  <section class="colors-level__section">
    <span class="colors-level__label">Accent</span>
    <ColorInput
      value={brandEditor.pending?.accentColor ?? '#F59E0B'}
      onchange={(hex) => updateColor('accentColor', hex)}
    />
  </section>

  <section class="colors-level__section">
    <div class="colors-level__label-row">
      <span class="colors-level__label">Background</span>
      {#if brandEditor.pending?.backgroundColor}
        <button class="colors-level__clear" onclick={clearBackground}>clear</button>
      {/if}
    </div>
    <ColorInput
      value={brandEditor.pending?.backgroundColor ?? '#FFFFFF'}
      onchange={(hex) => updateColor('backgroundColor', hex)}
    />
  </section>

  <button
    class="colors-level__drill"
    onclick={() => brandEditor.navigateTo('fine-tune-colors')}
  >
    Fine-tune colors...
  </button>
</div>

<style>
  .colors-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .colors-level__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .colors-level__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .colors-level__label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .colors-level__clear {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .colors-level__clear:hover {
    color: var(--color-interactive);
  }

  .colors-level__drill {
    font-size: var(--text-sm);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: var(--space-2) 0;
  }

  .colors-level__drill:hover {
    color: var(--color-interactive-hover);
  }
</style>
