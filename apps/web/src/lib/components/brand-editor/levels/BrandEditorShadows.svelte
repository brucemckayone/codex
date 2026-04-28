<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { hexToHslString } from '$lib/brand-editor/color-utils';
  import ColorInput from '../color-picker/ColorInput.svelte';
  import BrandSliderField from '../BrandSliderField.svelte';

  // Read current override values from store
  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  const intensity = $derived(Number(overrides['shadow-scale']) || 1);
  const tintColor = $derived(overrides['shadow-color'] ?? '');

  function updateOverride(key: string, value: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    if (!value || value === '1' || value === '') {
      delete current[key];
    } else {
      current[key] = value;
    }
    brandEditor.updateField('tokenOverrides', current);
  }

  function handleIntensityInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    updateOverride('shadow-scale', String(v));
  }

  function handleTintChange(hex: string) {
    // The shadow system uses space-delimited "H S% L%" format
    // (no commas, no hsl() wrapper) so it can be composed into
    // `hsl(var(--shadow-color) / 0.2)` at the consumer.
    updateOverride('shadow-color', hexToHslString(hex));
  }

  function clearTint() {
    updateOverride('shadow-color', '');
  }
</script>

<div class="shadows-level">
  <section class="shadows-level__section">
    <BrandSliderField
      id="shadow-intensity"
      label="Shadow Intensity"
      value="{Math.round(intensity * 100)}%"
      min={0}
      max={2}
      step={0.1}
      current={intensity}
      minLabel="None"
      maxLabel="Strong"
      oninput={handleIntensityInput}
    />
  </section>

  <section class="shadows-level__section">
    <div class="shadows-level__label-row">
      <span class="shadows-level__label">Shadow Tint</span>
      {#if tintColor}
        <button type="button" class="shadows-level__clear" onclick={clearTint}>reset</button>
      {/if}
    </div>
    <ColorInput
      value={tintColor || '#26262A'}
      onchange={handleTintChange}
    />
  </section>

  <div class="shadows-level__preview">
    <div class="shadows-level__card shadows-level__card--sm">
      <span>Small</span>
    </div>
    <div class="shadows-level__card shadows-level__card--md">
      <span>Medium</span>
    </div>
    <div class="shadows-level__card shadows-level__card--lg">
      <span>Large</span>
    </div>
  </div>
</div>

<style>
  .shadows-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .shadows-level__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .shadows-level__label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .shadows-level__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .shadows-level__clear {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
  }

  .shadows-level__clear:hover {
    color: var(--color-interactive);
  }

  .shadows-level__clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .shadows-level__preview {
    display: flex;
    gap: var(--space-3);
  }

  .shadows-level__card {
    flex: 1;
    padding: var(--space-3);
    background: var(--color-surface);
    border-radius: var(--radius-md);
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .shadows-level__card--sm { box-shadow: var(--shadow-sm); }
  .shadows-level__card--md { box-shadow: var(--shadow-md); }
  .shadows-level__card--lg { box-shadow: var(--shadow-lg); }
</style>
