<!--
  @component SectionFrame

  ONE section's wrapper + component invocation — the single place that owns the
  render seam, extracted from {@link SectionRenderer} so the studio canvas can
  reuse it (Codex-eckbx W1–W3).

  WHY THIS EXISTS. The canvas cannot call `SectionRenderer` directly: that takes
  the whole `sections` array and loops it, while the canvas has to interleave its
  own per-block chrome (select target, move/duplicate/delete toolbar, add-after
  affordance) between sections. Before this extraction the canvas answered that
  by keeping a SECOND set of components (`render-edit/`, 8 static twins for 11
  public types) — which is precisely how the two trees drifted: the public side
  never received `variant`, the canvas emitted none of the `data-jp-*` axes, and
  every section change had to be made twice.

  So the array-level concern (which sections render, in what order, under which
  anchor id) stays in `SectionRenderer`/`selectRenderableSections`, and the
  PER-SECTION concern (resolve the composition + the axes, emit them, invoke the
  component) lives here, where both callers reach it. A wrapper attribute added
  here appears on the public page and in the canvas by construction, not by a
  parity test noticing they disagree.

  Resolution happens HERE rather than in each caller, deliberately. Passing an
  already-resolved `variant`/`design` in would let the two trees resolve
  differently — the exact class of bug this replaces. The cost is one object
  literal per section for the page-design carrier, which is not worth trading
  correctness for.

  CE-4: lives under `$lib/page-builder` (PUBLIC_LIB_ROOT) and imports no studio
  editor UI. The edit seam arrives as the `editable` / `onEdit` PROPS, never as
  an import of `$lib/components/page-builder`.
-->
<script lang="ts">
  /* ── THE AXIS SUBSTRATE ──────────────────────────────────────────────────
     Imported HERE, in the component that EMITS `data-jp-*`, rather than in a
     parent. Co-locating the attributes and the rules that read them means a
     surface cannot end up with the markup and not the stylesheet — which now
     covers every host: the public page, WP-5's live-preview iframe, and the
     studio canvas, which mounts this component directly and has no
     `SectionRenderer` above it to carry the import for it.

     Deliberately NOT imported from `journey-palette.css`, whose four consumers
     include the checkout and the member dashboard: those have the `--jp-*`
     ladder but no sections, and should not carry section CSS. */
  import '../journey-design.css';
  import '../journey-sections-shared.css';
  import type { RenderableSection } from './section-registry';
  import type { JourneySalesContext } from './types';
  import type { SectionDesign } from '$lib/page-builder';
  import { resolveDesign, resolveVariant } from '../section-catalog';

  interface Props {
    /**
     * The section, its component and its DOM id — one entry of
     * `selectRenderableSections()`'s output. Taken as a unit so a caller cannot
     * pair a section with another type's component.
     */
    renderable: RenderableSection;
    context: JourneySalesContext;
    /**
     * The PAGE-level design defaults (`coursePage.page.design`). Each section
     * overrides it per axis; anything neither sets falls to the axis default.
     */
    pageDesign?: SectionDesign;
    /**
     * True when this render is the studio's inline WYSIWYG canvas rather than
     * the public page. Threaded to the component, which uses it to enable
     * contenteditable copy and to skip motion that cannot run inside an
     * inner-scrolling canvas.
     */
    editable?: boolean;
    /** Commit an inline copy edit. Only meaningful when `editable`. */
    onEdit?: (key: string, value: string) => void;
    /**
     * The course title, passed ONLY to the one section on the page allowed to use
     * it as its heading fallback (`SectionComponentProps.titleFallback`). Resolved
     * at the array level by `SectionRenderer` / `claimTitleFallback`, because no
     * section can know what its neighbours authored.
     *
     * A host that owns its own loop — the studio canvas does — must resolve it the
     * same way and pass it here, or its sections self-hide a heading the published
     * page shows. Absent is the SAFE direction (a missing heading, never a wrong
     * one), which is why it is optional.
     */
    titleFallback?: string;
  }

  const {
    renderable,
    context,
    pageDesign,
    editable = false,
    onEdit,
    titleFallback,
  }: Props = $props();

  const section = $derived(renderable.section);
  const variant = $derived(resolveVariant(section));
  const design = $derived(resolveDesign(section, { design: pageDesign }));

  /**
   * SECOND AND LATER SECTIONS OF A TYPE DEMOTE THEIR HEADING (see
   * `SectionComponentProps.headingLevel`). Derived from the anchor id rather than
   * from a new count: `claimAnchorId` already gives the FIRST section of a type
   * the bare type name and every later duplicate an ordinal suffix, so the two
   * rules cannot disagree about which hero is the first one.
   */
  const headingLevel: 1 | 2 = $derived(
    renderable.anchorId === section.type ? 1 : 2
  );
</script>

<!--
  `anchorId` is the section TYPE for the first section of that type, and an
  ordinal suffix for later duplicates — so every `#<type>` a visitor may already
  have bookmarked still lands on the section they expect. It is NOT plain
  `section.type`: a page may hold several sections of one type
  (`duplicateSection()` clones it), and the golden page did, which served an
  invalid document with two `id="ache"` (Codex-yxkj7).

  `data-jp-variant` mirrors the resolved composition onto the wrapper as well as
  passing it as a prop. It is not a styling hook — a section's own `<style>` is
  scoped and cannot reach an ancestor attribute — but it makes both halves of
  the seam OBSERVABLE in devtools and in the served HTML, so the plumbing is
  verified by measurement rather than by assertion (amendment A10).
-->
<section
  id={renderable.anchorId}
  class="jp-sec"
  data-section-type={section.type}
  data-jp-variant={variant}
  data-jp-width={design.width}
  data-jp-density={design.density}
  data-jp-surface={design.surface}
  data-jp-edge={design.edge}
  data-jp-align={design.align}
  data-jp-type={design.type}
  data-jp-accent={design.accent}
  data-jp-motion={design.motion}
  data-jp-media={design.media}
>
  <renderable.Component
    config={section.props}
    {context}
    {variant}
    {design}
    {editable}
    {onEdit}
    {titleFallback}
    {headingLevel}
  />
</section>

<style>
  .jp-sec {
    /* Each section owns its own vertical rhythm; the wrapper only establishes
       a stacking/isolation context so decorative section atmosphere never
       bleeds between sections. */
    position: relative;
    isolation: isolate;

    /*
      The axis CONTAINER (amendment A14). Compositions scope to the section's own
      inline size, not the viewport, so one can be correct at 1440 and broken at
      375 independently — which is why verification measures all three builder
      preview widths. Deliberately container queries rather than `--breakpoint-*`
      media queries: the builder canvas renders these same sections inside a
      device frame narrower than the window, where a viewport query reads the
      wrong number.

      NOTE this also brings LAYOUT CONTAINMENT, which makes the wrapper a
      containing block for `position: fixed` descendants. Nothing inside a section
      may position itself fixed against the viewport from here — `IntroVideoModal`
      already portals its overlay out to `.org-layout` for the neighbouring
      `isolation: isolate` reason, and any new overlay must do the same.
    */
    container-type: inline-size;
  }
</style>
