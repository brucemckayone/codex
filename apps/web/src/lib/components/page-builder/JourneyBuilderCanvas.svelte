<!--
  @component JourneyBuilderCanvas

  The INLINE WYSIWYG canvas for the journey sales-page builder
  (Codex-2pryk.3.3 · WP-5). Renders the store's sections through the SAME public
  components the live page uses — one {@link SectionFrame} per section — so the
  canvas IS the page, compositions and design axes included (Codex-eckbx W1–W3).

  IT USED TO BE A COPY. `render-edit/` held 8 static twins for 11 public types —
  eight components served all eleven of them (one prose renderer backed
  ache/turn/feel, one video renderer backed introVideo/reel), so nothing was
  MISSING from the canvas; the cost was fidelity, not coverage (Codex-acud8: an
  earlier draft of this comment claimed three types had no twin at all, which sent
  a reader hunting a missing-section bug that never existed — the deleted map at
  `c42868fb^:apps/web/src/lib/page-builder/render-edit/section-registry.ts` keys
  all eleven). The fidelity cost was real and is what the unification bought: the
  canvas emitted none of the nine `data-jp-*` axes (so every design control
  appeared inert), and Hero's six compositions collapsed to two distinguishable
  layouts because only `split-media` had a branch. Every section change had to be
  made twice or the two drifted — and they did.

  The canvas keeps its own section LOOP because it interleaves per-block editing
  chrome, which is why it mounts `SectionFrame` per section rather than
  `SectionRenderer` over the array. Both go through the same frame, so the
  wrapper attributes and the component contract cannot diverge again.

  MOTION is suppressed by `editable`: scroll choreography cannot run correctly
  inside an inner-scrolling device frame (the observer's root is the viewport, so
  a section scrolled to inside the canvas may never intersect and would stay
  armed — invisible — while being edited). Sections take the same immediate-reveal
  path reduced-motion clients get.

  Each block is:
    · selectable  — mousedown selects it (without stealing caret from text)
    · inline-editable — contenteditable copy writes straight to the store
    · block-toolbarred — move ↑/↓, duplicate, add-after, delete (on selection)

  The primary editing surface (the user chose inline WYSIWYG over an iframe): every
  edit mutates the `pageBuilder` store, which the route also streams to the public
  preview bridge for a separate full-width real-page preview. In `editable={false}`
  (Preview mode) the block chrome + contenteditable are off — a clean read-only page.
