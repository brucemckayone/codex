<!--
  @component SubscribeButton

  Unified subscribe / membership CTA that renders the correct variant based on
  the viewing user's live subscription status for the current org.

  State matrix (Codex-g5vbp — shared with the pricing page via
  $lib/subscription/status.ts):

    not subscribed           → "Subscribe" (primary) → pricing
    subscribed + active      → "Subscribed" (disabled, success badge)
    subscribed + cancelling  → warning "Ends {date}" + "Reactivate" (inline, optimistic)
    subscribed + past_due    → danger "Payment failed" + "Update payment" (Stripe portal)
    subscribed + paused      → warning "Paused" + "Resume" (interactive,
                                optimistic flip + rollback — Codex-7h4vo)

  Data sources:
    - `organizationId` prop identifies the org row in `subscriptionCollection`.
    - Live row from `subscriptionCollection` drives the rendered state; the
      collection is localStorage-backed and updates via webhook-driven version
      invalidation (no manual refetch needed here).
    - Reactivate uses `reactivateSubscription` remote with optimistic flip +
      rollback (pattern lifted from the pricing page — Codex-tfloz precedent).
    - Update-payment opens the Stripe billing portal via `openBillingPortal`;
      on failure falls through to /account/subscriptions.

  Safety:
    - Handlers are idempotent (Melt echo guard) — re-entering with the target
      state already set is a no-op (feedback_melt_controlled_components).
    - Cross-subdomain Manage link uses `buildPlatformUrl` since
      /account/subscriptions lives on the platform origin.
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import * as m from '$paraglide/messages';
  import Button from '$lib/components/ui/Button/Button.svelte';
  import Badge from '$lib/components/ui/Badge/Badge.svelte';
  import { subscriptionCollection, invalidateCollection } from '$lib/collections';
  import { openBillingPortal } from '$lib/remote/account.remote';
  import {
    reactivateSubscription,
    resumeSubscription,
  } from '$lib/remote/subscription.remote';
  import { buildPlatformUrl } from '$lib/utils/subdomain';
  import { formatDate } from '$lib/utils/format';
  import {
    getEffectiveStatus,
    type SubscriptionStatus,
  } from '$lib/subscription/status';

  interface Props {
    /** Org whose subscription status we render. */
    organizationId: string;
    /** Whether the viewing user is signed in. Controls the unauthenticated fallthrough. */
    isAuthenticated: boolean;
    /**
     * Where to send an unauthenticated user when they click Subscribe.
     * Defaults to the org's /pricing page.
     */
    subscribeHref?: string;
    /**
     * When true and the user has an ACTIVE subscription, render an
     * "Upgrade plan" variant (CTA → pricing page) instead of the passive
     * "Subscribed" state. Used by content-detail gates when the user's
     * current tier isn't high enough for the viewed content.
     */
    upgradeRequired?: boolean;
    /** Button size forwarded to the underlying <Button> primitive. */
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    /** Whether to render the inline status badge (Ends/Payment failed/Paused). */
    showBadge?: boolean;
    /** Optional container class for positioning in the parent layout. */
    class?: string;
  }

  const {
    organizationId,
    isAuthenticated,
    subscribeHref = '/pricing',
    upgradeRequired = false,
    size = 'md',
    showBadge = true,
    class: className = '',
  }: Props = $props();

  // ── Live subscription row ────────────────────────────────────────
  // subscriptionCollection is undefined on the server; the badge + state
  // UI only renders client-side. SSR renders the default Subscribe CTA
  // (most common state + safest default).
  const sub = $derived.by(() => {
    if (!browser || !subscriptionCollection) return null;
    return subscriptionCollection.state.get(organizationId) ?? null;
  });

  // Effective status via the shared helper — same logic the pricing page
  // uses for tier cards so both surfaces agree.
  const status = $derived<SubscriptionStatus | null>(
    getEffectiveStatus({
      currentTierId: sub?.tier?.id ?? null,
      status: sub?.status ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    })
  );

  // /account/subscriptions lives on the platform origin, not the org
  // subdomain — always build an absolute URL so the link crosses origins.
  const manageUrl = $derived(
    browser ? buildPlatformUrl(page.url, '/account/subscriptions') : '/account/subscriptions'
  );

  // ── Reactivate flow ──────────────────────────────────────────────
  let reactivateLoading = $state(false);
  let reactivateError = $state('');

  async function handleReactivate() {
    if (reactivateLoading) return;
    // Melt echo guard — if the row already shows active, bail early so a
    // re-render/sync doesn't re-fire the mutation.
    if (status === 'active') return;
    if (!browser || !subscriptionCollection) return;

    // Snapshot for rollback.
    const previous = subscriptionCollection.state.get(organizationId);
    if (!previous) return;

    reactivateLoading = true;
    reactivateError = '';

    // Optimistic flip — mirror the pricing page: active + cancelAtPeriodEnd=false.
    try {
      subscriptionCollection.update(organizationId, (draft) => {
        if (draft.status !== 'active') draft.status = 'active';
        if (draft.cancelAtPeriodEnd) draft.cancelAtPeriodEnd = false;
      });
    } catch {
      // If the collection can't mutate (e.g. row evicted mid-flight),
      // fall through to the server call — rollback is a no-op.
    }

    try {
      await reactivateSubscription({ organizationId });
      await Promise.all([
        invalidate('account:subscriptions'),
        invalidateCollection('library'),
        invalidateCollection('subscription'),
      ]);
    } catch (err) {
      // Rollback — restore the previous snapshot exactly.
      try {
        subscriptionCollection.update(organizationId, (draft) => {
          draft.status = previous.status;
          draft.cancelAtPeriodEnd = previous.cancelAtPeriodEnd;
        });
      } catch {
        // Best-effort; the version-based invalidation will re-reconcile.
      }
      reactivateError =
        err instanceof Error ? err.message : 'Failed to reactivate subscription';
    } finally {
      reactivateLoading = false;
    }
  }

  // ── Resume flow (Codex-7h4vo) ────────────────────────────────────
  // Parallel to reactivate: user clicks "Resume" on a paused subscription,
  // we optimistically flip the local row back to 'active' and call the
  // resume endpoint. On error we rollback to the prior snapshot; on
  // success we invalidate the library + subscription collections so
  // other surfaces (pricing page, content-detail gate) pick up the state
  // within one visibility tick.
  let resumeLoading = $state(false);
  let resumeError = $state('');

  async function handleResume() {
    if (resumeLoading) return;
    // Melt echo guard — a stale re-render shouldn't re-fire the mutation.
    if (status === 'active') return;
    if (!browser || !subscriptionCollection) return;

    const previous = subscriptionCollection.state.get(organizationId);
    if (!previous) return;

    resumeLoading = true;
    resumeError = '';

    // Optimistic flip — paused → active. Mirrors the pricing page.
    try {
      subscriptionCollection.update(organizationId, (draft) => {
        if (draft.status !== 'active') draft.status = 'active';
      });
    } catch {
      // If the collection can't mutate (e.g. row evicted mid-flight),
      // fall through to the server call — rollback is a no-op.
    }

    try {
      await resumeSubscription({ organizationId });
      await Promise.all([
        invalidate('account:subscriptions'),
        invalidateCollection('library'),
        invalidateCollection('subscription'),
      ]);
    } catch (err) {
      // Rollback — restore the previous snapshot exactly.
      try {
        subscriptionCollection.update(organizationId, (draft) => {
          draft.status = previous.status;
        });
      } catch {
        // Best-effort; the version-based invalidation will re-reconcile.
      }
      resumeError =
        err instanceof Error ? err.message : 'Failed to resume subscription';
    } finally {
      resumeLoading = false;
    }
  }

  // ── Update-payment flow ──────────────────────────────────────────
  let paymentPortalLoading = $state(false);

  async function handleUpdatePayment() {
    if (paymentPortalLoading) return;
    paymentPortalLoading = true;
    try {
      const result = await openBillingPortal({ returnUrl: page.url.href });
      if (result?.url) {
        window.location.href = result.url;
        return;
      }
      window.location.href = '/account/subscriptions';
    } catch {
      window.location.href = '/account/subscriptions';
    } finally {
      paymentPortalLoading = false;
    }
  }

  // ── Display helpers ──────────────────────────────────────────────
  const endsLabel = $derived.by(() => {
    if (!sub?.currentPeriodEnd) return null;
    return formatDate(sub.currentPeriodEnd);
  });
