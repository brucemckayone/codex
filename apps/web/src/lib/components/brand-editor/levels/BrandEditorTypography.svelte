<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import FontPicker from '../FontPicker.svelte';

  // Theme-aware: reads/writes the active editing theme's font. Dark values
  // live in darkTokenOverrides (falling back to light) so light and dark font
  // choices no longer overwrite each other. `getThemeFont` reads `editingTheme`
  // internally, so these re-derive when the light/dark preview toggles.
  const bodyFont = $derived(brandEditor.getThemeFont('body') ?? '');
  const headingFont = $derived(brandEditor.getThemeFont('heading') ?? '');

  function updateBody(val: string) {
    brandEditor.setThemeFont('body', val || null);
  }

  function updateHeading(val: string) {
    brandEditor.setThemeFont('heading', val || null);
  }
</script>

<div class="typography-level">
  <section class="typography-level__section">
    <FontPicker
      mode="body"
      label="Body Font"
      value={bodyFont}
      onValueChange={updateBody}
    />
    <p
      class="typography-level__preview"
      style:--preview-font={bodyFont ? `'${bodyFont}'` : 'var(--font-sans)'}
    >
      The quick brown fox jumps over the lazy dog.
    </p>
  </section>

  <section class="typography-level__section">
    <FontPicker
      mode="heading"
      label="Heading Font"
      value={headingFont}
      onValueChange={updateHeading}
    />
    <p
      class="typography-level__preview typography-level__preview--heading"
      style:--preview-font={headingFont ? `'${headingFont}'` : 'var(--font-heading)'}
    >
      Heading Sample
    </p>
  </section>

  <button
    type="button"
    class="typography-level__drill"
    onclick={() => brandEditor.navigateTo('fine-tune-typography')}
  >
    Fine-tune typography...
  </button>
</div>

<style>
  .typography-level {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .typography-level__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .typography-level__preview {
    font-family: var(--preview-font, var(--font-sans));
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    padding: var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .typography-level__preview--heading {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
  }

  .typography-level__drill {
    font-size: var(--text-sm);
    color: var(--color-interactive);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    padding: var(--space-2) 0;
  }

  .typography-level__drill:hover {
    color: var(--color-interactive-hover);
  }

  .typography-level__drill:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }
</style>
