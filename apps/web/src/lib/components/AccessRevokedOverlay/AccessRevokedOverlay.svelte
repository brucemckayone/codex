<!--
  @component AccessRevokedOverlay

  Contextual overlay shown when a previously-authorised user has lost access
  to content (subscription cancelled, payment failed, refund, admin revoke).
  Copy + CTA vary by revocation reason — see the table in Codex-zdf2u.

  The overlay is absolutely positioned so the caller's poster / thumbnail
  stays visible underneath (dark scrim on top). Not dismissable — the user
  must act on the CTA. Clicking outside / pressing Escape is intentionally
  no-op so they can't bypass the paywall.

  @prop {AccessRevocationReason | null} reason - Revocation reason from the
    server-side AccessDeniedError. Null = generic "Access denied" fallback.
  @prop {string} [organizationId] - Org ID forwarded to `reactivateSubscription`
    when the reason is `subscription_deleted`. Required for the inline flow.
  @prop {() => void} [onreactivated] - Invoked after a successful reactivate
    so the caller can invalidate cached access state and re-request a URL.
  @prop {string} [class] - Forwarded onto the overlay root.
-->
<script lang="ts">
  import { toast } from '$lib/components/ui/Toast';
  import { LockIcon, AlertCircleIcon, CreditCardIcon } from '$lib/components/ui/Icon';
  import { reactivateSubscription } from '$lib/remote/subscription.remote';
  import { openBillingPortal } from '$lib/remote/account.remote';
  import { page } from '$app/state';
  import type { AccessRevocationReason } from '$lib/server/content-detail';
  import type { Component } from 'svelte';

  interface Props {
    reason: AccessRevocationReason | null;
    organizationId?: string;
    onreactivated?: () => void;
    class?: string;
  }

  const {
    reason,
    organizationId,
    onreactivated,
    class: className,
  }: Props = $props();

  /**
   * Copy + CTA config per reason. Kept as a record so tests can assert
   * each variant renders the documented strings.
   */
  interface ReasonConfig {
    title: string;
    body: string;
    icon: Component;
    primary?: {
      label: string;
      action: 'reactivate' | 'billing-portal' | 'href' | 'support';
      href?: string;
    };
    secondary?: {
      label: string;
      action: 'billing-portal' | 'href' | 'support';
      href?: string;
    };
  }

  const config = $derived.by<ReasonConfig>(() => {
    switch (reason) {
      case 'subscription_deleted':
        return {
          title: 'Your subscription has ended',
          body: 'Reactivate to continue watching.',
          icon: LockIcon,
          primary: { label: 'Reactivate', action: 'reactivate' },
          secondary: {
            label: 'View plan',
            action: 'href',
            href: '/account/subscriptions',
          },
        };
      case 'payment_failed':
        return {
          title: 'Payment failed',
          body: 'Update your payment method to restore access.',
          icon: CreditCardIcon,
          primary: { label: 'Update payment', action: 'billing-portal' },
          secondary: {
            label: 'Manage plan',
            action: 'href',
            href: '/account/subscriptions',
          },
        };
      case 'refund':
        return {
          title: 'This purchase was refunded',
          body: 'Browse plans to subscribe again.',
          icon: AlertCircleIcon,
          primary: { label: 'Browse plans', action: 'href', href: '/pricing' },
          secondary: { label: 'Contact support', action: 'support' },
        };
      case 'admin_revoke':
        return {
          title: 'Access revoked',
          body: 'Contact support for assistance.',
          icon: AlertCircleIcon,
          primary: { label: 'Contact support', action: 'support' },
        };
      default:
        return {
          title: 'Access denied',
          body: 'You do not have permission to view this content.',
          icon: LockIcon,
        };
    }
  });

  let inFlight = $state(false);

  async function handleAction(
    action: 'reactivate' | 'billing-portal' | 'href' | 'support',
    href?: string
  ) {
    if (inFlight) return;
    if (action === 'href' && href) {
      window.location.href = href;
      return;
    }
    if (action === 'support') {
      window.location.href = 'mailto:support@codex.example?subject=Access%20issue';
      return;
    }
    if (action === 'reactivate') {
      if (!organizationId) {
        toast.error(
          'Reactivate failed',
          'Organisation context missing — please try again from the pricing page.'
        );
        return;
      }
      inFlight = true;
      try {
        await reactivateSubscription({ organizationId });
        onreactivated?.();
      } catch (err) {
        toast.error(
          'Reactivate failed',
          err instanceof Error ? err.message : undefined
        );
      } finally {
        inFlight = false;
      }
      return;
    }
    if (action === 'billing-portal') {
      inFlight = true;
      try {
        const result = await openBillingPortal({ returnUrl: page.url.href });
        // Defence-in-depth: only redirect to Stripe domains (mirrors
        // portalSessionForm in account.remote.ts).
        const portalUrl = new URL(result.url);
        if (portalUrl.hostname.endsWith('.stripe.com')) {
          window.location.href = result.url;
        } else {
          throw new Error('Invalid billing portal URL');
        }
      } catch (err) {
        toast.error(
          'Could not open billing portal',
          err instanceof Error ? err.message : undefined
        );
      } finally {
        inFlight = false;
      }
    }
  }

  const Icon = $derived(config.icon);
