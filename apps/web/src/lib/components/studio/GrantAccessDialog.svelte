<!--
  @component GrantAccessDialog

  Modal dialog for granting complimentary content access to a customer.
  Shows a content picker (Select dropdown) populated from the org's published content,
  and a confirm button that calls the grantContentAccess API.

  @prop {boolean} open - Whether the dialog is open (bindable)
  @prop {string} customerId - Customer to grant access to
  @prop {string} orgId - Organization ID for content listing
  @prop {() => void} [onSuccess] - Callback after successful grant
-->
<script lang="ts">
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Alert, Button, Select } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import { grantContentAccess } from '$lib/remote/admin.remote';
  import { listContent } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  interface Props {
    open?: boolean;
    customerId: string;
    orgId: string;
    onSuccess?: () => void;
  }

  let {
    open = $bindable(false),
    customerId,
    orgId,
    onSuccess,
  }: Props = $props();

  let selectedContentId = $state<string | undefined>(undefined);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let contentOptions = $state<Array<{ value: string; label: string }>>([]);
  let loadingContent = $state(false);

  // Load published content when dialog opens
  $effect(() => {
    if (open) {
      loadContent();
    }
  });

  async function loadContent() {
    loadingContent = true;
    try {
      const result = await listContent({
        organizationId: orgId,
        status: 'published',
        limit: 100,
      });
      contentOptions = (result?.items ?? []).map((item) => ({
        value: item.id,
        label: item.title,
      }));
    } catch {
      contentOptions = [];
    } finally {
      loadingContent = false;
    }
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!selectedContentId) {
      error = m.studio_customers_grant_select_placeholder();
      return;
    }

    submitting = true;
    try {
      await grantContentAccess({ customerId, contentId: selectedContentId });
      toast.success(m.studio_customers_grant_success());
      // Reset and close
      selectedContentId = undefined;
      open = false;
      onSuccess?.();
    } catch (err) {
      error = err instanceof Error ? err.message : m.studio_customers_grant_error();
    } finally {
      submitting = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    if (!isOpen) {
      selectedContentId = undefined;
      error = null;
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{m.studio_customers_grant_title()}</Dialog.Title>
      <Dialog.Description>{m.studio_customers_grant_description()}</Dialog.Description>
    </Dialog.Header>

    <form onsubmit={handleSubmit} class="grant-form">
      {#if error}
        <Alert variant="error">{error}</Alert>
      {/if}

      <div class="form-field">
        <Select
          options={contentOptions}
          bind:value={selectedContentId}
          label={m.studio_customers_grant_select_content()}
          placeholder={loadingContent ? m.common_loading() : m.studio_customers_grant_select_placeholder()}
        />
      </div>

      <Dialog.Footer>
        <Button
          type="button"
          variant="secondary"
          onclick={() => handleOpenChange(false)}
          disabled={submitting}
        >
          {m.common_cancel()}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !selectedContentId}
          loading={submitting}
        >
          {#if submitting}
            {m.common_loading()}
          {:else}
            {m.studio_customers_grant_confirm()}
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  .grant-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
