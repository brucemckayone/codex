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
    fieldsForSectionType,
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
    getCoursePagePreview,
    getJourneyForBuilder,
    resolveSellPreview,
    saveJourneyPage,
    updateJourneyOffer,
  } from '$lib/remote/journeys.remote';
  import { saveBuilderDraft } from '$lib/page-builder/builder-save';
  // The unauthored-copy check, for the publish confirm. Had no caller anywhere in
  // the repo except its own unit test, while its docstring described this exact
  // call site (Codex-maf0y).
  import { seededSections } from '$lib/page-builder';
  /*
    The page-SHAPE check, for the publish block. Also caller-less until now: its
    `PageShapeIssue` doc states "the builder's publish action blocks on them", and
    the publish action had never heard of it — so an EMPTY page (what
    `createJourney` inserts) and a TWO-HERO page (one press of Duplicate) both
    published.

    Through the `render` barrel, which is where the renderer's own half of this
    enforcement imports it from too — one function, one import path, two halves
    (the renderer refuses to paint an empty page; this refuses to publish one).
  */
  import { validatePageShape } from '$lib/page-builder/render';
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

  /**
   * The COURSE ROW's own sell copy and its testimonials — the last two legs of
   * `builderSalesContext` the canvas was never handed (Codex-bvhcr's class, after
   * `sellPreview` and `offer`).
   *
   * WHY THIS READ AND NOT A WIDER PAGE PAYLOAD. `kicker`, `lede` and
   * `course_testimonials` live on the COURSE, and nothing the studio already loads
   * carries them: the builder draft is the `landing_pages` row, and
   * `getCourseCurriculum` answers `{ courseId, stages }`. This is the same
   * management-gated read the public sell load falls back to for an unpublished
   * draft, and its docstring says it exists for the studio — so the canvas and the
   * page take their course facts from ONE endpoint rather than two, which is the
   * whole reason the canvas mounts the public components at all.
   *
   * ONLY `.course` AND `.testimonials` ARE READ. The payload also carries a `page`
   * record and its `stages`; both are ignored here, because the draft STORE is the
   * authority on the page and `curriculumQuery` on the curriculum. Reading the
   * page from this instead would show the author the last-saved copy in place of
   * what they are typing.
   *
   * KEYED ON THE SAVED SLUG, never `pending.slug`. The SEO panel edits the slug
   * live; keying on the pending value would re-fire this read on every keystroke
   * and answer `null` the moment the new slug differs from the persisted row.
   */
  const savedSlug = $derived(draftQuery?.current?.slug ?? '');
  const coursePageQuery = $derived(
    isCourse && savedSlug ? getCoursePagePreview({ slug: savedSlug }) : null
  );

  // `.current` is `undefined` in flight AND after a rejection (Codex-xo3bl), and
  // this query fails SOFT to `null` server-side as well, so both shapes mean the
  // same thing here: no course facts yet. The sections' own fallbacks cover it —
  // an absent kicker draws no eyebrow, exactly as an unset one does.
  const courseFacts = $derived(coursePageQuery?.current?.course ?? null);

  /**
   * Real testimonials for the canvas's `proof` section.
   *
   * `[]` is the honest empty — `ProofSection` renders its own empty state from it,
   * the same one the published page shows for a course with no quotes. What it is
   * NOT any more is a hardcoded `[]` standing in for "we never asked".
   */
  const testimonials = $derived(coursePageQuery?.current?.testimonials ?? []);

  /**
   * The course the sections render against — a DELIBERATELY MIXED object, and the
   * mix is the point.
   *
   * `id` is the page draft's subject. `slug`/`title` are the DRAFT's, not the
   * course row's, because `saveJourneyPage` keeps the subject course in lockstep
   * with the page (`cascadeCourseFromPage`: "the course's `slug`/`title` follow the
   * page's"), so the draft values are what the course WILL hold the moment this
   * page is saved — and the top bar's title input therefore updates the canvas's
   * heading fallbacks live, which is what a WYSIWYG surface owes its author.
   *
   * `kicker`/`lede` have no page-level twin at all: they are course columns with no
   * control in this builder, so the only honest source is the course row. Absent
   * them, `HeroSection`'s `p.eyebrow ?? context.course.kicker` and
   * `p.subheadline ?? context.course.lede` drew NOTHING in the canvas and drew
   * both lines on the published page — so a creator who cleared the hero eyebrow
   * to inherit their kicker saw the canvas go blank and typed the kicker in by
   * hand, storing a duplicate of a value the page would have inherited.
   *
   * `stageCount`/`practiceCount` are deliberately left to the adapter, which
   * derives them from the curriculum read — the same numbers, from the read the
   * builder already has, and they follow an unsaved curriculum edit.
   */
  const course = $derived({
    id: draftQuery?.current?.subjectId ?? '',
    slug: draftQuery?.current?.slug ?? '',
    title: draftQuery?.current?.title ?? '',
    kicker: courseFacts?.kicker ?? null,
    lede: courseFacts?.lede ?? null,
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

  /**
   * Is the section rail currently showing the ADD panel rather than the list?
   *
   * `SectionList` owns the flip (its Add button opens it, its Back button closes
   * it) and reports it up here for ONE reason: the panel replaces the rail's
   * content, and a catalogue of section types needs more than the 260px the list
   * needs. The route owns the column width, so the route has to be told. Without
   * this the panel renders correctly and cramped — which is the half of the
   * complaint ("give more space to it") that a replacement alone does not fix.
   */
  let picking = $state(false);
  let previewMode = $state(false);
  let saving = $state(false);

  /**
   * The canvas's "« Sections" toggle.
   *
   * IT STAYS VISIBLE IN THE FIVE SETTINGS MODES, where the rail does not exist at
   * all (`{#if mode === 'design'}` in the shell below), so pressing it there used
   * to do nothing — the same dead-control shape as a decorative input. It now
   * switches BACK to Design and shows the rail, which is what a press of a button
   * labelled "Sections" should mean in every mode. Hiding the button outside
   * Design was the alternative, but it lives in `JourneyBuilderCanvas`, and a
   * control that takes you to its own surface is more use than one that vanishes.
   *
   * It matters more below lg than above it: there the rail is a BAND in a stack
   * rather than a column, so this is the only way to collapse it and hand the
   * height back to the canvas.
   */
  function toggleRail(): void {
    if (mode !== 'design') {
      mode = 'design';
      railCollapsed = false;
      return;
    }
    railCollapsed = !railCollapsed;
  }

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
        // And the STUDIO's own reads, which that `invalidate` does NOT touch:
        // `invalidate(resource)` re-runs `load` functions only. SvelteKit re-runs
        // remote queries from an invalidation pass exclusively behind its internal
        // `force_invalidation` flag, and only `invalidateAll()` / `refreshAll()`
        // set it — so Save toasted success while the canvas went on drawing the
        // PRE-SAVE price and the PRE-SAVE media until a hard reload.
        //
        // These are exactly the two queries this save writes, and the two the
        // canvas is deliberately fed INSTEAD of the draft's own offer/media bags
        // (see `offerQuery`'s "AUTHORITATIVE, never the page's own offer bag"
        // note). That is what makes their staleness dangerous rather than merely
        // untidy: they render a plausible OLDER number, so the builder quietly
        // contradicts the page it just published instead of showing a gap.
        //
        // Scoped, not `invalidateAll()`: the creator waits on these round trips,
        // and the route's other three queries answer nothing any leg here wrote.
        refreshQueries: ({ offer, media }) =>
          Promise.all([
            offer ? offerQuery?.refresh() : undefined,
            media ? sellPreviewQuery?.refresh() : undefined,
          ]),
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
   * The page's SHAPE problems that must not reach a published page, as copy.
   *
   * `validatePageShape` was written for this call site and had none: its
   * `PageShapeIssue` doc states that "`error` shapes must not reach a PUBLISHED
   * page — the builder's publish action blocks on them and the service rejects
   * them", and the publish action had never heard of it. Two of those shapes are
   * one gesture away — `sections: []` is what `createJourney` INSERTS, and a
   * second hero is one press of Duplicate.
   *
   * ONLY THE `error` SEVERITIES BLOCK. `no-hero` and `hero-not-first` are `warn`
   * by design — opening on an ache, or putting a turn above the hero, are real
   * editorial choices — and a publish button is the wrong place to argue with a
   * creator's taste: blocking on taste is how a gate gets worked around. Stated
   * honestly, nothing surfaces the two warnings ANYWHERE yet; their inline home is
   * the section rail or the canvas frame, and it is not this function.
   *
   * ONE MESSAGE PER CODE, because "this page cannot be published" gives a creator
   * nothing to do next. An unknown future `error` code still BLOCKS, with the
   * generic message: a widened enum cannot open a hole here by defaulting to
   * silence, and the fallback is a reminder to add the specific copy.
   */
  function shapeBlockers(): string[] {
    return validatePageShape(pageBuilder.sections)
      .filter((issue) => issue.severity === 'error')
      .map((issue) => {
        if (issue.code === 'empty-page')
          return m.studio_builder_publish_blocked_empty();
        if (issue.code === 'multiple-hero')
          return m.studio_builder_publish_blocked_two_heroes();
        if (issue.code === 'no-cta')
          return m.studio_builder_publish_blocked_no_cta();
        return m.studio_builder_publish_blocked_generic();
      });
  }

  /**
   * Is this section prop a COPY field — words a visitor reads and the creator can
   * edit — rather than an appearance choice?
   *
   * The discriminator is the inspector's own control type, because that is what
   * decides whether the value is prose: `text`/`textarea` are the copy controls,
   * while `select`/`toggle`/`number`/`media` are choices. Reading it from
   * `section-fields.ts` rather than re-listing keys here means a field that
   * changes control type cannot leave a stale list behind.
   */
  function isSeedCopyField(type: string, key: string): boolean {
    const field = fieldsForSectionType(type).find((f) => f.key === key);
    return field?.control === 'text' || field?.control === 'textarea';
  }

  /**
   * THE PUBLISH GATE — the one function both ways of publishing go through.
   *
   * TWO CHECKS, TWO DIFFERENT STRENGTHS, in this order:
   *
   *  1. THE SHAPE BLOCKS. An empty page, two heroes, or a sales page with nowhere
   *     to press are not choices, they are mistakes with no reading that helps a
   *     visitor — so this refuses, names them, and nothing is written.
   *  2. THE PLACEHOLDER COPY ASKS. `seededSections` reports the sections still
   *     holding the catalogue's OWN words verbatim — "A common question?",
   *     "First L.", "2,400 and counting". That last one is not merely unpolished:
   *     it is a specific factual claim about the creator's business that the
   *     creator never made. But "identical to the catalogue's" is a strong hint
   *     and not a certainty (a creator may legitimately want "Who holds this" as
   *     their guide heading), so it is ONE confirm naming the sections, and accept
   *     proceeds. Never a block.
   *
   * SHAPE FIRST, because asking "publish anyway?" about placeholder copy on a page
   * that cannot be published at all is a question with no useful answer.
   *
   * THE PENDING SECTIONS, not the saved baseline: publish saves the draft, so the
   * copy about to go public is the pending copy.
   *
   * `confirm()` rather than a modal, matching the archive confirm below it — the
   * builder has one destructive-confirmation idiom and this is it. A modal is the
   * right eventual home for a message naming several sections; it is not worth a
   * second idiom in the same top bar today.
   */
  function passesPublishGate(): boolean {
    const blockers = shapeBlockers();
    if (blockers.length > 0) {
      toast.error(blockers.join(' '));
      return false;
    }

    // COPY ONLY, and this filter is load-bearing — MEASURED against the live
    // fixture, not assumed. `seededSections` reports every key whose seed is a
    // non-empty STRING, and the catalogue seeds string ENUMS as well as copy:
    // `hero.bg` seeds `'ember'`, which is the Background SELECT's default. So
    // every one of the seven seeded pages here reported its hero as "still
    // holding the example words it came with" on the strength of an atmosphere
    // choice — a false positive on the loudest section of every page, in a
    // confirm whose whole value is that a creator believes it.
    //
    // `text`/`textarea` are the two copy controls (`section-fields.ts`), so a
    // seeded key is only WORDS if its field is one of them. A seeded key with no
    // field at all is also skipped deliberately: it is unauthorable in this
    // builder, so naming its section would send a creator looking for a control
    // that does not exist.
    const seeded = seededSections(pageBuilder.sections).filter((section) =>
      section.keys.some((key) => isSeedCopyField(section.type, key))
    );
    if (seeded.length === 0) return true;

    // DEDUPED and ORDERED as the page reads: two Proof sections both untouched
    // must not name "Proof, Proof", and the order is the order a visitor meets
    // them, so the creator can walk down the page fixing them.
    const labels: string[] = [];
    for (const section of seeded) {
      if (!labels.includes(section.label)) labels.push(section.label);
    }

    // Paraglide 1.11.8 has NO plural support, so the singular is its own key and
    // the call site chooses — never an ICU `{count, plural, …}`, which does not
    // compile in this project.
    return labels.length === 1
      ? confirm(m.studio_builder_confirm_seed_copy_one({ section: labels[0] }))
      : confirm(
          m.studio_builder_confirm_seed_copy({ sections: labels.join(', ') })
        );
  }

  /**
   * Publish = flip the status and save. The success toast fires ONLY when the
   * write landed; on failure the status is rolled back to what it was so the
   * builder does not sit there claiming "Published" over an unpublished page.
   *
   * GATED FIRST, and before the status is written: a refused publish must leave
   * the draft exactly as it was, and writing-then-rolling-back would leave it
   * dirty (and the history holding a step) for a publish that never happened.
   */
  async function handlePublish(): Promise<void> {
    if (!passesPublishGate()) return;
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
   * call `preventDefault`. A clean draft got no prompt at all before this guard
   * existed, so the author simply lost their place. "View live ↗" is the way out
   * to the real page, and it opens a new tab.
   *
   * (3a) AND IT KNOWS ABOUT FULL-WIDTH PREVIEW, because two correct changes were
   * composing into a wrong result. `JourneyBuilderCanvas.onBlockClick` cancels a
   * CTA click in EDITABLE mode and deliberately exempts preview
   * (`editable === false`) — "there the author has explicitly asked to see the
   * page behave, and the links are the page". This backstop then cancelled
   * unconditionally, so NEITHER mode navigated and the canvas's exemption was
   * dead in the browser: test-proven on one side, inert on the other.
   *
   * The resolution keeps BOTH intents, and the ordering of the predicate is the
   * whole of it — `!previewMode || isDirty`:
   *   · EDITING (`!previewMode`): cancel, exactly as before. A click on a price
   *     card is an edit gesture, not a navigation.
   *   · FULL-WIDTH PREVIEW, CLEAN: let it through. This is the deliberate act the
   *     canvas exempts, and there is no unsaved work to protect.
   *   · FULL-WIDTH PREVIEW, DIRTY: still cancel. Losing unsaved work is worse
   *     than a blocked click, and this is the one case where the toast's second
   *     sentence is not merely accurate but the precise instruction — "View live"
   *     SAVES FIRST and refuses to open on a failed save (see `handleViewLive`),
   *     so it is the way to reach the real page without dropping the draft.
   * `previewMode` is the "Full width" toggle, not a separate route, so the guard
   * stays local state rather than anything the URL carries.
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
   * Write the status select's choice, gating the two values that change what the
   * public site holds. Re-reads the draft on refusal so the control cannot show a
   * status the page does not have.
   *
   * THIS IS THE OTHER WAY TO PUBLISH, and a gate on the Publish button alone is a
   * gate with a dropdown beside it: choosing "Published" here writes
   * `status: 'published'` into the draft, and the next Save takes the page live
   * and cascades the subject course to published with it. So the same
   * {@link passesPublishGate} runs — the shape blockers and the placeholder-copy
   * confirm — for the same reason and with the same strengths.
   *
   * Only `published` and `archived` are gated. Draft has nothing to check: it
   * takes a page OFF the public site, which is the one direction that cannot ship
   * unauthored copy or a broken shape to a visitor.
   */
  function setStatus(select: HTMLSelectElement): void {
    const next = select.value as PageStatus;
    if (next === 'published' && !passesPublishGate()) {
      select.value = pageBuilder.pending?.status ?? 'draft';
      return;
    }
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
      // Editing, or unsaved work in preview — see (3) and (3a) above.
      if (!previewMode || isDirty) {
        navigation.cancel();
        toast.info(m.studio_builder_toast_ctas_inert());
        return;
      }
      // Preview mode with a clean draft: the links ARE the page. Fall through so
      // the ordinary dirty checks below see it too (they are no-ops when clean).
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
  <!--
    `data-studio-fullbleed` is the OPT-IN the studio shell honours (see
    `studio/+layout.svelte`): it drops the shell's content cap and its padding for
    this route only. Every one of this route's four tails carries it, because all
    four are `100dvh` surfaces — and a `100dvh` child of a padded container
    overflows by twice the padding (measured: document scrollHeight 948 against
    clientHeight 900 at 1440x900, so the bottom of all three panes sat below the
    fold and the studio grew a scrollbar it should never have).

    It is an ATTRIBUTE ON THIS ELEMENT rather than a rule in the shell keyed on
    the pathname, so the shell needs no knowledge of which routes are full-bleed
    and no other studio page changes.
  -->
  <div
    class="jb"
    data-studio-fullbleed
    data-mode={mode}
    class:jb--preview={previewMode}
    class:jb--rail-collapsed={railCollapsed}
    class:jb--picking={picking}
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
          <SectionList onpickingchange={(next) => (picking = next)} />
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
          onToggleRail={toggleRail}
          {slug}
          {orgDomain}
          {stages}
          {course}
          {offer}
          {checkoutUrl}
          {dashboardUrl}
          {testimonials}
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
  <div class="jb-empty" role="alert" data-studio-fullbleed>
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
  <div class="jb-empty" data-studio-fullbleed>
    <p class="jb-empty__title">{m.studio_builder_missing_title()}</p>
    <p class="jb-empty__body">
      {m.studio_builder_missing_body()}
    </p>
    <div class="jb-empty__acts">
      <a class="jb-empty__link" href="/studio/journeys">{m.studio_builder_all_portals()}</a>
    </div>
  </div>
{:else}
  <div class="jb-loading" aria-busy="true" data-studio-fullbleed><p>{m.studio_builder_loading()}</p></div>
{/if}

<style>
  /*
    `minmax(0, 1fr)` on the implicit column is load-bearing: the default `auto`
    track is sized to its item's max-content, so the top bar's min-content width
    would push the whole workspace wider than the viewport and give the page a
    horizontal scrollbar. Capping the track lets the bar wrap instead.
  */
  /*
    `100dvh` STAYS, and `height: 100%` was tried and rejected — worth recording,
    because "take the shell's row instead of guessing the viewport" is the obvious
    fix for F37 and it does not work here. Measured: `.org-main` between the org
    layout and the studio layout is a plain block with auto height, so
    `.studio-layout` carries `min-height: 100vh` and NO definite height; its `1fr`
    row therefore sizes to content, the studio column's row does too, and a child
    asking for `100%` is asking a circular question. The result was the whole
    workspace growing to its content — `.jb` 3532px tall at a 900px viewport, with
    every pane's internal scroll gone.

    So the viewport unit is the honest answer for a surface whose ancestors hand it
    no definite height, and what F37 was actually about is the INSET: the shell
    padded this route by `--space-6` on every side, so a `100dvh` child overflowed
    its own container by 48px (measured, document scrollHeight 948 against
    clientHeight 900 at 1440x900) and the bottom of all three panes sat below the
    fold. That is what the `data-studio-fullbleed` opt-in on the element above
    removes. Making `100%` work would mean giving `.org-main` a definite height,
    which is a different file and a wider blast radius.
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

  /*
    The add panel needs a wider first column than the list does: it lays section
    types out in a grid, and the picker's own sizing is chosen against this width
    (3 columns fit at 420px, 4 do not). Instant, not transitioned — nothing else in
    this shell animates its columns, and a width tween here would drag the canvas
    with it on every open.

    Ordered AFTER `--rail-collapsed` deliberately: a collapsed rail has no Add
    button to press, so the two cannot both apply, and if that ever changes
    collapsed should win over widened rather than fight it.
  */
  .jb--picking[data-mode='design'] .jb__shell {
    grid-template-columns: 420px minmax(0, 1fr) 360px;
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

  /*
    ── below lg: three columns become one stack, and every panel stays reachable ──

    THIS BLOCK USED TO BE `display: none` ON ALL THREE PANELS while the six mode
    tabs stayed enabled. Measured at 834x1112 and at 390x844: pressing "Pricing"
    flipped `aria-pressed` and `data-mode`, and the panel it selects measured 0x0
    — no panel, no message, no hint that the surface exists on a wider screen.
    Same for Look, Media, Brand, SEO, and for the whole section inspector in
    Design mode. A control that accepts the press and does nothing is the exact
    shape three rounds of this effort removed from the public page.

    THE TARGET IS MADE REACHABLE RATHER THAN THE TABS DISABLED, because the
    canvas is already honest at these widths: it renders the chosen device's real
    width and states its own scale ("Tablet · 834px · 94%"), so at 834 and at 390
    the preview is near 1:1 and genuinely editable. The only thing missing was
    somewhere to put the panels. One code path, no mobile-only component: the
    same `<aside>` elements, restacked.

    THE ORDER IS PANELS-THEN-CANVAS, and that is the whole point. The canvas sits
    between the two Design-mode panels in DOM order (outline · canvas ·
    inspector), which is the right three-COLUMN order and the wrong stacking
    order: the inspector would land under a 70dvh canvas and a tab press would
    still look inert until you scrolled. `order` on the canvas keeps every
    control contiguous under the tabs, so pressing a tab reveals its panel with
    no scrolling at all — which is the defect being repaired.
  */
  @media (--below-lg) {
    /*
      THE WINDOW BECOMES THE SCROLLER, because the stack is taller than one screen
      by design: a panel band, then the canvas. A fixed `100dvh` here would cap the
      stack at one viewport and clip the canvas off the bottom of it, so the height
      is released and the floor kept — the floor is what stops a short draft (two
      sections, Brand mode) floating in a part-painted surface.

      THE ONE THING THIS CANNOT FIX FROM INSIDE THE ROUTE: below lg the shell puts
      its own mobile top bar (65px measured) above this route, so `100dvh` is 65px
      more than the room there is, and a page SHORTER than the viewport carries a
      65px tail of scroll. Every real draft measured here is far taller than one
      viewport, so it shows only on the loading and not-found tails. Fixing it
      exactly needs the shell to hand over a definite row, which needs a definite
      height on `.org-main` — see the note on `.jb` above.
    */
    .jb,
    .jb-loading,
    .jb-empty {
      height: auto;
      min-height: 100dvh;
    }

    .jb__shell,
    .jb[data-mode='look'] .jb__shell,
    .jb[data-mode='pricing'] .jb__shell,
    .jb[data-mode='media'] .jb__shell,
    .jb[data-mode='brand'] .jb__shell,
    .jb[data-mode='seo'] .jb__shell {
      grid-template-columns: minmax(0, 1fr);
    }

    /*
      Bands in a stack, not columns. Two changes only:

      · A HEIGHT CAP, because the shell's rows are now content-sized. The panels
        already scroll themselves (`overflow-y: auto` above, unchanged — so a band
        behaves exactly like the column it replaces), but with nothing to size
        against, an uncapped band grows and pushes the canvas out of reach:
        measured at 834 in Design mode with the hero selected, the inspector alone
        was 3146px tall and put the canvas 3649px down the page. Capped, the
        canvas is always about one screen below the tabs, whichever panel is open.
      · ONE BOTTOM EDGE, because a `border-right` on a full-width band is a
        hairline down the middle of nothing.
    */
    .jb__outline,
    .jb__settings,
    .jb__inspector {
      max-height: 60dvh;
      border-inline: 0;
      border-bottom: var(--border-width) var(--border-style) var(--color-border);
    }

    /*
      Last in the stack, and with a DEFINITE height. `.jbc__stage` inside the
      canvas is `overflow: auto`, which only scrolls against a definite height —
      without one the band grows to the full scaled page (at 834/tablet, 94% of a
      several-thousand-pixel sales page) and takes the window's scroll with it.
    */
    .jb__canvas {
      order: 3;
      height: 70dvh;
    }

    /* Full-width preview has no panel band to share the stack with, so the canvas
       takes the viewport. `dvh` and not `100%` here on purpose: `.jb` is
       `height: auto` in this block, so a percentage has nothing definite to
       resolve against and would collapse to the content height. */
    .jb--preview .jb__canvas {
      height: 100dvh;
    }

    /*
      Six tabs do not fit 390px: measured scrollWidth 466 against clientWidth
      358, inside a studio column that is `overflow-x: clip`, so Brand was cut
      mid-word and SEO could not be pressed at all. They wrap instead. `height`
      must become `min-height` with it — a fixed height clips the second row,
      which is the mistake `.jb__top`'s own comment records.
    */
    .jb__modes {
      flex-wrap: wrap;
      height: auto;
      min-height: var(--space-11, 2.75rem);
      padding: var(--space-1) var(--space-3);
    }
  }
</style>
