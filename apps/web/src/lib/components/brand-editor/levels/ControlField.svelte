<!--
  @component ControlField

  Manifest-driven renderer for a single hero-fx control. Dispatches on
  ControlConfig.kind to a slider, color picker, or toggle. Replaces the
  41 {:else if} per-preset blocks formerly in BrandEditorHeroEffects.

  Reads its current value from the parent's `currentValue` (a number for
  slider, string for color, boolean for toggle) and writes via the parent's
  `onUpdate(key, value)` callback. The parent owns the read/write of
  brandEditor.pending.tokenOverrides — this component is presentation-only.
-->
<script lang="ts">
  import type { ControlConfig } from '$lib/brand-editor/hero-fx-presets';
  import BrandSliderField from '../BrandSliderField.svelte';

  interface Props {
    control: ControlConfig;
    /** Current numeric value (for slider), hex string (for color), or boolean (for toggle). */
    currentValue: number | string | boolean;
    /** Write helper supplied by parent — accepts string value to match updateOverride signature. */
    onUpdate: (key: string, value: string) => void;
  }

  const { control, currentValue, onUpdate }: Props = $props();

  // ── Slider helpers ────────────────────────────────────────────────────
  function formatSliderValue(n: number, format: string): string {
    switch (format) {
      case 'int':
        return String(Math.round(n));
      case 'fixed1':
        return n.toFixed(1);
      case 'fixed2':
        return n.toFixed(2);
      case 'fixed3':
        return n.toFixed(3);
      case 'angle':
        return `${Math.round(n)}°`;
      default:
        return String(n);
    }
  }

  function handleSliderInput(key: string) {
    return (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      onUpdate(key, v);
    };
  }
</script>

{#if control.kind === 'slider'}
  {@const numValue = typeof currentValue === 'number' ? currentValue : 0}
  <BrandSliderField
    id={control.key}
    label={control.label}
    value={formatSliderValue(numValue, control.format)}
    min={control.min}
    max={control.max}
    step={control.step}
    current={numValue}
    minLabel={control.minLabel}
    maxLabel={control.maxLabel}
    oninput={handleSliderInput(control.key)}
  />
{:else if control.kind === 'color'}
  <div class="hero-fx__color-row">
    <span class="hero-fx__color-label">{control.label}</span>
    <input
      type="color"
      id={control.key}
      name={control.key}
      value={typeof currentValue === 'string' ? currentValue : ''}
      oninput={(e) => onUpdate(control.key, (e.target as HTMLInputElement).value)}
      class="hero-fx__color-input"
      aria-label={control.label}
    />
  </div>
{:else if control.kind === 'toggle'}
  {@const isOn = currentValue === true}
  <div class="hero-fx__toggle-row">
    <span class="hero-fx__toggle-label">{control.label}</span>
    <button
      type="button"
      class="hero-fx__toggle"
      class:hero-fx__toggle--on={isOn}
      onclick={() => onUpdate(control.key, isOn ? '0' : '1')}
      role="switch"
      aria-label={`Toggle ${control.label.toLowerCase()}`}
      aria-checked={isOn}
    >
      <span class="hero-fx__toggle-thumb"></span>
    </button>
  </div>
{/if}

<style>
  /* ── Color Picker Row ──────────────────────────── */

  .hero-fx__color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) 0;
  }

  .hero-fx__color-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .hero-fx__color-input {
    width: var(--space-10);
    height: var(--space-8);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    padding: var(--space-0-5);
    cursor: pointer;
    background: transparent;
  }

  .hero-fx__color-input:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .hero-fx__color-input::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .hero-fx__color-input::-webkit-color-swatch {
    border: none;
    border-radius: var(--radius-sm);
  }

  .hero-fx__color-input::-moz-color-swatch {
    border: none;
    border-radius: var(--radius-sm);
  }

  /* ── Toggle Switch ───────────────────────────── */

  .hero-fx__toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) 0;
  }

  .hero-fx__toggle-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .hero-fx__toggle {
    position: relative;
    width: var(--space-10);
    height: var(--space-5);
    background: var(--color-surface-tertiary);
    border: none;
    border-radius: var(--radius-full);
    cursor: pointer;
    transition: background var(--duration-normal) var(--ease-default);
    padding: 0;
  }

  .hero-fx__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .hero-fx__toggle--on {
    background: var(--color-interactive);
  }

  .hero-fx__toggle-thumb {
    position: absolute;
    top: var(--space-0-5);
    left: var(--space-0-5);
    width: var(--space-4);
    height: var(--space-4);
    background: var(--color-text-inverse);
    border-radius: var(--radius-full);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .hero-fx__toggle--on .hero-fx__toggle-thumb {
    transform: translateX(var(--space-5));
  }
</style>
