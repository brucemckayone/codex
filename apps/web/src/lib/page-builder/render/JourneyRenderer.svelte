<!--
  @component JourneyRenderer

  Top-level inert entry for a public journey sales page (SPEC §8.2). Assembles
  the read-only render context from the awaited {@link JourneyCoursePage} plus
  the streamed sell-preview promise, applies per-page brand overrides, and hands
  off to `SectionRenderer`.

  Brand model (D6 — inherit + override): when the page carries `brandOverrides`
  this renders inside a NESTED `[data-org-brand]` element whose inline `--brand-*`
  inputs re-derive the palette for the subtree; unset inputs inherit the org
  brand from the outer `.org-layout`. With no overrides it renders a plain
  wrapper that inherits the org brand wholesale. No JS in the override path.

  Reused by both the public route (`+page.svelte`) and WP-5's live-preview
  iframe, so it takes plain data + a promise and owns no data-fetching.
-->
<script lang="ts">
  import { page } from '$app/state';
  import { buildJourneyUrl } from '@codex/urls';
  import SectionRenderer from './SectionRenderer.svelte';
  import { brandOverridesToStyleAttr } from './brand-overrides';
  import type { JourneySalesContext, SellPreview } from './types';
  import type { JourneyCoursePage } from '$lib/page-builder';

  interface Props {
    coursePage: JourneyCoursePage;
    /** Streamed public sell previews (30s preview.m3u8). May resolve to null. */
    sellPreview: Promise<SellPreview | null>;
  }

  const { coursePage, sellPreview }: Props = $props();

  const brandStyle = $derived(
    brandOverridesToStyleAttr(coursePage.page.brandOverrides)
  );

  const checkoutUrl = $derived(
    buildJourneyUrl(
      page.url,
      { slug: coursePage.course.slug, id: coursePage.course.id },
      { surface: 'checkout' }
    )
  );

  const context: JourneySalesContext = $derived({
    course: coursePage.course,
    stages: coursePage.stages,
    testimonials: coursePage.testimonials,
    checkoutUrl,
    sellPreview,
  });
</script>

<div
  class="journey-page"
  data-org-brand={brandStyle ? '' : undefined}
  style={brandStyle}
>
  <SectionRenderer sections={coursePage.page.sections} {context} />
</div>

<style>
  .journey-page {
    /* Sections carry their own padding; the page wrapper only inherits the
       (possibly overridden) org brand + provides the background surface. */
    background: var(--color-background);
    color: var(--color-text);
  }
</style>
