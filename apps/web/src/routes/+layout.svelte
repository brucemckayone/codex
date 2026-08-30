<script lang="ts">
  /**
   * Root layout - thin shell providing global styles, view transitions, and user context.
   * Each route group (platform, org, creators) owns its own header/footer chrome.
   */
  // MUST be the first runtime import — silences a CSP violation Zod 4
  // would otherwise emit on first object-schema parse. See zod-init.ts.
  import '$lib/zod-init';
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { afterNavigate, invalidate, onNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { NavigationProgress, SkipLink, Toaster } from '$lib/components/ui';
  import {
    decideAuthRevalidation,
    type VisibilityState,
  } from '$lib/auth/session-visibility-sync';
  import { shouldScrollToTopOnNav } from '$lib/auth/scroll-reset-on-nav';
  import { reconcileStateOwner } from '$lib/client/user-scoped-state';
  import type { LayoutData } from './$types';
  import '../lib/styles/global.css';

  const SESSION_COOKIE = 'codex-session';
  const AUTH_RECHECK_COOLDOWN_MS = 60_000;

  const { data, children }: { data: LayoutData; children: Snippet } = $props();

  // ── Head tags this layout OWNS, rendered from page data (O32) ───────────────
  /**
   * `<meta name="description">` and `og:type` were emitted below as fixed
   * literals, on every page. `<svelte:head>` dedupes only `<title>`, so a page
   * that set its own did not override this one — it APPENDED, and the layout's
   * tag came first. Measured on a journey sell page, in document order:
   *
   *     meta[property="og:type"]  ["website", "product"]
   *     meta[name="description"]  ["Discover transformative content from
   *                                 independent creators", "<the course lede>"]
   *
   * A parser takes the FIRST value of a repeated Open Graph property, so the
   * page's `og:type="product"` was dead on arrival, and the search snippet of
   * every page with real copy was shadowed by the platform tagline.
   *
   * The fix is for this layout to keep emitting exactly ONE of each and take the
   * value from the page: a load publishes `pageMeta`, and the literals below are
   * only the fallback for a route that publishes none. So a page overrides
   * instead of duplicating — and a page that says nothing is unchanged.
   *
   * MIGRATION STATE, stated plainly rather than implied: only the journey sell
   * page publishes `pageMeta` today. Every other surface still emits its own
   * `<meta name="description">` inline and therefore still duplicates, exactly as
   * it did before this change. That is deliberate — those files belong to other
   * work — and it is the safe direction: no page can end up with NO description,
   * because the fallback here is unconditional. Migrating one is two moves:
   * return `pageMeta` from its load, delete the inline tag from its markup.
   * Remaining: ContentDetailView, the org landing/explore/creators/pricing pages,
   * the four `(platform)` pages and `_creators/[username]`.
   */
  interface PageMeta {
    /** The page's own meta description. Empty/absent → the platform default. */
    description?: string;
    /** The page's Open Graph vertical (`product`, `article`, `video.other`, …). */
    ogType?: string;
  }

  const PLATFORM_DESCRIPTION =
    'Discover transformative content from independent creators';

  // `App.PageData` declares only `user` (`src/app.d.ts`), and widening it is not
  // this file's to do, so the convention is read through a narrow local cast —
  // a named shape, never `any`. `page.data` is the MERGED data of every load for
  // the current route, so a page-level load's `pageMeta` is visible here.
  const pageMeta = $derived(
    (page.data as { pageMeta?: PageMeta } | undefined)?.pageMeta
  );
  const metaDescription = $derived(
    pageMeta?.description || PLATFORM_DESCRIPTION
  );
  const ogType = $derived(pageMeta?.ogType || 'website');

  // ── Identity-change guard (Codex-1g5lh.17) ────────────────────────────
  // Persisted client state (`codex-following`, `codex-library`,
  // `codex-playback-progress`, …) lives under GLOBAL storage keys with no user
  // id, so without this the next user to sign in on this browser reads the
  // previous user's data. `reconcileStateOwner` compares the authenticated
  // user against the owner marker recorded on THIS origin and wipes the
  // user-scoped stores on a mismatch.
  //
  // Called here, in the root layout, for two reasons:
  //   1. It is the only component that renders on EVERY origin — platform,
  //      `{slug}.<base-domain>`, and `creators.<base-domain>`. localStorage is
  //      partitioned per origin, so a guard on any one origin cannot fix the
  //      others; this one runs wherever the user actually lands.
  //   2. It is called SYNCHRONOUSLY in the script body, not in `onMount`.
  //      Svelte runs child `onMount` callbacks before the parent's, so an
  //      `onMount` here would fire AFTER `_org/[slug]/+layout.svelte` has
  //      already consulted `followingStore.has()` to decide whether to
  //      hydrate from the server — and a stale `true` there suppresses the
  //      very fetch that would correct it. Init order puts the wipe ahead of
  //      every descendant's init and every `onMount` in the tree.
  //
  // Reading `data` at init is the POINT here — the whole job is to act on the
  // identity this document was loaded with, before anything reads the stores.
  // Later changes are picked up by the `$effect` below.
  // svelte-ignore state_referenced_locally
  reconcileStateOwner(data.user?.id);

  // A client-side navigation can change identity with no new document —
  // `invalidate('app:auth')` below, or login's `use:enhance` → `update()` →
  // `invalidateAll()`, both re-run the root load and swap `data.user` in
  // place. `$effect` catches those; the synchronous call above already
  // handled the first render, so this is a no-op until the id actually moves.
  // Plain `let`, deliberately NOT `$state`: it is a snapshot of what we last
  // reconciled, and making it reactive would put it in the effect's own
  // dependency set — the effect would re-run once on every write for nothing.
  // svelte-ignore state_referenced_locally
  let reconciledUserId: string | null | undefined = data.user?.id;
  $effect(() => {
    const currentUserId = data.user?.id;
    if (currentUserId === reconciledUserId) return;
    reconciledUserId = currentUserId;
    reconcileStateOwner(currentUserId);
  });

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
    // Defensive optional chains on `.url` — TS types claim it's non-null but
    // first-load / HMR edge cases hit this code with `from.url`/`to.url` null.
    const reset = shouldScrollToTopOnNav({
      type: navigation.type,
      fromPathname: navigation.from?.url?.pathname,
      toPathname: navigation.to?.url?.pathname,
      toHash: navigation.to?.url?.hash,
    });
    if (reset) requestAnimationFrame(() => window.scrollTo(0, 0));
  });

  onNavigate((navigation) => {
    if (!navigation.to) return;
    if (!document.startViewTransition) return;

    // Skip view transition for same-path navigations (query/hash changes)
    if (navigation.from?.url?.pathname === navigation.to.url?.pathname) return;

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
  <!--
    ONE of each, from the page's own data — see `pageMeta` above for the
    duplication this replaces. `og:site_name` stays a literal: it names the
    platform, not the page, so no page has cause to override it.
  -->
  <meta name="description" content={metaDescription} />
  <meta property="og:site_name" content="Revelations" />
  <meta property="og:type" content={ogType} />
  <link rel="manifest" href="/manifest.json" />
</svelte:head>

<SkipLink />

<NavigationProgress />

{@render children()}

<Toaster />

