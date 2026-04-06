<!--
  @component BrandSliderField

  Reusable slider field for brand editor levels.
  Renders a label with value display, a range input with min/max hint labels.

  @prop {string} id - Input id (for label association)
  @prop {string} label - Field label text
  @prop {string} value - Formatted display value (e.g. "0.50rem", "100%")
  @prop {number} min - Range minimum
  @prop {number} max - Range maximum
  @prop {number} step - Range step
  @prop {number} current - Current numeric value for the input
  @prop {string} [minLabel] - Label for the min end of the range
  @prop {string} [maxLabel] - Label for the max end of the range
  @prop {string} [ariaValueText] - aria-valuetext for the input
  @prop {(e: Event) => void} oninput - Input handler
-->
<script lang="ts">
  interface Props {
    id: string;
    label: string;
    value: string;
    min: number;
    max: number;
    step: number;
    current: number;
    minLabel?: string;
    maxLabel?: string;
    ariaValueText?: string;
    oninput: (e: Event) => void;
  }

  const {
    id,
    label,
    value,
    min,
    max,
    step,
    current,
    minLabel,
    maxLabel,
    ariaValueText,
    oninput,
  }: Props = $props();
</script>

<div class="slider-field">
  <label class="slider-field__label" for={id}>
    {label}
    <span class="slider-field__value">{value}</span>
  </label>
  <div class="slider-field__range-row">
    {#if minLabel}
      <span class="slider-field__hint">{minLabel}</span>
    {/if}
    <input
      {id}
      type="range"
      {min}
      {max}
      {step}
      value={current}
      {oninput}
      class="slider-field__slider"
      aria-valuetext={ariaValueText}
    />
    {#if maxLabel}
      <span class="slider-field__hint slider-field__hint--end">{maxLabel}</span>
    {/if}
  </div>
</div>

<style>
  .slider-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .slider-field__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .slider-field__value {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .slider-field__range-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .slider-field__hint {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    flex-shrink: 0;
    width: 52px;
  }

  .slider-field__hint--end {
    text-align: right;
  }

  .slider-field__slider {
    flex: 1;
    accent-color: var(--color-interactive);
  }
</style>
