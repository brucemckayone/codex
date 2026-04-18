<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import BrandSliderField from '../BrandSliderField.svelte';

  interface LayoutOption {
    id: string;
    label: string;
    description: string;
  }

  const LAYOUTS: LayoutOption[] = [
    { id: 'default', label: 'Classic', description: 'Bottom-left editorial' },
    { id: 'centered', label: 'Centered', description: 'Center-aligned hero' },
    { id: 'logo-hero', label: 'Logo Hero', description: 'Large logo, centered' },
    { id: 'minimal', label: 'Minimal', description: 'Large title, CTAs at bottom' },
    { id: 'split', label: 'Split', description: 'Content left, canvas right' },
    { id: 'magazine', label: 'Magazine', description: 'Stats float as masthead' },
    { id: 'asymmetric', label: 'Asymmetric', description: 'Title top-right, content bottom-left' },
    { id: 'portrait', label: 'Portrait', description: 'Right-aligned narrow column' },
    { id: 'gallery', label: 'Gallery', description: 'Title top, content strip below' },
    { id: 'stacked', label: 'Stacked', description: 'One word per line, Swiss' },
  ];

  interface VisibilityToggle {
    key: string;
    label: string;
  }

  const VISIBILITY_TOGGLES: VisibilityToggle[] = [
    { key: 'hero-hide-title', label: 'Title' },
    { key: 'hero-hide-logo', label: 'Logo' },
    { key: 'hero-hide-description', label: 'Description' },
    { key: 'hero-hide-pills', label: 'Content pills' },
    { key: 'hero-hide-stats', label: 'Stats' },
  ];

  const activeLayout = $derived(brandEditor.pending?.heroLayout ?? 'default');

  function selectLayout(id: string) {
    brandEditor.updateField('heroLayout', id);
  }

  function isElementVisible(key: string): boolean {
    return brandEditor.pending?.tokenOverrides?.[key] !== '1';
  }

  function toggleElement(key: string) {
    if (!brandEditor.pending) return;
    const current = brandEditor.pending.tokenOverrides?.[key];
    const newOverrides = { ...brandEditor.pending.tokenOverrides };
    if (current === '1') {
      delete newOverrides[key];
    } else {
      newOverrides[key] = '1';
    }
    brandEditor.updateField('tokenOverrides', newOverrides);
  }

  // Logo scale — stored as tokenOverrides['hero-logo-scale'], injected as --brand-hero-logo-scale
  const logoScale = $derived(
    parseFloat(brandEditor.pending?.tokenOverrides?.['hero-logo-scale'] ?? '1') || 1
  );

  function handleLogoScale(e: Event) {
    if (!brandEditor.pending) return;
    const val = (e.target as HTMLInputElement).value;
    const newOverrides = { ...brandEditor.pending.tokenOverrides };
    if (val === '1') {
      delete newOverrides['hero-logo-scale'];
    } else {
      newOverrides['hero-logo-scale'] = val;
    }
    brandEditor.updateField('tokenOverrides', newOverrides);
  }
</script>

