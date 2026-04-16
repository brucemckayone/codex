<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import OklchColorPicker from '../color-picker/OklchColorPicker.svelte';

  type ColorField = 'primaryColor' | 'secondaryColor' | 'accentColor' | 'backgroundColor';
  type SectionId = 'primary' | 'secondary' | 'accent' | 'background';

  const SECTIONS: { id: SectionId; label: string; field: ColorField; fallback: string; clearable?: boolean }[] = [
    { id: 'primary', label: 'Primary', field: 'primaryColor', fallback: '#6366F1' },
    { id: 'secondary', label: 'Secondary', field: 'secondaryColor', fallback: '#737373' },
    { id: 'accent', label: 'Accent', field: 'accentColor', fallback: '#F59E0B' },
    { id: 'background', label: 'Background', field: 'backgroundColor', fallback: '#FFFFFF', clearable: true },
  ];

  let expanded = $state<SectionId | null>(null);

  function toggle(id: SectionId) {
    expanded = expanded === id ? null : id;
  }

  function getColor(field: ColorField): string | null {
    return brandEditor.getThemeColor(field);
  }

  function updateColor(field: ColorField, hex: string) {
    brandEditor.setThemeColor(field, hex);
  }
</script>

<div class="colors-level">
  {#each SECTIONS as section}
    {@const currentValue = getColor(section.field) ?? section.fallback}
    <section class="colors-level__section">
      <div class="colors-level__header-row">
        <button
          class="colors-level__header"
          class:colors-level__header--expanded={expanded === section.id}
          onclick={() => toggle(section.id)}
        >
          <span class="colors-level__swatch" style:background={currentValue}></span>
          <span class="colors-level__label">{section.label}</span>
          <span class="colors-level__hex">{currentValue}</span>
          <span class="colors-level__chevron">{expanded === section.id ? '−' : '+'}</span>
        </button>
        {#if section.clearable && brandEditor.pending?.backgroundColor}
          <button
            class="colors-level__clear"
            onclick={() => brandEditor.updateField('backgroundColor', null)}
          >
            clear
          </button>
        {/if}
      </div>

      {#if expanded === section.id}
        <div class="colors-level__picker">
          <OklchColorPicker
            value={currentValue}
            onchange={(hex) => updateColor(section.field, hex)}
          />
        </div>
      {/if}
    </section>
  {/each}

  <button
    class="colors-level__drill"
    onclick={() => brandEditor.navigateTo('fine-tune-colors')}
  >
    Fine-tune colors...
  </button>
</div>

<style>
  .colors-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .colors-level__section {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .colors-level__header-row {
    position: relative;
    display: flex;
    align-items: center;
  }

  .colors-level__header {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: none;
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .colors-level__header:hover {
    background: var(--color-surface-secondary);
  }

  .colors-level__header--expanded {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom-color: transparent;
  }

  .colors-level__swatch {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }

  .colors-level__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .colors-level__hex {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
    margin-left: auto;
  }

  .colors-level__chevron {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    width: var(--space-4);
    text-align: center;
    flex-shrink: 0;
  }

  .colors-level__clear {
    position: absolute;
    right: var(--space-8);
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    padding: var(--space-1) var(--space-2);
    z-index: 1;
  }

  .colors-level__clear:hover {
    color: var(--color-interactive);
  }

  .colors-level__picker {
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-top: none;
    border-bottom-left-radius: var(--radius-md);
    border-bottom-right-radius: var(--radius-md);
  }

  .colors-level__drill {
    font-size: var(--text-sm);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: var(--space-2) 0;
  }

  .colors-level__drill:hover {
    color: var(--color-interactive-hover);
  }
</style>
