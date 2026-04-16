<!--
  @component DialogForm

  Shared dialog + form wrapper that handles the common boilerplate:
  Dialog.Root > Dialog.Content > Dialog.Header > form > error Alert > content slot > Dialog.Footer.

  @prop {string} title - Dialog title
  @prop {string} [description] - Optional dialog description
  @prop {boolean} open - Whether the dialog is open (bindable)
  @prop {boolean} submitting - Whether the form is submitting
  @prop {string | null} error - Error message to display
  @prop {(event: SubmitEvent) => void} onsubmit - Form submit handler
  @prop {(open: boolean) => void} [onOpenChange] - Callback for open state change
  @prop {string} [submitLabel] - Submit button label (defaults to common_save)
  @prop {string} [cancelLabel] - Cancel button label (defaults to common_cancel)
  @prop {boolean} [submitDisabled] - Additional disabled condition for submit
  @prop {Snippet} children - Form fields content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Alert, Button } from '$lib/components/ui';
  import * as m from '$paraglide/messages';

  interface Props {
    title: string;
    description?: string;
    open?: boolean;
    submitting: boolean;
    error: string | null;
    onsubmit: (event: SubmitEvent) => void;
    onOpenChange?: (open: boolean) => void;
    submitLabel?: string;
    cancelLabel?: string;
    submitDisabled?: boolean;
    children: Snippet;
  }

  let {
    title,
    description,
    open = $bindable(false),
    submitting,
    error,
    onsubmit,
    onOpenChange,
    submitLabel,
    cancelLabel,
    submitDisabled = false,
    children,
  }: Props = $props();

  const resolvedSubmitLabel = $derived(submitLabel ?? m.media_edit_save());
  const resolvedCancelLabel = $derived(cancelLabel ?? m.common_cancel());

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
  }

  function handleCancel() {
    handleOpenChange(false);
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      {#if description}
        <Dialog.Description>{description}</Dialog.Description>
      {/if}
    </Dialog.Header>

    <form {onsubmit} class="dialog-form">
      <div class="dialog-form-body">
        {#if error}
          <Alert variant="error">{error}</Alert>
        {/if}

        {@render children()}
      </div>

      <Dialog.Footer>
        <Button
          type="button"
          variant="secondary"
          onclick={handleCancel}
          disabled={submitting}
        >
          {resolvedCancelLabel}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || submitDisabled}
          loading={submitting}
        >
          {#if submitting}
            {m.common_loading()}
          {:else}
            {resolvedSubmitLabel}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .dialog-form {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .dialog-form-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    overflow-y: auto;
    flex: 1;
  }
</style>
