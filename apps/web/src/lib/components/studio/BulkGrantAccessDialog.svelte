<!--
  @component BulkGrantAccessDialog

  Modal dialog for granting complimentary content access to multiple customers.
  Iterates through customer IDs using Promise.allSettled with batching.

  @prop {boolean} open - Whether the dialog is open (bindable)
  @prop {string[]} customerIds - Customer IDs to grant access to
  @prop {string} orgId - Organization ID for content listing
  @prop {() => void} [onSuccess] - Callback after all grants complete
-->
<script lang="ts">
  import { DialogForm } from '$lib/components/ui/DialogForm';
  import { Select } from '$lib/components/ui';
  import * as m from '$paraglide/messages';
  import { grantContentAccess } from '$lib/remote/admin.remote';
  import { listContent } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';

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
  let contentOptions = $state<Array<{ value: string; label: string }>>([]);
  let loadingContent = $state(false);
  let completed = $state(0);

  $effect(() => {
    if (open) {
      loadContent();
      completed = 0;
      error = null;
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
    completed = 0;
    let succeeded = 0;
    let failed = 0;

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
        else failed++;
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
      toast.error(m.studio_customers_bulk_grant_partial({
        succeeded: String(succeeded),
        failed: String(failed),
      }));
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
  <div class="form-field">
    <Select
      options={contentOptions}
      bind:value={selectedContentId}
      label={m.studio_customers_grant_select_content()}
      placeholder={loadingContent ? m.common_loading() : m.studio_customers_grant_select_placeholder()}
    />
  </div>

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
  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .progress-text {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }
</style>
