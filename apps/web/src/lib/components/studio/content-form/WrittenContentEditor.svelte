<!--
  @component WrittenContentEditor

  Rich text editor for content body (all content types).
  Uses Tiptap with the full preset (headings, code blocks, lists, etc).

  @prop {ContentForm} form - The active form instance
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import RichTextEditor from '$lib/components/editor/RichTextEditor.svelte';
  import type { createContentForm, updateContentForm } from '$lib/remote/content.remote';

  type ContentForm = typeof createContentForm | typeof updateContentForm;

  interface Props {
    form: ContentForm;
    optional?: boolean;
    class?: string;
  }

  const { form, optional = false, class: className = '' }: Props = $props();

  const contentValue = $derived(form.fields.contentBody.value() ?? '');
  const contentBodyIssues = $derived(form.fields.contentBody.issues() ?? []);
  const contentBodyErrorText = $derived(
    contentBodyIssues.map((issue) => issue.message).join(' '),
  );

  function handleInput() {
    // RichTextEditor already syncs JSON back to the form field via formFieldAttrs;
    // we only use this hook to re-run validation for any additional side-effects.
    // The `json` payload from RichTextEditor's oninput is unused here.
    form.validate?.();
  }
</script>

<section class="form-card {className}">
  <h3 class="card-title">
    {m.studio_content_form_section_body()}
    {#if optional}<span class="optional-hint">Optional</span>{/if}
  </h3>

  <RichTextEditor
    content={contentValue}
    preset="full"
    placeholder={m.studio_content_form_body_placeholder()}
    formFieldAttrs={form.fields.contentBody.as('text')}
    oninput={handleInput}
    ariaInvalid={contentBodyIssues.length > 0 ? true : undefined}
    ariaDescribedby={contentBodyIssues.length > 0 ? 'content-body-error' : undefined}
  />

  {#if contentBodyIssues.length > 0}
    <p id="content-body-error" class="field-error">{contentBodyErrorText}</p>
  {/if}
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

  .optional-hint {
    font-size: var(--text-xs);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
    margin-left: var(--space-1);
  }

  .field-error {
    font-size: var(--text-xs);
    color: var(--color-error-600);
    margin: var(--space-1) 0 0 0;
  }

</style>
