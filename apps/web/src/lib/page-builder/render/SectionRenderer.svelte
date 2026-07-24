<!--
  @component SectionRenderer

  The inert public section renderer (SPEC §4.1). Walks the page's ordered
  `sections`, drops DISABLED sections and UNKNOWN types (forward-compatible — an
  unrecognised `type` resolves to no component and is skipped), and renders each
  known section inside a semantic `<section>` wrapper. Order is array position.

  This is NOT the studio editor — it lives under `$lib/page-builder` (the CE-4
  PUBLIC_LIB_ROOT) and never imports the editor UI. WP-5's live-preview iframe
  reuses this same renderer via `JourneyRenderer`.
-->
<script lang="ts">
  import { selectRenderableSections } from './section-registry';
  import type { JourneySalesContext } from './types';
  import type { PageSection } from '$lib/page-builder';

  interface Props {
    sections: PageSection[];
    context: JourneySalesContext;
  }

  const { sections, context }: Props = $props();

  const renderable = $derived(selectRenderableSections(sections));
</script>

{#each renderable as { section, Component } (section.id)}
  <section class="jp-section" data-section-type={section.type}>
    <Component config={section.props} {context} />
  </section>
{/each}

<style>
  .jp-section {
    /* Each section owns its own vertical rhythm; the wrapper only establishes
       a stacking/isolation context so decorative section atmosphere never
       bleeds between sections. */
    position: relative;
    isolation: isolate;
  }
</style>
