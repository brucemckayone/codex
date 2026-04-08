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
  }

  const { form, optional = false }: Props = $props();

  const contentValue = $derived(form.fields.contentBody.value() ?? '');

  function handleInput(json: string) {
    // Sync editor JSON back to the form field via the hidden textarea's input event.
    // The RichTextEditor component handles this internally via formFieldAttrs,
    // but we also call this for any additional side-effects (e.g. validation).
    form.validate?.();
  }
</script>

<section class="form-card">
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
  />

  {#each form.fields.contentBody.issues() as issue}
    <p class="field-error">{issue.message}</p>
  {/each}
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
