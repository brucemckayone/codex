<!--
  @component HealthBanner

  Platform-wide dismissible notice for subscriptions in attention-needing
  lifecycle states (past_due, paused). Derives entirely from
  `subscriptionCollection` — no server fetch, no new API.

  Placement: mounted once each in `(platform)/+layout.svelte` and
  `_org/[slug]/+layout.svelte`. The banner appears atop the main content
  area in both trees; sessionStorage de-dupes dismissals so navigating
  between subdomains doesn't re-show after an explicit close.

  Click-through:
    - past_due  → /account/subscriptions  (CTA: Update payment)
    - paused    → /account/subscriptions  (CTA: Resume)
    - mixed / 2+ → /account/subscriptions (CTA: Manage subscriptions)

  sessionStorage key: `codex:subscription-banner-dismissed`. Clears
  naturally on tab close so the user sees the reminder again on their
  next visit; a webhook-driven status change also invalidates the
  collection version which re-renders the banner even within the
  same session.

  Accessibility:
    - `role="status"` + `aria-live="polite"` (banner is informational,
       not alerting — matches Alert.svelte's non-error semantics)
    - Close button is a real <button> with descriptive aria-label
    - CTA is a real <a> so it supports open-in-new-tab and honours
       the router
-->
<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import * as m from '$paraglide/messages';
  import {
    subscriptionCollection,
    useLiveQuery,
    type SubscriptionItem,
  } from '$lib/collections';
  import {
    deriveBannerVariant,
    filterAttentionSubs,
  } from './health-banner-logic';

  const DISMISS_KEY = 'codex:subscription-banner-dismissed';
  const MANAGE_URL = '/account/subscriptions';

  let dismissed = $state(false);

  onMount(() => {
    if (!browser) return;
    try {
      dismissed = sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // sessionStorage unavailable (privacy mode / quota) — treat as
      // not-dismissed. The banner is additive UX; falling open is safe.
      dismissed = false;
    }
  });

  function dismiss(): void {
    dismissed = true;
    if (!browser) return;
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Same rationale as onMount — silent fallback. Dismissal still
      // persists in memory for this page tree.
    }
  }

  const subsQuery = useLiveQuery(
    (q) => q.from({ sub: subscriptionCollection }),
    undefined,
    { ssrData: [] as SubscriptionItem[] }
  );

  const attentionSubs = $derived(
    filterAttentionSubs((subsQuery.data ?? []) as SubscriptionItem[])
  );

  const variant = $derived(deriveBannerVariant(attentionSubs));

  const copy = $derived.by<{ message: string; cta: string }>(() => {
    const count = attentionSubs.length;
    if (count > 1) {
      return {
        message: m.subscription_health_banner_multiple({ count }),
        cta: m.subscription_health_banner_cta_manage(),
      };
    }
    const first = attentionSubs[0];
    if (first?.status === 'past_due') {
      return {
        message: m.subscription_health_banner_past_due_single(),
        cta: m.subscription_health_banner_cta_update_payment(),
      };
    }
    return {
      message: m.subscription_health_banner_paused_single(),
      cta: m.subscription_health_banner_cta_resume(),
    };
  });

  const visible = $derived(!dismissed && attentionSubs.length > 0);
</script>

{#if visible}
  <div
    class="health-banner"
    data-variant={variant}
    role="status"
    aria-live="polite"
  >
    <p class="health-banner__message">{copy.message}</p>
    <div class="health-banner__actions">
      <a class="health-banner__cta" href={MANAGE_URL}>{copy.cta}</a>
      <button
        type="button"
        class="health-banner__close"
        onclick={dismiss}
        aria-label={m.subscription_health_banner_dismiss()}
      >
        &times;
      </button>
    </div>
  </div>
{/if}

<style>
  .health-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    margin: var(--space-3) auto;
    max-width: var(--container-max);
    width: calc(100% - var(--space-6));
    border: var(--border-width) var(--border-style) transparent;
  }

  .health-banner[data-variant='error'] {
    background-color: var(--color-error-50);
    border-color: var(--color-error-200);
    color: var(--color-error-700);
  }

  .health-banner[data-variant='warning'] {
    background-color: var(--color-warning-50);
    border-color: var(--color-warning-200);
    color: var(--color-warning-700);
  }

  .health-banner__message {
    margin: 0;
    flex: 1 1 auto;
    min-width: 0;
  }

  .health-banner__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 0 0 auto;
  }

  .health-banner__cta {
    font-weight: var(--font-medium);
    text-decoration: underline;
    text-underline-offset: var(--space-1);
    color: inherit;
  }

  .health-banner__cta:hover {
    text-decoration-thickness: 2px;
  }

  .health-banner__close {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font-size: var(--text-lg);
    line-height: 1;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .health-banner__close:hover {
    background-color: color-mix(in srgb, currentColor 12%, transparent);
  }

  .health-banner__close:focus-visible {
    outline: var(--border-width) solid currentColor;
    outline-offset: var(--space-1);
  }
</style>
