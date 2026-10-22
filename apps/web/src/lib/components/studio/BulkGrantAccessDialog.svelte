<!--
  @component BulkGrantAccessDialog

  Modal dialog for granting complimentary content access to multiple customers.
  Iterates through customer IDs using Promise.allSettled with batching. The
  picker (GrantContentPicker) offers only content a grant can open, and a
  failure toast carries the worker's reason when it gave one (Codex-2hxff.21).

  @prop {boolean} open - Whether the dialog is open (bindable)
  @prop {string[]} customerIds - Customer IDs to grant access to
  @prop {string} orgId - Organization ID for content listing
  @prop {() => void} [onSuccess] - Callback after all grants complete
-->
<script lang="ts">
  import { DialogForm } from '$lib/components/ui/DialogForm';
  import * as m from '$paraglide/messages';
  import { grantContentAccess } from '$lib/remote/admin.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import GrantContentPicker from './GrantContentPicker.svelte';
  import { grantRefusalReason } from './grant-error';

  interface Props {
    open?: boolean;
    customerIds: string[];
    orgId: string;
    onSuccess?: () => void;
  }

  let {
    open = $bindable(false),
    customerIds,
    orgId,
    onSuccess,
  }: Props = $props();

  let selectedContentId = $state<string | undefined>(undefined);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let completed = $state(0);

  $effect(() => {
    if (open) {
      completed = 0;
      error = null;
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;

    if (!selectedContentId) {
      error = m.studio_customers_grant_select_placeholder();
      return;
    }

    submitting = true;
    completed = 0;
    let succeeded = 0;
    let failed = 0;
    // The first refusal's reason, when the worker gave one. Every customer
    // gets the same item, so a refusal of the item itself (the 422) is the
    // same for all of them.
    let reason: string | undefined;

    // Batch in groups of 5 with a small delay between groups
    const batchSize = 5;
    for (let i = 0; i < customerIds.length; i += batchSize) {
      const batch = customerIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((customerId) =>
          grantContentAccess({ customerId, contentId: selectedContentId!, organizationId: orgId })
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled') succeeded++;
        else {
          failed++;
          reason ??= grantRefusalReason(result.reason) ?? undefined;
        }
        completed++;
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < customerIds.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    submitting = false;

    if (failed === 0) {
      toast.success(m.studio_customers_bulk_grant_success({ succeeded: String(succeeded) }));
    } else {
      toast.error(
        m.studio_customers_bulk_grant_partial({
          succeeded: String(succeeded),
          failed: String(failed),
        }),
        reason
      );
    }

    selectedContentId = undefined;
    open = false;
    onSuccess?.();
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      selectedContentId = undefined;
      error = null;
      completed = 0;
    }
  }
</script>

<DialogForm
  title={m.studio_customers_bulk_grant_title({ count: String(customerIds.length) })}
  description={m.studio_customers_bulk_grant_description()}
  bind:open
  {submitting}
  {error}
  onsubmit={handleSubmit}
  onOpenChange={handleOpenChange}
  submitLabel={m.studio_customers_grant_confirm()}
  submitDisabled={!selectedContentId}
>
  <GrantContentPicker {orgId} bind:value={selectedContentId} />

  {#if submitting && customerIds.length > 1}
    <p class="progress-text">
      {m.studio_customers_bulk_grant_progress({
        completed: String(completed),
        total: String(customerIds.length),
      })}
    </p>
  {/if}
</DialogForm>

<style>
  .progress-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