</script>

<div class="subscribe-button {className}" data-testid="subscribe-button">
  {#if status === null}
    <!-- Not subscribed — default CTA -->
    <a
      href={isAuthenticated ? subscribeHref : `/login?redirect=${encodeURIComponent(subscribeHref)}`}
      class="subscribe-button__link"
      data-testid="subscribe-button-subscribe"
    >
      <Button variant="primary" {size}>
        {m.pricing_subscribe()}
      </Button>
    </a>
  {:else if status === 'active'}
    {#if upgradeRequired}
      <!-- Active subscriber whose tier doesn't cover this content — show
           the upgrade CTA rather than the passive "Subscribed" state. -->
      <a
        href={subscribeHref}
        class="subscribe-button__link"
        data-testid="subscribe-button-upgrade"
      >
        <Button variant="primary" {size}>
          {m.upgrade_cta_title()}
        </Button>
      </a>
      <a
        href={manageUrl}
        class="subscribe-button__manage"
        data-testid="subscribe-button-manage"
      >
        {m.pricing_manage_plan()}
      </a>
    {:else}
      <!-- Subscribed & active — non-interactive confirmation -->
      <Badge variant="success" class="subscribe-button__badge">
        {m.subscription_badge()}
      </Badge>
      <a
        href={manageUrl}
        class="subscribe-button__manage"
        data-testid="subscribe-button-manage"
      >
        {m.pricing_manage_plan()}
      </a>
    {/if}
  {:else if status === 'cancelling'}
    {#if showBadge && endsLabel}
      <Badge variant="warning" class="subscribe-button__badge">
        {m.pricing_plan_ends_on({ date: endsLabel })}
      </Badge>
    {/if}
    <Button
      variant="primary"
      {size}
      onclick={handleReactivate}
      loading={reactivateLoading}
      data-testid="subscribe-button-reactivate"
    >
      {m.pricing_reactivate_plan()}
    </Button>
    <a
      href={manageUrl}
      class="subscribe-button__manage"
      data-testid="subscribe-button-manage"
    >
      {m.pricing_manage_plan()}
    </a>
    {#if reactivateError}
      <p class="subscribe-button__error" role="alert">
        {reactivateError}
      </p>
    {/if}
  {:else if status === 'past_due'}
    {#if showBadge}
      <Badge variant="error" class="subscribe-button__badge">
        {m.pricing_payment_failed()}
      </Badge>
    {/if}
    <Button
      variant="primary"
      {size}
      onclick={handleUpdatePayment}
      loading={paymentPortalLoading}
      data-testid="subscribe-button-update-payment"
    >
      {m.pricing_update_payment()}
    </Button>
    <a
      href={manageUrl}
      class="subscribe-button__manage"
      data-testid="subscribe-button-manage"
    >
      {m.pricing_manage_plan()}
    </a>
  {:else if status === 'paused'}
    {#if showBadge}
      <Badge variant="warning" class="subscribe-button__badge">
        {m.pricing_plan_paused()}
      </Badge>
    {/if}
    <!--
      User-initiated resume is wired end-to-end in Codex-7h4vo. Optimistic
      flip + rollback pattern matches reactivate; backend hits Stripe's
      subscriptions.resume API and bumps library + subscription caches
      via the orchestrator hook.
    -->
    <Button
      variant="primary"
      {size}
      onclick={handleResume}
      loading={resumeLoading}
      data-testid="subscribe-button-resume"
    >
      {m.pricing_resume_plan()}
    </Button>
    <a
      href={manageUrl}
      class="subscribe-button__manage"
      data-testid="subscribe-button-manage"
    >
      {m.pricing_manage_plan()}
    </a>
    {#if resumeError}
      <p class="subscribe-button__error" role="alert">
        {resumeError}
      </p>
    {/if}
  {/if}
</div>

<style>
  .subscribe-button {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .subscribe-button__link {
    /* Unstyled anchor — Button inside handles visuals.
       Removes default underline + colour so the Button's
       data-variant styles win without needing !important. */
    text-decoration: none;
    color: inherit;
  }

  .subscribe-button__manage {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: underline;
    text-underline-offset: var(--space-0-5);
    transition: var(--transition-colors);
  }

  .subscribe-button__manage:hover {
    color: var(--color-text);
  }

  .subscribe-button__manage:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .subscribe-button__error {
    width: 100%;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background-color: var(--color-error-50);
    color: var(--color-error-700);
    border: var(--border-width) var(--border-style) var(--color-error-200);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
  }
</style>
