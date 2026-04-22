<!--
  @component AccountSubscriptions

  User's subscription management page.
  Lists all active/cancelling subscriptions with cancel and org navigation.
-->
<script lang="ts">
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Badge, EmptyState, Alert } from '$lib/components/ui';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import {
    cancelSubscription,
    reactivateSubscription,
  } from '$lib/remote/subscription.remote';
  import { openBillingPortal } from '$lib/remote/account.remote';
  import { invalidateCollection } from '$lib/collections';
  import type { UserOrgSubscription } from '$lib/types';
  import { page } from '$app/state';
  import { buildOrgUrl } from '$lib/utils/subdomain';
  import { formatPrice, formatDate } from '$lib/utils/format';

  let { data } = $props();

  // `data` from SvelteKit is deeply reactive in Svelte 5 — mutating entries
  // of `data.subscriptions` (for optimistic updates) triggers re-renders.
  // When the server load re-runs after `invalidate('account:subscriptions')`,
  // `data.subscriptions` is fully replaced, so optimistic state is naturally
  // reconciled with authoritative server state.
  const subscriptions = $derived(data.subscriptions);

  let cancelDialogOpen = $state(false);
  let cancellingSubscription = $state<UserOrgSubscription | null>(null);
  let cancelReason = $state('');
  let cancelLoading = $state(false);
  let cancelError = $state('');
  let reactivateLoading = $state<string | null>(null);
  let reactivateError = $state('');

  function statusVariant(status: string): 'success' | 'warning' | 'error' | 'neutral' {
    switch (status) {
      case 'active': return 'success';
      case 'cancelling': return 'warning';
      case 'past_due': return 'error';
      default: return 'neutral';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'active': return m.subscription_status_active();
      case 'cancelling': return m.subscription_status_cancelling();
      case 'past_due': return m.subscription_status_past_due();
      case 'cancelled': return m.subscription_status_cancelled();
      default: return status;
    }
  }

  function openCancelDialog(sub: UserOrgSubscription) {
    cancellingSubscription = sub;
    cancelReason = '';
    cancelError = '';
    cancelDialogOpen = true;
  }

  async function handleCancel() {
    if (!cancellingSubscription) return;
    cancelLoading = true;
    cancelError = '';

    const organizationId = cancellingSubscription.organizationId;
    const reason = cancelReason || undefined;
    const existing = subscriptions.find(
      (s) => s.organizationId === organizationId
    );
    const previousStatus = existing?.status;
    const previousCancelAtPeriodEnd = existing?.cancelAtPeriodEnd;

    // Optimistic flip — idempotent guard (Melt controlled-component echo safe).
    // If the state already matches (e.g. server re-render with same status),
    // early-return to avoid re-triggering effect dependencies.
    if (existing && existing.status !== 'cancelling') {
      existing.status = 'cancelling';
      existing.cancelAtPeriodEnd = true;
    }

    try {
      await cancelSubscription({ organizationId, reason });
      cancelDialogOpen = false;
      cancellingSubscription = null;
      await Promise.all([
        invalidate('account:subscriptions'),
        invalidateCollection('library'),
        invalidateCollection('subscription'),
      ]);
    } catch (error) {
      // Rollback optimistic state on failure
      if (existing && previousStatus !== undefined) {
        existing.status = previousStatus;
        existing.cancelAtPeriodEnd = previousCancelAtPeriodEnd ?? false;
      }
      cancelError = error instanceof Error ? error.message : 'Failed to cancel subscription';
    } finally {
      cancelLoading = false;
    }
  }

  async function handleReactivate(sub: UserOrgSubscription) {
    reactivateLoading = sub.id;
    reactivateError = '';

    const existing = subscriptions.find(
      (s) => s.organizationId === sub.organizationId
    );
    const previousStatus = existing?.status;
    const previousCancelAtPeriodEnd = existing?.cancelAtPeriodEnd;

    // Optimistic flip — idempotent guard against echo re-entry.
    if (existing && existing.status !== 'active') {
      existing.status = 'active';
      existing.cancelAtPeriodEnd = false;
    }

    try {
      await reactivateSubscription({ organizationId: sub.organizationId });
      await Promise.all([
        invalidate('account:subscriptions'),
        invalidateCollection('library'),
        invalidateCollection('subscription'),
      ]);
    } catch (error) {
      // Rollback optimistic state on failure
      if (existing && previousStatus !== undefined) {
        existing.status = previousStatus;
        existing.cancelAtPeriodEnd = previousCancelAtPeriodEnd ?? false;
      }
      reactivateError = error instanceof Error ? error.message : 'Failed to reactivate subscription';
    } finally {
      reactivateLoading = null;
    }
  }

  async function handleUpdatePayment() {
    try {
      const result = await openBillingPortal({
        returnUrl: page.url.href,
      });
      if (result?.url) {
        window.location.href = result.url;
      }
    } catch {
      // Portal session creation failed — silent (Stripe will show its own error)
    }
  }
