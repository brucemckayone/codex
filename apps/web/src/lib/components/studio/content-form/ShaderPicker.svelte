<!--
  @component ShaderPicker

  Grid of shader preset cards for selecting an immersive audio shader.
  Shows preset name and description. Selected card has primary border.

  @prop {string | null} value - Currently selected preset ID (null = none)
  @prop {(preset: string | null) => void} onchange - Callback when selection changes
-->
<script lang="ts">
  import { HERO_FX_PRESETS } from '$lib/brand-editor/hero-fx-presets';
  import ShaderPreview from './ShaderPreview.svelte';

  interface Props {
    value: string | null;
    onchange: (preset: string | null) => void;
  }

  const { value, onchange }: Props = $props();

  /**
   * Every shader preset, derived from the single source of truth.
   *
   * This list used to be hardcoded here, and it had drifted: it named 26 of
   * the 41 presets, so `topo`, `turing`, `glass`, `film`, `physarum`,
   * `mycelium`, `pollen`, `growth`, `geode`, `lenia`, `bismuth`, `pearl`,
   * `vortex`, `gyroid`, `fracture` and `vapor` could not be chosen for
   * immersive audio playback at all — no matter how audio-reactive they were.
   *
   * Two lists that must agree, with nothing forcing them to, always diverge:
   * adding a preset to `HERO_FX_PRESETS` gave no signal that this copy also
   * needed the entry. Deriving removes the failure mode rather than
   * documenting it — a new preset now appears here automatically.
   *
   * `none` is re-described. In the brand editor it means "fall back to the
   * default gradient hero"; here it means "play audio with no visualiser at
   * all", since the immersive player is a fullscreen overlay with no gradient
   * behind it. Same id, different consequence — so the label is overridden
   * rather than inherited.
   */
  const PRESETS = HERO_FX_PRESETS.map((p) =>
    p.id === 'none' ? { ...p, description: 'No shader effect' } : p
  );

  function isSelected(presetId: string): boolean {
    if (presetId === 'none') return value === null;
    return value === presetId;
  }

  function handleSelect(presetId: string) {
    onchange(presetId === 'none' ? null : presetId);
  }
</script>

<div class="shader-picker-wrap">
  <ShaderPreview preset={value} />

  <div class="shader-picker" role="radiogroup" aria-label="Shader preset">
    {#each PRESETS as preset (preset.id)}
      <button
        type="button"
        class="preset-card"
        class:selected={isSelected(preset.id)}
        role="radio"
        aria-checked={isSelected(preset.id)}
        onclick={() => handleSelect(preset.id)}
      >
        <span class="preset-name">{preset.label}</span>
        <span class="preset-description">{preset.description}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  /* Container stacks the live preview above the preset grid so the creator
     sees exactly what they'll get before committing. Gap keeps the preview
     visually separated without a rule or surface change. */
  .shader-picker-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .shader-picker {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  @media (--breakpoint-sm) {
    .shader-picker {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .preset-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--color-surface);
    border: var(--border-width-thick) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
    font-family: inherit;
  }

  .preset-card:hover {
    border-color: var(--color-text-secondary);
    background: var(--color-surface-secondary);
  }

  .preset-card:focus-visible {
    outline: var(--border-width-thick) var(--border-style) var(--color-primary-500);
    outline-offset: var(--space-px);
  }

  .preset-card.selected {
    border-color: var(--color-primary-500);
    background: var(--color-surface-secondary);
  }

  .preset-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  .preset-description {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-snug);
  }
</style>
