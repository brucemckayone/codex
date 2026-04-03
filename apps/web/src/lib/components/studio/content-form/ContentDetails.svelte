<!--
  @component ContentDetails

  Groups title, slug, and description fields with inline validation.

  @prop {any} form - The active form instance
  @prop {string | null} orgSlug - Organization slug for slug URL preview (null for personal content)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import SlugField from './SlugField.svelte';
  import RichTextEditor from '$lib/components/editor/RichTextEditor.svelte';

  interface Props {
    form: any;
    orgSlug: string | null;
  }

  const { form, orgSlug }: Props = $props();

  const descriptionValue = $derived(form.fields.description.value() ?? '');
</script>

<section class="form-card">
  <h3 class="card-title">{m.studio_content_form_section_details()}</h3>

  <div class="form-fields">
    <!-- Title -->
    <div class="form-field">
      <label class="field-label" for="title">
        {m.studio_content_form_title_label()}
      </label>
      <input
        {...form.fields.title.as('text')}
        id="title"
        class="field-input"
        placeholder={m.studio_content_form_title_placeholder()}
      />
      {#each form.fields.title.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>

    <!-- Slug -->
    <SlugField {form} {orgSlug} />

    <!-- Description -->
    <div class="form-field">
      <label class="field-label" for="description">
        {m.studio_content_form_description_label()}
      </label>
      <RichTextEditor
        content={descriptionValue}
        preset="minimal"
        placeholder={m.studio_content_form_description_placeholder()}
        maxLength={10000}
        formFieldAttrs={form.fields.description.as('text')}
      />
      {#each form.fields.description.issues() as issue}
        <p class="field-error">{issue.message}</p>
      {/each}
    </div>
  </div>
</section>

<style>
  .form-card {
    padding: var(--space-6);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .card-title {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0 0 var(--space-4) 0;
  }

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
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

</style>