-->
<script lang="ts">
  import * as m from '$paraglide/messages';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import {
    brandOverridesToStyleAttr,
    /**
     * THE ADAPTER'S OWN INPUT TYPE, and every sales prop below is declared off
     * it rather than off a hand-written shape.
     *
     * This is not tidiness. `course` used to be typed
     * `Pick<JourneyCourseView, 'id' | 'slug' | 'title'>` — a narrower type than
     * `builderSalesContext` accepts — so `kicker` and `lede` were not merely
     * un-passed, they were UNTYPEABLE at the call site: the route could not have
     * handed them over if it had tried, and the guard that asserts "every
     * declared prop is passed" could not see a prop that was never declared.
     * Typed off `BuilderContextInput`, what the adapter accepts is exactly what
     * this component can be given, and a widened adapter cannot silently leave
     * the canvas behind.
     */
    type BuilderContextInput,
    builderSalesContext,
    SectionFrame,
    selectRenderableSections,
  } from '$lib/page-builder/render';
  /* THE COLOUR LADDER. `SectionFrame` carries the axis substrate
     (`journey-design.css` + `journey-sections-shared.css`) but deliberately NOT
     the palette, because the checkout and member dashboard want the ladder
     without any section rules. Every other surface that applies a
     `journey-palette` class therefore imports it for itself, and this one is no
     exception: `--jp-pole-a` is declared ONLY here, and `surface: tint|panel|
     invert` resolve `--jp-sec-bg` through `--jp-ink` down to it.

     NOT UNUSED, despite having no identifier. Until `render-edit/` was deleted
     the canvas got this file by accident — its old `SectionRenderer` imported
     `journey-sections.css`, which `@import`ed the palette. Repointing the canvas
     at `SectionFrame` broke that chain silently, and the three lifted surfaces
     painted nothing here while painting correctly when published.
     `journey-palette.test.ts` now asserts the applies-it/imports-it pair. */
  import '$lib/page-builder/journey-palette.css';
  import {
    ChevronDownIcon,
    ChevronUpIcon,
    CopyIcon,
    PlusIcon,
    TrashIcon,
  } from '$lib/components/ui/Icon';
  import AddSectionPicker from './AddSectionPicker.svelte';
  import {
    type JourneyPreviewDeviceId,
    journeyPreviewDevice,
    journeyPreviewScale,
  } from './journey-preview-canvas';

  interface Props {
    /** Off in Preview mode — hides block chrome + disables contenteditable. */
    editable?: boolean;
    /**
     * Canvas device preset. The canvas renders at that preset's REAL width and
     * scales down to fit the column it has — see `journey-preview-canvas.ts`,
     * which records why relabelling one fixed column was a fidelity defect.
     */
    device?: JourneyPreviewDeviceId;
    /** Sections rail collapsed — the bar's toggle flips it (route owns the state). */
    railCollapsed?: boolean;
    onToggleRail?: () => void;
    /** Page slug + org domain for the read-only address read-out in the bar. */
    slug?: string;
    orgDomain?: string;
    /**
     * The ADMIN curriculum read, passed straight through — the `map` section
     * renders from it. No longer pre-mapped to a builder-only preview shape: the
     * adapter maps `EditorStageView` down to the public `JourneyStageView` the
     * section actually reads, so the canvas and the live page number practices
     * the same way.
     */
    stages?: BuilderContextInput['stages'];
    /**
     * The course being sold. `id`/`slug`/`title` at minimum; the rest of
     * {@link BuilderContextInput.course} is optional and the adapter documents
     * what each absent field degrades to.
     *
     * WHY THE TYPE IS THE ADAPTER'S AND NOT A `Pick`: as a three-field pick, this
     * prop made `kicker` and `lede` untypeable at the call site, so the canvas
     * hero drew NEITHER while the published page drew both from the course row —
     * `HeroSection` reads `p.eyebrow ?? context.course.kicker` and
     * `p.subheadline ?? context.course.lede`, a fallback-to-data pattern pages
     * are expected to rely on. A creator who cleared the hero eyebrow to inherit
     * their kicker saw the canvas go blank and typed the kicker in by hand.
     */
    course?: BuilderContextInput['course'];
    /** The authoritative offer, when loaded. Null ⇒ sections draw a price-less CTA. */
    offer?: BuilderContextInput['offer'];
    /**
     * The journey's PUBLIC checkout + member-dashboard URLs — where the sections'
     * CTAs point (`buildJourneyUrl(..., { surface })`, the same two the public
     * `JourneyRenderer` builds).
     *
     * THE DEFAULTS ARE A FALLBACK, NOT THE INTENDED STATE. These were absent
     * entirely for as long as `offer` was (Codex-4wun2), and the omission was
     * invisible for exactly one reason: with no offer every CTA fell to
     * `hrefFor(null)` → `''` → `safeHref` → `'#'`, so the canvas rendered dead
     * anchors and looked correct. The moment real paths exist that stops holding —
     * `checkoutUrlForPath('', 'purchase')` is `'?offer=purchase'`, which carries no
     * scheme, so `safeHref` passes it through verbatim and every priced card
     * becomes a live RELATIVE link that reloads the builder route out from under
     * the author's unsaved work.
     */
    checkoutUrl?: BuilderContextInput['checkoutUrl'];
    dashboardUrl?: BuilderContextInput['dashboardUrl'];
    /**
     * The course's testimonials — what `ProofSection` renders.
     *
     * DECLARED LAST AND FOUND LAST, and the reason is worth keeping: this prop
     * did not exist, so the canvas passed nothing, `builderSalesContext` filled
     * its documented `[]`, and `ProofSection` drew its empty state while the
     * published page rendered the real `course_testimonials` rows. That was
     * invisible for as long as the table was empty for every course — a latent
     * divergence waiting for the first creator to add a quote, and one no
     * declared-prop guard could see, because nothing was declared.
     */
    testimonials?: BuilderContextInput['testimonials'];
    /**
     * The course's RESOLVED sell media — the hero's still and clip, the intro and
     * reel manifests, the guide's portrait.
     *
     * Already-resolved rather than a promise, because `builderSalesContext` wraps
     * it: the public page streams this off its critical path, and the studio has
     * it in hand from an ordinary client query.
     *
     * Null ⇒ every media-bearing section draws its media-less fallback, which is
     * the correct answer for a course that has picked no media and was the ONLY
     * answer before Codex-bvhcr.
     */
    sellPreview?: BuilderContextInput['sellPreview'];
  }

  let {
    editable = true,
    device = 'desktop',
    railCollapsed = false,
    onToggleRail,
    slug = '',
    orgDomain = '',
    stages = [],
    course,
    offer = null,
    checkoutUrl = '',
    dashboardUrl = '',
    testimonials = [],
    sellPreview = null,
  }: Props = $props();

  const sections = $derived(pageBuilder.sections);
  /**
   * The SAME selection the public renderer makes — enabled, known-type, with the
   * same anchor-id scheme (ordinal suffixes for duplicate types). Using this
   * rather than a local `.filter(s => s.enabled)` is what keeps an unknown type
   * from rendering here but not on the page, and keeps `#ache-2` meaning the same
   * section in both.
   */
  const renderables = $derived(selectRenderableSections(sections));
  const selectedId = $derived(pageBuilder.selectedSectionId);

  /**
   * The render context the public sections expect, assembled from what the studio
   * has. Rebuilt when its inputs change; `enrolled` is always false so the author
   * sees the pre-purchase page a prospective member sees.
   *
   * `sellPreview` was MISSING here (Codex-bvhcr), and because
   * `builderSalesContext` defaults it to null the omission was silent: `hero`,
   * `introVideo`, `reel` and `guide` each drew their media-less fallback — a
   * synthetic plate, no clip, the guide's monogram — while the same stored page
   * rendered the real media publicly. What an author sees is meant to be what a
   * visitor gets, which is the entire point of mounting the public components
   * here, and A75 sharpened the cost: the `media` mode control it added had its
   * whole effect hidden on the surface where you author it.
   *
   * `offer` had the SAME shape of omission one bead later (Codex-4wun2): declared
   * here, forwarded here, and never handed in by the route — so `context.offer`
   * was always null, `deriveOfferPaths` always returned `[]`, and the author edited
   * the invite section against `InviteSection`'s price-less branch while the
   * published page priced itself. The whole Pricing panel was invisible on the
   * WYSIWYG surface. `checkoutUrl`/`dashboardUrl` travel with it because they are
   * only harmless while there are no paths to link (see their prop docs).
   *
   * `testimonials`, and inside `course` the `kicker`/`lede` pair, were the LAST
   * three of the same class, and they hid one level deeper: the two fields were
   * absent from the `course` prop's TYPE and the collection had no prop at all, so
   * nothing about them was observable at the call site or to the route→canvas
   * guard. Every field `builderSalesContext` accepts is now a prop typed off
   * `BuilderContextInput`, which is what makes the guard's list complete
   * (`__tests__/builder-canvas-wiring.test.ts` walks that type, not this
   * interface).
   */
  const salesContext = $derived(
    builderSalesContext({
      course: course ?? { id: '', slug: slug, title: pageBuilder.pending?.title ?? '' },
      stages,
      offer,
      checkoutUrl,
      dashboardUrl,
      testimonials,
      sellPreview,
    })
  );

  /** The page-level design defaults each section overrides per axis. */
  const pageDesign = $derived(pageBuilder.pending?.design);

  /**
   * The page's brand overrides as a `style` declaration — the OTHER half of
   * page-level styling, which the public page gets from `JourneyRenderer` and the
   * canvas used to skip entirely, so `PageBrandPanel` wrote overrides nothing here
   * could show (the second half of Codex-6nrsk).
   *
   * Applied per SECTION rather than on `.jbc-page`, and that placement is
   * load-bearing. `tokenOverridesToCssVars` maps any non-`--brand-` key to
   * `--color-<key>`, so a page's overrides CAN re-point `--color-surface*` /
   * `--color-border*` — the very tokens the in-canvas block affordances (tags,
   * toolbars) read and need to keep studio-neutral. Scoping the declaration to a
   * wrapper around the section alone lets it reach the section by inheritance
   * while leaving the chrome outside it.
   */
  const brandStyle = $derived(
    brandOverridesToStyleAttr(pageBuilder.pending?.brandOverrides)
  );

  const indexOf = (id: string): number => sections.findIndex((s) => s.id === id);

  /* ── THE DEVICE FRAME ─────────────────────────────────────────────────────
     The canvas renders at the preset's real width and is scale-transformed to
     fit the column. `transform: scale()` and not `zoom`: both keep container
     queries honest (the element genuinely IS 1440px in its own coordinate
     space), but a transform also makes any `position: fixed` descendant resolve
     against the transformed ancestor, so the sales page's own floating CTA stays
     INSIDE the canvas instead of escaping to the studio viewport. */
  const frame = $derived(journeyPreviewDevice(device));

  /**
   * The creator-facing name of the previewed device.
   *
   * `JOURNEY_PREVIEW_DEVICES` is a GEOMETRY table — widths, heights and the
   * `NNNpx` label `canvas-device-frame.svelte.test.ts` pins — so its `label` is
   * left as raw data and the localised name is resolved here, from the same
   * three message keys the route's device switch reads. One device, one name.
   */
  function deviceLabel(id: JourneyPreviewDeviceId): string {
    if (id === 'tablet') return m.studio_builder_device_tablet();
    if (id === 'mobile') return m.studio_builder_device_mobile();
    return m.studio_builder_device_desktop();
  }

  /** The stage's CONTENT width (padding excluded) — see the observer below. */
  let stageWidth = $state(0);
  /** The page's own UNSCALED height, so the outer box can reserve `h × k`. */
  let pageHeight = $state(0);
  let stageEl = $state<HTMLElement | null>(null);
  let pageEl = $state<HTMLElement | null>(null);

  const scale = $derived(journeyPreviewScale(stageWidth, frame.width));
  /** Shown to the author: a silently-scaled canvas is its own kind of lie. */
  const scalePercent = $derived(Math.round(scale * 100));

  /**
   * Track the column and the page with ONE `ResizeObserver`, not a window
   * resize listener: collapsing the sections rail or switching mode tabs
   * changes the column width without changing the window, and those are the
   * two most common ways an author changes it.
   *
   * `contentRect` rather than `getBoundingClientRect`, for two different
   * reasons on the two targets. On the stage it excludes the padding, which is
   * the space the frame cannot use. On the page it is the PRE-TRANSFORM box —
   * a bounding rect would report `h × k` and feeding that back in would shrink
   * the frame on every pass.
   *
   * No feedback loop: the page's height depends on its own content and its
   * width, never on the outer box's height, so setting `--jbc-h` cannot resize
   * what produced it.
   */
  $effect(() => {
    const stage = stageEl;
    const page = pageEl;
    if (!stage || !page) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === stage) stageWidth = entry.contentRect.width;
        else if (entry.target === page) pageHeight = entry.contentRect.height;
      }
    });
    observer.observe(stage);
    observer.observe(page);
    return () => observer.disconnect();
  });

  /**
   * The frame's geometry, as custom properties.
   *
   * `--jbc-cs` (the counter-scale, 1/k) is computed HERE rather than as
   * `calc(1 / var(--jbc-k))` so the CSS does not depend on division by a
   * non-literal number, and it exists because the editing chrome must not
   * shrink with the page: at desktop k ≈ 0.49, and a 14px trash icon drawn at
   * 7px is not a control any more.
   *
   * `--jp-device-vh` re-points the sections' `svh` basis (`--jp-stage-vh` in
   * `journey-design.css`). `svh` resolves against the BROWSER viewport even
   * inside a fixed-width transformed box, so at device=mobile a hero sized
   * `100svh` was 373px wide by the STUDIO WINDOW's height — measured 373 × 900,
   * aspect 0.414, where a real 390 × 844 phone gives 0.462. Unset on desktop on
   * purpose: there the studio window really is a desktop viewport, so the live
   * `svh` is the honest number and a pinned one would misreport a tall monitor.
   */
  const frameStyle = $derived(
    [
      `--jbc-w: ${frame.width}px`,
      `--jbc-h: ${pageHeight}px`,
      `--jbc-k: ${scale}`,
      `--jbc-cs: ${scale > 0 ? 1 / scale : 1}`,
      frame.height === null
        ? ''
        : `--jp-device-vh: ${frame.height / 100}px`,
    ]
      .filter(Boolean)
      .join('; ')
  );

  /* ── BLOCK ORDER, IN THE ORDERING THE AUTHOR CAN SEE ──────────────────────
     The toolbar's move buttons used to index into the FULL section list while
     the canvas renders only `renderables` (enabled, known type). With a hidden
     section between two visible ones — one click of the rail's eye toggle — the
     button was ENABLED, the store mutated, the page went dirty, and the visible
     order did not change, because the section had swapped with something that
     is not drawn. Twice in a row it looked like it worked every other click.
     The rail's own arrows were always correct (`SectionList` iterates all
     sections), so the two panes disagreed about the same control. */
  const visibleIndexOf = (id: string): number =>
    renderables.findIndex((entry) => entry.section.id === id);

  /**
   * Move a section past its neighbouring VISIBLE section — an absolute-index
   * move rather than a ±1 swap, so a hidden section in between is stepped over
   * rather than swapped with.
   *
   * `moveSectionTo` is a splice-move (remove, then insert at the target), which
   * is the SAME semantic the rail's drag-reorder already gives an author, so the
   * two panes agree. Its visible consequence: a hidden section between the two
   * moved sections shifts by one slot rather than staying put. That is
   * deliberate — it keeps one reorder primitive in the store instead of adding a
   * swap that only the canvas would use, and a hidden section has no position an
   * author can see. It is NOT dropped: `moveSectionTo` splices within the one
   * list, and the test asserts all three sections survive the move.
   */
  function moveVisible(id: string, delta: -1 | 1): void {
    const neighbour = renderables[visibleIndexOf(id) + delta];
    if (!neighbour) return;
    pageBuilder.moveSectionTo(id, indexOf(neighbour.section.id));
  }

  /** A section's human label — the accessible name every block action needs. */
  const labelFor = (section: { name?: string | null; type: string }): string =>
    section.name ?? section.type;

  // In-canvas "add after this block" floating picker.
  let addAfterId = $state<string | null>(null);
  let addPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  /**
   * The toolbar button the popover was opened from, so focus can go back to it.
   *
   * WHY IT IS KEPT AT ALL. This popover is `position: fixed` beside the block's
   * toolbar but rendered as the LAST child of the component, after the whole
   * scrolling stage. So the tab order and the visual order disagree completely:
   * a creator who reached "Add a section after this" with the keyboard, pressed
   * it, and then pressed Tab landed on whatever follows the canvas — never in the
   * picker that had just appeared under their cursor. The picker was therefore
   * mouse-only in practice, on the surface whose keyboard path was deliberately
   * built out (see `onBlockKeydown`). Moving focus IN closes that; putting it BACK
   * is the other half, because a popover that dumps focus at the top of the
   * document on Escape is its own trap.
   *
   * Not `$state` — nothing renders from it, and a plain binding avoids a
   * pointless reactive read inside the two handlers that use it.
   */
  let addAnchorEl: HTMLElement | null = null;

  function openAdd(afterId: string, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    addPos = {
      x: Math.min(r.left, window.innerWidth - 288),
      y: Math.min(r.bottom + 6, window.innerHeight - 360),
    };
    addAnchorEl = anchor;
    addAfterId = afterId;
  }

  /**
   * Close the popover and return focus to the button that opened it.
   *
   * `isConnected` is checked because ADDING a section re-keys the `{#each}`, so
   * the anchor button this was opened from can be gone by the time we come to
   * focus it. A `focus()` on a detached node silently moves focus to `<body>`,
   * which is the trap this function exists to avoid — so it is skipped rather
   * than attempted.
   */
  function closeAdd(): void {
    addAfterId = null;
    const anchor = addAnchorEl;
    addAnchorEl = null;
    if (anchor?.isConnected) anchor.focus();
  }

  function onAdd(type: string): void {
    if (addAfterId) pageBuilder.addSection(type, addAfterId);
    closeAdd();
  }

  function onEditProp(id: string, key: string, value: string): void {
    pageBuilder.setSectionProp(id, key, value);
  }

  // A block-toolbar button must not steal the mousedown selection nor bubble it.
  function stop(event: Event): void {
    event.stopPropagation();
  }

  /**
   * IN EDITABLE MODE THE PAGE'S OWN LINKS MUST NOT NAVIGATE.
   *
   * This is the cost of the fidelity win in `Codex-4wun2`: the canvas now
   * receives the real `offer` and the real `checkoutUrl`, so every priced card,
   * hero CTA and invite button is a LIVE link to the real checkout instead of
   * the dead `'#'` they resolved to while `offer` was null. Right for fidelity,
   * wrong for an editor — clicking a price card to edit its copy navigated the
   * author out of the builder, taking unsaved work with it behind a confirm
   * dialog. Selecting the block is what a click anywhere else in it already
   * does, so that is what a click on a link does too.
   *
   * PREVIEW MODE IS LEFT ALONE (`editable === false`): there the author has
   * explicitly asked to see the page behave, and the links are the page.
   *
   * Bound on the block wrapper rather than the page so the handler is on the
   * element that owns the selection, and `closest('[data-sec]')` re-derives the
   * id from the DOM rather than trusting the closure — a duplicated section
   * re-uses this handler.
   */
  function onBlockClick(event: MouseEvent, id: string): void {
    if (!editable) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (anchor) event.preventDefault();
    pageBuilder.selectSection(id);
  }

  /**
   * The keyboard path to selecting a block. There was none: selection was
   * `onmousedown` on a plain `<div>`, so the canvas — the primary editing
   * surface — could only be driven with a mouse, and the block toolbar
   * (move/duplicate/add/delete) was reachable only after selecting from the
   * rail.
   *
   * Enter and Space only. Not the arrow keys: a block is a scroll container's
   * child and arrows must keep scrolling the stage.
   */
  function onBlockKeydown(event: KeyboardEvent, id: string): void {
    if (!editable) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // A key press inside a contenteditable field or a toolbar button belongs to
    // that control, not to block selection.
    const target = event.target as Element | null;
    if (target && target !== event.currentTarget) {
      if (target.closest('[contenteditable="true"], button, a[href], input, textarea, select'))
        return;
    }
    event.preventDefault();
    pageBuilder.selectSection(id);
  }
