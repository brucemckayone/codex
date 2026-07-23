<!--
  @component Journey sales-page builder (route shell + state spine)

  The journey/page builder lives here (Codex-2pryk.3.3 · WP-5): a two-pane
  workspace — section rail + live-preview canvas — an EXACT clone of the
  `studio/brand` workspace (FRONTEND-MAP §5.4 / §6 rule 5), swapping the brand
  store/rail/canvas for the page-builder equivalents:

    · loads the page draft (`getJourneyForBuilderMock` → the frozen
      `GetJourneyForBuilderQuery` shape) and OWNS the page-builder store:
      open() on load → edit via rail → Save (saveJourneyPageMock + markSaved) →
      close() on destroy.
    · streams the pending draft to the same-origin preview iframe over the
      `codex:page-preview:v1` bridge — copy / order / toggle edits go live with
      NO reload.
    · renders the SHARED `BrandStudioLayout` shell (pass different snippets — the
      layout is generic; §5.4 "share as-is") with JourneyBuilderRail + canvas.

  AGGRESSIVE-MODE MOCKS: `getJourneyForBuilderMock` / `saveJourneyPageMock` stand
  in for the real remote fns; the conductor wires them after WP-2 (see
  journey-queries.mock). Admin/owner gate lives in +page.server.ts.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageBuilderState } from '@codex/shared-types';
  import { BrandStudioLayout } from '$lib/components/brand-studio';
  import {
    JourneyBuilderCanvas,
    JourneyBuilderRail,
    createJourneyPreviewWiring,
    type JourneyPreviewFrameLoad,
  } from '$lib/components/page-builder';
  import {
    getJourneyForBuilderMock,
    saveJourneyPageMock,
  } from '$lib/components/page-builder/journey-queries.mock.svelte';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { createPagePreviewSender } from '$lib/page-builder/page-preview-bridge';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  const { data } = $props();

  const pageId = $derived(page.params.id ?? '');

  // Load the page draft — the reactive query the conductor swaps for the real
  // remote after WP-2 (identical `.current` access).
  const draftQuery = $derived(pageId ? getJourneyForBuilderMock({ id: pageId }) : null);

  // ── Workspace view (mirrors studio/brand) ─────────────────────────────────
  // Give the preview more room. Page-owned because the toggles live in the
  // canvas toolbar (a sibling subtree) but the effect applies to the layout.
  let railCollapsed = $state(false);
  let fullscreen = $state(false);

  function toggleRail(): void {
    railCollapsed = !railCollapsed;
  }
  function toggleFullscreen(): void {
    fullscreen = !fullscreen;
  }

  // Escape exits full-screen — but only if nothing nearer (a popover, a dialog)
  // already handled the key (honour defaultPrevented — same as studio/brand).
  function onWindowKeydown(event: KeyboardEvent): void {
    if (fullscreen && event.key === 'Escape' && !event.defaultPrevented) {
      fullscreen = false;
    }
  }

  // Own the store: open once the draft loads; close on destroy. A guard flag
  // keeps this to a single open() even as the query settles.
  let opened = false;
  $effect(() => {
    const draft = draftQuery?.current;
    if (!pageId || !draft || opened) return;
    opened = true;
    // The record extends PageBuilderState with row identity; the store's spine
    // is the editable draft only (id/orgId/publishedAt live on the row).
    const { id: _id, organizationId: _org, publishedAt: _pub, ...editable } = draft;
    pageBuilder.open(pageId, editable);
  });

  onDestroy(() => {
    pageBuilder.close();
  });

  // ── Live edit → preview bridge ────────────────────────────────────────────
  // Broadcast the builder's pending draft to the same-origin preview iframe(s)
  // so edits reflect INSTANTLY, no reload. The applier runs inside the framed
  // public journey page (WP-3 renderer → initPagePreviewBridge).
  const previewSender = createPagePreviewSender();
  // The seam (register frame + push snapshot) lives in a pure, unit-tested
  // helper so a dropped call can't ship green — see preview-wiring.ts.
  const previewWiring = createJourneyPreviewWiring(previewSender);

  // Push pending on every change. $state.snapshot deep-reads pending, so this
  // $effect re-runs on any nested edit; the sender debounces the post (~50ms).
  $effect(() => {
    const pending = pageBuilder.pending;
    if (!pending) return;
    previewWiring.pushSnapshot($state.snapshot(pending) as PageBuilderState);
  });

  // Register each (re)loaded frame + immediately sync it to current pending, so
  // a reload in the canvas reflects in-progress edits at once.
  function handleFrameLoad(detail: JourneyPreviewFrameLoad): void {
    previewWiring.registerFrame(detail);
  }

  onDestroy(() => {
    previewSender.destroy();
  });

  let saving = $state(false);

  // Persist the pending draft, then markSaved() so the dirty state resets. The
  // real command will also invalidate the page:config + collection cache keys
  // (HARDENING §E) — the conductor wires that with the real remote.
  async function handleSave(): Promise<void> {
    const payload = pageBuilder.getSavePayload();
    const record = draftQuery?.current;
    if (!payload || !record) return;
    saving = true;
    try {
      await saveJourneyPageMock({
        ...record,
        ...payload,
      });
      pageBuilder.markSaved();
      toast.success('Page saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save page');
    } finally {
      saving = false;
    }
  }

  // Preserve the unsaved-changes guard (same as studio/brand's overlay).
  beforeNavigate(({ cancel }) => {
    if (pageBuilder.isDirty && !confirm('You have unsaved page changes. Discard?')) {
      cancel();
    }
  });

  const slug = $derived(pageBuilder.pending?.slug ?? '');
</script>

<svelte:head>
  <title>Page builder | {data.org.name}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

{#if pageBuilder.isOpen}
  <BrandStudioLayout {railCollapsed} {fullscreen} onToggleRail={toggleRail}>
    {#snippet rail()}
      <JourneyBuilderRail {saving} onsave={handleSave} />
    {/snippet}
    {#snippet canvas()}
      <!--
        The preview bridge: `onframeload` registers each (re)loaded frame with
        the sender, which posts the pending draft to `detail.origin` (explicit
        targetOrigin) for instant, no-reload preview. The applier runs inside the
        framed journey page (WP-3 → initPagePreviewBridge).
      -->
      <JourneyBuilderCanvas
        previewOrigin={page.url.origin}
        {slug}
        onframeload={handleFrameLoad}
        {fullscreen}
        onToggleFullscreen={toggleFullscreen}
      />
    {/snippet}
  </BrandStudioLayout>
{:else}
  <div class="builder-loading" aria-busy="true">
    <p>Loading page…</p>
  </div>
{/if}

<style>
  .builder-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: calc(100vh - var(--space-24));
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
</style>
