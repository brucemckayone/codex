<!--
  @component Journey sales-page builder (route shell + state spine)

  The INLINE WYSIWYG journey/page builder (Codex-2pryk.3.3 · WP-5). A three-pane
  workspace faithful to the finished prototype (`docs/design/course-journeys/
  prototype/builder.html`): a top bar (device + Preview + Save), page-wide mode
  tabs (Design / Pricing / Brand / SEO), and — in Design mode — an outline rail, a
  live editable canvas, and a per-section inspector. The settings modes swap the
  outline+inspector for a single settings panel beside the canvas.

  It OWNS the `pageBuilder` store: open() on load → edit via rail/canvas → Save
  (saveJourneyPage + updateJourneyOffer + markSaved) → close() on destroy. Every
  control mutates the store; the canvas renders the store's pending draft directly,
  so edits are live.

  The remotes are REAL (`getJourneyForBuilder` / `saveJourneyPage` /
  `updateJourneyOffer` / `updateCourseMonetisation` — no mocks). Save drives four
  endpoints because the page copy, the course's plan + tier access, the page's
  offer row and the sell media are four separate resources; see `handleSave`
  and `$lib/page-builder/builder-save`. Admin/owner gate lives in
  +page.server.ts. Per-page brand overrides tint the canvas via the org brand OKLCH
  layer (`data-org-brand` + brand vars on the canvas wrapper).
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { beforeNavigate, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import type { PageStatus } from '@codex/shared-types';
  import { buildJourneyUrl } from '@codex/urls';
  import * as m from '$paraglide/messages';
  import {
    JourneyBuilderCanvas,
    PageBrandPanel,
    PageDesignPanel,
    PageMediaPanel,
    PagePricingPanel,
    PageSeoPanel,
    SectionEditor,
    SectionList,
  } from '$lib/components/page-builder';
  import {
    getCourseCurriculum,
    getCourseOffer,
    getJourneyForBuilder,
    resolveSellPreview,
    saveJourneyPage,
    updateJourneyOffer,
  } from '$lib/remote/journeys.remote';
  import { saveBuilderDraft } from '$lib/page-builder/builder-save';
  import { queryErrorMessage } from '$lib/remote/query-result';
  import { monetisation } from '$lib/page-builder/monetisation-store.svelte';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import { sellMedia } from '$lib/page-builder/sell-media-store.svelte';
  import { toast } from '$lib/components/ui/Toast/toast-store';

  const { data } = $props();

  const pageId = $derived(page.params.id ?? '');
  const orgName = $derived(data.org?.name ?? 'Studio');
  const orgDomain = $derived(data.org?.slug ?? 'your-space');

  // Load the page draft — the reactive query the conductor swaps for the real
  // remote after WP-2 (identical `.current` access).
  const draftQuery = $derived(pageId ? getJourneyForBuilder({ id: pageId }) : null);

  // Curriculum stages feed the map/descent section previews (course-owned). This
  // was a hardcoded `[]` awaiting "real curriculum wiring", which meant the map
  // showed ZERO stages in the builder while the public page rendered the real
  // ones — the builder looked broken next to its own live page. Now reads the same
  // admin curriculum the two-pane editor uses.
  //
  // `minutes` comes from the practice's linked media duration. It read a flat 0
  // while `EditorPracticeView` carried no duration, so the map's "≈ N min in all"
  // cue under-claimed every course; a written practice (or media with no probed
  // duration) still contributes 0, which is the honest answer for it.
  const curriculumQuery = $derived(
    pageId ? getCourseCurriculum({ pageId }) : null
  );

  // Curriculum and Insights are both COURSE artifacts — each resolves this page
  // to its subject course server-side — so the artifact switch only offers them
  // for a course journey. The Curriculum tab was ungated, which pointed a
  // non-course journey at a guaranteed 404.
  const isCourse = $derived(draftQuery?.current?.subjectType === 'course');

  // Passed to the canvas RAW. It used to be re-shaped here into a builder-only
  // `JourneyStagePreview`, because the canvas rendered its own component set; now
  // the canvas renders the public sections, and `builderSalesContext` maps the
  // admin curriculum down to the public `JourneyStageView` the `map` section
  // actually reads. Mapping in one place is what keeps the canvas and the live
  // page numbering practices identically (Codex-eckbx W1–W3).
  const stages = $derived(curriculumQuery?.current?.stages ?? []);

  // The course the sections render against. `id` is the subject of the page
  // draft; title/slug come from the same draft read, so the canvas needs no
  // extra request.
  const course = $derived({
    id: draftQuery?.current?.subjectId ?? '',
    slug: draftQuery?.current?.slug ?? '',
    title: draftQuery?.current?.title ?? '',
  });

  // The course's resolved sell media — hero still + clip, intro and reel
  // manifests, the guide's portrait. The canvas received NOTHING here
  // (Codex-bvhcr), so its four media-bearing sections drew media-less fallbacks
  // while the same page rendered the real media publicly.
  //
  // The SAME query the public sales load streams (`resolveSellPreview`, no auth
  // by design — HARDENING §E), called as an ordinary client query because the
  // studio runs `ssr = false`.
  //
  // Both ids must be real UUIDs before calling: the query's schema validates each
  // as one, and a non-course journey has no `subjectId` to resolve — so the guard
  // is a precondition, not defensiveness.
  const sellPreviewQuery = $derived(
    isCourse && pageId && course.id
      ? resolveSellPreview({ pageId, courseId: course.id })
      : null
  );

  // `.current` is `undefined` both in flight and AFTER A FAILURE — a rejected
  // remote query puts its reason on `.error` and leaves this untouched
  // (Codex-xo3bl) — so `?? null` reproduces exactly the `.catch(() => null)` the
  // public load applies. A sell-media read that fails must cost the author their
  // media preview, never their canvas.
  const sellPreview = $derived(sellPreviewQuery?.current ?? null);

  /**
   * WHY the draft read failed, if it did — and the reason the builder used to hang
   * on "Loading page…" for ever (Codex-b0fm6).
   *
   * The whole workspace is gated on `pageBuilder.isOpen && pending`, and the store
   * only opens from the `$effect` above, whose first line returns on a falsy
   * `draft`. So a REJECTED read and a NULL resolve both left the spinner as the
   * terminal state: no error, no retry, and no way back, because the builder's own
   * chrome lives inside that `{#if}`. Two ordinary paths reach it — a non-UUID
   * `[id]` segment (the query's schema rejects it) and a valid uuid that is not a
   * landing page, which is exactly what opening the builder with a COURSE id
   * produces, since `getJourneyForBuilder` is org-scoped and answers `null` for a
   * foreign or missing page (IDOR-safe by design).
   *
   * THROUGH `queryErrorMessage`, NEVER `draftQuery.error?.message`: SvelteKit
   * rejects with `HttpError`, which carries its text at `.body.message` and has no
   * top-level `message`, so the property read is `undefined` for every failure
   * there is and its branch is dead code (Codex-xo3bl).
   */
  const draftError = $derived(queryErrorMessage(draftQuery?.error));

  /**
   * A resolved-but-absent draft: the read succeeded and there is no such page in
   * this org. Distinct from in-flight, which is why `loading` is part of the test
   * — `.current` is `undefined` while a query is running too.
   */
  const draftMissing = $derived(
    !!draftQuery && !draftQuery.loading && draftQuery.current === null
  );

  // The course's AUTHORITATIVE offer — which ways in exist and what each charges
  // (SPEC §7). The canvas received NOTHING here either (Codex-4wun2), and it is
  // the same shape of omission as the sell media one above: the canvas declares
  // `offer`, forwards it into `builderSalesContext`, and was never handed one — so
  // `context.offer` was always null, `deriveOfferPaths` always returned `[]`, and
  // the author edited the invite section against its price-less branch while the
  // published page priced itself from this exact read. The whole Pricing panel was
  // invisible on the surface the inline-WYSIWYG decision was made for.
  //
  // AUTHORITATIVE, never the page's own `offer` bag: that bag is presentation, no
  // authoritative read consults it, and pricing the canvas from it would teach the
  // author a number the checkout will not charge (`InviteSection`'s pricing
  // invariant). The cost of reading the real thing is that a pricing edit reaches
  // the canvas only after Save — the Pricing panel is where an unsaved price is
  // visible.
  //
  // Same precondition as the preview read: the query validates `courseId` as a
  // UUID and a non-course journey has no `subjectId` to price.
  const offerQuery = $derived(
    isCourse && course.id ? getCourseOffer({ courseId: course.id }) : null
  );

  // `.current` is `undefined` in flight AND after a rejection (Codex-xo3bl), so
  // `?? null` reproduces the public load's `.catch(() => null)`. Null is the
  // documented price-less CTA — the honest degradation, never authored numbers.
  const offer = $derived(offerQuery?.current ?? null);

  // Where the canvas's CTAs point — built with `buildJourneyUrl` exactly as the
  // public `JourneyRenderer` builds the same two URLs, so the canvas's links and
  // the page's links are one construction.
  //
  // THIS IS THE SECOND HALF OF THE OFFER FIX, not a tidy-up. The canvas passed
  // neither URL, and `builderSalesContext` defaults both to `''` — harmless only
  // while there were no paths, because every CTA then fell to `hrefFor(null)` →
  // `''` → `safeHref` → `'#'`. With real paths, `checkoutUrlForPath('', pathId)`
  // returns `'?offer=<pathId>'`, which has no scheme, so `safeHref` passes it
  // through and every priced card in the canvas becomes a live RELATIVE link that
  // reloads THIS route (losing unsaved work behind the beforeNavigate confirm).
  //
  // `course.slug` is the LANDING PAGE's slug, and that is the correct segment:
  // `/journeys/[journeySlug]` and its `/checkout` both resolve by page slug
  // (`getCoursePage` selects `landing_pages` by `(orgId, slug)`), which is also
  // what `handleViewLive` below opens. `|| null` so a not-yet-loaded slug falls
  // back to the id rather than building `/journeys//checkout`.
  const journeyTarget = $derived({ slug: course.slug || null, id: course.id });
  const checkoutUrl = $derived(
    buildJourneyUrl(page.url, journeyTarget, { surface: 'checkout' })
  );
  const dashboardUrl = $derived(
    buildJourneyUrl(page.url, journeyTarget, { surface: 'dashboard' })
  );

  // ── Workspace view state ──────────────────────────────────────────────────
  type BuilderMode = 'design' | 'look' | 'pricing' | 'media' | 'brand' | 'seo';
  let mode = $state<BuilderMode>('design');
  let device = $state<'desktop' | 'tablet' | 'mobile'>('desktop');
  let railCollapsed = $state(false);
  let previewMode = $state(false);
  let saving = $state(false);

  // `label` is a THUNK, not a string: these tables live at module scope, and a
  // message read there would resolve once, before the request's language tag is
  // set. Called at render, each one resolves per request.
  const MODES: readonly { id: BuilderMode; label: () => string }[] = [
    { id: 'design', label: () => m.studio_builder_mode_design() },
    // "Look" is the page-scope design-axis preset picker (journey sections F-B2).
    // Beside Design rather than inside it: Design edits ONE section at a time,
    // Look sets what every section inherits, and merging the two put a page-wide
    // control inside a per-section inspector.
    { id: 'look', label: () => m.studio_builder_look_title() },
    { id: 'pricing', label: () => m.studio_builder_mode_pricing() },
    { id: 'media', label: () => m.studio_builder_media_title() },
    { id: 'brand', label: () => m.studio_builder_mode_brand() },
    { id: 'seo', label: () => m.studio_builder_mode_seo() },
  ];
  const DEVICES: readonly {
    id: 'desktop' | 'tablet' | 'mobile';
    label: () => string;
  }[] = [
    { id: 'desktop', label: () => m.studio_builder_device_desktop() },
    { id: 'tablet', label: () => m.studio_builder_device_tablet() },
    { id: 'mobile', label: () => m.studio_builder_device_mobile() },
  ];
  const STATUSES: readonly { id: PageStatus; label: () => string }[] = [
    { id: 'draft', label: () => m.studio_builder_status_draft() },
    { id: 'published', label: () => m.studio_builder_status_published() },
    { id: 'archived', label: () => m.studio_builder_status_archived() },
  ];

  // Esc exits full-width preview; Cmd/Ctrl+Z undo (+Shift redo) walks the
  // section-model history — but only when NOT typing in a field, so native
  // per-field text undo still works while editing copy.
  function onWindowKeydown(event: KeyboardEvent): void {
    if (previewMode && event.key === 'Escape' && !event.defaultPrevented) {
      previewMode = false;
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const target = event.target as HTMLElement | null;
    const editing =
      !!target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA');
    if (editing) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) pageBuilder.redo();
      else pageBuilder.undo();
    } else if (key === 'y') {
      event.preventDefault();
      pageBuilder.redo();
    }
  }

  // ── Own the store: open once the draft loads; close on destroy. ─────────────
  let opened = false;
  $effect(() => {
    const draft = draftQuery?.current;
    if (!pageId || !draft || opened) return;
    opened = true;
    // The record extends PageBuilderState with row identity; the store's spine is
    // the editable draft only (id/orgId/publishedAt live on the row).
    const { id: _id, organizationId: _org, publishedAt: _pub, ...editable } = draft;
    pageBuilder.open(pageId, editable);
    // Sell media + cover live on the SUBJECT COURSE, not the page row, so they
    // load from their own endpoint alongside the draft (Codex-eqh0z). Fire-and-
    // forget: `open()` already fails soft per-read, and a media-library hiccup
    // must not stop the creator editing copy.
    // `hasCourse` so a page with no subject course does not fire a read the
    // service answers with NotFoundError — the slots live on the COURSE.
    void sellMedia.open(pageId, {
      hasCourse: draft.subjectType === 'course' && !!draft.subjectId,
    });
    // The subscription plan + tier-access set live on the SUBJECT COURSE too, and
    // their baseline is read back from the tables that actually gate access
    // (Codex-2pryk.2.4.2) — never from the page's `offer` bag. A page with no
    // subject course has nothing to monetise, so it opens with `null`.
    void monetisation.open(
      draft.subjectType === 'course' ? draft.subjectId : null
    );
  });

  onDestroy(() => {
    pageBuilder.close();
    sellMedia.close();
    monetisation.close();
  });

  const pending = $derived(pageBuilder.pending);
  const selected = $derived(pageBuilder.selectedSection);
  // Media and monetisation are part of "unsaved work" too — otherwise picking a
  // clip or a tier and navigating away would lose it with no warning, and Save
  // would appear to have nothing to do.
  const isDirty = $derived(
    pageBuilder.isDirty || sellMedia.isDirty || monetisation.isDirty
  );
  const slug = $derived(pending?.slug ?? '');

  // Per-page brand overrides → tint the canvas via the org brand OKLCH layer.
  //
  // COLOUR INPUTS ONLY. This used to also re-declare
  // `--brand-shader-preset` from `tokenOverrides`, and that declaration could
  // never do anything: no component in either page-builder tree — public
  // `render/` or the canvas — mounts a `ShaderHero` or reads that property, and
  // `getShaderConfig` reads it off `.org-layout` (or an element handed to it
  // explicitly), never off an arbitrary ancestor like `.jb__canvas`. The canvas's
  // own per-section wrapper already emits the WHOLE `tokenOverrides` set through
  // the canonical `brandOverridesToStyleAttr`, so the value was redundant as well
  // as inert. The control that wrote it is going from `PageBrandPanel` in the same
  // pass.
  const brandStyle = $derived.by<string | undefined>(() => {
    const o = pending?.brandOverrides;
    if (!o) return undefined;
    const parts: string[] = [];
    if (o.primaryColor) parts.push(`--brand-color:${o.primaryColor}`);
    if (o.secondaryColor) parts.push(`--brand-secondary:${o.secondaryColor}`);
    if (o.accentColor) parts.push(`--brand-accent:${o.accentColor}`);
    if (o.backgroundColor) parts.push(`--brand-bg:${o.backgroundColor}`);
    return parts.length ? parts.join(';') : undefined;
  });

  /**
   * The page draft, the course's MONETISATION and the journey's OFFER are separate
   * resources with separate endpoints — page copy via `saveJourneyPage`, the
   * subscription plan + tier access via `updateCourseMonetisation`, and the offer
   * row via `updateJourneyOffer` (which also writes the authoritative
   * `courses.price_cents`). One Save button drives all of them so the creator has
   * one mental model. The orchestration lives in
   * `$lib/page-builder/builder-save` so it is unit-testable; this wrapper only
   * turns its explicit result into toasts.
   *
   * RETURNS whether the write landed (Codex-xzwl5). It used to swallow its own
   * errors and return normally, which made a failed save indistinguishable from a
   * successful one — `handlePublish` then reported "Page published" over content
   * that was never persisted, and `handleViewLive` opened a page showing stale
   * content. Every caller MUST gate on this boolean.
   */
  async function handleSave(): Promise<boolean> {
    const payload = pageBuilder.getSavePayload();
    const record = draftQuery?.current;
    // Nothing loaded ⇒ nothing to save. Reported as NOT saved so callers can
    // never treat "there was no draft" as "the draft was persisted".
    if (!payload || !record) {
      toast.error(m.studio_builder_toast_draft_loading());
      return false;
    }
    saving = true;
    try {
      const result = await saveBuilderDraft({
        pageId: record.id,
        payload,
        savedOffer: pageBuilder.saved?.offer,
        savePage: saveJourneyPage,
        saveOffer: updateJourneyOffer,
        // The two course-owned ways in (subscription plan + tier access). This
        // leg runs BEFORE the offer leg because it is the one that talks to
        // Stripe, and the offer bag's tier/subscription fields are DERIVED from
        // what it persisted — so a refused plan never leaves the sales page
        // advertising a subscription with no Stripe Product behind it.
        monetisation: {
          isDirty: monetisation.isDirty,
          save: () => monetisation.save(),
          presentation: () => monetisation.presentationOffer,
        },
        // Sell media is a FOURTH resource (it writes `courses.*MediaId`, not the
        // page row) and only sends when a slot actually changed.
        //
        // INSIDE the orchestrator, not after it. This leg used to run below, in
        // this function, UNDER the `staleWarning` early return — so a rejected
        // post-save `invalidate` (which happens for reasons that have nothing to
        // do with this save: any load it re-runs throwing is enough) skipped the
        // media write entirely, warned the creator about page staleness instead,
        // and still returned `true`. `handlePublish` then said "Page published"
        // over media that had never been sent, and `markSaved()` had already run,
        // so the un-sent media was silently discardable on the next navigation.
        // A leg the caller runs afterwards is a leg the caller can skip.
        sellMedia: {
          isDirty: sellMedia.isDirty,
          save: () => sellMedia.save(),
        },
        // Fold the persisted bag back into the draft so the saved baseline carries
        // the derived fields; without it every save would re-send the offer write.
        syncOffer: (offer) => pageBuilder.updateOffer(offer),
        markSaved: () => pageBuilder.markSaved(),
        // The PUBLIC sales load `depends('cache:versions')` precisely so a save
        // can mark it stale; without this the client reuses its cached load data
        // and the live page keeps showing pre-save content until a hard reload.
        refresh: () => invalidate('cache:versions'),
      });

      if (result.outcome === 'failed') {
        toast.error(result.message);
        return false;
      }
      if (result.staleWarning) {
        // Every write landed — including the media leg, which now runs inside
        // `saveBuilderDraft` — so this is a WARNING about the studio's cached
        // reads, and the save is reported as the success it was.
        toast.warning(result.staleWarning);
        return true;
      }

      toast.success(m.studio_builder_toast_saved());
      return true;
    } finally {
      saving = false;
    }
  }

  /**
   * Open the REAL public sales page in a new tab — the only surface that renders
   * the cinematic motion (the canvas mounts the static editable components; see
   * the toolbar comment). Saves first when dirty, and ABORTS when that save fails
   * (Codex-xzwl5): opening the live page after a failed save showed stale content
   * next to a builder showing the new content — an intermittent builder-vs-live
   * discrepancy the creator has no way to explain. The save's own toast already
   * says what went wrong.
   *
   * `?preview=1` (Codex-aectb) opts out of the sell page's entitled→dashboard
   * redirect. A creator who also holds the course would otherwise land on their
   * own dashboard and never see the page they just edited.
   */
  async function handleViewLive(): Promise<void> {
    // The WIDE flag, not `pageBuilder.isDirty`. Media and pricing live in their
    // own stores, so with only a clip or a tier changed the narrow flag was false,
    // the save was SKIPPED, and this opened the published page showing the OLD
    // media beside a canvas showing the new — reintroducing the exact
    // builder-vs-live discrepancy this function's docstring exists to prevent,
    // through the flag rather than through a failed save.
    if (isDirty && !(await handleSave())) return;
    if (!slug) {
      toast.error(m.studio_builder_toast_need_slug());
      return;
    }
    window.open(`/journeys/${slug}?preview=1`, '_blank', 'noopener');
  }

  /**
   * Publish = flip the status and save. The success toast fires ONLY when the
   * write landed; on failure the status is rolled back to what it was so the
   * builder does not sit there claiming "Published" over an unpublished page.
   */
  async function handlePublish(): Promise<void> {
    const previousStatus = pageBuilder.pending?.status;
    pageBuilder.updateMeta('status', 'published');
    if (!(await handleSave())) {
      if (previousStatus) pageBuilder.updateMeta('status', previousStatus);
      return;
    }
    toast.success(m.studio_builder_toast_published());
  }

  /**
   * The unsaved-work guard, and the one control that stops the canvas's live CTAs
   * navigating the editor away.
   *
   * (1) IT READS THE WIDE FLAG. It used to test `pageBuilder.isDirty`, which
   * covers the page draft ONLY — so picking an intro clip in the Media tab or
   * changing a tier in the Pricing tab and then clicking "Curriculum" left the
   * route with nothing to prompt about: `onDestroy` ran `sellMedia.close()` /
   * `monetisation.close()` and the selection was gone, while the Save button had
   * been lit the whole time. The comment on `isDirty` above already named this
   * ("otherwise picking a clip or a tier and navigating away would lose it with
   * no warning"); the guard simply did not use it. The copy is "unsaved changes"
   * rather than "unsaved page changes" because it now covers all three.
   *
   * (2) `type === 'leave'` (a tab close or a reload) gets `cancel()` with NO
   * `confirm()`: browsers suppress a dialog during unload, so `confirm()` returns
   * false immediately and the only thing that stops the unload is `cancel()`,
   * which raises the browser's own "Leave site?" prompt. Calling both means the
   * creator can be asked twice — once by a dialog they never see.
   *
   * (3) THE CANVAS'S CTAs ARE NOW LIVE LINKS. They point at the real checkout
   * (that is the fix for a canvas whose every CTA resolved to '#'), and inside an
   * EDITOR a click on one should select the block, not leave the page. The canvas
   * intercepts the click; this is the backstop for the paths it cannot — a
   * keyboard activation, a programmatic `goto`, a composition that forgets to
   * call `preventDefault`. It cancels UNCONDITIONALLY, dirty or clean: a clean
   * draft got no prompt at all, so the author simply lost their place. "View
   * live ↗" is the way out to the real page, and it opens a new tab.
   *
   * (4) THE CONFIRM COPY IS NOT LOCALISED YET, for the same reason the status
   * select's aria-label is not: `__tests__/builder-failure-states.test.ts:180`
   * asserts the literal "unsaved changes" inside this callback's
   * COMMENT-STRIPPED body, which is what pins the copy to all three resources
   * rather than to the page draft alone. A message call satisfies neither half
   * of that pair, so the swap needs the assertion to move to the message key in
   * the same change.
   */
  /**
   * Write the status select's choice, confirming the one value that takes a page
   * off the public site. Re-reads the draft on cancel so the control cannot show
   * a status the page does not have.
   */
  function setStatus(select: HTMLSelectElement): void {
    const next = select.value as PageStatus;
    if (
      next === 'archived' &&
      !confirm(m.studio_builder_confirm_archive())
    ) {
      select.value = pageBuilder.pending?.status ?? 'draft';
      return;
    }
    pageBuilder.updateMeta('status', next);
  }

  beforeNavigate((navigation) => {
    if (isPublicJourneySurface(navigation.to?.url)) {
      navigation.cancel();
      toast.info(m.studio_builder_toast_ctas_inert());
      return;
    }
    if (!isDirty) return;
    if (navigation.type === 'leave') {
      navigation.cancel();
      return;
    }
    if (!confirm('You have unsaved changes. Discard?')) navigation.cancel();
  });

  /**
   * Is this navigation target one of the journey's own PUBLIC surfaces — the sell
   * page, its checkout or its member dashboard?
   *
   * Matched on the pathname of the two URLs the canvas is handed, plus the sell
   * page itself, so it can only ever match a link the canvas drew. Nothing in the
   * builder chrome points at these: the top bar links to /studio/journeys and the
   * two course artifacts, and "View live" uses `window.open`, which never reaches
   * `beforeNavigate`.
   */
  function isPublicJourneySurface(target: URL | null | undefined): boolean {
    if (!target || !slug) return false;
    const here = target.pathname.replace(/\/$/, '');
    return (
      here === `/journeys/${slug}` ||
      here === new URL(checkoutUrl, page.url).pathname.replace(/\/$/, '') ||
      here === new URL(dashboardUrl, page.url).pathname.replace(/\/$/, '')
    );
  }
