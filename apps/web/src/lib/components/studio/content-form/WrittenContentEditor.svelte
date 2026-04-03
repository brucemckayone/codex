<!--
  @component WrittenContentEditor

  Rich text editor for article/written content body.
  Uses Tiptap with the full preset (headings, images, code blocks, etc).

  @prop {any} form - The active form instance
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import RichTextEditor from '$lib/components/editor/RichTextEditor.svelte';

  interface Props {
    form: any;
  }

  const { form }: Props = $props();

  const contentValue = $derived(form.fields.contentBody.value() ?? '');

  function handleInput(json: string) {
    // Sync editor JSON back to the form field via the hidden textarea's input event.
    // The RichTextEditor component handles this internally via formFieldAttrs,
    // but we also call this for any additional side-effects (e.g. validation).
    form.validate?.();
  }
</script>

<section class="form-card">
  <h3 class="card-title">{m.studio_content_form_section_body()}</h3>

  <RichTextEditor
    content={contentValue}
    preset="full"
    placeholder={m.studio_content_form_body_placeholder()}
    maxLength={100000}
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

  .field-error {
    font-size: var(--text-xs);
    color: var(--color-error-600);
    margin: var(--space-1) 0 0 0;
  }

  :global([data-theme='dark']) .form-card {
    background-color: var(--color-surface-dark);
    border-color: var(--color-border-dark);
  }
</style>
