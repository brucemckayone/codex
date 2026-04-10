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
  import { beforeNavigate, goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutData } from './$types';
  import { SidebarRail } from '$lib/components/layout/SidebarRail';
  import { MobileBottomNav, MobileBottomSheet } from '$lib/components/layout/MobileNav';
  import CommandPaletteSearch from '$lib/components/search/CommandPaletteSearch.svelte';
  import BrandEditorPanel from '$lib/components/brand-editor/BrandEditorPanel.svelte';
  import BrandEditorHeader from '$lib/components/brand-editor/BrandEditorHeader.svelte';
  import BrandEditorFooter from '$lib/components/brand-editor/BrandEditorFooter.svelte';
  import BrandEditorHome from '$lib/components/brand-editor/levels/BrandEditorHome.svelte';
  import BrandEditorColors from '$lib/components/brand-editor/levels/BrandEditorColors.svelte';
  import BrandEditorTypography from '$lib/components/brand-editor/levels/BrandEditorTypography.svelte';
  import BrandEditorShape from '$lib/components/brand-editor/levels/BrandEditorShape.svelte';
  import BrandEditorShadows from '$lib/components/brand-editor/levels/BrandEditorShadows.svelte';
  import BrandEditorLogo from '$lib/components/brand-editor/levels/BrandEditorLogo.svelte';
  import BrandEditorFineTuneColors from '$lib/components/brand-editor/levels/BrandEditorFineTuneColors.svelte';
  import BrandEditorFineTuneTypography from '$lib/components/brand-editor/levels/BrandEditorFineTuneTypography.svelte';
  import BrandEditorPresets from '$lib/components/brand-editor/levels/BrandEditorPresets.svelte';
  import BrandEditorHeroEffects from '$lib/components/brand-editor/levels/BrandEditorHeroEffects.svelte';
  import { ShaderHero } from '$lib/components/ui/ShaderHero';
  import { brandEditor, injectTokenOverrides, clearTokenOverrides } from '$lib/brand-editor';
  import type { BrandEditorState } from '$lib/brand-editor';
  import { updateBrandingCommand } from '$lib/remote/branding.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import { getStaleKeys, updateStoredVersions } from '$lib/client/version-manifest';
  import { invalidateCollection } from '$lib/collections';
  import { initProgressSync, cleanupProgressSync, forceSync } from '$lib/collections/progress-sync';
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
  const hasBranding = $derived(!!brandPrimary);

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

  // Reactive staleness check — runs on mount AND whenever data.versions changes.
  // data.versions changes after invalidate('cache:org-versions') re-runs the server load.
  // Guard with `browser` since $effect runs during SSR in Svelte 5.
  $effect(() => {
    if (!browser) return;
    const staleKeys = getStaleKeys(data.versions ?? {});
    if (staleKeys.some((k) => k.includes(':content'))) {
      void invalidateCollection('content');
    }
    if (staleKeys.some((k) => k.includes(':library'))) {
      void invalidateCollection('library');
    }
    updateStoredVersions(data.versions ?? {});
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
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void invalidate('cache:org-versions');
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    // Activate progress sync on org subdomain — content is watched here,
    // so the 30s flush, visibility handler, and beforeunload beacon are needed.
    if (data.user?.id) {
      initProgressSync(data.user.id);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
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
      };
      brandEditor.open(data.org.id, saved);
    }
  });

  // Strip URL param when editor closes
  function handleEditorClose() {
    if (brandEditor.isDirty) {
      if (!confirm('You have unsaved brand changes. Discard?')) return;
      brandEditor.discard();
    }
    brandEditor.close();
    const url = new URL(page.url);
    url.searchParams.delete('brandEditor');
    goto(url.pathname + url.search, { replaceState: true });
  }

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

  // Save handler
  let saving = $state(false);

  async function handleSave() {
    const payload = brandEditor.getSavePayload();
    if (!payload || !brandEditor.orgId) return;

    saving = true;
    try {
      const overrides = payload.tokenOverrides ?? {};
      const hasOverrides = Object.keys(overrides).length > 0;

      await updateBrandingCommand({
        orgId: brandEditor.orgId,
        primaryColorHex: payload.primaryColor,
        secondaryColorHex: payload.secondaryColor ?? '',
        accentColorHex: payload.accentColor ?? '',
        backgroundColorHex: payload.backgroundColor ?? '',
        fontBody: payload.fontBody ?? '',
        fontHeading: payload.fontHeading ?? '',
        radiusValue: payload.radius,
        densityValue: payload.density,
        tokenOverrides: hasOverrides ? JSON.stringify(overrides) : '',
        textColorHex: overrides['text'] ?? '',
        shadowScale: overrides['shadow-scale'] ?? '',
        shadowColor: overrides['shadow-color'] ?? '',
        textScale: overrides['text-scale'] ?? '',
        headingWeight: overrides['heading-weight'] ?? '',
        bodyWeight: overrides['body-weight'] ?? '',
        darkModeOverrides: payload.darkOverrides ? JSON.stringify(payload.darkOverrides) : '',
      });
      brandEditor.markSaved();
      toast.success('Brand settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save brand settings');
    } finally {
      saving = false;
    }
  }

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
  data-org-brand={hasBranding ? '' : undefined}
  data-org-bg={brandBackground ? '' : undefined}
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
>
  <ShaderHero class="shader-hero--fullpage" />
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

<!-- Brand Editor Panel — rendered OUTSIDE .org-layout so it uses system tokens -->
<BrandEditorPanel onsave={handleSave} {saving}>
  {#snippet header()}
    <BrandEditorHeader onclose={handleEditorClose} />
  {/snippet}

  {#if brandEditor.level === 'home'}
    <BrandEditorHome />
  {:else if brandEditor.level === 'colors'}
    <BrandEditorColors />
  {:else if brandEditor.level === 'typography'}
    <BrandEditorTypography />
  {:else if brandEditor.level === 'shape'}
    <BrandEditorShape />
  {:else if brandEditor.level === 'shadows'}
    <BrandEditorShadows />
  {:else if brandEditor.level === 'logo'}
    <BrandEditorLogo />
  {:else if brandEditor.level === 'presets'}
    <BrandEditorPresets />
  {:else if brandEditor.level === 'hero-effects'}
    <BrandEditorHeroEffects />
  {:else if brandEditor.level === 'fine-tune-colors'}
    <BrandEditorFineTuneColors />
  {:else if brandEditor.level === 'fine-tune-typography'}
    <BrandEditorFineTuneTypography />
  {/if}

  {#snippet footer()}
    <BrandEditorFooter onsave={handleSave} {saving} />
  {/snippet}
</BrandEditorPanel>

<style>
  .org-layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
    color: var(--color-text);
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
  }

  .org-main--studio {
    margin-left: 0;
  }

  /* Landing page: drop view-transition-name + allow blend-mode to reach shader.
     view-transition-name creates an isolated stacking context that blocks
     mix-blend-mode from compositing against the shader canvas. */
  .org-main--blendable {
    view-transition-name: none;
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
</style>
