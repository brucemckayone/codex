<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import BrandSliderField from '../BrandSliderField.svelte';

  // ── Preset definitions ─────────────────────────────────────────────────
  interface PresetOption {
    id: string;
    label: string;
    description: string;
  }

  const PRESETS: PresetOption[] = [
    { id: 'none', label: 'None', description: 'Default gradient' },
    { id: 'suture', label: 'Suture Fluid', description: 'Organic flowing fluid' },
    { id: 'ether', label: 'Ether', description: 'Ethereal glowing forms' },
    { id: 'warp', label: 'Domain Warp', description: 'Marble textures' },
    { id: 'ripple', label: 'Water Ripple', description: 'Rippling water surface' },
  ];

  // ── Default values ─────────────────────────────────────────────────────
  const DEFAULTS: Record<string, string> = {
    'shader-intensity': '0.40',
    'shader-grain': '0.025',
    'shader-vignette': '0.20',
    'shader-curl': '30',
    'shader-dissipation': '0.985',
    'shader-rotation-speed': '0.40',
    'shader-complexity': '6',
    'shader-zoom': '5.0',
    'shader-warp-strength': '1.50',
    'shader-light-angle': '135',
    'shader-wave-speed': '0.80',
    'shader-damping': '0.995',
  };

  /** All shader-* token override keys. */
  const ALL_SHADER_KEYS = [
    'shader-preset',
    'shader-intensity',
    'shader-grain',
    'shader-vignette',
    'shader-curl',
    'shader-dissipation',
    'shader-rotation-speed',
    'shader-complexity',
    'shader-zoom',
    'shader-warp-strength',
    'shader-light-angle',
    'shader-wave-speed',
    'shader-damping',
  ];

  // ── Read current overrides ─────────────────────────────────────────────
  const overrides = $derived(brandEditor.pending?.tokenOverrides ?? {});
  const activePreset = $derived(overrides['shader-preset'] ?? 'none');

  /** Read a numeric override, falling back to its default. Handles 0 correctly. */
  function readNum(key: string): number {
    const raw = overrides[key];
    if (raw == null) return Number(DEFAULTS[key]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(DEFAULTS[key]);
  }

  // Shared sliders
  const intensity = $derived(readNum('shader-intensity'));
  const grain = $derived(readNum('shader-grain'));
  const vignette = $derived(readNum('shader-vignette'));

  // Suture sliders
  const curl = $derived(readNum('shader-curl'));
  const dissipation = $derived(readNum('shader-dissipation'));

  // Ether sliders
  const rotationSpeed = $derived(readNum('shader-rotation-speed'));
  const complexity = $derived(readNum('shader-complexity'));
  const zoom = $derived(readNum('shader-zoom'));

  // Warp sliders
  const warpStrength = $derived(readNum('shader-warp-strength'));
  const lightAngle = $derived(readNum('shader-light-angle'));

  // Ripple sliders
  const waveSpeed = $derived(readNum('shader-wave-speed'));
  const damping = $derived(readNum('shader-damping'));

  // ── Update helpers ─────────────────────────────────────────────────────
  function updateOverride(key: string, value: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };
    // Remove if the value matches the default (so it falls back to ShaderHero defaults)
    if (!value || value === DEFAULTS[key]) {
      delete current[key];
    } else {
      current[key] = value;
    }
    brandEditor.updateField('tokenOverrides', current);
  }

  function selectPreset(presetId: string) {
    const current = { ...(brandEditor.pending?.tokenOverrides ?? {}) };

    if (presetId === 'none') {
      // Clear ALL shader-* overrides so no stale config lingers
      for (const key of ALL_SHADER_KEYS) {
        delete current[key];
      }
    } else {
      // Set the preset, keep existing slider values
      current['shader-preset'] = presetId;
    }

    brandEditor.updateField('tokenOverrides', current);
  }

  // ── Slider input handlers ──────────────────────────────────────────────
  function handleSliderInput(key: string) {
    return (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      updateOverride(key, v);
    };
  }
</script>

