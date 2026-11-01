<!--
  @component AccountSubscriptions

  User's subscription management page.
  Lists all active/cancelling subscriptions with cancel and org navigation.
-->
<script lang="ts">
  import { invalidate, invalidateAll } from '$app/navigation';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import * as Card from '$lib/components/ui/Card';
  import * as Dialog from '$lib/components/ui/Dialog';
  import { Badge, EmptyState, Alert } from '$lib/components/ui';
  import TextArea from '$lib/components/ui/TextArea/TextArea.svelte';
  import Label from '$lib/components/ui/Label/Label.svelte';
  import {
    cancelSubscription,
    keepCurrentPlan,
    reactivateSubscription,
    resumeSubscription,
  } from '$lib/remote/subscription.remote';
  import { openBillingPortal } from '$lib/remote/account.remote';
  import { invalidateCollection } from '$lib/collections';
  import type { PendingTierChange, UserOrgSubscription } from '$lib/types';
  import { page } from '$app/state';
  import { buildOrgUrl } from '$lib/utils/subdomain';
  import {
    formatPrice,
    formatDate,
    formatSentenceDate,
  } from '$lib/utils/format';
  import { waitingMoveBody } from '$lib/utils/plan-label';
  import { logger } from '$lib/observability';

  let { data } = $props();

  // `data` from SvelteKit is deeply reactive in Svelte 5 — mutating entries
  // of `data.subscriptions` (for optimistic updates) triggers re-renders.
  // When the server load re-runs after `invalidate('account:subscriptions')`,
  // `data.subscriptions` is fully replaced, so optimistic state is naturally
  // reconciled with authoritative server state.
  const subscriptions = $derived(data.subscriptions);

  type ChurnReason =
    | 'too_expensive'
    | 'not_enough_content'
    | 'found_alternative'
    | 'not_using_it'
    | 'technical_issues'
    | 'other';

  let cancelDialogOpen = $state(false);
  let cancellingSubscription = $state<UserOrgSubscription | null>(null);
  let cancelReason = $state('');
  let cancelChurnReason = $state<ChurnReason | ''>('');
  let cancelLoading = $state(false);
  let cancelError = $state('');

  // The free-text field is only required when the user picks "Other" —
  // every other reason stands alone. Enabling the textarea for non-'other'
  // reasons would invite noise; disabling it prevents that by design.
  const cancelReasonTextareaDisabled = $derived(
    cancelChurnReason !== '' && cancelChurnReason !== 'other'
  );
  const churnReasonOptions: { value: ChurnReason; label: () => string }[] = [
    { value: 'too_expensive', label: () => m.subscription_churn_reason_too_expensive() },
    { value: 'not_enough_content', label: () => m.subscription_churn_reason_not_enough_content() },
    { value: 'found_alternative', label: () => m.subscription_churn_reason_found_alternative() },
    { value: 'not_using_it', label: () => m.subscription_churn_reason_not_using_it() },
    { value: 'technical_issues', label: () => m.subscription_churn_reason_technical_issues() },
    { value: 'other', label: () => m.subscription_churn_reason_other() },
  ];
  // Per-card state: multiple cards can reactivate in parallel, and an error
  // on one must not render on the others. Single-slot $state<string | null>
  // rendered the error on any card whose loading slot happened to be null.
  const reactivatingIds = new SvelteSet<string>();
  const reactivateErrors = new SvelteMap<string, string>();
  const resumingIds = new SvelteSet<string>();
  const resumeErrors = new SvelteMap<string, string>();
  // Keep current plan, per card (Codex-2hxff.16): the line it came to.
  const keepingIds = new SvelteSet<string>();
  const keepLines = new SvelteMap<string, { tone: 'success' | 'error' | 'info'; text: string }>();

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
    cancelChurnReason = '';
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

    const churnReason = cancelChurnReason || undefined;

    try {
      const result = await cancelSubscription({
        organizationId,
        reason,
        churnReason,
      });
      if (!result.success) {
        if (existing && previousStatus !== undefined) {
          existing.status = previousStatus;
          existing.cancelAtPeriodEnd = previousCancelAtPeriodEnd ?? false;
        }
        cancelError = result.message || 'Failed to cancel subscription';
        return;
      }
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
    reactivatingIds.add(sub.id);
    reactivateErrors.delete(sub.id);

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
      const result = await reactivateSubscription({
        organizationId: sub.organizationId,
      });
      if (!result.success) {
        if (existing && previousStatus !== undefined) {
          existing.status = previousStatus;
          existing.cancelAtPeriodEnd = previousCancelAtPeriodEnd ?? false;
        }
        reactivateErrors.set(
          sub.id,
          result.message || m.subscription_reactivate_error()
        );
        return;
      }
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
      reactivateErrors.set(
        sub.id,
        error instanceof Error
          ? error.message
          : m.subscription_reactivate_error()
      );
    } finally {
      reactivatingIds.delete(sub.id);
    }
  }

  async function handleResume(sub: UserOrgSubscription) {
    resumingIds.add(sub.id);
    resumeErrors.delete(sub.id);

    const existing = subscriptions.find(
      (s) => s.organizationId === sub.organizationId
    );
    const previousStatus = existing?.status;

    if (existing && existing.status !== 'active') {
      existing.status = 'active';
    }

    try {
      const result = await resumeSubscription({
        organizationId: sub.organizationId,
      });
      if (!result.success) {
        if (existing && previousStatus !== undefined) {
          existing.status = previousStatus;
        }
        resumeErrors.set(
          sub.id,
          result.message || m.subscription_resume_error()
        );
        return;
      }
      await Promise.all([
        invalidate('account:subscriptions'),
        invalidateCollection('library'),
        invalidateCollection('subscription'),
      ]);
    } catch (error) {
      if (existing && previousStatus !== undefined) {
        existing.status = previousStatus;
      }
      resumeErrors.set(
        sub.id,
        error instanceof Error ? error.message : m.subscription_resume_error()
      );
    } finally {
      resumingIds.delete(sub.id);
    }
  }

  /**
   * Keep current plan on a card with a waiting move (waiting move states
   * 2-5): one call, nothing charged. The page reads its list again after
   * any answer, so the card shows what is true; a refusal says the move is
   * still set.
   */
  async function handleKeep(sub: UserOrgSubscription, move: PendingTierChange) {
    if (keepingIds.has(sub.id)) return;
    keepingIds.add(sub.id);
    keepLines.delete(sub.id);
    const plan = sub.tier.name;
    try {
      const result = await keepCurrentPlan({ organizationId: sub.organizationId });
      if (result.success) {
        const kept = result.data;
        keepLines.set(sub.id, {
          tone: 'success',
          text: m.pricing_move_kept({
            plan,
            date: formatSentenceDate(kept?.currentPeriodEnd ?? sub.currentPeriodEnd),
            price: formatPrice(kept?.amountCents ?? sub.heldAmountCents ?? sub.amountCents),
          }),
        });
        await Promise.all([
          invalidate('account:subscriptions'),
          invalidateCollection('library'),
          invalidateCollection('subscription'),
        ]);
        return;
      }
      const failure: { code?: string; detailsCode?: string; status?: number } =
        'code' in result ? result : {};
      if (failure.detailsCode === 'MOVE_ALREADY_LANDED') {
        // The renewal has happened: the card re-reads as the new plan.
        keepLines.set(sub.id, {
          tone: 'info',
          text: m.pricing_move_landed({ plan: move.tierName }),
        });
        await invalidate('account:subscriptions');
        return;
      }
      if (failure.code === undefined) {
        // No answer: it may have kept it. Read the list again.
        keepLines.set(sub.id, {
          tone: 'error',
          text: m.pricing_refusal_change_unconfirmed(),
        });
        await invalidate('account:subscriptions');
        return;
      }
      logger.warn('account: keep current plan refused', {
        status: failure.status,
        code: failure.detailsCode ?? failure.code,
      });
      keepLines.set(sub.id, {
        tone: 'error',
        text: m.pricing_move_keep_failed({
          plan,
          movingTo: move.tierName,
          date: formatSentenceDate(move.effectiveAt),
        }),
      });
    } catch (error) {
      logger.warn('account: keep current plan got no answer', {
        error: error instanceof Error ? error.message : String(error),
      });
      keepLines.set(sub.id, {
        tone: 'error',
        text: m.pricing_refusal_change_unconfirmed(),
      });
      await invalidate('account:subscriptions').catch(() => {});
    } finally {
      keepingIds.delete(sub.id);
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

  {#if data.loadError}
    <Alert variant="error">
      {m.subscription_load_error()}
      <Button variant="ghost" size="sm" onclick={() => invalidateAll()}>
        {m.common_try_again()}
      </Button>
    </Alert>
  {:else if subscriptions.length === 0}
    <EmptyState
      title={m.subscription_no_subscriptions()}
      description={m.subscription_no_subscriptions_description()}
    />
  {:else}
    <div class="subscription-list">
      {#each subscriptions as sub (sub.id)}
        <!-- An open chargeback on one of its invoices pauses the plan's access
             and billing (Codex-2hxff.60). Until the bank settles it, the card
             says so and offers only Cancel: no tier change, reactivate or
             payment update. -->
        {@const disputed = sub.disputedAt != null}
        <!-- A move to a cheaper plan waiting for the renewal (Codex-2hxff.16). -->
        {@const move = sub.pendingTierChange ?? null}
        <Card.Root>
          <Card.Content>
            <div
              class="subscription-card"
              data-testid="subscription-card"
              data-org-slug={sub.organization.slug}
            >
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
                <Badge
                  variant={disputed ? 'warning' : statusVariant(sub.status)}
                  data-testid="subscription-status-badge"
                >
                  {disputed ? m.access_paused_dispute_label() : statusLabel(sub.status)}
                </Badge>
              </div>

              {#if disputed}
                <Alert variant="warning" data-testid="subscription-dispute-notice">
                  {m.access_paused_dispute_subscription()}
                </Alert>
              {:else if sub.status === 'past_due'}
                <Alert variant="error">
                  {m.subscription_past_due_message()}
                  <Button variant="ghost" size="sm" onclick={handleUpdatePayment}>
                    {m.subscription_update_payment()}
                  </Button>
                </Alert>
              {:else if sub.status === 'paused'}
                <Alert variant="warning">
                  {m.subscription_paused_message()}
                </Alert>
              {:else if sub.status === 'cancelling'}
                <p class="cancelling-message">
                  {m.subscription_cancelling_message({
                    date: formatDate(sub.currentPeriodEnd),
                  })}
                </p>
                {#if move}
                  <!-- The move survives a cancel (T4): reactivating brings
                       it back, so one quiet line says so (state 6). -->
                  <p class="subscription-note" data-testid="subscription-move-survives">
                    {m.subscription_move_survives_cancel({
                      plan: move.tierName,
                      date: formatSentenceDate(move.effectiveAt),
                    })}
                  </p>
                {/if}
              {:else if move}
                <!-- The pricing page's notice, inside the card (state 5). -->
                <Alert variant="info" data-testid="subscription-move-notice">
                  <div class="subscription-move">
                    <span class="subscription-move__text">
                      <b>{m.pricing_move_notice_title({
                        plan: move.tierName,
                        date: formatSentenceDate(move.effectiveAt),
                      })}</b>
                      <span>{waitingMoveBody(move, sub.tier.name, formatSentenceDate)}</span>
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={keepingIds.has(sub.id)}
                      data-testid="subscription-keep-button"
                      onclick={() => handleKeep(sub, move)}
                    >
                      {m.pricing_move_keep()}
                    </Button>
                  </div>
                </Alert>
              {/if}
              {#if keepLines.has(sub.id)}
                {@const line = keepLines.get(sub.id)}
                {#if line?.tone === 'success'}
                  <p class="subscription-done" role="status" data-testid="subscription-keep-line">
                    {line.text}
                  </p>
                {:else if line}
                  <Alert variant={line.tone} data-testid="subscription-keep-line">
                    {line.text}
                  </Alert>
                {/if}
              {/if}

              <div class="subscription-meta">
                <!-- While a move waits, the row's amount is the next (cheaper)
                     bill; what the member pays now is the held amount. -->
                <span class="subscription-price">
                  {formatPrice(sub.heldAmountCents ?? sub.amountCents)}
                  <span class="billing-interval">/{sub.billingInterval === 'month' ? 'mo' : 'yr'}</span>
                </span>
                <span class="subscription-period">
                  {m.subscription_current_period_ends({
                    date: formatDate(sub.currentPeriodEnd),
                  })}
                </span>
              </div>

              <div class="subscription-actions">
                {#if !disputed}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="subscription-change-tier-button"
                    onclick={() => {
                      const orgUrl = buildOrgUrl(page.url, sub.organization.slug, '/pricing');
                      window.location.href = orgUrl;
                    }}
                  >
                    {m.subscription_change_tier()}
                  </Button>
                {/if}
                {#if sub.status === 'active'}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="subscription-cancel-button"
                    onclick={() => openCancelDialog(sub)}
                  >
                    {m.subscription_cancel()}
                  </Button>
                {/if}
                {#if sub.status === 'cancelling' && !disputed}
                  <Button
                    variant="primary"
                    size="sm"
                    loading={reactivatingIds.has(sub.id)}
                    data-testid="subscription-reactivate-button"
                    onclick={() => handleReactivate(sub)}
                  >
                    {m.subscription_reactivate()}
                  </Button>
                {/if}
                {#if sub.status === 'paused' && !disputed}
                  <Button
                    variant="primary"
                    size="sm"
                    loading={resumingIds.has(sub.id)}
                    data-testid="subscription-resume-button"
                    onclick={() => handleResume(sub)}
                  >
                    {m.subscription_resume()}
                  </Button>
                {/if}
              </div>

              {#if reactivateErrors.has(sub.id)}
                <Alert variant="error">{reactivateErrors.get(sub.id)}</Alert>
              {/if}
              {#if resumeErrors.has(sub.id)}
                <Alert variant="error">{resumeErrors.get(sub.id)}</Alert>
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
      {#if cancellingSubscription}
        <p class="follow-notice">
          {m.subscription_cancel_follow_notice({
            orgName: cancellingSubscription.organization.name,
          })}
        </p>
      {/if}

      <fieldset
        class="churn-reason-group"
        aria-describedby="churn-reason-legend"
      >
        <legend id="churn-reason-legend" class="churn-reason-legend">
          {m.subscription_churn_reason_label()}
        </legend>
        {#each churnReasonOptions as opt (opt.value)}
          <label class="churn-reason-option">
            <input
              type="radio"
              name="churn-reason"
              value={opt.value}
              bind:group={cancelChurnReason}
            />
            <span>{opt.label()}</span>
          </label>
        {/each}
      </fieldset>

      <div class="form-field">
        <Label for="cancel-reason">{m.subscription_cancel_reason()}</Label>
        <TextArea
          id="cancel-reason"
          bind:value={cancelReason}
          rows={3}
          maxlength={500}
          disabled={cancelReasonTextareaDisabled}
          aria-required={cancelChurnReason === 'other'}
        />
        {#if cancelChurnReason === 'other'}
          <p class="churn-reason-hint">
            {m.subscription_churn_reason_other_required()}
          </p>
        {/if}
      </div>

      {#if cancelError}
        <Alert variant="error">{cancelError}</Alert>
      {/if}
    </Dialog.Body>

    <Dialog.Footer>
      <Button
        variant="ghost"
        data-testid="cancel-dialog-dismiss-button"
        onclick={() => { cancelDialogOpen = false; }}
      >
        {m.monetisation_cancel()}
      </Button>
      <Button
        variant="destructive"
        data-testid="cancel-dialog-confirm-button"
        onclick={handleCancel}
        loading={cancelLoading}
      >
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

  .subscription-note {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    line-height: var(--leading-relaxed);
  }

  .subscription-done {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--color-status-success-text);
  }

  .subscription-move {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    justify-content: space-between;
  }

  .subscription-move__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
    /* Wraps the button under the words on a phone: the mockup's basis. */
    flex: 1 1 14rem;
  }

  .subscription-move__text b {
    color: var(--color-text);
    font-weight: var(--font-semibold);
  }

  .subscription-move__text span {
    color: var(--color-text-secondary);
  }


  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .follow-notice {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-4);
    padding: var(--space-3);
    background: var(--color-surface-secondary);
    border-radius: var(--radius-md);
    line-height: var(--leading-relaxed);
  }

  .churn-reason-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-4);
    padding: 0;
    border: 0;
  }

  .churn-reason-legend {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text);
    margin-bottom: var(--space-2);
    padding: 0;
  }

  .churn-reason-option {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: pointer;
  }

  .churn-reason-option input[type='radio'] {
    accent-color: var(--color-primary-500);
  }

  .churn-reason-hint {
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    margin: var(--space-1) 0 0;
  }
</style>
