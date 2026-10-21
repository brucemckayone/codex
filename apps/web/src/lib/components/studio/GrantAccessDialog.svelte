<!--
  @component GrantAccessDialog

  Modal dialog for granting complimentary content access to a customer.
  Uses DialogForm for the shared dialog + form boilerplate, and
  GrantContentPicker, which offers only content a grant can open. A refused
  grant shows the worker's own reason (Codex-2hxff.21).

  @prop {boolean} open - Whether the dialog is open (bindable)
  @prop {string} customerId - Customer to grant access to
  @prop {string} orgId - Organization ID for content listing
  @prop {() => void} [onSuccess] - Callback after successful grant
-->
<script lang="ts">
  import { DialogForm } from '$lib/components/ui/DialogForm';
  import * as m from '$paraglide/messages';
  import { grantContentAccess } from '$lib/remote/admin.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import GrantContentPicker from './GrantContentPicker.svelte';
  import { grantErrorMessage } from './grant-error';

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

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!selectedContentId) {
      error = m.studio_customers_grant_select_placeholder();
      return;
    }

    submitting = true;
    try {
      await grantContentAccess({ customerId, contentId: selectedContentId, organizationId: orgId });
      toast.success(m.studio_customers_grant_success());
      // Reset and close
      selectedContentId = undefined;
      open = false;
      onSuccess?.();
    } catch (err) {
      error = grantErrorMessage(err);
    } finally {
      submitting = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      selectedContentId = undefined;
      error = null;
    }
  }
</script>

<DialogForm
  title={m.studio_customers_grant_title()}
  description={m.studio_customers_grant_description()}
  bind:open
  {submitting}
  {error}
  onsubmit={handleSubmit}
  onOpenChange={handleOpenChange}
  submitLabel={m.studio_customers_grant_confirm()}
  submitDisabled={!selectedContentId}
>
  <GrantContentPicker {orgId} bind:value={selectedContentId} />
</DialogForm>
