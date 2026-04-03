<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';

  let radius = $state(brandEditor.pending?.radius ?? 0.5);
  let density = $state(brandEditor.pending?.density ?? 1);

  $effect(() => {
    radius = brandEditor.pending?.radius ?? 0.5;
    density = brandEditor.pending?.density ?? 1;
  });

  function handleRadiusInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    radius = v;
    brandEditor.updateField('radius', v);
  }

  function handleDensityInput(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    density = v;
    brandEditor.updateField('density', v);
  }
</script>

<div class="shape-level">
  <section class="shape-level__section">
    <label class="shape-level__label" for="radius-slider">
      Corner Radius
      <span class="shape-level__value">{radius.toFixed(2)}rem</span>
    </label>
    <div class="shape-level__range-row">
      <span class="shape-level__range-label">Sharp</span>
      <input
        id="radius-slider"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={radius}
        oninput={handleRadiusInput}
        class="shape-level__slider"
        aria-valuetext="{radius.toFixed(2)}rem"
      />
      <span class="shape-level__range-label">Playful</span>
    </div>

    <div class="shape-level__previews">
      <div class="shape-level__preview-btn" style="border-radius: {radius}rem">
        Button
      </div>
      <div class="shape-level__preview-card" style="border-radius: {radius * 1.5}rem">
        Card
      </div>
    </div>
  </section>

  <section class="shape-level__section">
    <label class="shape-level__label" for="density-slider">
      Density
      <span class="shape-level__value">{density.toFixed(2)}x</span>
    </label>
    <div class="shape-level__range-row">
      <span class="shape-level__range-label">Compact</span>
      <input
        id="density-slider"
        type="range"
        min="0.85"
        max="1.15"
        step="0.05"
        value={density}
        oninput={handleDensityInput}
        class="shape-level__slider"
        aria-valuetext="{density.toFixed(2)}x scale"
      />
      <span class="shape-level__range-label">Spacious</span>
    </div>
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

  .shape-level__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .shape-level__value {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .shape-level__range-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .shape-level__range-label {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
    width: 52px;
  }

  .shape-level__range-label:last-child {
    text-align: right;
  }

  .shape-level__slider {
    flex: 1;
    accent-color: var(--color-interactive);
  }

  .shape-level__previews {
    display: flex;
    gap: var(--space-3);
  }

  .shape-level__preview-btn {
    padding: var(--space-2) var(--space-4);
    background: var(--color-interactive);
    color: var(--color-text-on-brand);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    border: none;
    text-align: center;
  }

  .shape-level__preview-card {
    flex: 1;
    padding: var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
  }
</style>
