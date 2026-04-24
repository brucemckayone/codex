<!--
  @component ContentDetails

  Groups title, slug, and description fields with inline validation.

  @prop {ContentForm} form - The active form instance
  @prop {string | null} orgSlug - Organization slug for slug URL preview (null for personal content)
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import SlugField from './SlugField.svelte';
  import RichTextEditor from '$lib/components/editor/RichTextEditor.svelte';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    orgSlug: string | null;
    creatorUsername?: string | null;
    organizationId?: string | null;
    contentId?: string | null;
    class?: string;
  }

  const {
    form,
    orgSlug,
    creatorUsername,
    organizationId,
    contentId,
    class: className = '',
  }: Props = $props();

  const descriptionValue = $derived(form.fields.description.value() ?? '');
  // issues() can return undefined before the form is initialised — fall back
  // to an empty array so downstream .length / .map calls don't throw at setup.
  const titleIssues = $derived(form.fields.title.issues() ?? []);
  const descriptionIssues = $derived(form.fields.description.issues() ?? []);
  const titleErrorText = $derived(titleIssues.map((issue) => issue.message).join(' '));
  const descriptionErrorText = $derived(
    descriptionIssues.map((issue) => issue.message).join(' '),
  );
</script>

<section class="form-card {className}">
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
        aria-invalid={titleIssues.length > 0}
        aria-describedby={titleIssues.length > 0 ? 'title-error' : undefined}
      />
      {#if titleIssues.length > 0}
        <p id="title-error" class="field-error">{titleErrorText}</p>
      {/if}
    </div>

    <!-- Slug -->
    <SlugField {form} {orgSlug} {creatorUsername} {organizationId} {contentId} />

    <!-- Description -->
    <div class="form-field">
      <label class="field-label" for="description">
        {m.studio_content_form_description_label()}
        <span class="optional-hint">Optional</span>
      </label>
      <RichTextEditor
        content={descriptionValue}
        preset="minimal"
        placeholder={m.studio_content_form_description_placeholder()}
        maxLength={10000}
        formFieldAttrs={form.fields.description.as('text')}
        ariaInvalid={descriptionIssues.length > 0 ? true : undefined}
        ariaDescribedby={descriptionIssues.length > 0 ? 'description-error' : undefined}
      />
      {#if descriptionIssues.length > 0}
        <p id="description-error" class="field-error">{descriptionErrorText}</p>
      {/if}
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

  .field-input:focus-visible {
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

  .optional-hint {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    margin-left: var(--space-1);
  }

</style>
