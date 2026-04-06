<!--
  @component BrandEditorFineTuneTypography
  Level 2 — Text scale and font weight overrides.
  Depends on textScale/headingWeight/bodyWeight DB columns (now complete).
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import BrandSliderField from '../BrandSliderField.svelte';

  const textScale = $derived(brandEditor.pending?.tokenOverrides?.['text-scale'] ?? '1');
  const headingWeight = $derived(brandEditor.pending?.tokenOverrides?.['heading-weight'] ?? '');
  const bodyWeight = $derived(brandEditor.pending?.tokenOverrides?.['body-weight'] ?? '');

  const WEIGHT_OPTIONS = [
    { value: '', label: 'Default' },
    { value: '300', label: 'Light (300)' },
    { value: '400', label: 'Regular (400)' },
    { value: '500', label: 'Medium (500)' },
    { value: '600', label: 'Semibold (600)' },
    { value: '700', label: 'Bold (700)' },
  ];

  function updateOverride(key: string, value: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    if (value === '' || value === '1') {
      delete current[key];
    } else {
      current[key] = value;
    }
    brandEditor.updateField('tokenOverrides', current);
  }

  function handleScaleInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    updateOverride('text-scale', v);
  }

  function handleHeadingWeight(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    updateOverride('heading-weight', v);
  }

  function handleBodyWeight(e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    updateOverride('body-weight', v);
  }
</script>

<div class="fine-type">
  <section class="fine-type__section">
    <BrandSliderField
      id="text-scale-slider"
      label="Text Scale"
      value="{Number(textScale).toFixed(2)}x"
      min={0.85}
      max={1.15}
      step={0.05}
      current={Number(textScale)}
      minLabel="Smaller"
      maxLabel="Larger"
      ariaValueText="{Number(textScale).toFixed(2)}x scale"
      oninput={handleScaleInput}
    />
    <p class="fine-type__preview" style="font-size: calc(var(--text-base) * {textScale})">
      The quick brown fox jumps over the lazy dog.
    </p>
  </section>

  <section class="fine-type__section">
    <label class="fine-type__label" for="heading-weight">Heading Weight</label>
    <select id="heading-weight" class="fine-type__select" value={headingWeight} onchange={handleHeadingWeight}>
      {#each WEIGHT_OPTIONS as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="fine-type__preview fine-type__preview--heading" style="font-weight: {headingWeight || 'var(--font-bold)'}">
      Heading Preview
    </p>
  </section>

  <section class="fine-type__section">
    <label class="fine-type__label" for="body-weight">Body Weight</label>
    <select id="body-weight" class="fine-type__select" value={bodyWeight} onchange={handleBodyWeight}>
      {#each WEIGHT_OPTIONS as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <p class="fine-type__preview" style="font-weight: {bodyWeight || 'var(--font-normal)'}">
      Body text preview with the selected weight applied.
    </p>
  </section>
</div>

<style>
  .fine-type {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .fine-type__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .fine-type__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .fine-type__select {
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .fine-type__preview {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
  }

  .fine-type__preview--heading {
    font-size: var(--text-xl);
    font-family: var(--font-heading);
    color: var(--color-text);
  }
</style>
