<!--
  @component JourneyRailCard

  The /explore "Journeys" rail adapter over {@link JourneyEntryCard}
  (Codex-tnwnu). Maps the PUBLIC `CourseCardSummary` onto the one shared journey
  entry card; the cover anatomy, scrim ramp and flair all live there.

  This card was already the closest to the shared system — its title sat inside
  the cover over the same scrim ramp `ContentCard`'s title-in-cover variant uses.
  Two things changed in absorbing it:

   • The per-card hue rotation is GONE. It rotated the cover gradient off the org
     brand by `index * 34deg` so a rail read as a set of distinct tones. That is
     the per-card accent colour the neutral-palette decision rejects (and the
     reason the prototype's `.ember`/`.blood`/`.clay` tones were never built);
     the shared brand cover replaces it. The `index` prop therefore no longer
     exists.
   • The scrim ramp is now unconditional. It used to be gated behind
     `--imaged`, so a cover-less journey had no ramp and its overlaid text sat
     on a raw gradient — a second treatment inside one card.

  Purely presentational — the parent supplies the resolved sales-page `href`
  (built with `buildJourneyUrl(..., { surface: 'sales' })`) so this component
  stays free of routing concerns.
-->
<script lang="ts">
  import JourneyEntryCard from '$lib/components/journeys/JourneyEntryCard.svelte';
  import { courseSummaryEntry } from '$lib/components/journeys/journey-entry-card';
  import type { CourseCardSummary } from '$lib/journeys/types';

  interface Props {
    journey: CourseCardSummary;
    /** Resolved public sales-page URL (root-relative on the org subdomain). */
    href: string;
  }

  const { journey, href }: Props = $props();

  const entry = $derived(courseSummaryEntry(journey, href));
</script>

<JourneyEntryCard {...entry} />
