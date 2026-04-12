<!--
  @component BrandEditorHeroEffects (PROTOTYPE — docs only)

  Brand editor Level 1 component for configuring shader presets on the org hero.
  Lives in the floating brand editor panel alongside Colors, Typography, etc.

  When moved to production:
    apps/web/src/lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte

  Reads/writes to brandEditor.pending.tokenOverrides using shader-* keys.
  Changes propagate through the existing $effect → injectBrandVars → CSS pipeline,
  causing the ShaderHero component to update live.
-->
<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';

  // ── Preset metadata ───────────────────────────────────────
  // In production, import from shader-presets.ts
  const PRESETS = [
    { id: 'gradient-mesh', name: 'Gradient Mesh', category: 'Ambient', desc: 'Soft flowing color blobs' },
    { id: 'noise-flow', name: 'Noise Flow', category: 'Dynamic', desc: 'Organic paint-mixing field' },
    { id: 'aurora', name: 'Aurora', category: 'Ambient', desc: 'Northern lights curtain' },
    { id: 'voronoi', name: 'Voronoi Cells', category: 'Organic', desc: 'Morphing cell patterns' },
    { id: 'metaballs', name: 'Metaballs', category: 'Organic', desc: 'Lava lamp blobs' },
    { id: 'waves', name: 'Waves', category: 'Ambient', desc: 'Water caustic ripples' },
    { id: 'particles', name: 'Star Field', category: 'Ambient', desc: 'Parallax floating dots' },
    { id: 'geometric', name: 'Geometric', category: 'Geometric', desc: 'Kaleidoscopic symmetry' },
  ] as const;

  type PresetId = typeof PRESETS[number]['id'] | 'none';

  // ── Read current values from tokenOverrides ──────────────
  function getOverride(key: string): string | null {
    return brandEditor.pending?.tokenOverrides?.[key] ?? null;
  }

  function setOverride(key: string, value: string | null) {
    if (!brandEditor.pending) return;
    const overrides = { ...(brandEditor.pending.tokenOverrides ?? {}) };
    if (value === null) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
    brandEditor.updateField('tokenOverrides', overrides);
  }

  // ── Derived state ────────────────────────────────────────
  const currentPreset = $derived<PresetId>(
    (getOverride('shader-preset') as PresetId) ?? 'none'
  );
  const speed = $derived(Number(getOverride('shader-speed') ?? '0.5'));
  const intensity = $derived(Number(getOverride('shader-intensity') ?? '0.8'));
  const complexity = $derived(Number(getOverride('shader-complexity') ?? '0.5'));
  const mouseEnabled = $derived(getOverride('shader-mouse-enabled') !== 'false');
  const scrollFade = $derived(getOverride('shader-scroll-fade') !== 'false');

  // ── Actions ──────────────────────────────────────────────
  function selectPreset(id: PresetId) {
    setOverride('shader-preset', id === 'none' ? null : id);
  }

  function handleSpeed(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    setOverride('shader-speed', value);
  }

  function handleIntensity(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    setOverride('shader-intensity', value);
  }

  function handleComplexity(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    setOverride('shader-complexity', value);
  }

  function toggleMouse() {
    setOverride('shader-mouse-enabled', mouseEnabled ? 'false' : 'true');
  }

  function toggleScroll() {
    setOverride('shader-scroll-fade', scrollFade ? 'false' : 'true');
  }
</script>

