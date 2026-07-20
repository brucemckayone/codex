<!--
  @component BrandEditorColors

  The colour focus body for the `/studio/brand` rail. Instead of four stacked
  accordions each hiding a cramped inline picker, this edits ONE role at a time
  at full height: a compact role switcher (Primary / Secondary / Accent /
  Background) selects which colour is live, and a single large OKLCH picker fills
  the remaining space. The active role's value round-trips through the store's
  per-theme routing (getThemeColor / setThemeColor), so flipping the editing
  theme re-targets light vs dark automatically.

  Epic: Codex-cijzb · rail-UX overhaul.
-->
<script lang="ts">
  import {
    BRAND_DEFAULT_ACCENT,
    BRAND_DEFAULT_BACKGROUND,
    BRAND_DEFAULT_PRIMARY,
    BRAND_DEFAULT_SECONDARY,
    brandEditor,
  } from '$lib/brand-editor';
  import OklchColorPicker from '../color-picker/OklchColorPicker.svelte';

  type ColorField =
    | 'primaryColor'
    | 'secondaryColor'
    | 'accentColor'
    | 'backgroundColor';
  type SectionId = 'primary' | 'secondary' | 'accent' | 'background';

  const SECTIONS: {
    id: SectionId;
    label: string;
    field: ColorField;
    fallback: string;
    clearable?: boolean;
  }[] = [
    { id: 'primary', label: 'Primary', field: 'primaryColor', fallback: BRAND_DEFAULT_PRIMARY },
    { id: 'secondary', label: 'Secondary', field: 'secondaryColor', fallback: BRAND_DEFAULT_SECONDARY },
    { id: 'accent', label: 'Accent', field: 'accentColor', fallback: BRAND_DEFAULT_ACCENT },
    { id: 'background', label: 'Background', field: 'backgroundColor', fallback: BRAND_DEFAULT_BACKGROUND, clearable: true },
  ];

  let activeRole = $state<SectionId>('primary');

  const activeSection = $derived(
    SECTIONS.find((s) => s.id === activeRole) ?? SECTIONS[0]
  );
  const activeValue = $derived(
    brandEditor.getThemeColor(activeSection.field) ?? activeSection.fallback
  );
  const backgroundCleared = $derived(!brandEditor.pending?.backgroundColor);

  function roleSwatch(field: ColorField, fallback: string): string {
    return brandEditor.getThemeColor(field) ?? fallback;
  }

  // Quick-pick swatches = the org's own palette (whichever roles are set),
  // deduped, so an admin can reuse a brand colour across roles in one click.
  const paletteSwatches = $derived.by(() => {
    const out: string[] = [];
    const pushUnique = (hex: string) => {
      if (!out.some((h) => h.toUpperCase() === hex.toUpperCase())) out.push(hex);
    };
    for (const s of SECTIONS) {
      const hex = brandEditor.getThemeColor(s.field);
      if (hex) pushUnique(hex);
    }
    pushUnique('#FFFFFF');
    pushUnique('#171717');
    return out;
  });

  function onPick(hex: string): void {
    brandEditor.setThemeColor(activeSection.field, hex);
  }

  function clearBackground(): void {
    brandEditor.updateField('backgroundColor', null);
  }
</script>

<div class="colours-focus">
  <div class="colours-focus__roles" role="radiogroup" aria-label="Colour role">
    {#each SECTIONS as section (section.id)}
      {@const isActive = section.id === activeRole}
      <button
        type="button"
        class="role"
        class:role--active={isActive}
        role="radio"
        aria-checked={isActive}
        onclick={() => (activeRole = section.id)}
      >
        <span
          class="role__swatch"
          class:role__swatch--empty={section.clearable && backgroundCleared}
          style:background={roleSwatch(section.field, section.fallback)}
          aria-hidden="true"
        ></span>
        <span class="role__label">{section.label}</span>
      </button>
    {/each}
  </div>

  <div class="colours-focus__picker">
    <OklchColorPicker
      large
      value={activeValue}
      onchange={onPick}
      swatches={paletteSwatches}
    />
  </div>

  {#if activeSection.clearable}
    <div class="colours-focus__bg">
      {#if backgroundCleared}
        <p class="colours-focus__bg-note">
          Using the theme’s default background. Pick a colour above to override it.
        </p>
      {:else}
        <button type="button" class="colours-focus__bg-clear" onclick={clearBackground}>
          Clear background override
        </button>
      {/if}
    </div>
  {/if}

  <button
    type="button"
    class="colours-focus__finetune"
    onclick={() => brandEditor.navigateTo('fine-tune-colors')}
  >
    Fine-tune individual tokens…
  </button>
</div>

<style>
  .colours-focus {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  /* ── Role switcher ── */
  .colours-focus__roles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .role {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .role:hover {
    background: var(--color-surface-secondary);
    border-color: var(--color-border);
  }

  .role:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .role--active {
    border-color: var(--color-interactive);
    box-shadow: 0 0 0 var(--border-width) var(--color-interactive);
  }

  .role__swatch {
    width: var(--space-5);
    height: var(--space-5);
    border-radius: var(--radius-sm);
    border: var(--border-width) var(--border-style) var(--color-border);
    flex-shrink: 0;
  }

  /* Cleared background = no override: a checkerboard hints "transparent/default". */
  .role__swatch--empty {
    background-image:
      linear-gradient(45deg, var(--color-border) 25%, transparent 25%),
      linear-gradient(-45deg, var(--color-border) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--color-border) 75%),
      linear-gradient(-45deg, transparent 75%, var(--color-border) 75%);
    background-size: var(--space-2) var(--space-2);
    background-position:
      0 0,
      0 calc(var(--space-2) / 2),
      calc(var(--space-2) / 2) calc(-1 * var(--space-2) / 2),
      calc(-1 * var(--space-2) / 2) 0;
  }

  .role__label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Picker ── */
  .colours-focus__picker {
    display: flex;
    flex-direction: column;
  }

  /* ── Background clear affordance ── */
  .colours-focus__bg {
    flex-shrink: 0;
  }

  .colours-focus__bg-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
  }

  .colours-focus__bg-clear {
    font-size: var(--text-sm);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .colours-focus__bg-clear:hover {
    color: var(--color-interactive-hover);
  }

  .colours-focus__bg-clear:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  /* ── Fine-tune drill ── */
  .colours-focus__finetune {
    flex-shrink: 0;
    align-self: flex-start;
    font-size: var(--text-sm);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: 0;
  }

  .colours-focus__finetune:hover {
    color: var(--color-interactive-hover);
  }

  .colours-focus__finetune:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }
</style>
