<!--
  @component SlugField

  Slug input with prominent URL preview bar.
  Auto-generates from title value unless manually edited.

  @prop {any} form - The active form instance
  @prop {string | null} orgSlug - Organization slug for URL preview (null for personal content)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';

  interface Props {
    form: any;
    orgSlug: string | null;
  }

  const { form, orgSlug }: Props = $props();

  let slugManuallyEdited = $state(false);

  const titleValue = $derived(form.fields.title.value() ?? '');
  const slugValue = $derived(form.fields.slug.value() ?? '');

  // Auto-generate slug from title when not manually edited
  $effect(() => {
    if (!slugManuallyEdited && titleValue) {
      const generated = titleValue
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      form.fields.slug.set(generated);
    }
  });

  function handleSlugInput() {
    slugManuallyEdited = true;
  }
</script>

<div class="slug-field">
  <label class="field-label" for="slug">
    {m.studio_content_form_slug_label()}
  </label>
  <input
    {...form.fields.slug.as('text')}
    id="slug"
    class="field-input"
    placeholder={m.studio_content_form_slug_placeholder()}
    oninput={handleSlugInput}
  />
  {#each form.fields.slug.issues() as issue}
    <p class="field-error">{issue.message}</p>
  {/each}
  {#if slugValue}
    <div class="url-preview">
      <span class="url-prefix">{orgSlug ? `${orgSlug}.lvh.me` : 'creators.lvh.me'}/content/</span><span class="url-slug">{slugValue}</span>
    </div>
  {/if}
</div>

<style>
  .slug-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-background);
    color: var(--color-text);
    transition: var(--transition-colors);
    width: 100%;
    font-family: inherit;
  }

  .field-input:focus {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: -1px;
    border-color: var(--color-border-focus);
  }

  .field-input[aria-invalid='true'] {
    border-color: var(--color-error-500);
  }

  .field-error {
    font-size: var(--text-xs);
    color: var(--color-error-600);
    margin: 0;
  }

  .url-preview {
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-surface-secondary, var(--color-surface));
    border-radius: var(--radius-md);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs);
    overflow-x: auto;
    white-space: nowrap;
  }

  .url-prefix {
    color: var(--color-text-muted);
  }

  .url-slug {
    color: var(--color-interactive-hover);
    font-weight: var(--font-medium);
  }

</style>
