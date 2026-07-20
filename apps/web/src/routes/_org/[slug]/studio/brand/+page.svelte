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
    BrandStudioGuided,
    type BrandStudioMode,
    createPreviewWiring,
    isUnbrandedState,
    readStoredMode,
    resolveInitialMode,
    writeStoredMode,
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

  // ── Workspace mode (WP-1.7) ──────────────────────────────────────────────
  // Guided (shallow) vs Advanced (the full rail). Both drive the SAME store, so
  // toggling is a pure content swap — no edit is transferred or lost. Default:
  // Guided for an org that hasn't branded yet, Advanced otherwise; an explicit
  // choice is remembered per-org and wins over that default. Resolved once, when
  // the store first opens (below), so it reflects the loaded branding.
  let mode = $state<BrandStudioMode>('advanced');
  function setMode(next: BrandStudioMode): void {
    mode = next;
    if (orgId) writeStoredMode(orgId, next);
  }

  // ── Workspace view (Codex-cijzb.15) ──────────────────────────────────────
  // Give the live preview more room. Both are page-owned because the toggles
  // live in the canvas toolbar (a sibling subtree) but the effect applies to
  // BrandStudioLayout — the page is their nearest common ancestor. Independent:
  // you can collapse the rail while full-screen (edge-to-edge preview) or keep
  // it (edit against a large canvas). Ephemeral session state — resets on a hard
  // reload, survives in-SPA studio navigation while this page is mounted.
  let railCollapsed = $state(false);
  let fullscreen = $state(false);

  function toggleRail(): void {
    railCollapsed = !railCollapsed;
  }
  function toggleFullscreen(): void {
    fullscreen = !fullscreen;
  }

  // Escape exits full-screen — but only if nothing nearer (an open colour-picker
  // popover, a Melt dialog) already handled the key. Those call preventDefault
  // when they consume Escape, so honouring defaultPrevented stops us from
  // yanking the user out of full-screen when they only meant to close a popover.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (fullscreen && event.key === 'Escape' && !event.defaultPrevented) {
      fullscreen = false;
    }
  }

  // Stored JSON fields that failed to PARSE on load (not merely absent), mapped
  // to their raw string. Set once by the open effect; read by handleSave to
  // round-trip the raw value instead of blanking it. Plain `let` — only read
  // imperatively in the save handler, never in a reactive position.
  let unreadableRaw: Record<string, string> = {};

  // Own the store: open once branding is available; close on destroy. A plain
  // guard flag keeps this to a single open() even as the query refreshes.
  let opened = false;
  $effect(() => {
    const current = brandingQuery?.current;
    if (!orgId || !current || opened) return;
    opened = true;
    const unreadable: Record<string, string> = {};
    const initialState = toBrandEditorState(current, unreadable);
    unreadableRaw = unreadable;
    brandEditor.open(orgId, initialState);
    // One non-blocking notice if any saved field couldn't be read — surfaced
    // BEFORE the admin can overwrite it by saving. handleSave preserves the raw
    // value, so this warns rather than signalling data loss.
    const failedFields = Object.keys(unreadable);
    if (failedFields.length > 0) {
      toast.error(
        `Some saved brand settings couldn't be read (${failedFields.join(', ')}). ` +
          `They're preserved as-is — re-set them before saving to replace them.`
      );
    }
    mode = resolveInitialMode({
      storedMode: readStoredMode(orgId),
      isUnbranded: isUnbrandedState(initialState),
    });
  });

  onDestroy(() => {
    brandEditor.close();
  });

  // ── Live edit → preview bridge (WP-1.4) ──────────────────────────────────
  // Broadcast the editor's pending brand state to the same-origin preview
  // iframe(s) so edits reflect INSTANTLY, no reload. The applier lives inside
  // the framed public page (org layout → initBrandPreviewBridge).
  const previewSender = createBrandPreviewSender();
  // The seam (register frame + push snapshot) lives in a pure, unit-tested
  // helper so a dropped call can't ship green — see preview-wiring.ts.
  const previewWiring = createPreviewWiring(previewSender);

  // Push pending on every change. $state.snapshot deep-reads pending, so this
  // $effect re-runs on any nested field change; the sender debounces the post
  // (~50ms) to coalesce rapid slider drags. Guarded on a non-null pending.
  $effect(() => {
    const pending = brandEditor.pending;
    if (!pending) return;
    previewWiring.pushSnapshot($state.snapshot(pending) as BrandEditorState);
  });

  // Register each (re)loaded frame + immediately sync it to current pending, so
  // a route change / reload in the canvas reflects in-progress edits at once.
  function handleFrameLoad(detail: PreviewFrameLoad): void {
    previewWiring.registerFrame(detail);
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

  // Persist the current payload: map BrandEditorState → updateBrandingCommand,
  // markSaved(), then invalidate the org layout load so public branding
  // refreshes without a manual reload.
  //
  // Non-destructive guard (Codex-cijzb · WP-1.8): a JSON field that couldn't be
  // read on load (see unreadableRaw / toBrandEditorState) coerces to empty in
  // the editor. Without a guard the next Save would serialize that empty value
  // and PERMANENTLY overwrite the stored fine-tunes. So when such a field is
  // still empty (the admin hasn't replaced it), we write back its raw stored
  // string unchanged — a failed READ can't blank good data. A real edit
  // (non-empty) always wins.
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
        tokenOverrides: hasOverrides
          ? JSON.stringify(overrides)
          : (unreadableRaw.tokenOverrides ?? ''),
        darkModeOverrides: payload.darkOverrides
          ? JSON.stringify(payload.darkOverrides)
          : (unreadableRaw.darkModeOverrides ?? ''),
        darkTokenOverrides: hasDarkOverrides
          ? JSON.stringify(darkOverrides)
          : (unreadableRaw.darkTokenOverrides ?? ''),
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
  // `unreadable` collects fields whose stored JSON failed to parse (field →
  // raw string) so the caller can notify + preserve them; an absent/empty
  // value is NOT a failure and is not recorded.
  function toBrandEditorState(
    b: BrandingSettingsResponse,
    unreadable: Record<string, string>
  ): BrandEditorState {
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
      tokenOverrides:
        parseTokenRecord(b.tokenOverrides, 'tokenOverrides', unreadable) ?? {},
      darkOverrides: parseDarkOverrides(
        b.darkModeOverrides,
        'darkModeOverrides',
        unreadable
      ),
      darkTokenOverrides: parseTokenRecord(
        b.darkTokenOverrides,
        'darkTokenOverrides',
        unreadable
      ),
      heroLayout: b.heroLayout || 'default',
    };
  }

  function parseTokenRecord(
    json: string | null,
    field: string,
    unreadable: Record<string, string>
  ): Record<string, string | null> | null {
    if (!json) return null; // absent/empty — not an error
    try {
      const parsed = JSON.parse(json) as Record<string, string | null>;
      return parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
        ? parsed
        : null;
    } catch {
      recordUnreadable(field, json, unreadable);
      return null;
    }
  }

  function parseDarkOverrides(
    json: string | null,
    field: string,
    unreadable: Record<string, string>
  ): BrandEditorState['darkOverrides'] {
    if (!json) return null; // absent/empty — not an error
    try {
      return (JSON.parse(json) as BrandEditorState['darkOverrides']) ?? null;
    } catch {
      recordUnreadable(field, json, unreadable);
      return null;
    }
  }

  // A genuine parse failure (corrupt stored JSON) — warn and stash the raw
  // string so it can be round-tripped on save rather than silently blanked.
  function recordUnreadable(
    field: string,
    raw: string,
    unreadable: Record<string, string>
  ): void {
    console.warn(
      `[brand-studio] Stored branding field "${field}" is not valid JSON and ` +
        `could not be read; preserving it as-is until re-set.`
    );
    unreadable[field] = raw;
  }
