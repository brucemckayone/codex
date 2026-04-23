<script lang="ts">
  /**
   * Root layout - thin shell providing global styles, view transitions, and user context.
   * Each route group (platform, org, creators) owns its own header/footer chrome.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { afterNavigate, invalidate, onNavigate } from '$app/navigation';
  import { NavigationProgress, SkipLink, Toaster } from '$lib/components/ui';
  import {
    decideAuthRevalidation,
    type VisibilityState,
  } from '$lib/auth/session-visibility-sync';
  import { shouldScrollToTopOnNav } from '$lib/auth/scroll-reset-on-nav';
  import type { LayoutData } from './$types';
  import '../lib/styles/global.css';

  const SESSION_COOKIE = 'codex-session';
  const AUTH_RECHECK_COOLDOWN_MS = 60_000;

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  // ── Cross-subdomain + cross-device auth sync ──────────────────────────
  // Decision logic lives in $lib/auth/session-visibility-sync (unit-tested
  // pure function). This handler adapts it to the DOM.
  onMount(() => {
    function hasCookie(): boolean {
      return document.cookie.split(';').some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
    }

    let lastHadCookie = hasCookie();
    let lastRecheckMs = 0;

    function handleVisibility() {
      const nowHasCookie = hasCookie();
      const decision = decideAuthRevalidation({
        visibilityState: document.visibilityState as VisibilityState,
        nowHasCookie,
        lastHadCookie,
        hasUser: Boolean(data.user),
        nowMs: Date.now(),
        lastRecheckMs,
        cooldownMs: AUTH_RECHECK_COOLDOWN_MS,
      });

      if (decision.action === 'invalidate') {
        lastHadCookie = nowHasCookie;
        lastRecheckMs = Date.now();
        void invalidate('app:auth');
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  });

  // ── Scroll-to-top guard ──────────────────────────────────────────
  // SvelteKit's default scroll handling is visually masked by the named
  // 'page-content' view transition. Decision logic lives in
  // $lib/auth/scroll-reset-on-nav (unit-tested pure function).
  afterNavigate((navigation) => {
    const reset = shouldScrollToTopOnNav({
      type: navigation.type,
      fromPathname: navigation.from?.url.pathname,
      toPathname: navigation.to?.url.pathname,
      toHash: navigation.to?.url.hash,
    });
    if (reset) requestAnimationFrame(() => window.scrollTo(0, 0));
  });

  onNavigate((navigation) => {
    if (!navigation.to) return;
    if (!document.startViewTransition) return;

    // Skip view transition for same-path navigations (query/hash changes)
    if (navigation.from?.url.pathname === navigation.to.url.pathname) return;

    return new Promise((resolve) => {
      try {
        const transition = document.startViewTransition(async () => {
          resolve();
          await navigation.complete;
        });

        // Safety valve: skip the visual transition if DOM update takes too long.
        // skipTransition() completes the transition instantly (no animation),
        // ensuring the DOM always updates without waiting for Chrome's 4s timeout.
        const safety = setTimeout(() => transition.skipTransition(), 800);
        transition.finished
          .finally(() => clearTimeout(safety))
          .catch(() => {});
      } catch {
        // startViewTransition throws DOMException if a transition is already active.
        // Resolve immediately so SvelteKit proceeds with navigation.
        resolve();
      }
    });
  });

</script>

<svelte:head>
  <meta name="description" content="Discover transformative content from independent creators" />
  <meta property="og:site_name" content="Revelations" />
  <meta property="og:type" content="website" />
  <link rel="manifest" href="/manifest.json" />
</svelte:head>

<SkipLink />

<NavigationProgress />

{@render children()}

<Toaster />