<div class="hero-fx">
  <!-- Preset Selector -->
  <section class="hero-fx__section">
    <span class="hero-fx__label">Shader Effect</span>
    <div class="hero-fx__preset-grid" role="radiogroup" aria-label="Shader preset">
      <!-- None option -->
      <button
        class="hero-fx__preset-card"
        class:hero-fx__preset-card--active={currentPreset === 'none'}
        role="radio"
        aria-checked={currentPreset === 'none'}
        onclick={() => selectPreset('none')}
      >
        <div class="hero-fx__preset-thumb hero-fx__preset-thumb--none">
          <span class="hero-fx__none-icon">&#x2715;</span>
        </div>
        <span class="hero-fx__preset-name">None</span>
      </button>

      <!-- Preset cards -->
      {#each PRESETS as preset (preset.id)}
        <button
          class="hero-fx__preset-card"
          class:hero-fx__preset-card--active={currentPreset === preset.id}
          role="radio"
          aria-checked={currentPreset === preset.id}
          onclick={() => selectPreset(preset.id)}
          title={preset.desc}
        >
          <!-- Static thumbnail (build-time PNG in production) -->
          <div class="hero-fx__preset-thumb">
            <!-- Placeholder: CSS gradient approximation -->
            <div
              class="hero-fx__preset-thumb-inner"
              data-preset={preset.id}
            ></div>
          </div>
          <span class="hero-fx__preset-name">{preset.name}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Animation Controls (only visible when a preset is selected) -->
  {#if currentPreset !== 'none'}
    <section class="hero-fx__section">
      <span class="hero-fx__label">Animation</span>
      <div class="hero-fx__controls">
        <!-- Speed -->
        <div class="hero-fx__slider-row">
          <label class="hero-fx__slider-label" for="shader-speed">Speed</label>
          <input
            id="shader-speed"
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            value={speed}
            oninput={handleSpeed}
            class="hero-fx__slider"
            aria-label="Animation speed"
          />
          <span class="hero-fx__slider-value">{speed.toFixed(1)}</span>
        </div>

        <!-- Intensity -->
        <div class="hero-fx__slider-row">
          <label class="hero-fx__slider-label" for="shader-intensity">Intensity</label>
          <input
            id="shader-intensity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={intensity}
            oninput={handleIntensity}
            class="hero-fx__slider"
            aria-label="Effect intensity"
          />
          <span class="hero-fx__slider-value">{(intensity * 100).toFixed(0)}%</span>
        </div>

        <!-- Complexity -->
        <div class="hero-fx__slider-row">
          <label class="hero-fx__slider-label" for="shader-complexity">Detail</label>
          <input
            id="shader-complexity"
            type="range"
            min="0.1"
            max="1.0"
            step="0.1"
            value={complexity}
            oninput={handleComplexity}
            class="hero-fx__slider"
            aria-label="Visual complexity"
          />
          <span class="hero-fx__slider-value">{(complexity * 100).toFixed(0)}%</span>
        </div>
      </div>
    </section>

    <!-- Interaction Toggles -->
    <section class="hero-fx__section">
      <span class="hero-fx__label">Interaction</span>
      <div class="hero-fx__toggles">
        <button
          class="hero-fx__toggle"
          class:hero-fx__toggle--on={mouseEnabled}
          onclick={toggleMouse}
          aria-pressed={mouseEnabled}
        >
          <span class="hero-fx__toggle-text">Mouse tracking</span>
          <span class="hero-fx__toggle-state">{mouseEnabled ? 'On' : 'Off'}</span>
        </button>

        <button
          class="hero-fx__toggle"
          class:hero-fx__toggle--on={scrollFade}
          onclick={toggleScroll}
          aria-pressed={scrollFade}
        >
          <span class="hero-fx__toggle-text">Scroll fade</span>
          <span class="hero-fx__toggle-state">{scrollFade ? 'On' : 'Off'}</span>
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .hero-fx {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  /* ── Section ──────────────────────────────────────── */

  .hero-fx__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hero-fx__label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /* ── Preset Grid ──────────────────────────────────── */

  .hero-fx__preset-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }

  .hero-fx__preset-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: center;
    width: 100%;
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

  .hero-fx__preset-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--color-surface-secondary);
  }

  .hero-fx__preset-thumb--none {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface-tertiary);
  }

  .hero-fx__none-icon {
    font-size: var(--text-lg);
    color: var(--color-text-muted);
    opacity: var(--opacity-50);
  }

  .hero-fx__preset-thumb-inner {
    width: 100%;
    height: 100%;
  }

  /* CSS gradient approximations for thumbnails (placeholder until build-time PNGs) */
  .hero-fx__preset-thumb-inner[data-preset='gradient-mesh'] {
    background: linear-gradient(135deg, var(--color-brand-primary, #3B82F6), var(--color-brand-secondary, #6B7280), var(--color-brand-accent, #F59E0B));
  }
  .hero-fx__preset-thumb-inner[data-preset='noise-flow'] {
    background: radial-gradient(ellipse at 30% 40%, var(--color-brand-primary, #3B82F6), var(--color-brand-secondary, #6B7280));
  }
  .hero-fx__preset-thumb-inner[data-preset='aurora'] {
    background: linear-gradient(180deg, transparent 10%, var(--color-brand-primary, #3B82F6) 40%, var(--color-brand-secondary, #6B7280) 70%, transparent 90%);
  }
  .hero-fx__preset-thumb-inner[data-preset='voronoi'] {
    background: conic-gradient(from 0deg, var(--color-brand-primary, #3B82F6), var(--color-brand-secondary, #6B7280), var(--color-brand-accent, #F59E0B), var(--color-brand-primary, #3B82F6));
  }
  .hero-fx__preset-thumb-inner[data-preset='metaballs'] {
    background: radial-gradient(circle at 35% 45%, var(--color-brand-primary, #3B82F6) 20%, transparent 50%),
                radial-gradient(circle at 65% 55%, var(--color-brand-secondary, #6B7280) 15%, transparent 45%),
                var(--color-surface-tertiary);
  }
  .hero-fx__preset-thumb-inner[data-preset='waves'] {
    background: repeating-linear-gradient(90deg, var(--color-brand-primary, #3B82F6) 0%, transparent 15%, var(--color-brand-secondary, #6B7280) 30%, transparent 45%);
  }
  .hero-fx__preset-thumb-inner[data-preset='particles'] {
    background: radial-gradient(1px 1px at 20% 30%, var(--color-brand-primary, #fff) 50%, transparent),
                radial-gradient(1px 1px at 50% 60%, var(--color-brand-secondary, #fff) 50%, transparent),
                radial-gradient(1px 1px at 80% 20%, var(--color-brand-accent, #fff) 50%, transparent),
                var(--color-surface-tertiary);
  }
  .hero-fx__preset-thumb-inner[data-preset='geometric'] {
    background: conic-gradient(from 45deg at 50% 50%, var(--color-brand-primary, #3B82F6), transparent, var(--color-brand-secondary, #6B7280), transparent, var(--color-brand-primary, #3B82F6));
  }

  .hero-fx__preset-name {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
    line-height: var(--leading-tight);
  }

  /* ── Sliders ──────────────────────────────────────── */

  .hero-fx__controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hero-fx__slider-row {
    display: grid;
    grid-template-columns: 70px 1fr 40px;
    align-items: center;
    gap: var(--space-2);
  }

  .hero-fx__slider-label {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .hero-fx__slider {
    width: 100%;
    accent-color: var(--color-interactive);
    cursor: pointer;
  }

  .hero-fx__slider-value {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    text-align: right;
  }

  /* ── Toggles ──────────────────────────────────────── */

  .hero-fx__toggles {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .hero-fx__toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2-5) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    width: 100%;
    text-align: left;
  }

  .hero-fx__toggle:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .hero-fx__toggle--on {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .hero-fx__toggle-text {
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .hero-fx__toggle-state {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
  }

  .hero-fx__toggle--on .hero-fx__toggle-state {
    color: var(--color-interactive);
  }
</style>
