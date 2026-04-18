<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import BrandSliderField from '../BrandSliderField.svelte';

  const radius = $derived(brandEditor.pending?.radius ?? 0.5);
  const density = $derived(brandEditor.pending?.density ?? 1);

  function handleRadiusInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    brandEditor.updateField('radius', v);
  }

  function handleDensityInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    brandEditor.updateField('density', v);
  }
</script>

<div class="shape-level">
  <section class="shape-level__section">
    <BrandSliderField
      id="radius-slider"
      label="Corner Radius"
      value="{radius.toFixed(2)}rem"
      min={0}
      max={2}
      step={0.05}
      current={radius}
      minLabel="Sharp"
      maxLabel="Playful"
      ariaValueText="{radius.toFixed(2)}rem"
      oninput={handleRadiusInput}
    />

    <div class="shape-level__previews">
      <div class="shape-level__preview-btn" style="border-radius: {radius}rem">
        Button
      </div>
      <div class="shape-level__preview-card" style="border-radius: {radius * 1.5}rem">
        <span class="shape-level__card-title">Card</span>
        <span class="shape-level__card-body">Preview content</span>
      </div>
    </div>
  </section>

  <section class="shape-level__section">
    <BrandSliderField
      id="density-slider"
      label="Density"
      value="{density.toFixed(2)}x"
      min={0.75}
      max={1.25}
      step={0.05}
      current={density}
      minLabel="Compact"
      maxLabel="Spacious"
      ariaValueText="{density.toFixed(2)}x scale"
      oninput={handleDensityInput}
    />
  </section>
</div>

<style>
  .shape-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .shape-level__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .shape-level__previews {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .shape-level__preview-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: none;
    white-space: nowrap;
    height: var(--space-10);
  }

  .shape-level__preview-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-sm);
  }

  .shape-level__card-title {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .shape-level__card-body {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