</script>

<div
  class="access-revoked {className ?? ''}"
  role="alert"
  aria-live="assertive"
  data-reason={reason ?? 'generic'}
>
  <div class="access-revoked__scrim" aria-hidden="true"></div>
  <div class="access-revoked__card">
    <Icon size={32} class="access-revoked__icon" stroke-width="1.5" />
    <h2 class="access-revoked__title">{config.title}</h2>
    <p class="access-revoked__body">{config.body}</p>
    {#if config.primary || config.secondary}
      <div class="access-revoked__actions">
        {#if config.primary}
          {@const primary = config.primary}
          <button
            type="button"
            class="access-revoked__btn access-revoked__btn--primary"
            onclick={() => handleAction(primary.action, primary.href)}
            disabled={inFlight}
          >
            {inFlight ? 'Working…' : primary.label}
          </button>
        {/if}
        {#if config.secondary}
          {@const secondary = config.secondary}
          <button
            type="button"
            class="access-revoked__btn access-revoked__btn--secondary"
            onclick={() => handleAction(secondary.action, secondary.href)}
            disabled={inFlight}
          >
            {secondary.label}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .access-revoked {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    /* Sit above media-chrome controls + the play overlay. Slightly below
       modal/toast so global surfaces still stack on top. */
    z-index: var(--z-sticky, 40);
    animation: access-revoked-fade-in var(--duration-slow) var(--ease-out);
  }

  .access-revoked__scrim {
    position: absolute;
    inset: 0;
    background: var(--color-player-overlay-heavy);
    backdrop-filter: blur(var(--blur-sm, 4px));
  }

  .access-revoked__card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    max-width: calc(var(--space-24) * 4);
    padding: var(--space-6) var(--space-5);
    background: var(--color-surface);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    text-align: center;
    color: var(--color-text);
  }

  :global(.access-revoked__icon) {
    color: var(--color-text-secondary);
    opacity: var(--opacity-90);
  }

  .access-revoked__title {
    font-size: var(--text-lg);
    font-weight: var(--font-semibold);
    margin: 0;
    color: var(--color-text);
    line-height: var(--leading-snug);
  }

  .access-revoked__body {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    margin: 0;
    line-height: var(--leading-relaxed);
  }

  .access-revoked__actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
    width: 100%;
  }

  .access-revoked__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    border-radius: var(--radius-md);
    border: var(--border-width) var(--border-style) transparent;
    cursor: pointer;
    font-family: inherit;
    transition: var(--transition-colors), var(--transition-transform);
    text-decoration: none;
  }

  .access-revoked__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: 2px;
  }

  .access-revoked__btn:disabled {
    opacity: var(--opacity-60);
    cursor: not-allowed;
  }

  .access-revoked__btn--primary {
    background: var(--color-brand-accent, var(--color-primary-500));
    color: var(--color-text-inverse);
  }

  .access-revoked__btn--primary:hover:not(:disabled) {
    background: var(--color-brand-accent-hover, var(--color-primary-600));
  }

  .access-revoked__btn--secondary {
    background: transparent;
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .access-revoked__btn--secondary:hover:not(:disabled) {
    background: var(--color-surface-secondary);
    border-color: var(--color-border-strong, var(--color-border));
  }

  @media (--breakpoint-sm) {
    .access-revoked__actions {
      flex-direction: row;
      justify-content: center;
    }

    .access-revoked__btn {
      flex: 1;
      max-width: calc(var(--space-24) * 2);
    }
  }

  @keyframes access-revoked-fade-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-2));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .access-revoked {
      animation: none;
    }
  }
</style>
