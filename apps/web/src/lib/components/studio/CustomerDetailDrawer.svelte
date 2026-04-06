<!--
  @component CustomerDetailDrawer

  Right-anchored slide-out drawer showing customer details:
  - Profile section: name, email, joined date
  - Stats section: total spent (GBP), purchase count
  - Purchase history table: date, content title, amount
  - "Grant Access" button to open GrantAccessDialog

  Uses Melt UI Dialog for overlay/close behaviour (Escape, click-outside).
  Fetches customer data via the `getCustomerDetail` remote function on open.

  @prop {boolean} open - Whether the drawer is open (bindable)
  @prop {string | null} customerId - The customer ID to display
  @prop {string} orgId - Organization ID (for content listing in grant dialog)
  @prop {(open: boolean) => void} [onOpenChange] - Callback when open state changes
-->
<script lang="ts">
  import type { CustomerDetails } from '@codex/admin';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Button, Skeleton } from '$lib/components/ui';
  import * as Table from '$lib/components/ui/Table';
  import { formatDate, formatPrice, getInitials } from '$lib/utils/format';
  import * as m from '$paraglide/messages';
  import { getCustomerDetail } from '$lib/remote/admin.remote';
  import GrantAccessDialog from './GrantAccessDialog.svelte';

  interface Props {
    open?: boolean;
    customerId: string | null;
    orgId: string;
    onOpenChange?: (open: boolean) => void;
  }

  let {
    open = $bindable(false),
    customerId,
    orgId,
    onOpenChange,
  }: Props = $props();

  let customer = $state<CustomerDetails | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let grantDialogOpen = $state(false);

  // Fetch customer details whenever customerId changes and drawer is open
  $effect(() => {
    if (open && customerId) {
      loadCustomer(customerId);
    }
  });

  async function loadCustomer(id: string) {
    loading = true;
    error = null;
    customer = null;

    try {
      customer = await getCustomerDetail(id);
    } catch {
      error = m.studio_customers_drawer_error();
    } finally {
      loading = false;
    }
  }

  function handleOpenChange(isOpen: boolean) {
    open = isOpen;
    onOpenChange?.(isOpen);
    if (!isOpen) {
      customer = null;
      error = null;
      grantDialogOpen = false;
    }
  }

  function handleGrantSuccess() {
    // Reload customer to refresh purchase history / access state
    if (customerId) {
      loadCustomer(customerId);
    }
  }

  const displayName = $derived(customer?.name ?? '--');
  const initials = $derived(getInitials(customer?.name));
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="drawer-content">
    {#if loading}
      <div class="drawer-loading">
        <Skeleton width="100%" height="3rem" />
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="100%" height="6rem" />
        <p class="loading-text">{m.studio_customers_drawer_loading()}</p>
      </div>
    {:else if error}
      <div class="drawer-error">
        <p class="error-text">{error}</p>
        <Button variant="secondary" onclick={() => handleOpenChange(false)}>
          {m.common_go_back()}
        </Button>
      </div>
    {:else if customer}
      <Dialog.Header>
        <Dialog.Title>{m.studio_customers_drawer_title()}</Dialog.Title>
      </Dialog.Header>

      <!-- Profile Section -->
      <section class="profile-section">
        <div class="profile-avatar" aria-hidden="true">
          {initials}
        </div>
        <div class="profile-info">
          <h3 class="profile-name">{displayName}</h3>
          <div class="profile-meta">
            <span class="meta-label">{m.studio_customers_drawer_email()}</span>
            <span class="meta-value">{customer.email}</span>
          </div>
          <div class="profile-meta">
            <span class="meta-label">{m.studio_customers_drawer_joined()}</span>
            <span class="meta-value">{formatDate(customer.createdAt)}</span>
          </div>
        </div>
      </section>

      <!-- Stats Section -->
      <section class="stats-section">
        <div class="stat-card">
          <span class="stat-label">{m.studio_customers_drawer_total_spent()}</span>
          <span class="stat-value">{formatPrice(customer.totalSpentCents)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">{m.studio_customers_drawer_purchases()}</span>
          <span class="stat-value">{customer.totalPurchases}</span>
        </div>
      </section>

      <!-- Purchase History -->
      <section class="history-section">
        <h4 class="section-heading">{m.studio_customers_drawer_purchase_history()}</h4>
        {#if customer.purchaseHistory.length > 0}
          <div class="history-table-wrapper">
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.Head>{m.studio_customers_drawer_col_date()}</Table.Head>
                  <Table.Head>{m.studio_customers_drawer_col_content()}</Table.Head>
                  <Table.Head>{m.studio_customers_drawer_col_amount()}</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each customer.purchaseHistory as purchase (purchase.purchaseId)}
                  <Table.Row>
                    <Table.Cell class="history-date-cell">
                      {formatDate(purchase.purchasedAt)}
                    </Table.Cell>
                    <Table.Cell class="history-content-cell">
                      {purchase.contentTitle}
                    </Table.Cell>
                    <Table.Cell class="history-amount-cell">
                      {formatPrice(purchase.amountPaidCents)}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        {:else}
          <p class="no-purchases">{m.studio_customers_drawer_no_purchases()}</p>
        {/if}
      </section>

      <!-- Actions -->
      <Dialog.Footer>
        <Button variant="secondary" onclick={() => handleOpenChange(false)}>
          {m.common_cancel()}
        </Button>
        <Button variant="primary" onclick={() => { grantDialogOpen = true; }}>
          {m.studio_customers_drawer_grant_access()}
        </Button>
      </Dialog.Footer>

      <!-- Grant Access Dialog -->
      {#if customer}
        <GrantAccessDialog
          bind:open={grantDialogOpen}
          customerId={customer.userId}
          {orgId}
          onSuccess={handleGrantSuccess}
        />
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  /*
   * Override Dialog positioning for right-anchored drawer.
   * Uses .dialog-content.drawer-content to beat the base .dialog-content
   * specificity without !important.
   */
  :global(.dialog-content.drawer-content) {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: auto;
    max-width: 32rem;
    width: 100%;
    max-height: 100vh;
    height: 100%;
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
    border-left: var(--border-width) var(--border-style) var(--color-border);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-6);
  }

  /* Full-width on mobile */
  @media (max-width: 40rem) {
    :global(.dialog-content.drawer-content) {
      max-width: 100%;
    }
  }

  .drawer-loading {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) 0;
  }

  .loading-text {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    text-align: center;
    margin: 0;
  }

  .drawer-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8) 0;
    text-align: center;
  }

  .error-text {
    font-size: var(--text-sm);
    color: var(--color-error);
    margin: 0;
  }

  /* Profile Section */
  .profile-section {
    display: flex;
    gap: var(--space-4);
    align-items: flex-start;
  }

  .profile-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-12);
    height: var(--space-12);
    border-radius: var(--radius-full, 9999px);
    background-color: var(--color-interactive-subtle);
    color: var(--color-interactive);
    font-weight: var(--font-bold);
    font-size: var(--text-lg);
    flex-shrink: 0;
  }

  .profile-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .profile-name {
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-meta {
    display: flex;
    gap: var(--space-2);
    font-size: var(--text-sm);
  }

  .meta-label {
    color: var(--color-text-secondary);
  }

  .meta-value {
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Stats Section */
  .stats-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-4);
    background-color: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) var(--color-border);
  }

  .stat-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  /* Purchase History */
  .history-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-heading {
    font-family: var(--font-heading);
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--color-text);
    margin: 0;
  }

  .history-table-wrapper {
    overflow-x: auto;
  }

  :global(.history-date-cell) {
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :global(.history-content-cell) {
    color: var(--color-text);
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.history-amount-cell) {
    font-weight: var(--font-medium);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .no-purchases {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    padding: var(--space-4) 0;
  }
</style>