<div class="hero-fx">
  <!-- Preset selector -->
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Shader Preset</span>
    <div class="hero-fx__preset-grid">
      {#each PRESETS as preset}
        <button
          class="hero-fx__preset-card"
          class:hero-fx__preset-card--active={activePreset === preset.id}
          onclick={() => selectPreset(preset.id)}
        >
          <span class="hero-fx__preset-label">{preset.label}</span>
          <span class="hero-fx__preset-desc">{preset.description}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Shared sliders (only when a preset is active) -->
  {#if activePreset !== 'none'}
    <section class="hero-fx__section">
      <span class="hero-fx__section-label">Global</span>

      <BrandSliderField
        id="shader-intensity"
        label="Intensity"
        value={intensity.toFixed(2)}
        min={0.10}
        max={1.00}
        step={0.05}
        current={intensity}
        minLabel="Subtle"
        maxLabel="Strong"
        oninput={handleSliderInput('shader-intensity')}
      />

      <BrandSliderField
        id="shader-grain"
        label="Grain"
        value={grain.toFixed(3)}
        min={0.000}
        max={0.080}
        step={0.005}
        current={grain}
        minLabel="Clean"
        maxLabel="Gritty"
        oninput={handleSliderInput('shader-grain')}
      />

      <BrandSliderField
        id="shader-vignette"
        label="Vignette"
        value={vignette.toFixed(2)}
        min={0.00}
        max={0.50}
        step={0.05}
        current={vignette}
        minLabel="None"
        maxLabel="Heavy"
        oninput={handleSliderInput('shader-vignette')}
      />
    </section>

    <!-- Per-preset sliders -->
    {#if activePreset === 'suture'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Suture Fluid</span>

        <BrandSliderField
          id="shader-curl"
          label="Curl Strength"
          value={String(Math.round(curl))}
          min={1}
          max={80}
          step={1}
          current={curl}
          minLabel="Calm"
          maxLabel="Chaotic"
          oninput={handleSliderInput('shader-curl')}
        />

        <BrandSliderField
          id="shader-dissipation"
          label="Dissipation"
          value={dissipation.toFixed(3)}
          min={0.900}
          max={0.999}
          step={0.001}
          current={dissipation}
          minLabel="Fast"
          maxLabel="Slow"
          oninput={handleSliderInput('shader-dissipation')}
        />
      </section>
    {:else if activePreset === 'ether'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Ether</span>

        <BrandSliderField
          id="shader-rotation-speed"
          label="Rotation Speed"
          value={rotationSpeed.toFixed(2)}
          min={0.10}
          max={1.00}
          step={0.05}
          current={rotationSpeed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-rotation-speed')}
        />

        <BrandSliderField
          id="shader-complexity"
          label="Complexity"
          value={String(Math.round(complexity))}
          min={3}
          max={8}
          step={1}
          current={complexity}
          minLabel="Simple"
          maxLabel="Complex"
          oninput={handleSliderInput('shader-complexity')}
        />

        <BrandSliderField
          id="shader-zoom"
          label="Zoom"
          value={zoom.toFixed(1)}
          min={1.0}
          max={8.0}
          step={0.5}
          current={zoom}
          minLabel="Close"
          maxLabel="Far"
          oninput={handleSliderInput('shader-zoom')}
        />
      </section>
    {:else if activePreset === 'warp'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Domain Warp</span>

        <BrandSliderField
          id="shader-warp-strength"
          label="Warp Strength"
          value={warpStrength.toFixed(2)}
          min={0.50}
          max={3.00}
          step={0.10}
          current={warpStrength}
          minLabel="Gentle"
          maxLabel="Extreme"
          oninput={handleSliderInput('shader-warp-strength')}
        />

        <BrandSliderField
          id="shader-light-angle"
          label="Light Angle"
          value="{Math.round(lightAngle)}°"
          min={0}
          max={360}
          step={5}
          current={lightAngle}
          minLabel="0°"
          maxLabel="360°"
          oninput={handleSliderInput('shader-light-angle')}
        />
      </section>
    {:else if activePreset === 'ripple'}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">Water Ripple</span>

        <BrandSliderField
          id="shader-wave-speed"
          label="Wave Speed"
          value={waveSpeed.toFixed(2)}
          min={0.10}
          max={2.00}
          step={0.10}
          current={waveSpeed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-wave-speed')}
        />

        <BrandSliderField
          id="shader-damping"
          label="Damping"
          value={damping.toFixed(3)}
          min={0.980}
          max={0.999}
          step={0.001}
          current={damping}
          minLabel="Quick"
          maxLabel="Lasting"
          oninput={handleSliderInput('shader-damping')}
        />
      </section>
    {/if}
  {/if}
</div>

<style>
  .hero-fx {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .hero-fx__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-fx__section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /* ── Preset Grid ──────────────────────────────── */

  .hero-fx__preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .hero-fx__preset-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    text-align: left;
    transition: var(--transition-colors);
  }

  .hero-fx__preset-card:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .hero-fx__preset-card--active {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .hero-fx__preset-card--active:hover {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .hero-fx__preset-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .hero-fx__preset-desc {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-tight);
  }

  .hero-fx__preset-card--active .hero-fx__preset-label {
    color: var(--color-interactive);
  }
</style>
