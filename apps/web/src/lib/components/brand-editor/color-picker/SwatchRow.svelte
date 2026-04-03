<script lang="ts">
  interface Props {
    /** Array of hex color strings to display as swatches. */
    colors: string[];
    /** Currently selected hex color (gets a ring indicator). */
    selected?: string;
    /** Called when a swatch is clicked. */
    onselect?: (hex: string) => void;
  }

  const { colors, selected, onselect }: Props = $props();
</script>

<div class="swatch-row" role="radiogroup" aria-label="Color presets">
  {#each colors as color}
    <button
      type="button"
      class="swatch"
      class:swatch--active={selected?.toUpperCase() === color.toUpperCase()}
      style="background-color: {color}"
      onclick={() => onselect?.(color)}
      aria-label="Select color {color}"
      aria-checked={selected?.toUpperCase() === color.toUpperCase()}
      role="radio"
    ></button>
  {/each}
</div>

<style>
  .swatch-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1-5);
  }

  .swatch {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    border: var(--border-width) var(--border-style) var(--color-border);
    cursor: pointer;
    transition: var(--transition-colors);
    padding: 0;
  }

  .swatch:hover {
    border-color: var(--color-border-strong);
    transform: scale(1.1);
  }

  .swatch--active {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 2px var(--color-interactive);
  }

  .swatch:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }
</style>
