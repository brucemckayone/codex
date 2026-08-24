<!--
  @component SectionRenderer

  The inert public section renderer (SPEC §4.1). Walks the page's ordered
  `sections`, drops DISABLED sections and UNKNOWN types (forward-compatible — an
  unrecognised `type` resolves to no component and is skipped), and renders each
  known section inside a semantic `<section>` wrapper. Order is array position.

  THE ARRAY-LEVEL HALF of the render seam. Which sections render, in what order,
  under which anchor id — that is this component. The PER-SECTION half (resolve
  the composition + the axes, emit them, invoke the component) lives in
  {@link SectionFrame}, because the studio canvas needs that half WITHOUT this
  one: it interleaves per-block editing chrome between sections and so must own
  its own loop (Codex-eckbx W1–W3).

  Keeping the seam in `SectionFrame` is what stops the two surfaces drifting. The
  canvas used to answer the same need with a second component set
  (`render-edit/`), and the cost was structural: the public side never received
  `variant`, the canvas emitted none of the `data-jp-*` axes, and every section
  change had to be made in two places.

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
  /* The axis substrate (`journey-design.css` + `journey-sections-shared.css`) is
     imported by `SectionFrame`, the component that emits `data-jp-*`, so every
     host that mounts a frame gets the rules that read its attributes — including
     the studio canvas, which mounts frames without this renderer. */
  import SectionFrame from './SectionFrame.svelte';
  import { selectRenderableSections } from './section-registry';
  import type { JourneySalesContext } from './types';
  import type { PageSection, SectionDesign } from '$lib/page-builder';

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
    /**
     * True when this render is an editing surface rather than the public page.
     * The public page never sets it; it exists so a host that reuses this whole
     * renderer (rather than `SectionFrame` per section) can still opt in.
     */
    editable?: boolean;
    /** Commit an inline copy edit. Only meaningful when `editable`. */
    onEdit?: (sectionId: string, key: string, value: string) => void;
  }

  const { sections, context, pageDesign, editable = false, onEdit }: Props = $props();

  const renderable = $derived(selectRenderableSections(sections));
</script>

{#each renderable as entry (entry.section.id)}
  <SectionFrame
    renderable={entry}
    {context}
    {pageDesign}
    {editable}
    onEdit={onEdit ? (key, value) => onEdit(entry.section.id, key, value) : undefined}
  />
{/each}
