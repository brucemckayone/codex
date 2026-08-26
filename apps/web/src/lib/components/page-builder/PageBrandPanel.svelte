<!--
  @component PageBrandPanel

  The "Brand & theme" page-mode panel (Codex-2pryk.3.3 · WP-5). Per-page overrides
  on top of the org brand (D6 — inherit by default, override per page): a primary
  colour override + a hero shader preset, written to `PageBuilderState.brandOverrides`
  via the store. The route applies these to the canvas as brand CSS custom
  properties, so the preview re-tints live. Unset fields inherit the org brand.
-->
<script lang="ts">
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';

  const overrides = $derived(pageBuilder.pending?.brandOverrides ?? {});
  const overridePrimary = $derived(!!overrides.primaryColor);
  const shaderPreset = $derived(overrides.tokenOverrides?.['--brand-shader-preset'] ?? '');

  // A curated shader shortlist (real ShaderHero preset ids) + inherit/none.
  const SHADERS: readonly { value: string; label: string }[] = [
    { value: '', label: 'Inherit (org shader)' },
    { value: 'lava', label: 'Lava' },
    { value: 'ember', label: 'Ember' },
    { value: 'silk', label: 'Silk' },
    { value: 'nebula', label: 'Nebula' },
    { value: 'aurora', label: 'Aurora' },
    { value: 'none', label: 'None (still)' },
  ];

  function toggleOverride(): void {
    // Off → inherit (clear the override); on → seed from the current org primary.
    pageBuilder.updateBrandOverrides({
      primaryColor: overridePrimary ? undefined : (overrides.primaryColor ?? '#c24129'),
    });
  }

  function setPrimary(color: string): void {
    pageBuilder.updateBrandOverrides({ primaryColor: color });
  }

  function setShader(preset: string): void {
    const next = { ...(overrides.tokenOverrides ?? {}) };
    if (preset) next['--brand-shader-preset'] = preset;
    else delete next['--brand-shader-preset'];
    pageBuilder.updateBrandOverrides({ tokenOverrides: next });
  }
</script>

<div class="panel">
  <header class="panel__head">
    <h2 class="panel__title">Brand &amp; theme</h2>
    <p class="panel__sub">Page-level · overrides the org brand</p>
  </header>

  <div class="row" class:row--on={overridePrimary}>
    <span class="row__copy">Override primary colour<small>only this page</small></span>
    <button
      type="button"
      class="row__sw"
      aria-pressed={overridePrimary}
      aria-label="Override primary colour"
      onclick={toggleOverride}
    ></button>
  </div>

  {#if overridePrimary}
    <label class="panel__field panel__field--inline">
      <span class="panel__label">Primary colour</span>
      <input
        type="color"
        class="panel__color"
        value={overrides.primaryColor ?? '#c24129'}
        oninput={(e) => setPrimary(e.currentTarget.value)}
      />
    </label>
  {/if}

  <label class="panel__field">
    <span class="panel__label">Hero shader</span>
    <select class="panel__input" value={shaderPreset} onchange={(e) => setShader(e.currentTarget.value)}>
      {#each SHADERS as s (s.value)}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
  </label>

  <p class="panel__callout">
    Every page inherits the org’s brand tokens. Overrides here affect <b>only this page</b>.
  </p>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
  }

  .panel__head {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }

  .panel__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .panel__sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .panel__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .panel__field--inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .panel__label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
  }

  .panel__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .panel__input:focus-visible {
    outline: none;
    border-color: var(--color-interactive);
    box-shadow: var(--shadow-focus-ring);
  }

  .panel__color {
    width: var(--space-12);
    height: var(--space-8);
    padding: 0;
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
  }

  .panel__callout {
    margin: var(--space-1) 0 0;
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--color-text-muted);
  }

  .panel__callout b {
    color: var(--color-text-secondary);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
  }

  .row--on {
    border-color: color-mix(in oklab, var(--color-interactive) 40%, var(--color-border));
  }

  .row__copy {
    flex: 1;
    display: flex;
    flex-direction: column;
    font-size: var(--text-sm);
    color: var(--color-text);
  }

  .row__copy small {
    color: var(--color-text-muted);
    font-size: var(--text-xs);
  }

  .row__sw {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border: 0;
    border-radius: var(--radius-full);
    background-color: var(--color-surface-tertiary, var(--color-surface-secondary));
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .row__sw::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background-color: var(--color-text-muted);
    transition: transform var(--duration-fast) var(--ease-default);
  }

  .row--on .row__sw {
    background-color: color-mix(in oklab, var(--color-interactive) 55%, var(--color-surface-secondary));
  }

  .row--on .row__sw::after {
    transform: translateX(14px);
    background-color: var(--color-interactive);
  }

  .row__sw:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }
</style>