<div class="layout-editor">
  <!-- Layout Picker -->
  <section class="layout-editor__section">
    <span class="layout-editor__section-label">Arrangement</span>
    <div class="layout-editor__grid">
      {#each LAYOUTS as layout (layout.id)}
        <button
          class="layout-editor__card"
          class:layout-editor__card--active={activeLayout === layout.id}
          onclick={() => selectLayout(layout.id)}
        >
          <div class="layout-editor__preview">
            {#if layout.id === 'default'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="12" y="28" width="100" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <circle cx="20" cy="46" r="6" fill="var(--color-text-muted)" opacity="0.4" />
                <rect x="12" y="54" width="80" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="12" y="62" width="24" height="4" rx="2" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="40" y="62" width="24" height="4" rx="2" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="12" y="70" width="36" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="52" y="70" width="28" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'centered'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <circle cx="110" cy="18" r="7" fill="var(--color-text-muted)" opacity="0.4" />
                <rect x="70" y="30" width="80" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="80" y="42" width="60" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="68" y="52" width="36" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="108" y="52" width="28" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="50" y="66" width="120" height="1" fill="var(--color-text-muted)" opacity="0.15" />
                <rect x="60" y="71" width="16" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="102" y="71" width="16" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="144" y="71" width="16" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'logo-hero'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <circle cx="110" cy="28" r="16" fill="var(--color-text-muted)" opacity="0.4" />
                <rect x="80" y="50" width="60" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="68" y="60" width="36" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="108" y="60" width="28" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'minimal'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="40" y="26" width="140" height="14" rx="3" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="78" y="68" width="28" height="5" rx="2.5" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="110" y="68" width="28" height="5" rx="2.5" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'split'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <line x1="110" y1="8" x2="110" y2="72" stroke="var(--color-text-muted)" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.2" />
                <rect x="12" y="24" width="84" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="36" width="60" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="50" width="70" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="12" y="58" width="44" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="12" y="68" width="32" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="48" y="68" width="24" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'magazine'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="164" y="10" width="1" height="34" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="170" y="12" width="22" height="6" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="170" y="20" width="30" height="2" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="170" y="28" width="22" height="6" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="170" y="36" width="30" height="2" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="12" y="44" width="110" height="10" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="60" width="74" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="12" y="68" width="32" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="48" y="68" width="24" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'asymmetric'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="110" y="10" width="96" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="130" y="22" width="76" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.45" />
                <rect x="12" y="48" width="70" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="12" y="56" width="50" height="4" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="12" y="66" width="32" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="48" y="66" width="24" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'portrait'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="128" y="16" width="80" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="148" y="28" width="60" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.45" />
                <rect x="156" y="42" width="52" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="176" y="50" width="32" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="164" y="60" width="24" height="6" rx="3" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="192" y="60" width="16" height="6" rx="3" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="140" y="70" width="68" height="1" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {:else if layout.id === 'gallery'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="26" y="14" width="168" height="16" rx="3" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="54" width="30" height="14" rx="2" fill="var(--color-text-muted)" opacity="0.3" />
                <rect x="58" y="56" width="66" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="58" y="62" width="50" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="140" y="54" width="18" height="6" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="140" y="62" width="14" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="172" y="54" width="18" height="6" rx="1" fill="var(--color-text-muted)" opacity="0.5" />
                <rect x="172" y="62" width="14" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
              </svg>
            {:else if layout.id === 'stacked'}
              <svg viewBox="0 0 220 80" fill="none" aria-hidden="true">
                <rect x="0" y="0" width="220" height="80" rx="4" fill="var(--color-surface-secondary)" />
                <rect x="12" y="10" width="68" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="22" width="52" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="34" width="88" height="8" rx="2" fill="var(--color-text-muted)" opacity="0.6" />
                <rect x="12" y="54" width="80" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.25" />
                <rect x="12" y="62" width="56" height="3" rx="1" fill="var(--color-text-muted)" opacity="0.2" />
                <rect x="12" y="70" width="28" height="5" rx="2.5" fill="var(--color-interactive)" opacity="0.5" />
                <rect x="44" y="70" width="22" height="5" rx="2.5" fill="var(--color-text-muted)" opacity="0.2" />
              </svg>
            {/if}
          </div>
          <span class="layout-editor__card-label">{layout.label}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Element Visibility Toggles -->
  <section class="layout-editor__section">
    <span class="layout-editor__section-label">Show / Hide</span>
    <div class="layout-editor__toggles">
      {#each VISIBILITY_TOGGLES as toggle (toggle.key)}
        {@const visible = isElementVisible(toggle.key)}
        <button
          class="layout-editor__toggle"
          class:layout-editor__toggle--hidden={!visible}
          onclick={() => toggleElement(toggle.key)}
          aria-pressed={visible}
        >
          <span class="layout-editor__toggle-icon">{visible ? '●' : '○'}</span>
          <span class="layout-editor__toggle-label">{toggle.label}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- Logo Scale -->
  <section class="layout-editor__section">
    <span class="layout-editor__section-label">Logo Size</span>
    <BrandSliderField
      id="hero-logo-scale"
      label="Scale"
      value="{logoScale.toFixed(1)}x"
      min={0.5}
      max={4}
      step={0.1}
      current={logoScale}
      minLabel="0.5x"
      maxLabel="4x"
      oninput={handleLogoScale}
    />
  </section>
</div>

<style>
  .layout-editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .layout-editor__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .layout-editor__section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
  }

  /* ── Layout Picker Grid ── */
  .layout-editor__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .layout-editor__card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
    padding: var(--space-2);
    border: var(--border-width-thick) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    cursor: pointer;
    transition: border-color var(--duration-fast) var(--ease-default),
      background var(--duration-fast) var(--ease-default);
    text-align: center;
    width: 100%;
  }

  .layout-editor__card:hover {
    border-color: var(--color-border);
    background: var(--color-surface-secondary);
  }

  .layout-editor__card:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .layout-editor__card--active {
    border-color: var(--color-interactive);
    background: var(--color-interactive-subtle);
  }

  .layout-editor__card--active:hover {
    border-color: var(--color-interactive);
  }

  .layout-editor__preview {
    border-radius: var(--radius-md);
    overflow: hidden;
    line-height: 0;
  }

  .layout-editor__preview :global(svg) {
    width: 100%;
    height: auto;
    display: block;
  }

  .layout-editor__card-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  /* ── Element Visibility Toggles ── */
  .layout-editor__toggles {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .layout-editor__toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    cursor: pointer;
    transition: var(--transition-colors);
    text-align: left;
    width: 100%;
  }

  .layout-editor__toggle:hover {
    background: var(--color-surface-secondary);
  }

  .layout-editor__toggle:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .layout-editor__toggle--hidden {
    opacity: 0.5;
  }

  .layout-editor__toggle--hidden .layout-editor__toggle-label {
    text-decoration: line-through;
  }

  .layout-editor__toggle-icon {
    font-size: var(--text-sm);
    color: var(--color-interactive);
    flex-shrink: 0;
    width: var(--space-4);
    text-align: center;
  }

  .layout-editor__toggle--hidden .layout-editor__toggle-icon {
    color: var(--color-text-muted);
  }

  .layout-editor__toggle-label {
    font-size: var(--text-sm);
    color: var(--color-text);
  }
</style>
