<!--
  @component SectionRenderer

  The inert public section renderer (SPEC §4.1). Walks the page's ordered
  `sections`, drops DISABLED sections and UNKNOWN types (forward-compatible — an
  unrecognised `type` resolves to no component and is skipped), and renders each
  known section inside a semantic `<section>` wrapper. Order is array position.

  THE RENDER SEAM (`docs/design/journey-sections/02-axis-contract.md` A1). This is
  the one place the two presentation layers are resolved and handed down:

    • `variant` — WHICH composition the component draws (`resolveVariant`).
    • `design`  — the nine design AXES it draws in (`resolveDesign`), emitted as
                  `data-jp-*` attributes on the wrapper for CSS, and passed as a
                  prop for the cases that need an axis in markup or JS.

  Both are additive + OPTIONAL on `SectionComponentProps`, so the 11 components
  adopt them one work-package at a time rather than all in one commit.

  This is NOT the studio editor — it lives under `$lib/page-builder` (the CE-4
  PUBLIC_LIB_ROOT) and never imports the editor UI. WP-5's live-preview iframe
  reuses this same renderer via `JourneyRenderer`.
-->
<script lang="ts">
  import { selectRenderableSections } from './section-registry';
  import type { JourneySalesContext } from './types';
  import type { PageSection, SectionDesign } from '$lib/page-builder';
  import { resolveDesign, resolveVariant } from '../section-catalog';

  interface Props {
    sections: PageSection[];
    context: JourneySalesContext;
    /**
     * The PAGE-level design defaults (`coursePage.page.design`) — the page's
     * "look". Each section overrides it per axis; anything neither sets falls to
     * the axis default. Optional so a preview host with no stored look still
     * renders.
     */
    pageDesign?: SectionDesign;
  }

  const { sections, context, pageDesign }: Props = $props();

  const renderable = $derived(selectRenderableSections(sections));

  // Wrapped once rather than per section: `resolveDesign` takes design CARRIERS
  // (a section, a page draft), not bare axis bags, so both arguments read the
  // same way at the call site.
  const pageSource = $derived({ design: pageDesign });
</script>

{#each renderable as { section, Component, anchorId } (section.id)}
  {@const variant = resolveVariant(section)}
  {@const design = resolveDesign(section, pageSource)}
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
    id={anchorId}
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
    <Component config={section.props} {context} {variant} {design} />
  </section>
{/each}

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
