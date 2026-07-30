<!--
  @component JourneyCard

  The org-landing / discovery adapter over {@link JourneyEntryCard} (Codex-tnwnu).

  This used to be its own card treatment — 16/9 cover, type BELOW the cover, a
  centred fallback glyph visible only when there was no photo. It is now a
  projection: it maps a `JourneyCardView` onto the ONE shared journey entry card
  so the landing carousel, the /explore rail, the library shelf and the dashboard
  threshold all render the same anatomy. The visual decisions, and the reasons
  for the prototype traits that were deliberately NOT reproduced, live in
  `JourneyEntryCard.svelte`.

  Kept as a named component (rather than inlining the mapper at the call site)
  because `JourneyCardView` is the page-builder's DTO — the landing page passes
  it straight through, and this is where that knowledge belongs.

  `progress` (present → the enrolled variant) swaps the price affordance for a
  status line and gives the cover its determinate progress bar.
-->
<script lang="ts">
  import type { EnrolledJourneyCard, JourneyCardView } from '$lib/page-builder';
  import JourneyEntryCard from './JourneyEntryCard.svelte';
  import { journeyViewEntry } from './journey-entry-card';

  interface Props {
    journey: JourneyCardView;
    /** Destination URL — the caller builds it (cross-org-aware). */
    href: string;
    /**
     * Enrolled progress rollup. When set, the foot renders a status line
     * ("N of M practices" / "Completed" / "Not started yet") instead of the
     * price + "View portal" affordance, and the cover carries a progress bar.
     */
    progress?: {
      percent: number;
      status: EnrolledJourneyCard['status'];
      completedPractices: number;
      totalPractices: number;
    };
  }

  const { journey, href, progress }: Props = $props();

  const entry = $derived(journeyViewEntry(journey, href, progress));
</script>

<JourneyEntryCard {...entry} />
