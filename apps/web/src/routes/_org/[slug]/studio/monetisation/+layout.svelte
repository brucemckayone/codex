<!--
  @component MonetisationLayout

  Tabbed hub for organization monetisation. Anchor-based triggers drive
  SvelteKit sub-routing (each tab is its own route), mirroring the settings
  layout pattern. Active tab is derived from the current URL pathname.

  Tabs:
  - Subscriptions  → /studio/monetisation            (Stripe Connect, tiers)
  - Revenue share  → /studio/monetisation/revenue-share (creator agreements)

  @prop {Snippet} children - Child route content
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { navigating, page } from '$app/state';
  import * as m from '$paraglide/messages';

  const { children }: { children: Snippet } = $props();

  const activeTab = $derived(
    page.url.pathname.endsWith('/revenue-share') ? 'revenue-share' : 'subscriptions'
  );

  const loadingTab = $derived(
    navigating?.to?.url.pathname?.endsWith('/revenue-share')
      ? 'revenue-share'
      : navigating?.to?.url.pathname?.endsWith('/monetisation')
        ? 'subscriptions'
        : null
  );

  const tabs = [
    {
      value: 'subscriptions',
      href: '/studio/monetisation',
      label: 'Subscriptions',
    },
    {
      value: 'revenue-share',
      href: '/studio/monetisation/revenue-share',
      label: 'Revenue share',
    },
  ];
</script>

<div class="monetisation-hub">
  <header class="monetisation-hub__header">
    <h1 class="page-title">{m.monetisation_title()}</h1>
  </header>

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
    max-width: 1200px;
  }

  .monetisation-hub__header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .page-title {
    font-family: var(--font-heading);
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--color-text);
    margin: 0;
    line-height: var(--leading-tight);
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
