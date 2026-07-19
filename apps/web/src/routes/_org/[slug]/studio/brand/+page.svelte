<!--
  @component BrandStudio (route shell + state spine)

  The unified brand editor lives here: a two-pane workspace — control rail +
  live-preview canvas — replacing the retired floating `?brandEditor` overlay
  and the old settings/branding page.

  WP-1.1 delivers the SHELL and the STATE SPINE only:
    - Loads current branding via the same remote the old page used
      (getBrandingSettings) and OWNS the brand-editor store:
      open() on mount → edit via store → Save (updateBrandingCommand +
      markSaved) → close() on destroy.
    - Renders BrandStudioLayout with placeholder rail + canvas.

  Later WPs fill the panes (see BrandStudioRail / BrandStudioCanvas TODOs):
    WP-1.3 iframe canvas · WP-1.4 postMessage bridge · WP-1.5 rich rail ·
    WP-1.6 logo + hero-text in rail · WP-1.7 Guided mode.

  Admin/owner gate lives in +page.server.ts. Epic: Codex-cijzb · WP-1.1.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import type { HeroLayout } from '@codex/validation';
  import type { BrandingSettingsResponse } from '@codex/shared-types';
  import { brandEditor, createBrandPreviewSender } from '$lib/brand-editor';
  import type { BrandEditorState } from '$lib/brand-editor';
  import { getBrandingSettings, updateBrandingCommand } from '$lib/remote/branding.remote';
  import { getPublicContent } from '$lib/remote/content.remote';
  import { toast } from '$lib/components/ui/Toast/toast-store';
  import {
    BrandStudioLayout,
    BrandStudioRail,
    BrandStudioCanvas,
    type PreviewFrameLoad,
  } from '$lib/components/brand-studio';
  import * as m from '$paraglide/messages';
  import type { PageData } from './$types';

  const { data }: { data: PageData } = $props();

  const orgId = $derived(data.org?.id ?? '');

  // Load current branding — the same remote query the old settings/branding
  // page used, so the save/load contract is unchanged.
  const brandingQuery = $derived(orgId ? getBrandingSettings(orgId) : null);

  // One published content slug for the canvas' Detail/Player previews. Studio
  // is ssr=false, so this reactive remote query resolves client-side. When the
  // org has no published content the slug stays undefined and those tabs
  // disable gracefully (see CanvasToolbar's content gate).
  const previewContentQuery = $derived(
    orgId ? getPublicContent({ orgId, limit: 1 }) : null
  );
  const previewContentSlug = $derived.by(() => {
    const items = previewContentQuery?.current?.items;
    if (!Array.isArray(items) || items.length === 0) return undefined;
    const first = items[0];
    if (first && typeof first === 'object') {
      if ('slug' in first && typeof first.slug === 'string' && first.slug) {
        return first.slug;
      }
      if ('id' in first && typeof first.id === 'string' && first.id) {
        return first.id;
      }
    }
    return undefined;
  });

  // Own the store: open once branding is available; close on destroy. A plain
  // guard flag keeps this to a single open() even as the query refreshes.
  let opened = false;
  $effect(() => {
    const current = brandingQuery?.current;
    if (!orgId || !current || opened) return;
    opened = true;
    brandEditor.open(orgId, toBrandEditorState(current));
  });

  onDestroy(() => {
    brandEditor.close();
  });

  // ── Live edit → preview bridge (WP-1.4) ──────────────────────────────────
  // Broadcast the editor's pending brand state to the same-origin preview
  // iframe(s) so edits reflect INSTANTLY, no reload. The applier lives inside
  // the framed public page (org layout → initBrandPreviewBridge).
  const previewSender = createBrandPreviewSender();

  // Push pending on every change. $state.snapshot deep-reads pending, so this
  // $effect re-runs on any nested field change; the sender debounces the post
  // (~50ms) to coalesce rapid slider drags. Guarded on a non-null pending.
  $effect(() => {
    const pending = brandEditor.pending;
    if (!pending) return;
    previewSender.send($state.snapshot(pending) as BrandEditorState);
  });

  // Register each (re)loaded frame + immediately sync it to current pending, so
  // a route change / reload in the canvas reflects in-progress edits at once.
  function handleFrameLoad(detail: PreviewFrameLoad): void {
    previewSender.register(detail.element, detail.origin);
  }

  onDestroy(() => {
    previewSender.destroy();
  });

  let saving = $state(false);

  // ── Hero-text preview reload (WP-1.6) ────────────────────────────────────
  // Org name/description are NOT brand tokens, so they can't stream through the
  // WP-1.4 colour bridge. After the rail's hero-text control persists them
  // (updateOrganizationForm → organization-api, which invalidates the org's
  // public-info cache), bump this token: BrandStudioCanvas appends it to the
  // frame `src`, reloading the iframe in place so the fresh hero text renders.
  // Also refresh the studio's own org data (title + props) — non-critical.
  let previewReloadToken = $state(0);
  function handleHeroPreviewReload(): void {
    previewReloadToken += 1;
    invalidate('cache:org-versions').catch(() => {
      /* non-critical — the iframe reload is the primary refresh */
    });
  }

  // Persist the current payload. Mirrors BrandEditorMount.handleSave exactly:
  // map BrandEditorState → updateBrandingCommand, markSaved(), then invalidate
  // the org layout load so public branding refreshes without a manual reload.
  async function handleSave() {
    const payload = brandEditor.getSavePayload();
    if (!payload || !brandEditor.orgId) return;

    saving = true;
    try {
      const overrides = payload.tokenOverrides ?? {};
      const hasOverrides = Object.keys(overrides).length > 0;
      const darkOverrides = payload.darkTokenOverrides ?? null;
      const hasDarkOverrides =
        darkOverrides != null && Object.keys(darkOverrides).length > 0;

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
        darkModeOverrides: payload.darkOverrides
          ? JSON.stringify(payload.darkOverrides)
          : '',
        darkTokenOverrides: hasDarkOverrides ? JSON.stringify(darkOverrides) : '',
        heroLayout: payload.heroLayout as HeroLayout,
      });
      brandEditor.markSaved();
      await invalidate('cache:org-versions').catch(() => {
        /* non-critical — save succeeded; worst case the user reloads */
      });
      toast.success('Brand settings saved');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save brand settings'
      );
    } finally {
      saving = false;
    }
  }

  // Preserve the unsaved-changes guard the retired overlay used to provide.
  beforeNavigate(({ cancel }) => {
    if (brandEditor.isDirty) {
      if (!confirm('You have unsaved brand changes. Discard?')) cancel();
    }
  });

  // ── Branding response → editor state ─────────────────────────────────────
  function toBrandEditorState(b: BrandingSettingsResponse): BrandEditorState {
    return {
      primaryColor: b.primaryColorHex || '#C24129',
      secondaryColor: b.secondaryColorHex,
      accentColor: b.accentColorHex,
      backgroundColor: b.backgroundColorHex,
      fontBody: b.fontBody,
      fontHeading: b.fontHeading,
      radius: Number(b.radiusValue) || 0.5,
      density: Number(b.densityValue) || 1,
      logoUrl: b.logoUrl,
      tokenOverrides: parseTokenRecord(b.tokenOverrides) ?? {},
      darkOverrides: parseDarkOverrides(b.darkModeOverrides),
      darkTokenOverrides: parseTokenRecord(b.darkTokenOverrides),
      heroLayout: b.heroLayout || 'default',
    };
  }

  function parseTokenRecord(
    json: string | null
  ): Record<string, string | null> | null {
    if (!json) return null;
    try {
      const parsed = JSON.parse(json) as Record<string, string | null>;
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  function parseDarkOverrides(
    json: string | null
  ): BrandEditorState['darkOverrides'] {
    if (!json) return null;
    try {
      return (JSON.parse(json) as BrandEditorState['darkOverrides']) ?? null;
    } catch {
      return null;
    }
  }
</script>

<svelte:head>
  <title>{m.branding_title()} | {data.org?.name ?? 'Studio'}</title>
</svelte:head>

<BrandStudioLayout>
  {#snippet rail()}
    <BrandStudioRail
      {saving}
      isDirty={brandEditor.isDirty}
      onsave={handleSave}
      orgName={data.org?.name ?? ''}
      orgDescription={data.org?.description ?? null}
      onpreviewreload={handleHeroPreviewReload}
    />
  {/snippet}
  {#snippet canvas()}
    <!--
      WP-1.4 live preview bridge: `onframeload` registers each (re)loaded frame
      with the sender, which posts the editor's pending brand state to
      `detail.origin` (explicit targetOrigin) for instant, no-reload preview. The
      applier runs inside the framed page (org layout → initBrandPreviewBridge).
    -->
    <BrandStudioCanvas
      previewOrigin={page.url.origin}
      contentSlug={previewContentSlug}
      onframeload={handleFrameLoad}
      reloadToken={previewReloadToken}
    />
  {/snippet}
</BrandStudioLayout>
