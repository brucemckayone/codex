<!--
  @component OklchColorPicker

  Assembled OKLCH color picker: canvas area + hue slider + hex input + swatches.
  Bidirectional sync between hex string and OKLCH {l, c, h} state.

  @prop {string} value - Hex color value (bindable)
  @prop {string} [label] - Label above the picker
  @prop {(hex: string) => void} [onchange] - Called when color changes
  @prop {string[]} [swatches] - Preset swatch colors
  @prop {string} [class] - Optional class forwarded to root
-->
<script lang="ts">
  import { hexToOklch, oklchToHex } from '$lib/brand-editor/oklch-math';
  import OklchColorArea from './OklchColorArea.svelte';
  import HueSlider from './HueSlider.svelte';
  import ColorInput from './ColorInput.svelte';
  import SwatchRow from './SwatchRow.svelte';

  interface Props {
    value?: string;
    label?: string;
    onchange?: (hex: string) => void;
    swatches?: string[];
    /** Optional class forwarded to root — composition seam per R13 inverse. */
    class?: string;
  }

  let {
    value = $bindable('#6366F1'),
    label,
    onchange,
    swatches = [
      '#EF4444', '#F59E0B', '#22C55E', '#3B82F6',
      '#8B5CF6', '#EC4899', '#171717', '#FFFFFF',
    ],
    class: className,
  }: Props = $props();

  // Internal OKLCH state derived from hex.
  let oklch = $state(hexToOklch(value) ?? { l: 0.6, c: 0.15, h: 264 });

  // Sync external hex changes → internal OKLCH, but only if the incoming hex differs from
  // what we'd emit for the current oklch. This avoids a round-trip clobber when the user
  // drags the area/hue slider: handleAreaChange → emitHex → value → $effect → reparse →
  // floating-point drift in oklch. (3yco7)
  $effect(() => {
    const current = oklchToHex(oklch.l, oklch.c, oklch.h);
    if (value.toUpperCase() === current.toUpperCase()) return;
    const parsed = hexToOklch(value);
    if (parsed) {
      oklch = parsed;
    }
  });

  function emitHex() {
    const hex = oklchToHex(oklch.l, oklch.c, oklch.h);
    value = hex;
    onchange?.(hex);
  }

  function handleAreaChange(l: number, c: number) {
    oklch.l = l;
    oklch.c = c;
    emitHex();
  }

  function handleHueChange(h: number) {
    oklch.h = h;
    emitHex();
  }

  function handleHexInput(hex: string) {
    const parsed = hexToOklch(hex);
    if (parsed) {
      oklch = parsed;
      value = hex;
      onchange?.(hex);
    }
  }

  function handleSwatchSelect(hex: string) {
    const parsed = hexToOklch(hex);
    if (parsed) {
      oklch = parsed;
      value = hex;
      onchange?.(hex);
    }
  }
</script>

<div class="oklch-picker {className ?? ''}">
  {#if label}
    <span class="oklch-picker__label">{label}</span>
  {/if}

  <OklchColorArea
    hue={oklch.h}
    bind:lightness={oklch.l}
    bind:chroma={oklch.c}
    onchange={handleAreaChange}
  />

  <HueSlider
    bind:hue={oklch.h}
    onchange={handleHueChange}
  />

  <div class="oklch-picker__row">
    <ColorInput {value} onchange={handleHexInput} />
  </div>

  {#if swatches.length > 0}
    <SwatchRow
      colors={swatches}
      selected={value}
      onselect={handleSwatchSelect}
    />
  {/if}
</div>

<style>
  .oklch-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .oklch-picker__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .oklch-picker__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
