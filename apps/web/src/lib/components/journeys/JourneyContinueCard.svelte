<!--
  @component JourneyContinueCard

  The single "threshold" back into the course (SPEC §8.3 continue-where-left-off)
  — now an adapter over {@link JourneyEntryCard} (Codex-tnwnu).

  It used to be its own treatment: a `--portal-*` gradient plate with a play/read
  glyph and a percentage pill, text beside it, always filled. That made it the
  fifth different journey card in the product. It now projects the resume context
  onto the shared entry card at its `row` silhouette — same cover layers, same
  scrim ramp, same flair, same type scale as a browse tile — and is marked
  `featured`, because the dashboard threshold is genuinely the page's hero and is
  therefore the one journey card that earns chrome and a filled CTA pill.

  What changed for the member, deliberately:
   • The play/read glyph is gone. It was a per-content-type signature; journeys
     have one flair (the ghosted dropcap) and adding a second would restart the
     divergence this closes. The practice medium is still named in the meta line.
   • The percentage pill is gone. Progress is now the determinate bar on the
     cover's bottom edge, and the dashboard header states "N of M · X% through"
     immediately above this card, so nothing is lost.

  Presentational — the parent resolves WHICH practice to resume to and the
  journey state; this component only renders the threshold.
-->
<script lang="ts">
  import {
    practiceKindLabel,
    practiceMinutes,
    stageNumeral,
  } from '$lib/journeys/practice-display';
  import type { PracticeContentType } from '$lib/journeys/types';
  import JourneyEntryCard from './JourneyEntryCard.svelte';

  interface Props {
    href: string;
    title: string;
    contentType: PracticeContentType;
    stageName: string;
    /** Zero-based stage position, for the roman numeral in the meta row. */
    stageIndex: number;
    durationSeconds: number | null;
    /** Overall course completion 0–100 (the cover's progress bar). */
    percent: number;
    /** Journey state → framing + CTA verb. */
    state: 'begin' | 'resume' | 'revisit';
    /** The practice's still, when it has one; null → the brand cover. */
    coverImageUrl?: string | null;
  }

  const {
    href,
    title,
    contentType,
    stageName,
    stageIndex,
    durationSeconds,
    percent,
    state,
    coverImageUrl = null,
  }: Props = $props();

  const minutes = $derived(practiceMinutes(durationSeconds));

  const eyebrow = $derived(
    state === 'begin'
      ? 'Begin your journey'
      : state === 'revisit'
        ? "You've walked this whole journey"
        : 'Continue where you left off'
  );
  const cta = $derived(
    state === 'begin' ? 'Begin' : state === 'revisit' ? 'Revisit' : 'Resume'
  );

  const meta = $derived(
    [
      `Stage ${stageNumeral(stageIndex)}`,
      stageName,
      practiceKindLabel(contentType),
      minutes ? `${minutes} min` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  );
</script>

<JourneyEntryCard
  {href}
  {title}
  {meta}
  {cta}
  {coverImageUrl}
  kicker={eyebrow}
  layout="row"
  featured
  progress={{ percent, label: null }}
/>
