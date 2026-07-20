<!--
  @component OklchColorPicker

  Assembled OKLCH color picker: canvas area + hue slider + hex input + swatches.
  Bidirectional sync between hex string and OKLCH {l, c, h} state.

  A `large` mode (used by the `/studio/brand` colour focus) grows the colour
  area to fill the available height, adds an eyedropper (screen sampling via the
  EyeDropper API where supported), and shows the live OKLCH coordinates.

  @prop {string} value - Hex color value (bindable)
  @prop {string} [label] - Label above the picker
  @prop {(hex: string) => void} [onchange] - Called when color changes
  @prop {string[]} [swatches] - Preset swatch colors
  @prop {boolean} [large] - Fill-height layout + eyedropper + OKLCH readout
  @prop {string} [class] - Optional class forwarded to root
-->
<script lang="ts">
  import { browser } from '$app/environment';
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
    large?: boolean;
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
    large = false,
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

  // Live OKLCH readout (large mode) — a compact caption reinforcing that this is
  // a perceptual OKLCH picker, not HSL.
  const coords = $derived(
    `L ${oklch.l.toFixed(2)} · C ${oklch.c.toFixed(2)} · H ${Math.round(oklch.h)}°`
  );

  // ── EyeDropper API (Chromium) — typed, no `as any`. Absent in Firefox/Safari,
  // where the button simply isn't rendered. ────────────────────────────────────
  interface EyeDropperResult {
    readonly sRGBHex: string;
  }
  interface EyeDropperInstance {
    open(): Promise<EyeDropperResult>;
  }
  interface EyeDropperConstructor {
    new (): EyeDropperInstance;
  }
  const EyeDropperClass = (
    globalThis as { EyeDropper?: EyeDropperConstructor }
  ).EyeDropper;
  const eyedropperSupported = browser && typeof EyeDropperClass === 'function';

  async function pickWithEyedropper() {
    if (!EyeDropperClass) return;
    try {
      const result = await new EyeDropperClass().open();
      if (result?.sRGBHex) handleHexInput(result.sRGBHex);
    } catch {
      /* user dismissed the eyedropper — no-op */
    }
  }

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

<div class="oklch-picker {large ? 'oklch-picker--large' : ''} {className ?? ''}">
  {#if label}
    <span class="oklch-picker__label">{label}</span>
  {/if}

  <OklchColorArea
    hue={oklch.h}
    bind:lightness={oklch.l}
    bind:chroma={oklch.c}
    onchange={handleAreaChange}
    fill={large}
  />

  <HueSlider
    bind:hue={oklch.h}
    onchange={handleHueChange}
  />

  <div class="oklch-picker__row">
    <div class="oklch-picker__hex">
      <ColorInput {value} onchange={handleHexInput} />
    </div>
    {#if eyedropperSupported}
      <button
        type="button"
        class="oklch-picker__eyedropper"
        onclick={pickWithEyedropper}
        aria-label="Pick colour from screen"
        title="Pick colour from screen"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m2 22 1-1h3l9-9M3 21v-3l9-9m6.5-6.5a2.12 2.12 0 0 1 3 3L15 12l-4-4 4.5-4.5a2.12 2.12 0 0 1 3 0Z"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    {/if}
  </div>

  {#if large}
    <p class="oklch-picker__coords">{coords}</p>
  {/if}

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

  /* Large layout: the area (fill mode) becomes the dominant element via its own
     aspect ratio; the row/coords/swatches flow beneath. No flex-fill here — the
     colour focus scrolls as a whole on short viewports. */
  .oklch-picker__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .oklch-picker__row {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
  }

  .oklch-picker__hex {
    flex: 1;
    min-width: 0;
  }

  .oklch-picker__eyedropper {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-9);
    flex-shrink: 0;
    color: var(--color-text-secondary);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .oklch-picker__eyedropper:hover {
    color: var(--color-text);
    background: var(--color-surface-secondary);
    border-color: var(--color-border-strong);
  }

  .oklch-picker__eyedropper:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .oklch-picker__coords {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
</style>
