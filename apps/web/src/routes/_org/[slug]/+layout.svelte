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
  import OrgHeader from '$lib/components/layout/Header/OrgHeader.svelte';
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
  import { brandEditor } from '$lib/brand-editor';
  import type { BrandEditorState } from '$lib/brand-editor';
  import { updateBrandingCommand } from '$lib/remote/branding.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
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

  // ── Brand Editor ────────────────────────────────────────────────────
  const showBrandEditor = $derived(page.url.searchParams.has('brandEditor'));

  // Open/close the editor based on URL param
  $effect(() => {
    if (!browser) return;
    if (showBrandEditor && brandEditor.isClosed && data.org) {
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
        tokenOverrides: {},
        darkOverrides: data.org.darkModeOverrides ?? null,
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
        secondaryColorHex: payload.secondaryColor,
        accentColorHex: payload.accentColor,
        backgroundColorHex: payload.backgroundColor,
        fontBody: payload.fontBody,
        fontHeading: payload.fontHeading,
        radiusValue: payload.radius,
        densityValue: payload.density,
        tokenOverrides: hasOverrides ? JSON.stringify(overrides) : null,
        textColorHex: overrides['text'] ?? null,
        shadowScale: overrides['shadow-scale'] ?? null,
        shadowColor: overrides['shadow-color'] ?? null,
        textScale: overrides['text-scale'] ?? null,
        headingWeight: overrides['heading-weight'] ?? null,
        bodyWeight: overrides['body-weight'] ?? null,
        darkModeOverrides: payload.darkOverrides ? JSON.stringify(payload.darkOverrides) : null,
      });
      brandEditor.markSaved();
      toast.success('Brand settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save brand settings');
    } finally {
      saving = false;
    }
  }

  // SvelteKit navigation guard
  beforeNavigate(({ cancel }) => {
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

<!-- Brand Editor Panel — rendered OUTSIDE .org-layout so it uses system tokens -->
<BrandEditorPanel>
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
</style>
