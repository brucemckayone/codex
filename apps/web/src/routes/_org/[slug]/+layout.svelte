<script lang="ts">
  /**
   * Organization layout - for {slug}.revelations.studio routes
   * Wires OrgHeader component and injects org brand colors as CSS variables.
   * Hides org chrome (header/footer) when inside the studio, which has its own layout.
   *
   * Branding injection: sets `data-org-brand` attribute and `--org-brand-*` CSS
   * custom properties to override both legacy and modern design tokens. Uses
   * `color-mix(in oklch, ...)` to derive hover/active/subtle variants from base colors.
   *
   * Caching: mirrors the platform layout pattern — $effect watches data.versions
   * for staleness, visibilitychange re-runs the server load on tab return.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutData } from './$types';
  import { SidebarRail } from '$lib/components/layout/SidebarRail';
  import { MobileBottomNav, MobileBottomSheet } from '$lib/components/layout/MobileNav';
  import CommandPaletteSearch from '$lib/components/search/CommandPaletteSearch.svelte';
  import { ShaderHero } from '$lib/components/ui/ShaderHero';
  import { brandEditor, injectTokenOverrides, clearTokenOverrides } from '$lib/brand-editor';
  import type { BrandEditorState } from '$lib/brand-editor';
  import { getStaleKeys, updateStoredVersions } from '$lib/client/version-manifest';
  import { invalidateCollection, loadSubscriptionFromServer } from '$lib/collections';
  import { initProgressSync, cleanupProgressSync, forceSync } from '$lib/collections/progress-sync';
  import { followingStore } from '$lib/client/following.svelte';
  import { getFollowingStatus } from '$lib/remote/org.remote';
  import * as m from '$paraglide/messages';

  interface Props {
    data: LayoutData;
    children: Snippet;
  }

  const { data, children }: Props = $props();

  // Studio routes have their own header/sidebar — hide the org chrome
  const isStudio = $derived(page.url.pathname.startsWith('/studio'));
  // Landing page needs mix-blend-mode to reach the shader canvas,
  // which requires dropping view-transition-name (it creates isolation)
  const isLanding = $derived(page.url.pathname === '/');
  let searchOpen = $state(false);
  let moreOpen = $state(false);

  // ── Branding ─────────────────────────────────────────────────────
  // Raw inputs — the CSS file (org-brand.css) derives the full palette
  // from these via OKLCH relative color syntax.
  const brandPrimary = $derived(data.org?.brandColors?.primary ?? undefined);
  const brandSecondary = $derived(data.org?.brandColors?.secondary ?? undefined);
  const brandAccent = $derived(data.org?.brandColors?.accent ?? undefined);
  const brandBackground = $derived(data.org?.brandColors?.background ?? undefined);
  const brandFontBody = $derived(data.org?.brandFonts?.body ?? undefined);
  const brandFontHeading = $derived(data.org?.brandFonts?.heading ?? undefined);
  const brandRadius = $derived.by(() => {
    const v = Number(data.org?.brandRadius);
    return Number.isFinite(v) ? `${v}rem` : undefined;
  });
  const brandDensity = $derived.by(() => {
    const v = Number(data.org?.brandDensity);
    return Number.isFinite(v) ? String(v) : undefined;
  });
  const brandLogoUrl = $derived(
    brandEditor.isOpen
      ? (brandEditor.pending?.logoUrl ?? data.org?.logoUrl ?? undefined)
      : (data.org?.logoUrl ?? undefined)
  );
  const hasBranding = $derived(!!brandPrimary);

  // Hero element visibility — reads from brand editor when open, server tokenOverrides otherwise.
  // Stored as tokenOverrides keys: 'hero-hide-stats', 'hero-hide-pills', etc.
  const heroHideFlags = $derived.by(() => {
    const overrides = brandEditor.isOpen
      ? (brandEditor.pending?.tokenOverrides ?? {})
      : (() => {
          const raw = data.org?.brandFineTune?.tokenOverrides;
          if (!raw) return {};
          try { return JSON.parse(raw) as Record<string, string | null>; } catch { return {}; }
        })();
    return {
      stats: overrides['hero-hide-stats'] === '1',
      pills: overrides['hero-hide-pills'] === '1',
      description: overrides['hero-hide-description'] === '1',
      logo: overrides['hero-hide-logo'] === '1',
      title: overrides['hero-hide-title'] === '1',
    };
  });

  // Fine-tune branding fields — injected as CSS vars alongside core branding
  const brandShadowScale = $derived(data.org?.brandFineTune?.shadowScale ?? undefined);
  const brandShadowColor = $derived(data.org?.brandFineTune?.shadowColor ?? undefined);
  const brandTextScale = $derived(data.org?.brandFineTune?.textScale ?? undefined);
  const brandHeadingWeight = $derived(data.org?.brandFineTune?.headingWeight ?? undefined);
  const brandBodyWeight = $derived(data.org?.brandFineTune?.bodyWeight ?? undefined);

  // Token overrides from server — includes shader-* keys, color overrides, etc.
  // Parsed from the JSON string stored in branding_settings.tokenOverrides.
  // These are injected as CSS vars via $effect so ShaderHero (and other consumers)
  // can read them via getComputedStyle on initial page load.
  const serverTokenOverrides = $derived.by(() => {
    const raw = data.org?.brandFineTune?.tokenOverrides;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, string | null>;
      return Object.keys(parsed).length > 0 ? parsed : null;
    } catch {
      return null;
    }
  });

  // Inject token overrides as CSS custom properties on the org layout element.
  // Runs on mount and whenever serverTokenOverrides changes (e.g. after branding save).
  // Skipped when brand editor is open — the editor's live injectBrandVars handles it.
  $effect(() => {
    if (!browser) return;
    const overrides = serverTokenOverrides;
    const editorOpen = !brandEditor.isClosed;

    const el = document.querySelector('.org-layout') as HTMLElement | null;
    if (!el) return;

    if (editorOpen) return; // Brand editor manages its own CSS injection

    if (overrides) {
      clearTokenOverrides(el);
      injectTokenOverrides(el, overrides);
    } else {
      clearTokenOverrides(el);
    }
  });

  // Build Google Fonts URL from selected font families
  const googleFontsUrl = $derived.by(() => {
    const families = [...new Set([brandFontBody, brandFontHeading].filter(Boolean))] as string[];
    if (families.length === 0) return undefined;
    const params = families
      .map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`)
      .join('&');
    return `https://fonts.googleapis.com/css2?${params}&display=swap`;
  });

  // Google Fonts stylesheet is loaded directly in <svelte:head> below.
  // display=swap in the URL ensures text renders immediately with fallback fonts.

  // Reactive staleness check — runs on mount AND whenever data.versions changes.
  // data.versions is streamed (a Promise) so we resolve it before checking.
  // Guard with `browser` since $effect runs during SSR in Svelte 5.
  $effect(() => {
    if (!browser) return;
    // Track data.versions as reactive dependency (promise reference changes on invalidation)
    const versionsRef = data.versions;
    void Promise.resolve(versionsRef).then((versions) => {
      const staleKeys = getStaleKeys(versions ?? {});
      if (staleKeys.some((k) => k.includes(':content'))) {
        void invalidateCollection('content');
      }
      if (staleKeys.some((k) => k.includes(':library'))) {
        void invalidateCollection('library');
      }
      if (staleKeys.some((k) => k.includes(':subscription'))) {
        void loadSubscriptionFromServer(data.org.id);
      }
      updateStoredVersions(versions ?? {});
    });
  });

  // Sync org background to html element so scrollbar gutter area matches.
  // Without this, the scrollbar track shows the root light background on dark org brands.
  // Tracks brandBackground (from server data) and brandEditor.pending?.backgroundColor
  // (live editor changes) so it re-runs when either changes.
  $effect(() => {
    if (!browser) return;
    // Track reactive deps: server brand bg + editor pending bg
    const serverBg = brandBackground;
    const editorBg = brandEditor.pending?.backgroundColor;
    // Read the actual computed color after CSS derivation
    const layout = document.querySelector('.org-layout');
    if (!layout) return;
    // Use requestAnimationFrame to ensure CSS has been applied
    const raf = requestAnimationFrame(() => {
      const bg = getComputedStyle(layout).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)') {
        document.documentElement.style.backgroundColor = bg;
      }
    });
    // Suppress unused var warnings — these are tracked for reactivity
    void serverBg;
    void editorBg;
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.style.removeProperty('background-color');
    };
  });

  onMount(() => {
    // Re-check KV versions on tab return — detects content published/unpublished
    // while this tab was hidden, or org settings changed on another device.
    // Throttled to avoid hammering the server on rapid tab switches.
    let lastVersionCheck = 0;
    const VERSION_CHECK_COOLDOWN_MS = 60_000; // 60 seconds

    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        if (now - lastVersionCheck < VERSION_CHECK_COOLDOWN_MS) return;
        lastVersionCheck = now;
        void invalidate('cache:org-versions');
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    // Periodic version check — catches staleness during long browsing sessions
    // where visibilitychange never fires (user stays on tab for 20+ min).
    // Cheap: 3-4 parallel KV reads (~10ms). Only polls when tab is visible.
    const VERSION_POLL_INTERVAL_MS = 5 * 60 * 1000;
    const versionPollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void invalidate('cache:org-versions');
      }
    }, VERSION_POLL_INTERVAL_MS);

    // Fetch following status client-side and hydrate the store — but
    // only when we don't already have a value cached in localStorage.
    // This saves a network request on every return visit. Cross-device
    // "followed on another device" drift is accepted as a trade-off;
    // the store is optimistically-updated on every click so discrepancy
    // only persists until the next click or manual unfollow/follow.
    if (data.user && !followingStore.has(data.org.id)) {
      getFollowingStatus(data.org.id)
        .then((following) => { followingStore.hydrate(data.org.id, following); })
        .catch(() => { /* Graceful — store keeps localStorage value or defaults to false */ });
    }

    // Hydrate subscription collection from server on first visit.
    // Populates localStorage with full subscription details so subsequent
    // navigations get zero-latency reads from the collection.
    if (data.user) {
      void loadSubscriptionFromServer(data.org.id);
    }

    // Activate progress sync on org subdomain — content is watched here,
    // so the 30s flush, visibility handler, and beforeunload beacon are needed.
    if (data.user?.id) {
      initProgressSync(data.user.id);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(versionPollInterval);
      cleanupProgressSync();
    };
  });

  // ── Brand Editor ────────────────────────────────────────────────────
  const showBrandEditor = $derived(page.url.searchParams.has('brandEditor'));

  // Open/close the editor based on URL param
  $effect(() => {
    if (!browser) return;
    if (showBrandEditor && brandEditor.isClosed && data.org) {
      // Reconstruct saved tokenOverrides from fine-tune fields
      const ft = data.org.brandFineTune;
      const savedOverrides: Record<string, string> = {};
      if (ft?.tokenOverrides) {
        try { Object.assign(savedOverrides, JSON.parse(ft.tokenOverrides)); } catch { /* ignore parse errors */ }
      }
      // Also populate from individual fields (they may exist even without tokenOverrides JSON)
      if (ft?.shadowScale) savedOverrides['shadow-scale'] = ft.shadowScale;
      if (ft?.shadowColor) savedOverrides['shadow-color'] = ft.shadowColor;
      if (ft?.textScale) savedOverrides['text-scale'] = ft.textScale;
      if (ft?.headingWeight) savedOverrides['heading-weight'] = ft.headingWeight;
      if (ft?.bodyWeight) savedOverrides['body-weight'] = ft.bodyWeight;

      // Parse saved dark mode overrides
      let savedDarkOverrides = null;
      if (ft?.darkModeOverrides) {
        try { savedDarkOverrides = JSON.parse(ft.darkModeOverrides); } catch { /* ignore */ }
      }

      const saved: BrandEditorState = {
        primaryColor: brandPrimary ?? '#C24129',
        secondaryColor: brandSecondary ?? null,
        accentColor: brandAccent ?? null,
        backgroundColor: brandBackground ?? null,
        fontBody: data.org.brandFonts?.body ?? null,
        fontHeading: data.org.brandFonts?.heading ?? null,
        radius: Number(data.org.brandRadius) || 0.5,
        density: Number(data.org.brandDensity) || 1,
        logoUrl: data.org.logoUrl ?? null,
        tokenOverrides: Object.keys(savedOverrides).length > 0 ? savedOverrides : {},
        darkOverrides: savedDarkOverrides,
        heroLayout: data.org?.heroLayout ?? 'default',
      };
      brandEditor.open(data.org.id, saved);
    }
  });

  // beforeunload when dirty
  $effect(() => {
    if (!browser) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (brandEditor.isDirty) {
        e.preventDefault();
      }
    }
    if (brandEditor.isDirty) {
      window.addEventListener('beforeunload', onBeforeUnload);
      return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }
  });

  // Dynamically load the brand editor module only when the editor is
  // activated (URL param or store state). Keeps ~23 components and the
  // branding remote off the critical path for normal org visitors.
  type BrandEditorMountComponent =
    typeof import('$lib/components/brand-editor/BrandEditorMount.svelte').default;
  let BrandEditorMount = $state<BrandEditorMountComponent | null>(null);
  const shouldLoadBrandEditor = $derived(
    browser && (showBrandEditor || !brandEditor.isClosed)
  );

  $effect(() => {
    if (shouldLoadBrandEditor && !BrandEditorMount) {
      void import('$lib/components/brand-editor/BrandEditorMount.svelte').then(
        (mod) => { BrandEditorMount = mod.default; }
      );
    }
  });

  // SvelteKit navigation guard — flush progress + brand editor dirty check
  beforeNavigate(({ cancel }) => {
    // Flush unsynced playback progress so server loads see it immediately
    void forceSync();

    if (brandEditor.isDirty && !brandEditor.isClosed) {
      if (!confirm('You have unsaved brand changes. Discard?')) {
        cancel();
      }
    }
  });
