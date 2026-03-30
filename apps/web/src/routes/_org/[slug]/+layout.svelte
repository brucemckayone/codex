<script lang="ts">
  /**
   * Organization layout - for {slug}.revelations.studio routes
   * Wires OrgHeader component and injects org brand colors as CSS variables.
   * Hides org chrome (header/footer) when inside the studio, which has its own layout.
   *
   * Caching: mirrors the platform layout pattern — $effect watches data.versions
   * for staleness, visibilitychange re-runs the server load on tab return.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutData } from './$types';
  import OrgHeader from '$lib/components/layout/Header/OrgHeader.svelte';
  import { getStaleKeys, updateStoredVersions } from '$lib/client/version-manifest';
  import { invalidateCollection } from '$lib/collections';
  import * as m from '$paraglide/messages';

  interface Props {
    data: LayoutData;
    children: Snippet;
  }

  const { data, children }: Props = $props();

  // Studio routes have their own header/sidebar — hide the org chrome
  const isStudio = $derived(page.url.pathname.startsWith('/studio'));

  // Reactive staleness check — runs on mount AND whenever data.versions changes.
  // data.versions changes after invalidate('cache:org-versions') re-runs the server load.
  // Guard with `browser` since $effect runs during SSR in Svelte 5.
  $effect(() => {
    if (!browser) return;
    const staleKeys = getStaleKeys(data.versions ?? {});
    if (staleKeys.some((k) => k.includes(':content'))) {
      void invalidateCollection('content');
    }
    updateStoredVersions(data.versions ?? {});
  });

  onMount(() => {
    // Re-check KV versions on tab return — detects content published/unpublished
    // while this tab was hidden, or org settings changed on another device.
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void invalidate('cache:org-versions');
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  });
</script>

<div
  class="org-layout"
  style:--brand-primary={data.org?.brandColors?.primary}
  style:--brand-secondary={data.org?.brandColors?.secondary}
  style:--brand-accent={data.org?.brandColors?.accent}
>
  {#if !isStudio}
    <OrgHeader user={data.user} org={data.org} />
  {/if}

  <main id="main-content" class="org-main">
    {@render children()}
  </main>

  {#if !isStudio}
    <footer class="org-footer">
      <div class="footer-inner">
        <p class="powered-by">
          {m.footer_powered_by({ platform: m.footer_powered_by_platform() })}
        </p>
        <nav class="footer-links">
          <a href="/about">{m.footer_about()}</a>
          <a href="/terms">{m.footer_terms()}</a>
          <a href="/privacy">{m.footer_privacy()}</a>
        </nav>
        <p class="copyright">&copy; {new Date().getFullYear()} Codex. All rights reserved.</p>
      </div>
    </footer>
  {/if}
</div>

<style>
  .org-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
    color: var(--color-text);
  }

  .org-main {
    flex: 1;
  }

  .org-footer {
    border-top: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
    padding: var(--space-8) var(--space-4);
  }

  .footer-inner {
    max-width: var(--container-max);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    text-align: center;
  }

  @media (--breakpoint-md) {
    .footer-inner {
      flex-direction: row;
      justify-content: space-between;
      text-align: left;
    }
  }

  .powered-by {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
  }

  .footer-links {
    display: flex;
    gap: var(--space-4);
  }

  .footer-links a {
    font-size: var(--text-sm);
    color: var(--color-text-secondary);
    transition: var(--transition-colors);
  }

  .footer-links a:hover {
    color: var(--color-text);
  }

  .copyright {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }

  /* Dark mode support */
  :global([data-theme='dark']) .org-layout {
    background-color: var(--color-background);
    color: var(--color-text);
  }

  :global([data-theme='dark']) .org-footer {
    background-color: var(--color-surface);
    border-top-color: var(--color-border);
  }

  :global([data-theme='dark']) .footer-links a:hover {
    color: var(--color-text);
  }
</style>
