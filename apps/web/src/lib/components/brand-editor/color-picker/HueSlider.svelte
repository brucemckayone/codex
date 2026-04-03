<script lang="ts">
  interface Props {
    /** Current hue value (0-360). */
    hue?: number;
    /** Called when hue changes. */
    onchange?: (hue: number) => void;
  }

  let {
    hue = $bindable(0),
    onchange,
  }: Props = $props();

  function handleInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    hue = value;
    onchange?.(value);
  }
</script>

<div class="hue-slider">
  <input
    type="range"
    min="0"
    max="360"
    step="1"
    value={hue}
    oninput={handleInput}
    class="hue-slider__input"
    aria-label="Hue"
    aria-valuetext="{Math.round(hue)}°"
  />
</div>

<style>
  .hue-slider {
    width: 100%;
    padding: var(--space-1) 0;
  }

  .hue-slider__input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 12px;
    border-radius: var(--radius-full);
    outline: none;
    cursor: pointer;
    background: linear-gradient(
      to right,
      oklch(0.7 0.15 0),
      oklch(0.7 0.15 60),
      oklch(0.7 0.15 120),
      oklch(0.7 0.15 180),
      oklch(0.7 0.15 240),
      oklch(0.7 0.15 300),
      oklch(0.7 0.15 360)
    );
  }

  /* Webkit thumb */
  .hue-slider__input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    border: 2px solid white;
    box-shadow: var(--shadow-sm);
    background: oklch(0.7 0.15 var(--_hue, 0));
    cursor: grab;
  }

  .hue-slider__input::-webkit-slider-thumb:active {
    cursor: grabbing;
  }

  /* Firefox thumb */
  .hue-slider__input::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    border: 2px solid white;
    box-shadow: var(--shadow-sm);
    background: oklch(0.7 0.15 var(--_hue, 0));
    cursor: grab;
  }

  .hue-slider__input::-moz-range-thumb:active {
    cursor: grabbing;
  }

  /* Focus visible */
  .hue-slider__input:focus-visible::-webkit-slider-thumb {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .hue-slider__input:focus-visible::-moz-range-thumb {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
