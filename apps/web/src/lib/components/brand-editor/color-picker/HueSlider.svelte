<script lang="ts">
  interface Props {
    /** Current hue value (0-360). */
    hue?: number;
    /** Called when hue changes. */
    onchange?: (hue: number) => void;
    /** Optional class forwarded to root — composition seam per R13 inverse. */
    class?: string;
  }

  let {
    hue = $bindable(0),
    onchange,
    class: className,
  }: Props = $props();

  function handleInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    hue = value;
    onchange?.(value);
  }
</script>

<div class="hue-slider {className ?? ''}">
  <!-- --_hue is consumed by the vendor thumb rules below (DRY via custom properties —
       mgnnq). Previously unset, making the thumb always hue=0 (sjah). R13 inverse: this
       root carries the class forward so callers can adjust. -->
  <input
    type="range"
    min="0"
    max="360"
    step="1"
    value={hue}
    oninput={handleInput}
    class="hue-slider__input"
    style="--_hue: {hue}"
    aria-label="Hue"
    aria-valuetext="{Math.round(hue)}°"
  />
</div>

<style>
  .hue-slider {
    /* Shared thumb tokens consumed by both vendor selectors — DRY per 03-components.md. */
    --_thumb-size: var(--space-4); /* 16px */
    --_thumb-border: var(--border-width-thick) solid var(--color-surface);
    --_thumb-bg: oklch(0.7 0.15 var(--_hue, 0));

    width: 100%;
    padding: var(--space-1) 0;
  }

  .hue-slider__input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: var(--space-3); /* 12px — native range tracks afford full-height hit area */
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
    width: var(--_thumb-size);
    height: var(--_thumb-size);
    border-radius: var(--radius-full);
    border: var(--_thumb-border);
    box-shadow: var(--shadow-sm);
    background: var(--_thumb-bg);
    cursor: grab;
  }

  .hue-slider__input::-webkit-slider-thumb:active {
    cursor: grabbing;
  }

  /* Firefox thumb */
  .hue-slider__input::-moz-range-thumb {
    width: var(--_thumb-size);
    height: var(--_thumb-size);
    border-radius: var(--radius-full);
    border: var(--_thumb-border);
    box-shadow: var(--shadow-sm);
    background: var(--_thumb-bg);
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