</script>

<div class="jbc" data-editable={editable ? '' : undefined}>
  <div class="jbc__bar">
    {#if onToggleRail}
      <button
        type="button"
        class="jbc__railtoggle"
        aria-pressed={railCollapsed}
        title={railCollapsed
          ? m.studio_builder_canvas_rail_show()
          : m.studio_builder_canvas_rail_collapse()}
        onclick={onToggleRail}
      >
        <span class="jbc__chev" class:jbc__chev--collapsed={railCollapsed} aria-hidden="true">«</span>
        {m.studio_builder_sections()}
      </button>
    {/if}
    <span class="jbc__live"><span class="jbc__live-dot" aria-hidden="true"></span> {m.studio_builder_canvas_live()}</span>
    <span class="jbc__url">{orgDomain || 'your-space'} / journeys / {slug || 'draft'}</span>
    <!-- The scale, stated. An author who reads "Desktop · 1440px · 49%"
         understands why the type looks small; one who reads "Desktop" concludes
         the page is wrong. -->
    <span class="jbc__scale">
      {deviceLabel(frame.id)} · {frame.width}px{scale < 1
        ? ` · ${scalePercent}%`
        : ''}
    </span>
    {#if editable}
      <span class="jbc__hint">{m.studio_builder_canvas_hint()}</span>
    {/if}
  </div>

  <div class="jbc__stage" bind:this={stageEl}>
    <!-- `journey-palette` supplies the colour ladder `.jp` styles read, from the
         same file the live sales page and checkout derive from, so the canvas and
         the real page cannot drift apart again (Codex-gfg50) — see the import
         above, which is what makes this class more than decoration. The canvas
         takes the BASE class only — `--page` would re-point `--color-surface*` /
         `--color-border*`, which the in-canvas block affordances below read and
         need to keep studio-neutral against any page palette. -->
    <!-- The FIT box. `overflow: hidden` plus an explicit `w × k` / `h × k` size
         so the scaled page occupies exactly the space it paints and no phantom
         scrollbar appears; the border, radius and elevation moved here from the
         page because they must be drawn at studio scale, not at 49% of it. -->
    <div class="jbc-fit" style={frameStyle}>
      <div
        class="jbc-page jp journey-palette"
        class:jbc-page--editable={editable}
        data-device={device}
        bind:this={pageEl}
      >
        {#each renderables as entry (entry.section.id)}
          {@const section = entry.section}
          {@const vi = visibleIndexOf(section.id)}
          {@const name = labelFor(section)}
          {@const isSel = editable && selectedId === section.id}
          <!--
            A NON-INTERACTIVE CONTAINER THAT IS NONETHELESS FOCUSABLE, which is
            exactly the shape the two suppressed rules are heuristics against.
            It is deliberate, and the alternative is worse: `role="button"` would
            satisfy the lint and then SWALLOW the section's own contents, because
            a button's children are presentational to several screen readers —
            and this container holds the editable copy and the page's real CTAs.
            So `group` keeps the contents readable, `tabindex` gives the keyboard
            the path to selection that did not exist at all, and Enter/Space
            activate it (`onBlockKeydown` bows out for a key press that belongs
            to a field or a control inside the block).
          -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="jbc-block"
            class:jbc-block--selected={isSel}
            data-sec={section.id}
            role="group"
            aria-label={editable ? m.studio_builder_canvas_section({ section: name }) : undefined}
            aria-current={isSel ? 'true' : undefined}
            tabindex={editable ? 0 : undefined}
            onmousedown={editable ? () => pageBuilder.selectSection(section.id) : undefined}
            onclick={(event) => onBlockClick(event, section.id)}
            onkeydown={(event) => onBlockKeydown(event, section.id)}
          >
            {#if editable}
              <span class="jbc-block__tag">{name}</span>
              {#if isSel}
                <!-- EVERY ACTION IS NAMED. These five were named ONLY by
                     `title`, which is the accessible-name fallback in HTML-AAM
                     but never appears on touch and is not reachable by
                     keyboard — and one of them is a destructive Delete sitting
                     immediately beside Duplicate. The label names the TARGET as
                     well as the verb, because a toolbar of five identical
                     "Delete"s tells a screen-reader user nothing about which
                     section they are about to remove.

                     PHRASED EXACTLY AS THE RAIL PHRASES IT — `Move <name> up`,
                     not `Move the <name> section up`. These are the same five
                     verbs on the same sections as `SectionList`'s row controls
                     (`SectionList.svelte:122`), and the two panes disagreeing
                     about the name of one control is the defect this whole block
                     exists to end. The article also read badly against real
                     data: the seeded sections are named "The ache" and
                     "The map", so the first phrasing announced "Move the The
                     ache section up".

                     Delete does not confirm, and deliberately so: it pushes an
                     undo step (`removeSection` → `snapshot()`), and undo is on
                     the top bar and ⌘Z. A confirm on an undoable action trains
                     people to dismiss confirms. -->
                <div
                  class="jbc-block__bar"
                  role="toolbar"
                  aria-label={m.studio_builder_canvas_block_actions({ section: name })}
                >
                  <button
                    type="button"
                    class="jbc-block__btn"
                    title={m.studio_builder_move_up()}
                    aria-label={m.studio_builder_section_move_up({ section: name })}
                    disabled={vi <= 0}
                    onmousedown={stop}
                    onclick={() => moveVisible(section.id, -1)}
                  >
                    <ChevronUpIcon size={15} />
                  </button>
                  <button
                    type="button"
                    class="jbc-block__btn"
                    title={m.studio_builder_move_down()}
                    aria-label={m.studio_builder_section_move_down({ section: name })}
                    disabled={vi >= renderables.length - 1}
                    onmousedown={stop}
                    onclick={() => moveVisible(section.id, 1)}
                  >
                    <ChevronDownIcon size={15} />
                  </button>
                  <button
                    type="button"
                    class="jbc-block__btn"
                    title={m.studio_builder_inspector_duplicate()}
                    aria-label={m.studio_builder_canvas_duplicate({ section: name })}
                    onmousedown={stop}
                    onclick={() => pageBuilder.duplicateSection(section.id)}
                  >
                    <CopyIcon size={14} />
                  </button>
                  <button
                    type="button"
                    class="jbc-block__btn"
                    title={m.studio_builder_canvas_add_after_title()}
                    aria-label={m.studio_builder_canvas_add_after({ section: name })}
                    onmousedown={stop}
                    onclick={(e) => openAdd(section.id, e.currentTarget)}
                  >
                    <PlusIcon size={15} />
                  </button>
                  <button
                    type="button"
                    class="jbc-block__btn jbc-block__btn--danger"
                    title={m.studio_builder_inspector_delete()}
                    aria-label={m.studio_builder_canvas_delete({ section: name })}
                    onmousedown={stop}
                    onclick={() => pageBuilder.removeSection(section.id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              {/if}
            {/if}

            <!-- `display: contents` — the wrapper exists ONLY to scope the brand
                 declaration; it generates no box, so it cannot change section
                 layout, while custom properties still inherit through it. -->
            <div class="jbc-block__brand" style={brandStyle}>
              <SectionFrame
                renderable={entry}
                context={salesContext}
                {pageDesign}
                {editable}
                onEdit={(key, value) => onEditProp(section.id, key, value)}
              />
            </div>
          </div>
        {/each}

        {#if renderables.length === 0}
          <p class="jbc-empty">{m.studio_builder_canvas_empty()}</p>
        {/if}
      </div>
    </div>
  </div>

  {#if addAfterId}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="jbc-addpop"
      style="left: {addPos.x}px; top: {addPos.y}px;"
      onmousedown={stop}
    >
      <!-- `focusOnMount`, unlike the rail's copy of this picker: see the prop's
           own note. Here the popover is the component's last child, so without it
           the keyboard never reaches the thing the button just opened. -->
      <AddSectionPicker onadd={onAdd} onclose={closeAdd} focusOnMount />
    </div>
    <button
      type="button"
      class="jbc-addpop__scrim"
      aria-label={m.studio_builder_canvas_close_picker()}
      onclick={closeAdd}
    ></button>
  {/if}
</div>

<style>
  /* Box-less: scopes the page brand declaration to the section without becoming
     a layout participant. */
  .jbc-block__brand {
    display: contents;
  }

  .jbc {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  /* ── canvas bar ── */
  .jbc__bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: var(--border-width) var(--border-style) var(--color-border);
    background-color: var(--color-surface);
  }

  .jbc__railtoggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-2);
    border: var(--border-width) var(--border-style) var(--color-border);
    border-radius: var(--radius-md);
    background: none;
    color: var(--color-text-secondary);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jbc__railtoggle:hover {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jbc__chev {
    display: inline-block;
    transition: transform var(--duration-normal) var(--ease-default);
  }

  .jbc__chev--collapsed {
    transform: rotate(180deg);
  }

  .jbc__live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-success-600, var(--color-success));
  }

  .jbc__live-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: currentColor;
    box-shadow: 0 0 8px 1px currentColor;
  }

  .jbc__url {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  .jbc__scale {
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .jbc__hint {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── stage + fit box + page ── */
  .jbc__stage {
    overflow: auto;
    display: grid;
    place-items: start center;
    padding: var(--space-6) var(--space-4);
    background-color: var(--color-surface-secondary);
    background-image: radial-gradient(
      color-mix(in oklab, var(--color-border) 60%, transparent) 1px,
      transparent 1px
    );
    background-size: 22px 22px;
  }

  /* The scaled page's footprint: exactly `w × k` by `h × k`, and `content-box`
     so those two numbers ARE the box rather than the box minus its edges — with
     the repo-wide `border-box` the page would be clipped by a hairline down its
     right edge.

     THE EDGE IS A RING, NOT A BORDER, and that is a measurement not a
     preference. `k` is solved from the stage's CONTENT width, so `w × k` is
     already the exact space available; a 1px border adds 2px of LAYOUT on top of
     it. Measured at device=tablet: stage clientWidth 708, scrollWidth 710 — two
     pixels of horizontal scroll on a pane that is meant to scroll only
     vertically. A `box-shadow` ring is ink overflow, never scrollable overflow,
     so it draws the same hairline and costs no layout. It follows
     `border-radius` like a border does. */
  .jbc-fit {
    box-sizing: content-box;
    width: calc(var(--jbc-w) * var(--jbc-k));
    height: calc(var(--jbc-h) * var(--jbc-k));
    overflow: hidden;
    border-radius: var(--radius-xl);
    box-shadow:
      0 0 0 var(--border-width) var(--color-border),
      var(--shadow-xl);
    background-color: var(--color-background);
  }

  /* THE CONTAINER-QUERY ROOT'S ANCESTOR, at a real device width. `.jp-sec`
     carries `container-type: inline-size`, so this width — not the studio
     column's — is what all 19 `@container` rules in the journey CSS resolve
     against, which is the whole point of the fit box above.

     No width TRANSITION on the device switch, deliberately: animating this
     width would step every container query through every intermediate value,
     re-resolving eight breakpoints per frame and flickering compositions.
     The device toggle is a mode change, not a movement. */
  .jbc-page {
    width: var(--jbc-w);
    transform: scale(var(--jbc-k));
    transform-origin: top left;
  }

  /* ── block selection + chrome ── */
  .jbc-block {
    position: relative;
  }

  /* The keyboard path to selection — see `onBlockKeydown`. Focus is drawn with
     the same ring the selected state uses, counter-scaled like the rest of the
     chrome so it stays a hairline on screen rather than 0.49 of one. */
  .jbc-page--editable .jbc-block:focus-visible {
    outline: calc(var(--border-width-thick) * var(--jbc-cs, 1)) solid
      var(--color-interactive);
    outline-offset: calc(-2px * var(--jbc-cs, 1));
  }

  .jbc-page--editable .jbc-block {
    cursor: pointer;
  }

  .jbc-block::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    outline: 0 solid transparent;
    outline-offset: -1px;
    transition: outline-color var(--duration-fast) var(--ease-default);
    z-index: 40;
  }

  /* ── THE CHROME IS COUNTER-SCALED ───────────────────────────────────────────
     `--jbc-cs` is 1/k. Everything below is editing chrome, not page content:
     at desktop the page is drawn at ~49%, and a 14px trash icon at 7px, a
     hairline at 0.49px and 10px label text are not usable controls. Scaling the
     chrome back up keeps it at studio size on screen while the PAGE stays at
     device size in its own coordinate space — which is the fidelity the frame
     exists for. Every use carries `, 1` so the rules are still correct if the
     property is ever missing. */
  .jbc-page--editable .jbc-block:hover::after {
    outline: calc(var(--border-width) * var(--jbc-cs, 1)) solid
      color-mix(in oklab, var(--color-interactive) 45%, transparent);
  }

  .jbc-block--selected::after {
    outline: calc(var(--border-width-thick) * var(--jbc-cs, 1)) solid
      var(--color-interactive);
    outline-offset: calc(-2px * var(--jbc-cs, 1));
  }

  /* `translateY(-100%) scale()` about the BOTTOM-LEFT origin: the translate is
     applied in the untransformed space, so the tag's bottom edge stays on the
     block's top edge and it grows upward — the same placement it had at scale 1. */
  .jbc-block__tag {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: left bottom;
    transform: translateY(-100%) scale(var(--jbc-cs, 1));
    z-index: 41;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    font-size: var(--text-xs);
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--color-text-on-brand, var(--color-background));
    background-color: var(--color-interactive);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-default);
  }

  .jbc-block:hover .jbc-block__tag,
  .jbc-block--selected .jbc-block__tag {
    opacity: 1;
  }

  .jbc-block__bar {
    position: absolute;
    top: calc(var(--space-2) * var(--jbc-cs, 1));
    right: calc(var(--space-2) * var(--jbc-cs, 1));
    transform-origin: top right;
    transform: scale(var(--jbc-cs, 1));
    z-index: 43;
    display: flex;
    gap: var(--space-0-5);
    padding: var(--space-1);
    border-radius: var(--radius-md);
    background-color: color-mix(in oklab, var(--color-surface) 92%, transparent);
    border: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-lg);
    backdrop-filter: blur(var(--blur-sm));
  }

  .jbc-block__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-7);
    height: var(--space-6);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: var(--transition-colors);
  }

  .jbc-block__btn:hover:not(:disabled) {
    color: var(--color-text);
    background-color: var(--color-surface-secondary);
  }

  .jbc-block__btn:disabled {
    opacity: var(--opacity-40, 0.4);
    cursor: default;
  }

  .jbc-block__btn--danger:hover:not(:disabled) {
    color: var(--color-error-600, var(--color-error));
    background-color: color-mix(in oklab, var(--color-error, red) 14%, transparent);
  }

  /* editable-text affordance — only in the editing canvas */
  .jbc-page--editable :global([data-field]) {
    border-radius: var(--radius-xs, 3px);
    outline: none;
    transition: var(--transition-colors);
  }

  .jbc-page--editable :global([data-field][contenteditable='true']:hover) {
    background-color: color-mix(in oklab, var(--color-interactive) 12%, transparent);
  }

  .jbc-page--editable :global([data-field][contenteditable='true']:focus) {
    background-color: color-mix(in oklab, var(--color-interactive) 10%, transparent);
    box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--color-interactive) 70%, transparent);
  }

  .jbc-empty {
    padding: var(--space-16) var(--space-6);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  /* ── in-canvas add popover ── */
  .jbc-addpop {
    position: fixed;
    z-index: var(--z-popover, 60);
    width: 272px;
    max-height: 60vh;
    overflow-y: auto;
    box-shadow: var(--shadow-xl);
    border-radius: var(--radius-lg);
  }

  .jbc-addpop__scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover, 60) - 1);
    border: 0;
    background: none;
    cursor: default;
  }
</style>
