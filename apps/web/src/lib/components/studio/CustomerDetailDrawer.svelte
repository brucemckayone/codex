<!--
  @component CustomerDetailDrawer

  Right-anchored slide-out drawer showing customer details:
  - Profile section: name, email (with copy button), joined date (relative)
  - Stats section: total spent (with spend trend), purchase count
  - Purchase history table: date, content title (linked), amount
  - Access grants (Codex-2hxff.21): this organisation's support grants, live
    ones with a Revoke button (confirmed in ConfirmDialog) and revoked ones
    muted, as a record. Loaded by its own query as the drawer opens, in
    parallel with the details, and reloaded after a grant or a revoke.
  - "Grant Access" button to open GrantAccessDialog

  @prop {boolean} open - Whether the drawer is open (bindable)
  @prop {string | null} customerId - The customer ID to display
  @prop {string} orgId - Organization ID (for content listing in grant dialog)
  @prop {(open: boolean) => void} [onOpenChange] - Callback when open state changes
-->
<script lang="ts">
  import type { CustomerDetails } from '@codex/admin';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Button, Skeleton } from '$lib/components/ui';
  import ConfirmDialog from '$lib/components/ui/Feedback/ConfirmDialog.svelte';
  import * as Table from '$lib/components/ui/Table';
  import { CheckIcon, TrendingUpIcon } from '$lib/components/ui/Icon';
  import { formatDate, formatPrice, formatRelativeTime, getInitials } from '$lib/utils/format';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import * as m from '$paraglide/messages';
  import {
    getCustomerDetail,
    getCustomerGrants,
    revokeCustomerGrant,
  } from '$lib/remote/admin.remote';
  import type { CustomerGrant } from '$lib/types';
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
  let emailCopied = $state(false);

  // Access grants. Started in the same effect as the details so the two load
  // side by side. Not a `$derived`: that would only run once the markup reads
  // it, and the markup reaches the grants after the details have loaded.
  let grantsQuery = $state.raw<ReturnType<typeof getCustomerGrants> | null>(
    null
  );
  let revokeTarget = $state.raw<CustomerGrant | null>(null);
  let revokeDialogOpen = $state(false);
  let revokeFailedId = $state<string | null>(null);

  $effect(() => {
    if (open && customerId) {
      loadCustomer(customerId);
      grantsQuery = getCustomerGrants({ customerId, organizationId: orgId });
    }
  });

  async function loadCustomer(id: string) {
    loading = true;
    error = null;
    customer = null;

    try {
      customer = await getCustomerDetail({ customerId: id, organizationId: orgId });
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
      emailCopied = false;
      grantsQuery = null;
      revokeTarget = null;
      revokeDialogOpen = false;
      revokeFailedId = null;
    }
  }

  function handleGrantSuccess() {
    if (customerId) {
      loadCustomer(customerId);
    }
    refreshGrants();
  }

  function refreshGrants() {
    // A failed reload lands on the query's own `error`, which the section
    // renders in place of the list, so there is nothing more to do here.
    return grantsQuery?.refresh().catch(() => {});
  }

  function askRevoke(grant: CustomerGrant) {
    revokeTarget = grant;
    revokeFailedId = null;
    revokeDialogOpen = true;
  }

  // Returns the revoke's promise, so the confirm stays open and busy until it
  // settles. It never rejects: a refusal marks the row, which stays live,
  // once the dialog has closed.
  async function confirmRevoke() {
    const grant = revokeTarget;
    if (!grant || !customerId) return;
    try {
      await revokeCustomerGrant({
        customerId,
        entitlementId: grant.id,
        organizationId: orgId,
      });
    } catch {
      revokeFailedId = grant.id;
      return;
    }
    await refreshGrants();
  }

  async function handleCopyEmail() {
    if (!customer?.email) return;
    try {
      await navigator.clipboard.writeText(customer.email);
      emailCopied = true;
      setTimeout(() => { emailCopied = false; }, 2000);
    } catch {
      toast.error(m.studio_customers_copy_email_failed());
    }
  }

  const displayName = $derived(customer?.name ?? '--');
  const initials = $derived(getInitials(customer?.name));

  // Live grants first, then revoked ones; each keeps the API's newest-first
  // order. `undefined` until the first load lands.
  const grants = $derived.by((): CustomerGrant[] | undefined => {
    const items = grantsQuery?.current?.items;
    if (!items) return undefined;
    return [
      ...items.filter((g) => !g.revokedAt),
      ...items.filter((g) => g.revokedAt),
    ];
  });
  // A rejected load leaves `current` undefined with `loading` false, so the
  // error must be read on its own, or the section would show the empty line
  // to someone whose grants simply failed to load.
  const grantsFailed = $derived(grantsQuery?.error != null);

  // The confirm names the customer, or their email when they have no name.
  const customerLabel = $derived(customer?.name?.trim() || customer?.email || '');

  /** Two placeholder rows, sized like a title and its "Granted…" line. */
  const grantSkeletonRows = [
    { key: 'a', title: '58%', meta: '42%' },
    { key: 'b', title: '46%', meta: '50%' },
  ];

  // Spending trend: compare avg of last 3 purchases vs older
  const spendTrend = $derived.by((): 'up' | 'down' | 'neutral' => {
    if (!customer?.purchaseHistory || customer.purchaseHistory.length < 4) return 'neutral';
    const sorted = [...customer.purchaseHistory].sort(
      (a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime()
    );
    const recentAvg = sorted.slice(0, 3).reduce((s, p) => s + p.amountPaidCents, 0) / 3;
    const olderAvg = sorted.slice(3).reduce((s, p) => s + p.amountPaidCents, 0) / (sorted.length - 3);
    if (recentAvg > olderAvg * 1.1) return 'up';
    if (recentAvg < olderAvg * 0.9) return 'down';
    return 'neutral';
  });
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
            <button
              class="copy-email-btn"
              onclick={handleCopyEmail}
              aria-label={m.studio_customers_copy_email()}
              title={emailCopied ? m.studio_customers_copy_email() : m.studio_customers_copy_email()}
            >
              {#if emailCopied}
                <CheckIcon size={14} />
              {:else}
                <!-- Inline clipboard SVG (no icon component exists) -->
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              {/if}
            </button>
          </div>
          <div class="profile-meta">
            <span class="meta-label">{m.studio_customers_drawer_joined()}</span>
            <span class="meta-value" title={formatDate(customer.createdAt)}>
              {formatRelativeTime(customer.createdAt)}
            </span>
          </div>
        </div>
      </section>

      <!-- Stats Section -->
      <section class="stats-section">
        <div class="stat-card">
          <span class="stat-label">{m.studio_customers_drawer_total_spent()}</span>
          <span class="stat-value">
            {formatPrice(customer.totalSpentCents)}
            {#if spendTrend === 'up'}
              <span class="trend trend--up" title={m.studio_customers_trend_up()}>
                <TrendingUpIcon size={16} />
              </span>
            {:else if spendTrend === 'down'}
              <span class="trend trend--down" title={m.studio_customers_trend_down()}>
                <TrendingUpIcon size={16} />
              </span>
            {/if}
          </span>
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
                      <a href="/content/{purchase.contentId}" class="content-link">
                        {purchase.contentTitle}
                      </a>
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

      <!-- Access Grants (Codex-2hxff.21) -->
      <section class="history-section">
        <h4 class="section-heading">{m.studio_customers_grants_heading()}</h4>
        {#if grantsFailed}
          <div class="grants-error" role="alert">
            <p class="error-text">{m.studio_customers_grants_load_error()}</p>
            <Button variant="secondary" size="sm" onclick={refreshGrants}>
              {m.studio_customers_grants_retry()}
            </Button>
          </div>
        {:else if !grants}
          <p class="sr-only" aria-live="polite">{m.studio_customers_grants_loading()}</p>
          <ul class="grant-list" aria-hidden="true">
            {#each grantSkeletonRows as row (row.key)}
              <li class="grant-row">
                <div class="grant-text grant-text--skeleton">
                  <Skeleton width={row.title} height="var(--space-4)" />
                  <Skeleton width={row.meta} height="var(--space-3)" />
                </div>
              </li>
            {/each}
          </ul>
        {:else if grants.length === 0}
          <p class="no-purchases">{m.studio_customers_grants_empty()}</p>
        {:else}
          <ul class="grant-list">
            {#each grants as grant (grant.id)}
              <li class="grant-row" data-state={grant.revokedAt ? 'revoked' : 'live'}>
                <div class="grant-text">
                  <a href="/content/{grant.contentSlug}" class="content-link grant-title">
                    {grant.contentTitle}
                  </a>
                  <span class="grant-meta">
                    {#if grant.revokedAt}
                      {m.studio_customers_grants_revoked({ date: formatDate(grant.revokedAt) })}
                    {:else if grant.grantedByName}
                      {m.studio_customers_grants_granted_by({
                        date: formatDate(grant.grantedAt),
                        name: grant.grantedByName,
                      })}
                    {:else}
                      {m.studio_customers_grants_granted({ date: formatDate(grant.grantedAt) })}
                    {/if}
                  </span>
                  {#if revokeFailedId === grant.id}
                    <span class="grant-error" role="alert">
                      {m.studio_customers_grants_revoke_error()}
                    </span>
                  {/if}
                </div>
                {#if !grant.revokedAt}
                  <Button
                    variant="secondary"
                    size="sm"
                    class="grant-revoke"
                    aria-label={m.studio_customers_grants_revoke_label({ title: grant.contentTitle })}
                    onclick={() => askRevoke(grant)}
                  >
                    {m.studio_customers_grants_revoke()}
                  </Button>
                {/if}
              </li>
            {/each}
          </ul>
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

      <!-- Revoke confirm: the A2 copy, body as the description, no children -->
      <ConfirmDialog
        bind:open={revokeDialogOpen}
        title={m.studio_customers_grants_revoke_title({ title: revokeTarget?.contentTitle ?? '' })}
        description={m.studio_customers_grants_revoke_description({ name: customerLabel })}
        confirmText={m.studio_customers_grants_revoke_confirm()}
        cancelText={m.common_cancel()}
        variant="destructive"
        awaitConfirm
        onConfirm={confirmRevoke}
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
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

  @media (--below-sm) {
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
    align-items: center;
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

  .copy-email-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: var(--transition-colors);
    flex-shrink: 0;
  }

  .copy-email-btn:hover {
    color: var(--color-interactive);
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
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .trend {
    display: inline-flex;
    align-items: center;
  }

  .trend--up {
    color: var(--color-success);
  }

  .trend--down {
    color: var(--color-error);
    transform: rotate(180deg);
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
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .content-link {
    color: var(--color-interactive);
    text-decoration: none;
    transition: var(--transition-colors);
  }

  .content-link:hover {
    text-decoration: underline;
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

  /* Access Grants */
  .grant-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }

  .grant-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    /* The history table's cell inset, so the titles line up with its
       Content column. */
    padding: var(--space-3) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .grant-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .grant-text--skeleton {
    flex: 1;
    gap: var(--space-2);
  }

  .grant-title {
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grant-meta {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* Revoked rows stay as a record: muted, and the words carry the state. */
  .grant-row[data-state='revoked'] .content-link {
    color: var(--color-text-secondary);
  }

  .grant-error {
    font-size: var(--text-xs);
    color: var(--color-status-error-text);
  }

  .grant-row :global(.grant-revoke) {
    flex-shrink: 0;
  }

  .grants-error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
  }

  :global(.drawer-content .dialog-footer) {
    margin-top: auto;
    padding-top: var(--space-4);
    border-top: var(--border-width) var(--border-style) var(--color-border);
  }
</style>
