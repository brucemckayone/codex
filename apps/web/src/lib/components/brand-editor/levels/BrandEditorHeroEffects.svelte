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
    'shader-intensity': '0.65',
    'shader-grain': '0.025',
    'shader-vignette': '0.20',
    // Suture
    'shader-curl': '30',
    'shader-dissipation': '0.985',
    'shader-advection': '6.0',
    'shader-force': '1.00',
    // Ether
    'shader-rotation-speed': '0.40',
    'shader-complexity': '6',
    'shader-zoom': '5.0',
    'shader-glow': '0.50',
    'shader-scale': '2.00',
    'shader-aberration': '0.003',
    // Warp
    'shader-warp-strength': '1.50',
    'shader-light-angle': '135',
    'shader-speed': '0.30',
    'shader-detail': '4',
    'shader-contrast': '1.10',
    'shader-invert': '1',
    // Ripple
    'shader-wave-speed': '0.80',
    'shader-damping': '0.995',
    'shader-ripple-size': '0.030',
    'shader-refraction': '0.50',
  };

  /** All shader-* token override keys. */
  const ALL_SHADER_KEYS = Object.keys(DEFAULTS).concat('shader-preset');

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

  // Shared
  const intensity = $derived(readNum('shader-intensity'));
  const grain = $derived(readNum('shader-grain'));
  const vignette = $derived(readNum('shader-vignette'));

  // Suture
  const curl = $derived(readNum('shader-curl'));
  const dissipation = $derived(readNum('shader-dissipation'));
  const advection = $derived(readNum('shader-advection'));
  const force = $derived(readNum('shader-force'));

  // Ether
  const rotationSpeed = $derived(readNum('shader-rotation-speed'));
  const complexity = $derived(readNum('shader-complexity'));
  const zoom = $derived(readNum('shader-zoom'));
  const glow = $derived(readNum('shader-glow'));
  const scale = $derived(readNum('shader-scale'));
  const aberration = $derived(readNum('shader-aberration'));

  // Warp
  const warpStrength = $derived(readNum('shader-warp-strength'));
  const lightAngle = $derived(readNum('shader-light-angle'));
  const speed = $derived(readNum('shader-speed'));
  const detail = $derived(readNum('shader-detail'));
  const contrast = $derived(readNum('shader-contrast'));
  const invert = $derived(overrides['shader-invert'] !== '0' && overrides['shader-invert'] !== 'false');

  // Ripple
  const waveSpeed = $derived(readNum('shader-wave-speed'));
  const damping = $derived(readNum('shader-damping'));
  const rippleSize = $derived(readNum('shader-ripple-size'));
  const refraction = $derived(readNum('shader-refraction'));

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
        max={2.00}
        step={0.05}
        current={intensity}
        minLabel="Subtle"
        maxLabel="Vivid"
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

        <BrandSliderField
          id="shader-advection"
          label="Advection"
          value={advection.toFixed(1)}
          min={1.0}
          max={15.0}
          step={0.5}
          current={advection}
          minLabel="Short"
          maxLabel="Long"
          oninput={handleSliderInput('shader-advection')}
        />

        <BrandSliderField
          id="shader-force"
          label="Mouse Force"
          value={force.toFixed(2)}
          min={0.10}
          max={3.00}
          step={0.10}
          current={force}
          minLabel="Gentle"
          maxLabel="Strong"
          oninput={handleSliderInput('shader-force')}
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

        <BrandSliderField
          id="shader-glow"
          label="Glow"
          value={glow.toFixed(2)}
          min={0.10}
          max={1.50}
          step={0.05}
          current={glow}
          minLabel="Dim"
          maxLabel="Bright"
          oninput={handleSliderInput('shader-glow')}
        />

        <BrandSliderField
          id="shader-scale"
          label="Scale"
          value={scale.toFixed(2)}
          min={0.50}
          max={4.00}
          step={0.25}
          current={scale}
          minLabel="Small"
          maxLabel="Large"
          oninput={handleSliderInput('shader-scale')}
        />

        <BrandSliderField
          id="shader-aberration"
          label="Chromatic Aberration"
          value={aberration.toFixed(3)}
          min={0.000}
          max={0.020}
          step={0.001}
          current={aberration}
          minLabel="None"
          maxLabel="Heavy"
          oninput={handleSliderInput('shader-aberration')}
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

        <BrandSliderField
          id="shader-speed"
          label="Animation Speed"
          value={speed.toFixed(2)}
          min={0.05}
          max={1.00}
          step={0.05}
          current={speed}
          minLabel="Slow"
          maxLabel="Fast"
          oninput={handleSliderInput('shader-speed')}
        />

        <BrandSliderField
          id="shader-detail"
          label="Detail (octaves)"
          value={String(Math.round(detail))}
          min={2}
          max={6}
          step={1}
          current={detail}
          minLabel="Smooth"
          maxLabel="Detailed"
          oninput={handleSliderInput('shader-detail')}
        />

        <BrandSliderField
          id="shader-contrast"
          label="Contrast"
          value={contrast.toFixed(2)}
          min={0.50}
          max={2.00}
          step={0.10}
          current={contrast}
          minLabel="Flat"
          maxLabel="Punchy"
          oninput={handleSliderInput('shader-contrast')}
        />

        <div class="hero-fx__toggle-row">
          <span class="hero-fx__toggle-label">Invert Colors</span>
          <button
            class="hero-fx__toggle"
            class:hero-fx__toggle--on={invert}
            onclick={() => updateOverride('shader-invert', invert ? '0' : '1')}
            role="switch"
            aria-checked={invert}
          >
            <span class="hero-fx__toggle-thumb"></span>
          </button>
        </div>
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

        <BrandSliderField
          id="shader-ripple-size"
          label="Ripple Size"
          value={rippleSize.toFixed(3)}
          min={0.010}
          max={0.100}
          step={0.005}
          current={rippleSize}
          minLabel="Tiny"
          maxLabel="Wide"
          oninput={handleSliderInput('shader-ripple-size')}
        />

        <BrandSliderField
          id="shader-refraction"
          label="Refraction"
          value={refraction.toFixed(2)}
          min={0.10}
          max={1.00}
          step={0.05}
          current={refraction}
          minLabel="Flat"
          maxLabel="Deep"
          oninput={handleSliderInput('shader-refraction')}
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

  .hero-fx__toggle--on {
    background: var(--color-interactive);
  }

  .hero-fx__toggle-thumb {
    position: absolute;
    top: var(--space-0-5);
    left: var(--space-0-5);
    width: var(--space-4);
    height: var(--space-4);
    background: white;
    border-radius: var(--radius-full);
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .hero-fx__toggle--on .hero-fx__toggle-thumb {
    transform: translateX(var(--space-5));
  }
</style>
