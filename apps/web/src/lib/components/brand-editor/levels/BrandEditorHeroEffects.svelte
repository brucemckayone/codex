<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import {
    HERO_FX_DEFAULTS,
    HERO_FX_PRESETS,
    HERO_FX_SHARED_CONTROLS,
    HERO_FX_PRESET_CONTROLS,
    type ControlConfig,
  } from '$lib/brand-editor/hero-fx-presets';
  import {
    selectPreset as selectPresetHelper,
    updateOverride as updateOverrideHelper,
  } from '$lib/brand-editor/hero-fx-helpers';
  import ControlField from './ControlField.svelte';

  // ── Read current overrides ─────────────────────────────────────────────
  // Codex-wwedk: when editing the dark theme, prefer darkTokenOverrides;
  // fall back to the light tokenOverrides for keys not yet diverged. This
  // mirrors the visitor-facing CSS fallback chain so the preview matches.
  const overrides = $derived.by<Record<string, string | null>>(() => {
    const light = brandEditor.pending?.tokenOverrides ?? {};
    if (brandEditor.editingTheme === 'dark') {
      const dark = brandEditor.pending?.darkTokenOverrides ?? {};
      return { ...light, ...dark };
    }
    return light;
  });
  const activePreset = $derived(overrides['shader-preset'] ?? 'none');

  /** Read a numeric override, falling back to its default. Handles 0 correctly. */
  function readNum(key: string): number {
    const raw = overrides[key];
    if (raw == null) return Number(HERO_FX_DEFAULTS[key]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(HERO_FX_DEFAULTS[key]);
  }

  /** Read a string override (color picker, etc.), falling back to its default. */
  function readStr(key: string): string {
    return overrides[key] ?? HERO_FX_DEFAULTS[key] ?? '';
  }

  /** Read a boolean override (toggle), parsing falsy strings ('0' / 'false'). */
  function readBool(key: string): boolean {
    const raw = overrides[key];
    if (raw == null) {
      // Default is the parsed default — '1'/'true' → true, '0'/'false' → false.
      const def = HERO_FX_DEFAULTS[key];
      return def !== '0' && def !== 'false';
    }
    return raw !== '0' && raw !== 'false';
  }

  /** Discriminated read: returns the right value type for each control kind. */
  function readControlValue(control: ControlConfig): number | string | boolean {
    if (control.kind === 'slider') return readNum(control.key);
    if (control.kind === 'color') return readStr(control.key);
    return readBool(control.key);
  }

  // ── Update helpers ─────────────────────────────────────────────────────
  // Codex-wwedk: route writes through setThemeTokenOverride so they land in
  // darkTokenOverrides when editing dark, tokenOverrides when editing light.
  // Default-clearing semantics: passing null removes the key from the active
  // theme's bucket so it falls back to either the light value (when dark)
  // or the ShaderHero compiled-in default (when light).
  //
  // Codex-bies6: the gotcha-bearing logic now lives in hero-fx-helpers.ts so
  // it can be unit-tested without mounting this component. These thin
  // wrappers bind brandEditor.setThemeTokenOverride as the writer; the
  // helpers themselves are pure.
  //
  // GOTCHA #2 (Codex-6itei §4.2): updateOverride MUST remove the override
  // entry when value === HERO_FX_DEFAULTS[key] so pending.tokenOverrides
  // stays minimal. Tested in hero-fx-helpers.test.ts.
  function updateOverride(key: string, value: string) {
    updateOverrideHelper(key, value, brandEditor.setThemeTokenOverride);
  }

  // GOTCHA #1 (Codex-6itei §4.2): selectPreset('none') MUST iterate
  // ALL_HERO_FX_SHADER_KEYS — the union of every shader-* key across every
  // preset plus 'shader-preset' itself — so no stale overrides linger when
  // the user picks "None". Tested in hero-fx-helpers.test.ts.
  function selectPreset(presetId: string) {
    selectPresetHelper(presetId, brandEditor.setThemeTokenOverride);
  }
</script>

<div class="hero-fx">
  <!-- Preset selector -->
  <section class="hero-fx__section">
    <span class="hero-fx__section-label">Shader Preset</span>
    <div class="hero-fx__preset-grid">
      {#each HERO_FX_PRESETS as preset (preset.id)}
        <button
          type="button"
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

  <!-- Shared sliders + per-preset controls (only when a preset is active) -->
  {#if activePreset !== 'none'}
    <section class="hero-fx__section">
      <span class="hero-fx__section-label">Global</span>
      {#each HERO_FX_SHARED_CONTROLS as control (control.key)}
        <ControlField
          {control}
          currentValue={readControlValue(control)}
          onUpdate={updateOverride}
        />
      {/each}
    </section>

    {@const presetControls = HERO_FX_PRESET_CONTROLS[activePreset]}
    {#if presetControls}
      <section class="hero-fx__section">
        <span class="hero-fx__section-label">{presetControls.sectionLabel}</span>
        {#each presetControls.controls as control (control.key)}
          <ControlField
            {control}
            currentValue={readControlValue(control)}
            onUpdate={updateOverride}
          />
        {/each}
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

  .hero-fx__preset-card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
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
