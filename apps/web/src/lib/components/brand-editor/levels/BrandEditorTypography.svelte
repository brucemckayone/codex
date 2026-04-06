<script lang="ts">
  import { brandEditor } from '$lib/brand-editor';
  import { Select } from '$lib/components/ui';

  const FONT_OPTIONS = [
    { value: '', label: 'Default (Inter)' },
    { value: 'Inter', label: 'Inter' },
    { value: 'Roboto', label: 'Roboto' },
    { value: 'Open Sans', label: 'Open Sans' },
    { value: 'Lato', label: 'Lato' },
    { value: 'Poppins', label: 'Poppins' },
    { value: 'Montserrat', label: 'Montserrat' },
    { value: 'Playfair Display', label: 'Playfair Display' },
    { value: 'Merriweather', label: 'Merriweather' },
    { value: 'DM Sans', label: 'DM Sans' },
    { value: 'Source Sans 3', label: 'Source Sans 3' },
    { value: 'Nunito', label: 'Nunito' },
    { value: 'Raleway', label: 'Raleway' },
  ];

  const bodyFont = $derived(brandEditor.pending?.fontBody ?? '');
  const headingFont = $derived(brandEditor.pending?.fontHeading ?? '');

  function updateBody(val: string | undefined) {
    brandEditor.updateField('fontBody', val || null);
  }

  function updateHeading(val: string | undefined) {
    brandEditor.updateField('fontHeading', val || null);
  }
</script>

<div class="typography-level">
  <section class="typography-level__section">
    <Select
      label="Body Font"
      options={FONT_OPTIONS}
      value={bodyFont}
      onValueChange={updateBody}
      placeholder="Select font..."
    />
    <p class="typography-level__preview" style="font-family: {bodyFont || 'var(--font-sans)'}">
      The quick brown fox jumps over the lazy dog.
    </p>
  </section>

  <section class="typography-level__section">
    <Select
      label="Heading Font"
      options={FONT_OPTIONS}
      value={headingFont}
      onValueChange={updateHeading}
      placeholder="Select font..."
    />
    <p class="typography-level__preview typography-level__preview--heading" style="font-family: {headingFont || 'var(--font-heading)'}">
      Heading Sample
    </p>
  </section>

  <button
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
</style>
