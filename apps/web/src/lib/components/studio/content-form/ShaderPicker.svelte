<!--
  @component ShaderPicker

  Grid of shader preset cards for selecting an immersive audio shader.
  Shows preset name and description. Selected card has primary border.

  @prop {string | null} value - Currently selected preset ID (null = none)
  @prop {(preset: string | null) => void} onchange - Callback when selection changes
-->
<script lang="ts">
  interface Props {
    value: string | null;
    onchange: (preset: string | null) => void;
  }

  const { value, onchange }: Props = $props();

  const PRESETS = [
    { id: 'none', label: 'None', description: 'No shader effect' },
    { id: 'suture', label: 'Suture', description: 'Organic flowing fluid' },
    { id: 'ether', label: 'Ether', description: 'Ethereal glowing forms' },
    { id: 'warp', label: 'Warp', description: 'Domain warping textures' },
    { id: 'ripple', label: 'Ripple', description: 'Water ripple surface' },
    { id: 'pulse', label: 'Pulse', description: 'Liquid wave surface' },
    { id: 'ink', label: 'Ink', description: 'Ink dispersion' },
    { id: 'nebula', label: 'Nebula', description: 'Cosmic dust clouds' },
    { id: 'silk', label: 'Silk', description: 'Flowing fabric' },
    { id: 'aurora', label: 'Aurora', description: 'Northern lights' },
    { id: 'plasma', label: 'Plasma', description: 'Iridescent fluid' },
    { id: 'flux', label: 'Flux', description: 'Magnetic field lines' },
    { id: 'caustic', label: 'Caustic', description: 'Underwater light' },
    { id: 'lava', label: 'Lava', description: 'Molten crust' },
    { id: 'rain', label: 'Rain', description: 'Raindrops on glass' },
    { id: 'frost', label: 'Frost', description: 'Ice crystal growth' },
    { id: 'glow', label: 'Glow', description: 'Bioluminescent deep sea' },
    { id: 'life', label: 'Life', description: 'Cellular automata' },
    { id: 'tendrils', label: 'Tendrils', description: 'Flowing curl noise' },
    { id: 'ocean', label: 'Ocean', description: 'Caustics over sand' },
    { id: 'waves', label: 'Waves', description: 'Ocean surface' },
    { id: 'clouds', label: 'Clouds', description: 'Procedural sky' },
    { id: 'julia', label: 'Julia', description: 'Animated fractal' },
    { id: 'tunnel', label: 'Tunnel', description: 'Fractal tunnel' },
    { id: 'flow', label: 'Flow', description: 'Paint streaks' },
    { id: 'spore', label: 'Spore', description: 'Slime network' },
  ] as const;

  function isSelected(presetId: string): boolean {
    if (presetId === 'none') return value === null;
    return value === presetId;
  }

  function handleSelect(presetId: string) {
    onchange(presetId === 'none' ? null : presetId);
  }
</script>

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

<style>
  .shader-picker {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }

  @media (min-width: 640px) {
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
