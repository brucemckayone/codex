<!--
  @component JourneyBuilderCanvas

  The INLINE WYSIWYG canvas for the journey sales-page builder
  (Codex-2pryk.3.3 · WP-5). Renders the store's sections through the SAME public
  components the live page uses — one {@link SectionFrame} per section — so the
  canvas IS the page, compositions and design axes included (Codex-eckbx W1–W3).

  IT USED TO BE A COPY. `render-edit/` held 8 static twins for 11 public types,
  and the cost was not just fidelity: three types had no twin at all, the canvas
  emitted none of the nine `data-jp-*` axes (so every design control appeared
  inert), and Hero's six compositions collapsed to two distinguishable layouts
  because only `split-media` had a branch. Every section change had to be made
  twice or the two drifted — and they did.

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
  import type { CourseOffer, EditorStageView, JourneyCourseView } from '$lib/page-builder';
  import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
  import {
    brandOverridesToStyleAttr,
    builderSalesContext,
    SectionFrame,
    selectRenderableSections,
    type SellPreview,
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

  interface Props {
    /** Off in Preview mode — hides block chrome + disables contenteditable. */
    editable?: boolean;
    /** Canvas device width. */
    device?: 'desktop' | 'tablet' | 'mobile';
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
    stages?: readonly EditorStageView[];
    /** The course being sold — id/slug/title at minimum. */
    course?: Pick<JourneyCourseView, 'id' | 'slug' | 'title'>;
    /** The authoritative offer, when loaded. Null ⇒ sections draw a price-less CTA. */
    offer?: CourseOffer | null;
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
    sellPreview?: SellPreview | null;
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
   */
  const salesContext = $derived(
    builderSalesContext({
      course: course ?? { id: '', slug: slug, title: pageBuilder.pending?.title ?? '' },
      stages,
      offer,
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

  // In-canvas "add after this block" floating picker.
  let addAfterId = $state<string | null>(null);
  let addPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  function openAdd(afterId: string, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    addPos = {
      x: Math.min(r.left, window.innerWidth - 288),
      y: Math.min(r.bottom + 6, window.innerHeight - 360),
    };
    addAfterId = afterId;
  }

  function onAdd(type: string): void {
    if (addAfterId) pageBuilder.addSection(type, addAfterId);
    addAfterId = null;
  }

  function onEditProp(id: string, key: string, value: string): void {
    pageBuilder.setSectionProp(id, key, value);
  }

  // A block-toolbar button must not steal the mousedown selection nor bubble it.
  function stop(event: Event): void {
    event.stopPropagation();
  }
</script>

<div class="jbc" data-editable={editable ? '' : undefined}>
  <div class="jbc__bar">
    {#if onToggleRail}
      <button
        type="button"
        class="jbc__railtoggle"
        aria-pressed={railCollapsed}
        title={railCollapsed ? 'Show the sections panel' : 'Collapse the sections panel'}
        onclick={onToggleRail}
      >
        <span class="jbc__chev" class:jbc__chev--collapsed={railCollapsed} aria-hidden="true">«</span>
        Sections
      </button>
    {/if}
    <span class="jbc__live"><span class="jbc__live-dot" aria-hidden="true"></span> Live</span>
    <span class="jbc__url">{orgDomain || 'your-space'} / journeys / {slug || 'draft'}</span>
    {#if editable}
      <span class="jbc__hint">Click a block to edit · type directly into text</span>
    {/if}
  </div>

  <div class="jbc__stage">
    <!-- `journey-palette` supplies the colour ladder `.jp` styles read, from the
         same file the live sales page and checkout derive from, so the canvas and
         the real page cannot drift apart again (Codex-gfg50) — see the import
         above, which is what makes this class more than decoration. The canvas
         takes the BASE class only — `--page` would re-point `--color-surface*` /
         `--color-border*`, which the in-canvas block affordances below read and
         need to keep studio-neutral against any page palette. -->
    <div
      class="jbc-page jp journey-palette"
      class:jbc-page--editable={editable}
      data-device={device}
    >
      {#each renderables as entry (entry.section.id)}
        {@const section = entry.section}
        {@const i = indexOf(section.id)}
        {@const isSel = editable && selectedId === section.id}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="jbc-block"
          class:jbc-block--selected={isSel}
          data-sec={section.id}
          onmousedown={editable ? () => pageBuilder.selectSection(section.id) : undefined}
        >
          {#if editable}
            <span class="jbc-block__tag">{section.name ?? section.type}</span>
            {#if isSel}
              <div class="jbc-block__bar" role="toolbar" aria-label="Section actions">
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Move up"
                  disabled={i <= 0}
                  onmousedown={stop}
                  onclick={() => pageBuilder.moveSection(section.id, -1)}
                >
                  <ChevronUpIcon size={15} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Move down"
                  disabled={i >= sections.length - 1}
                  onmousedown={stop}
                  onclick={() => pageBuilder.moveSection(section.id, 1)}
                >
                  <ChevronDownIcon size={15} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Duplicate"
                  onmousedown={stop}
                  onclick={() => pageBuilder.duplicateSection(section.id)}
                >
                  <CopyIcon size={14} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn"
                  title="Add a section after this"
                  onmousedown={stop}
                  onclick={(e) => openAdd(section.id, e.currentTarget)}
                >
                  <PlusIcon size={15} />
                </button>
                <button
                  type="button"
                  class="jbc-block__btn jbc-block__btn--danger"
                  title="Delete"
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
        <p class="jbc-empty">No visible sections. Enable one in the rail, or add a section.</p>
      {/if}
    </div>
  </div>

  {#if addAfterId}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="jbc-addpop"
      style="left: {addPos.x}px; top: {addPos.y}px;"
      onmousedown={stop}
    >
      <AddSectionPicker onadd={onAdd} onclose={() => (addAfterId = null)} />
    </div>
    <button
      type="button"
      class="jbc-addpop__scrim"
      aria-label="Close add-section picker"
      onclick={() => (addAfterId = null)}
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

  .jbc__hint {
    margin-left: auto;
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }

  /* ── stage + page ── */
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

  .jbc-page {
    width: 100%;
    max-width: 1080px;
    border-radius: var(--radius-xl);
    overflow: hidden;
    border: var(--border-width) var(--border-style) var(--color-border);
    box-shadow: var(--shadow-xl);
    transition: max-width var(--duration-slow) var(--ease-default);
  }

  .jbc-page[data-device='tablet'] {
    max-width: var(--brand-studio-preview-tablet, 768px);
  }

  .jbc-page[data-device='mobile'] {
    max-width: var(--brand-studio-preview-mobile, 380px);
  }

  /* ── block selection + chrome ── */
  .jbc-block {
    position: relative;
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

  .jbc-page--editable .jbc-block:hover::after {
    outline: var(--border-width) solid color-mix(in oklab, var(--color-interactive) 45%, transparent);
  }

  .jbc-block--selected::after {
    outline: var(--border-width-thick) solid var(--color-interactive);
    outline-offset: -2px;
  }

  .jbc-block__tag {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateY(-100%);
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
    top: var(--space-2);
    right: var(--space-2);
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