</script>

<svelte:head>
  <title>{m.studio_builder_title()} | {orgName}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

{#if pageBuilder.isOpen && pending}
  <div
    class="jb"
    data-mode={mode}
    class:jb--preview={previewMode}
    class:jb--rail-collapsed={railCollapsed}
  >
    <!-- ── top bar ── -->
    <header class="jb__top">
      <!--
        Brand home link (prototype builder.html:203). The builder is a
        full-bleed surface, so this is the only way back out of it besides the
        icon rail. It targets the Portals index — the list the builder was
        opened from, matching the prototype's own `href` — rather than /studio,
        so it reads as "up one level" from the page you are editing.
      -->
      <a class="jb__brand" href="/studio/journeys" title={m.studio_builder_all_portals()}>
        Studio<span aria-hidden="true">.</span>
      </a>
      <span class="jb__doc">
        {m.studio_builder_doc_kind()} ·
        <input
          class="jb__doc-title"
          value={pending.title}
          oninput={(e) => pageBuilder.updateMeta('title', e.currentTarget.value)}
          aria-label={m.studio_builder_page_title_label()}
        />
      </span>
      <!--
        ARCHIVED IS DESTRUCTIVE and sits in the same undifferentiated row as the
        title input, two elements from the history buttons — so it is confirmed
        before it is written. It IS undoable now (page meta takes history steps),
        but an archive is also a PUBLIC change the moment the page is saved, and
        undo cannot reach a saved page. On cancel the select is snapped back to
        the draft's real status, because a `<select>` keeps the user's choice on
        screen otherwise and would then disagree with the draft.
      -->
      <!--
        NOT LOCALISED, and deliberately. `__tests__/builder-top-bar.test.ts:96`
        asserts the literal `aria-label="Page status"` in this file's SOURCE — it
        is the guard that the publish affordance is still a labelled <select>
        rather than the prototype's status pill — so moving this behind a message
        turns that guard red, and the localisation pass did not own that test
        file. Land the two together: add `studio_builder_status_label` /
        "Page status" to messages/en.json and point the assertion at the key.
      -->
      <select
        class="jb__status"
        value={pending.status}
        onchange={(e) => setStatus(e.currentTarget)}
        aria-label="Page status"
      >
        {#each STATUSES as s (s.id)}
          <option value={s.id}>{s.label()}</option>
        {/each}
      </select>

      <nav class="jb__art" aria-label={m.studio_builder_artifacts_label()}>
        {#if isCourse}
          <a href="/studio/journeys/{pageId}/curriculum">{m.studio_builder_artifact_curriculum()}</a>
          <a href="/studio/journeys/{pageId}/insights">{m.studio_builder_artifact_insights()}</a>
        {/if}
        <span class="jb__art-on" aria-current="page">{m.studio_builder_artifact_sales_page()}</span>
      </nav>

      <!--
        The device switch, history and the four actions share one wrapper so the
        whole right-hand cluster wraps to a second line AS A UNIT and stays
        right-aligned. Wrapped individually, Save/Publish stranded themselves
        bottom-left while the rest of the row stayed put.
      -->
      <div class="jb__actions">
      <div class="jb__seg" role="group" aria-label={m.studio_builder_device_label()}>
        {#each DEVICES as d (d.id)}
          <button type="button" aria-pressed={device === d.id} onclick={() => (device = d.id)}>
            {d.label()}
          </button>
        {/each}
      </div>

      <div class="jb__history" role="group" aria-label={m.studio_builder_history_label()}>
        <button
          type="button"
          class="jb__icon-btn"
          title={m.studio_builder_undo_title()}
          aria-label={m.studio_builder_undo()}
          disabled={!pageBuilder.canUndo}
          onclick={() => pageBuilder.undo()}
        >↶</button>
        <button
          type="button"
          class="jb__icon-btn"
          title={m.studio_builder_redo_title()}
          aria-label={m.studio_builder_redo()}
          disabled={!pageBuilder.canRedo}
          onclick={() => pageBuilder.redo()}
        >↷</button>
      </div>

      <!--
        "Full width" only hides the editor rails — the canvas renders the same
        PUBLIC section components the live page does (`render/`), so what is on it
        IS the page. The cinematic motion (pinned ache, kinetic hero, scroll
        reveals) is the one difference, and only WHILE EDITING: every `use:reveal`
        takes `{ disabled: editable }`, because animating a block out from under a
        contenteditable caret makes click-to-edit unreliable. Preview mode turns
        editing off, so the motion runs there too; "View live" below is for seeing
        it on the real URL.
      -->
      <button
        type="button"
        class="jb__btn"
        class:jb__btn--on={previewMode}
        title={m.studio_builder_full_width_title()}
        onclick={() => (previewMode = !previewMode)}
      >
        {previewMode ? m.studio_builder_editing() : m.studio_builder_full_width()}
      </button>
      <button
        type="button"
        class="jb__btn"
        title={m.studio_builder_view_live_title()}
        disabled={saving}
        onclick={handleViewLive}
      >
        {m.studio_builder_view_live()}
      </button>
      <button type="button" class="jb__btn" disabled={!isDirty || saving} onclick={handleSave}>
        {saving ? m.studio_builder_saving() : m.studio_builder_save()}
      </button>
      <button
        type="button"
        class="jb__btn jb__btn--primary"
        disabled={saving}
        onclick={handlePublish}
      >
        {saving ? m.studio_builder_publishing() : m.studio_builder_publish()}
      </button>
      </div>
    </header>

    <!-- ── mode tabs ── -->
    <!-- The loop variable is `tab`, NOT `m`: `m` is the Paraglide message
         namespace in this file, and an `{#each … as m}` would shadow it for the
         whole block. -->
    <nav class="jb__modes" aria-label={m.studio_builder_mode_label()}>
      {#each MODES as tab (tab.id)}
        <button type="button" aria-pressed={mode === tab.id} onclick={() => (mode = tab.id)}>
          {tab.label()}
        </button>
      {/each}
    </nav>

    <!-- ── shell ── -->
    <div class="jb__shell">
      {#if mode === 'design'}
        <aside class="jb__outline">
          <SectionList />
        </aside>
      {:else}
        <aside class="jb__settings">
          {#if mode === 'look'}
            <PageDesignPanel />
          {:else if mode === 'pricing'}
            <PagePricingPanel />
          {:else if mode === 'media'}
            <PageMediaPanel />
          {:else if mode === 'brand'}
            <PageBrandPanel />
          {:else}
            <PageSeoPanel {orgDomain} />
          {/if}
        </aside>
      {/if}

      <!--
        Per-page brand vars flow into the canvas; the `.jp` page self-derives its
        surface + text ladder from them (see journey-palette.css), so the sales
        page tints without re-theming the studio chrome around it.
      -->
      <section class="jb__canvas" style={brandStyle}>
        <JourneyBuilderCanvas
          editable={!previewMode}
          {device}
          {railCollapsed}
          onToggleRail={() => (railCollapsed = !railCollapsed)}
          {slug}
          {orgDomain}
          {stages}
          {course}
          {offer}
          {checkoutUrl}
          {dashboardUrl}
          {sellPreview}
        />
      </section>

      {#if mode === 'design'}
        <aside class="jb__inspector">
          {#if selected}
            <SectionEditor section={selected} />
          {:else}
            <p class="jb__inspector-empty">{m.studio_builder_inspector_empty()}</p>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
{:else if draftError}
  <!--
    A FAILED read. Named, escapable, and retryable — the three things the bare
    spinner was not. `role="alert"` because the surface has no other content to
    read, so the failure must be announced rather than only painted.
  -->
  <div class="jb-empty" role="alert">
    <p class="jb-empty__title">{m.studio_builder_error_title()}</p>
    <p class="jb-empty__body">{draftError}</p>
    <div class="jb-empty__acts">
      <button type="button" class="jb-empty__btn" onclick={() => draftQuery?.refresh()}>
        {m.studio_builder_error_retry()}
      </button>
      <a class="jb-empty__link" href="/studio/journeys">{m.studio_builder_all_portals()}</a>
    </div>
  </div>
{:else if draftMissing}
  <!--
    NOT FOUND, and the copy names the id class explicitly because the commonest
    way to land here is a correct-looking URL with the wrong uuid in it: this route
    takes the PORTAL page id, not the course id, and the two are interchangeable to
    the eye.
  -->
  <div class="jb-empty">
    <p class="jb-empty__title">{m.studio_builder_missing_title()}</p>
    <p class="jb-empty__body">
      {m.studio_builder_missing_body()}
    </p>
    <div class="jb-empty__acts">
      <a class="jb-empty__link" href="/studio/journeys">{m.studio_builder_all_portals()}</a>
    </div>
  </div>
{:else}
  <div class="jb-loading" aria-busy="true"><p>{m.studio_builder_loading()}</p></div>
{/if}

<style>
  /*
    `minmax(0, 1fr)` on the implicit column is load-bearing: the default `auto`
    track is sized to its item's max-content, so the top bar's min-content width
    would push the whole workspace wider than the viewport and give the page a
    horizontal scrollbar. Capping the track lets the bar wrap instead.
  */
  .jb {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    height: 100dvh;
    background-color: var(--color-background);
  }

  /*
    ── top bar ──
    Nine controls, so the row is allowed to wrap onto a second line rather than
    overflow: below roughly 1330px of bar width the right-hand cluster drops
    whole (its `margin-left: auto` keeps it right-aligned on the new line). The
    height is a MIN, not a fixed value — a fixed height is what clipped the
    wrapped action labels before. With one line the bar is still 48px tall.
  */
  .jb__top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    align-content: center;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-1) var(--space-4);
    min-height: var(--space-12);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  /*
    The identity block is the ONLY negotiable item in the bar. Every sibling is
    `flex: none` (below), so when the row runs short the title yields instead of
    the whole row squashing — which is what used to clip the action labels.
  */
  /*
    Brand wordmark / home link. The prototype tinted the period with a fixed
    studio gold (`--st-gold: #cdb489`); we have no such token and every brand
    colour here is org-overridable, so the period takes `--color-brand-primary`
    and the mark tints per org rather than pinning one org's palette into the
    studio chrome.

    Sized with `--text-sm` to sit level with `.jb__doc` next to it — the
    prototype's .82rem-vs-.8rem split is finer than one step of our type scale,
    so matching its neighbour is the honest translation. Focus ring comes from
    the global `:focus-visible` in base.css; hover underlines rather than
    changing colour, because the mark is already at full `--color-text` and the
    bar's dim→prominent hover convention (`.jb__art a`) has nowhere to go from
    there.

    DON'T "fix" the weight: `--font-bold` resolves to the ORG's heading weight,
    not 700, because org-brand.css re-declares
    `[data-org-brand] { --font-bold: var(--heading-weight, 700) }`. On this org
    it computes to 400 — the brand heading font is Archivo Black, a single-weight
    display face, and 700 would make the browser synthesise a smeared fake bold.
    The mark reads heavy because the FACE is heavy (`--font-heading`, the same
    token `.jb__doc-title` beside it uses), not because of the weight axis. An
    org with a multi-weight heading font gets a real 700 here.
  */
  .jb__brand {
    flex: none;
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text);
    text-decoration: none;
    white-space: nowrap;
  }

  .jb__brand span {
    color: var(--color-brand-primary);
  }

  .jb__brand:hover {
    text-decoration: underline;
  }

  .jb__doc {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .jb__doc-title {
    border: 0;
    background: none;
    color: var(--color-text);
    font-family: var(--font-heading);
    font-size: var(--text-sm);
    font-weight: var(--font-semibold);
    flex: 0 1 auto;
    min-width: var(--space-32);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    text-overflow: ellipsis;
  }

  .jb__doc-title:hover {
    background-color: var(--color-surface-secondary);
  }

  .jb__doc-title:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /*
    `width: max-content` is load-bearing. A bare <select> resolves `width: auto`
    to fill-available (measured: 1800px basis for 100px of content), and since
    every flex child defaults to `flex-shrink: 1` the algorithm handed this
    control ~565px of a 1688px bar while clipping the buttons. Sizing it to its
    own content — and taking it out of the negotiation — is the actual fix.
  */
  .jb__status {
    flex: none;
    width: max-content;
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-surface);
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
  }

  .jb__art {
    display: flex;
    flex: none;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
  }

  .jb__art a,
  .jb__art-on {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--color-text-secondary);
    text-decoration: none;
    white-space: nowrap;
  }

  .jb__art a:hover {
    color: var(--color-text);
  }

  .jb__art-on {
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  /*
    The right-hand cluster. `margin-left: auto` lives HERE rather than on
    `.jb__seg` so that when the bar wraps, the whole group moves to the new line
    together and `justify-content: flex-end` keeps it right-aligned. It wraps
    internally too, so it degrades to any width without overflowing.
  */
  .jb__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1) var(--space-3);
    margin-left: auto;
    min-width: 0;
  }

  .jb__seg {
    display: flex;
    flex: none;
    gap: var(--space-1);
    padding: var(--space-1);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-secondary);
  }

  .jb__seg button {
    padding: var(--space-1) var(--space-3);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__seg button[aria-pressed='true'] {
    background-color: var(--color-text);
    color: var(--color-background);
  }

  .jb__btn {
    flex: none;
    padding: var(--space-2) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    white-space: nowrap;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jb__btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  .jb__btn--on {
    color: var(--color-text);
    border-color: var(--color-interactive);
    background-color: color-mix(in oklab, var(--color-interactive) 12%, transparent);
  }

  .jb__btn--primary {
    border-color: transparent;
    background-color: var(--color-interactive);
    color: var(--color-text-on-brand, var(--color-background));
    font-weight: var(--font-semibold);
  }

  .jb__btn--primary:hover:not(:disabled) {
    background-color: var(--color-interactive-hover);
  }

  .jb__history {
    display: flex;
    flex: none;
    gap: var(--space-0-5);
  }

  .jb__icon-btn {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--space-8);
    height: var(--space-8);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-size: var(--text-base);
    line-height: 1;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__icon-btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jb__icon-btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: not-allowed;
  }

  .jb__icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  .jb__btn:focus-visible,
  .jb__seg button:focus-visible,
  .jb__modes button:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus-ring);
  }

  /* ── mode tabs ── */
  .jb__modes {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    height: var(--space-11, 2.75rem);
    padding: 0 var(--space-3);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  .jb__modes button {
    padding: 0 var(--space-4);
    border: 0;
    border-bottom: var(--border-width-thick) var(--border-style) transparent;
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb__modes button:hover {
    color: var(--color-text);
  }

  .jb__modes button[aria-pressed='true'] {
    color: var(--color-text);
    border-bottom-color: var(--color-interactive);
  }

  /* ── shell grid ── */
  .jb__shell {
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr) 360px;
    min-height: 0;
  }

  .jb[data-mode='look'] .jb__shell,
  .jb[data-mode='pricing'] .jb__shell,
  .jb[data-mode='media'] .jb__shell,
  .jb[data-mode='brand'] .jb__shell,
  .jb[data-mode='seo'] .jb__shell {
    grid-template-columns: 380px minmax(0, 1fr);
  }

  .jb--rail-collapsed[data-mode='design'] .jb__shell {
    grid-template-columns: 0 minmax(0, 1fr) 360px;
  }

  .jb--preview .jb__shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .jb__outline,
  .jb__settings,
  .jb__inspector {
    min-height: 0;
    overflow-y: auto;
    background-color: var(--color-surface);
  }

  .jb__outline,
  .jb__settings {
    border-right: var(--border-width) var(--border-style) var(--color-border);
  }

  .jb__inspector {
    border-left: var(--border-width) var(--border-style) var(--color-border);
  }

  .jb--rail-collapsed[data-mode='design'] .jb__outline,
  .jb--preview .jb__outline,
  .jb--preview .jb__settings,
  .jb--preview .jb__inspector {
    display: none;
  }

  .jb__inspector-empty {
    padding: var(--space-6) var(--space-4);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
  }

  .jb__canvas {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .jb-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100dvh;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  /*
    The two FAILURE states, sharing `.jb-loading`'s full-height centring so the
    builder's three tails read as one surface. Tokens only — the builder is a
    full-bleed studio surface and inherits the org brand, so a literal colour here
    would pin one org's palette into shared chrome.
  */
  .jb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100dvh;
    padding: var(--space-6);
    text-align: center;
  }

  .jb-empty__title {
    margin: 0;
    font-family: var(--font-heading);
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .jb-empty__body {
    margin: 0;
    max-width: 46ch;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
  }

  .jb-empty__acts {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .jb-empty__btn,
  .jb-empty__link {
    padding: var(--space-1) var(--space-3);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-full);
    background-color: var(--color-surface);
    color: var(--color-text);
    font-size: var(--text-sm);
    text-decoration: none;
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jb-empty__btn:hover,
  .jb-empty__link:hover {
    background-color: var(--color-surface-secondary);
  }

  @media (--below-lg) {
    .jb__shell,
    .jb[data-mode='look'] .jb__shell,
    .jb[data-mode='pricing'] .jb__shell,
    .jb[data-mode='media'] .jb__shell,
    .jb[data-mode='brand'] .jb__shell,
    .jb[data-mode='seo'] .jb__shell {
      grid-template-columns: minmax(0, 1fr);
    }

    .jb__outline,
    .jb__settings,
    .jb__inspector {
      display: none;
    }
  }
</style>
