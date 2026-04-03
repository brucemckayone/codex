<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import ColorInput from '../color-picker/ColorInput.svelte';

  // Read current override values from store
  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  let intensity = $state(Number(overrides['shadow-scale']) || 1);
  let tintColor = $state(overrides['shadow-color'] ?? '');

  // Sync from store when external changes occur (e.g., preset apply)
  $effect(() => {
    const o = brandEditor.pending?.tokenOverrides ?? {};
    intensity = Number(o['shadow-scale']) || 1;
    tintColor = o['shadow-color'] ?? '';
  });

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
    intensity = v;
    updateOverride('shadow-scale', String(v));
  }

  function handleTintChange(hex: string) {
    tintColor = hex;
    // Convert hex to HSL-ish string for --shadow-color
    // The shadow system uses "H S% L%" format (no commas, no hsl() wrapper)
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    const hsl = `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
    updateOverride('shadow-color', hsl);
  }

  function clearTint() {
    tintColor = '';
    updateOverride('shadow-color', '');
  }
</script>

<div class="shadows-level">
  <section class="shadows-level__section">
    <label class="shadows-level__label" for="shadow-intensity">
      Shadow Intensity
      <span class="shadows-level__value">{Math.round(intensity * 100)}%</span>
    </label>
    <div class="shadows-level__range-row">
      <span class="shadows-level__range-hint">None</span>
      <input
        id="shadow-intensity"
        type="range"
        min="0"
        max="2"
        step="0.1"
        value={intensity}
        oninput={handleIntensityInput}
        class="shadows-level__slider"
      />
      <span class="shadows-level__range-hint">Strong</span>
    </div>
  </section>

  <section class="shadows-level__section">
    <div class="shadows-level__label-row">
      <span class="shadows-level__label">Shadow Tint</span>
      {#if tintColor}
        <button class="shadows-level__clear" onclick={clearTint}>reset</button>
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

  .shadows-level__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .shadows-level__label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .shadows-level__value {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .shadows-level__range-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .shadows-level__range-hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
    width: 42px;
  }

  .shadows-level__range-hint:last-child {
    text-align: right;
  }

  .shadows-level__slider {
    flex: 1;
    accent-color: var(--color-interactive);
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