</script>

<svelte:head>
  {#if googleFontsUrl}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
    <link rel="stylesheet" href={googleFontsUrl} />
  {/if}
</svelte:head>

<div
  class="org-layout"
  class:org-layout--studio={isStudio}
  class:org-layout--landing={isLanding}
  data-org-brand={hasBranding ? '' : undefined}
  data-org-bg={brandBackground ? '' : undefined}
  data-hero-layout={brandEditor.isOpen
    ? (brandEditor.pending?.heroLayout ?? 'default')
    : (data.org?.heroLayout ?? 'default')}
  data-hero-hide-stats={heroHideFlags.stats ? '' : undefined}
  data-hero-hide-pills={heroHideFlags.pills ? '' : undefined}
  data-hero-hide-description={heroHideFlags.description ? '' : undefined}
  data-hero-hide-logo={heroHideFlags.logo ? '' : undefined}
  data-hero-hide-title={heroHideFlags.title ? '' : undefined}
  style:--brand-color={brandPrimary}
  style:--brand-secondary={brandSecondary}
  style:--brand-accent={brandAccent}
  style:--brand-bg={brandBackground}
  style:--brand-density={brandDensity}
  style:--brand-radius={brandRadius}
  style:--brand-font-body={brandFontBody ? `'${brandFontBody}', var(--font-sans)` : undefined}
  style:--brand-font-heading={brandFontHeading ? `'${brandFontHeading}', var(--font-sans)` : undefined}
  style:--brand-shadow-scale={brandShadowScale}
  style:--brand-shadow-color={brandShadowColor}
  style:--brand-text-scale={brandTextScale}
  style:--brand-heading-weight={brandHeadingWeight}
  style:--brand-body-weight={brandBodyWeight}
  style:--brand-shader-logo-url={brandLogoUrl}
>
  <ShaderHero class="shader-hero--fullpage" />
  <div class="shader-blur-overlay" class:shader-blur-overlay--landing={isLanding}></div>
  {#if !isStudio}
    <SidebarRail variant="org" user={data.user} org={data.org} onSearchClick={() => { searchOpen = true; }} />
  {/if}

  <main id="main-content" class="org-main" class:org-main--studio={isStudio} class:org-main--blendable={isLanding} class:org-main--landing={isLanding}>
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

  {#if !isStudio}
    <MobileBottomNav
      variant="org"
      user={data.user}
      org={data.org}
      onSearchClick={() => { searchOpen = true; }}
      onMoreClick={() => { moreOpen = true; }}
    />
    <MobileBottomSheet bind:open={moreOpen} variant="org" user={data.user} org={data.org} />
    <CommandPaletteSearch scope="org" orgSlug={data.org.slug} bind:open={searchOpen} />
  {/if}
</div>

<!-- Brand Editor — dynamically imported, rendered OUTSIDE .org-layout so it uses system tokens -->
{#if BrandEditorMount}
  <BrandEditorMount />
{/if}

<style>
  .org-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
    color: var(--color-text);
  }

  .org-layout--studio {
    background-color: transparent;
  }

  /* Non-landing pages: blur the shader canvas directly via CSS filter.
     backdrop-filter doesn't reliably composite against WebGL canvases
     when view-transition-name creates a stacking context on org-main. */
  .org-layout:not(.org-layout--landing) :global(.shader-hero--fullpage) {
    filter: blur(var(--blur-2xl));
  }

  /* Landing page: backdrop-filter overlay with gradient mask.
     Works here because org-main--blendable removes view-transition-name,
     placing content in normal flow (step 3) below the overlay (step 6). */
  .shader-blur-overlay {
    display: none;
  }

  /* Landing page: blur is now handled by .content-area's own
     backdrop-filter in +page.svelte — no fixed overlay needed.
     The content area blurs the fixed shader behind it as it scrolls. */
  .shader-blur-overlay--landing {
    display: none;
  }

  /* Full-page shader background — fixed behind all content */
  :global(.shader-hero--fullpage) {
    position: fixed !important;
    inset: 0 !important;
    z-index: 0 !important;
    pointer-events: none !important;
  }

  :global(.shader-hero--fullpage canvas) {
    pointer-events: auto;
  }


  .org-main {
    flex: 1;
    margin-left: var(--space-16);
    view-transition-name: page-content;
    background: color-mix(in srgb, var(--color-background) 80%, transparent);
  }

  .org-main--studio {
    margin-left: 0;
  }

  /* Landing page: drop view-transition-name + allow blend-mode to reach shader.
     view-transition-name creates an isolated stacking context that blocks
     mix-blend-mode from compositing against the shader canvas. */
  .org-main--blendable {
    view-transition-name: none;
    background: transparent;
  }


  @media (--below-md) {
    .org-main {
      margin-left: 0;
      padding-bottom: var(--space-20);
    }

    .org-main--studio {
      padding-bottom: 0;
    }
  }

  .org-footer {
    position: relative;
    border-top: var(--border-width) var(--border-style) var(--color-border);
    background: color-mix(in srgb, var(--color-surface) 60%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: var(--space-8) var(--space-4);
    margin-left: var(--space-16);
  }

  @media (--below-md) {
    .org-footer {
      margin-left: 0;
    }
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
    color: var(--color-text-tertiary);
  }

  .footer-links {
    display: flex;
    gap: var(--space-4);
  }

  .footer-links a {
    font-size: var(--text-sm);
    color: var(--color-text-tertiary);
    transition: var(--transition-colors);
  }

  .footer-links a:hover {
    color: var(--color-text);
  }

  .copyright {
    font-size: var(--text-xs);
    color: var(--color-text-tertiary);
  }
</style>
