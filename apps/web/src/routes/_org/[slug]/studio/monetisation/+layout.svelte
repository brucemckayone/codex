<!--
  @component MonetisationLayout

  Tabbed hub for organization monetisation. Anchor-based triggers drive
  SvelteKit sub-routing (each tab is its own route), mirroring the settings
  layout pattern. Active tab is derived from the current URL pathname.

  Tabs:
  - Subscriptions  → /studio/monetisation              (Stripe Connect, tiers)
  - Revenue share  → /studio/monetisation/revenue-share (creator agreements)
  - Pricing FAQ    → /studio/monetisation/pricing-faq   (public pricing-page FAQ)

  MASTHEAD CONTRACT — this layout and its three leaves used to fight over the
  role, stacking 402px of wayfinding before the first content on revenue-share
  (kicker MONEY → h1 Monetisation → active tab → kicker ‹MONETISATION → h2).
  The division now is:

    layout : kicker + the single <h1> + a ONE-LINE hub lede + the tab track
    leaf   : PageHeader variant="compact" (an <h2>) + its own lede, NO kicker

  A leaf must not render a `kicker`/`kickerHref`. The back-link pointed at
  `/studio/monetisation` — the tab strip 24px above it — so it was a fourth
  device restating what the active tab already says. And all THREE leaves carry
  the compact masthead: the Subscriptions tab used to render none, so moving
  between tabs shifted the page structure under the reader.

  @prop {Snippet} children - Child route content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { navigating, page } from '$app/state';
  import * as m from '$paraglide/messages';
  import { PageHeader } from '$lib/components/ui';

  const { children }: { children: Snippet } = $props();

  const activeTab = $derived(
    page.url.pathname.endsWith('/revenue-share')
      ? 'revenue-share'
      : page.url.pathname.endsWith('/pricing-faq')
        ? 'pricing-faq'
        : 'subscriptions'
  );

  const loadingTab = $derived(
    navigating?.to?.url.pathname?.endsWith('/revenue-share')
      ? 'revenue-share'
      : navigating?.to?.url.pathname?.endsWith('/pricing-faq')
        ? 'pricing-faq'
        : navigating?.to?.url.pathname?.endsWith('/monetisation')
          ? 'subscriptions'
          : null
  );

  const tabs = $derived([
    {
      value: 'subscriptions',
      href: '/studio/monetisation',
      label: m.monetisation_subscriptions_title(),
    },
    {
      value: 'revenue-share',
      href: '/studio/monetisation/revenue-share',
      label: m.monetisation_revenue_share_title(),
    },
    {
      value: 'pricing-faq',
      href: '/studio/monetisation/pricing-faq',
      label: m.monetisation_pricing_faq_title(),
    },
  ]);
</script>

<div class="monetisation-hub">
  <PageHeader
    kicker={m.studio_section_money()}
    title={m.monetisation_title()}
    description={m.monetisation_description()}
    divider={false}
  />

  <nav class="monetisation-hub__tabs" aria-label={m.monetisation_title()}>
    <div class="tabs-list" role="tablist">
      {#each tabs as tab (tab.value)}
        <a
          href={tab.href}
          class="tab-trigger"
          class:active={activeTab === tab.value}
          class:loading={loadingTab === tab.value}
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-current={activeTab === tab.value ? 'page' : undefined}
        >
          {tab.label}
        </a>
      {/each}
    </div>
  </nav>

  <div class="monetisation-hub__content">
    {@render children()}
  </div>
</div>

<style>
  .monetisation-hub {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .monetisation-hub__tabs {
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
  }

  .tabs-list {
    display: flex;
    gap: var(--space-4);
  }

  .tab-trigger {
    display: block;
    padding: var(--space-2) 0;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
    text-decoration: none;
    border-bottom: var(--border-width-thick) var(--border-style) transparent;
    margin-bottom: calc(-1 * var(--border-width));
    transition:
      color var(--duration-fast) var(--ease-default),
      border-color var(--duration-fast) var(--ease-default);
  }

  .tab-trigger:hover {
    color: var(--color-text);
  }

  .tab-trigger:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
    border-radius: var(--radius-sm);
  }

  .tab-trigger.loading {
    color: var(--color-text);
    border-bottom-color: var(--color-border-strong);
  }

  .tab-trigger.active {
    color: var(--color-interactive);
    border-bottom-color: var(--color-interactive);
  }

  .monetisation-hub__content {
    flex: 1;
    min-width: 0;
  }

  /* Mobile: stack tabs vertically */
  @media (--below-sm) {
    .tabs-list {
      flex-direction: column;
      gap: var(--space-1);
    }

    .tab-trigger {
      padding: var(--space-2) var(--space-3);
      border-bottom: none;
      border-radius: var(--radius-md);
      margin-bottom: 0;
    }

    .tab-trigger.active {
      background-color: var(--color-interactive-subtle);
      border-bottom-color: transparent;
    }

    .monetisation-hub__tabs {
      border-bottom: none;
    }
  }
</style>