</script>

<svelte:head>
  <title>{m.branding_title()} | {data.org?.name ?? 'Studio'}</title>
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<BrandStudioLayout {railCollapsed} {fullscreen}>
  {#snippet rail()}
    <div class="brand-mode">
      <div class="brand-mode__toggle" role="group" aria-label="Editor mode">
        <button
          type="button"
          class="brand-mode__btn"
          class:is-active={mode === 'guided'}
          aria-pressed={mode === 'guided'}
          onclick={() => setMode('guided')}
        >
          Guided
        </button>
        <button
          type="button"
          class="brand-mode__btn"
          class:is-active={mode === 'advanced'}
          aria-pressed={mode === 'advanced'}
          onclick={() => setMode('advanced')}
        >
          Advanced
        </button>
      </div>

      <div class="brand-mode__view">
        {#if mode === 'guided'}
          <BrandStudioGuided
            {saving}
            isDirty={brandEditor.isDirty}
            onsave={handleSave}
            onopenfulleditor={() => setMode('advanced')}
            orgName={data.org?.name ?? ''}
          />
        {:else}
          <BrandStudioRail
            {saving}
            isDirty={brandEditor.isDirty}
            onsave={handleSave}
            orgName={data.org?.name ?? ''}
            orgDescription={data.org?.description ?? null}
            onpreviewreload={handleHeroPreviewReload}
          />
        {/if}
      </div>
    </div>
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
      {railCollapsed}
      {fullscreen}
      onToggleRail={toggleRail}
      onToggleFullscreen={toggleFullscreen}
    />
  {/snippet}
</BrandStudioLayout>

<style>
  /* Rail-region wrapper: a fixed mode toggle above the active mode's view. The
     view fills the rest so Guided and the rail both flex to the rail height. */
  .brand-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .brand-mode__toggle {
    display: inline-flex;
    gap: var(--space-1);
    align-self: flex-start;
    margin: var(--space-3) var(--space-3) 0;
    padding: var(--space-0-5);
    background: var(--color-surface-secondary);
    border: var(--border-width) var(--border-style) var(--color-border-subtle);
    border-radius: var(--radius-lg);
  }

  .brand-mode__btn {
    appearance: none;
    border: none;
    background: none;
    padding: var(--space-1-5) var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--color-text-muted);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .brand-mode__btn:hover {
    color: var(--color-text);
  }

  .brand-mode__btn.is-active {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: var(--shadow-sm);
  }

  .brand-mode__btn:focus-visible {
    outline: var(--border-width-thick) solid var(--color-focus);
    outline-offset: var(--space-0-5);
  }

  .brand-mode__view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