</script>

<svelte:head>
  <title>{m.subscription_manage()} | Codex</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="subscriptions-page">
  <h1 class="page-title">{m.subscription_manage()}</h1>

  {#if subscriptions.length === 0}
    <EmptyState
      title={m.subscription_no_subscriptions()}
      description={m.subscription_no_subscriptions_description()}
    />
  {:else}
    <div class="subscription-list">
      {#each subscriptions as sub (sub.id)}
        <Card.Root>
          <Card.Content>
            <div class="subscription-card">
              <div class="subscription-info">
                <div class="subscription-org">
                  {#if sub.organization.logoUrl}
                    <img
                      src={sub.organization.logoUrl}
                      alt={sub.organization.name}
                      class="org-logo"
                      width="32"
                      height="32"
                    />
                  {/if}
                  <div class="org-details">
                    <span class="org-name">{sub.organization.name}</span>
                    <span class="tier-name">{sub.tier.name}</span>
                  </div>
                </div>
                <Badge variant={statusVariant(sub.status)}>
                  {statusLabel(sub.status)}
                </Badge>
              </div>

              {#if sub.status === 'past_due'}
                <Alert variant="error">
                  {m.subscription_past_due_message()}
                  <Button variant="ghost" size="sm" onclick={handleUpdatePayment}>
                    {m.subscription_update_payment()}
                  </Button>
                </Alert>
              {/if}

              {#if sub.status === 'cancelling'}
                <p class="cancelling-message">
                  {m.subscription_cancelling_message({
                    date: formatDate(sub.currentPeriodEnd as unknown as string),
                  })}
                </p>
              {/if}

              <div class="subscription-meta">
                <span class="subscription-price">
                  {formatPrice(sub.amountCents)}
                  <span class="billing-interval">/{sub.billingInterval === 'month' ? 'mo' : 'yr'}</span>
                </span>
                <span class="subscription-period">
                  {m.subscription_current_period_ends({
                    date: formatDate(sub.currentPeriodEnd as unknown as string),
                  })}
                </span>
              </div>

              <div class="subscription-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => {
                    const orgUrl = buildOrgUrl(page.url, sub.organization.slug, '/pricing');
                    window.location.href = orgUrl;
                  }}
                >
                  {m.subscription_change_tier()}
                </Button>
                {#if sub.status === 'active'}
                  <Button
                    variant="ghost"
                    size="sm"
                    onclick={() => openCancelDialog(sub)}
                  >
                    {m.subscription_cancel()}
                  </Button>
                {/if}
                {#if sub.status === 'cancelling'}
                  <Button
                    variant="primary"
                    size="sm"
                    loading={reactivateLoading === sub.id}
                    onclick={() => handleReactivate(sub)}
                  >
                    {m.subscription_reactivate()}
                  </Button>
                {/if}
              </div>

              {#if reactivateError && reactivateLoading === null}
                <Alert variant="error">{reactivateError}</Alert>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>

<!-- Cancel Subscription Dialog -->
<Dialog.Root bind:open={cancelDialogOpen}>
  <Dialog.Content size="sm">
    <Dialog.Header>
      <Dialog.Title>{m.subscription_cancel()}</Dialog.Title>
      {#if cancellingSubscription}
        <Dialog.Description>
          {cancellingSubscription.organization.name} — {cancellingSubscription.tier.name}
        </Dialog.Description>
      {/if}
    </Dialog.Header>

    <Dialog.Body>
      <div class="form-field">
        <Label for="cancel-reason">{m.subscription_cancel_reason()}</Label>
        <TextArea
          id="cancel-reason"
          bind:value={cancelReason}
          rows={3}
          maxlength={500}
        />
      </div>

      {#if cancelError}
        <Alert variant="error">{cancelError}</Alert>
      {/if}
    </Dialog.Body>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => { cancelDialogOpen = false; }}>
        {m.monetisation_cancel()}
      </Button>
      <Button variant="destructive" onclick={handleCancel} loading={cancelLoading}>
        {m.subscription_cancel_confirm()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .subscriptions-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    max-width: 800px;
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
  }

  .subscription-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .subscription-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .subscription-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .subscription-org {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .org-logo {
    border-radius: var(--radius-md);
    object-fit: cover;
  }

  .org-details {
    display: flex;
    flex-direction: column;
  }

  .org-name {
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    color: var(--color-text);
  }

  .tier-name {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .subscription-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: var(--border-width) var(--border-style) var(--color-border-subtle);
  }

  .subscription-price {
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  .billing-interval {
    font-size: var(--text-sm);
    font-weight: var(--font-normal);
    color: var(--color-text-muted);
  }

  .subscription-period {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
  }

  .subscription-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .cancelling-message {
    font-size: var(--text-xs);
    color: var(--color-warning-700);
    margin: 0;
  }


  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
