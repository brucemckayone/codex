/**
 * `JourneyEntryCard` prop contract + the DTO→props projections (Codex-tnwnu).
 *
 * Five surfaces used to render a journey with five different card treatments
 * (org landing carousel, /explore rail, library "Your journeys", library "Jump
 * back in", the dashboard threshold). They now all render through ONE component
 * — but they read three structurally incompatible DTOs (`JourneyCardView`,
 * `CourseCardSummary`, `EnrolledCourseSummary`) plus the dashboard's practice
 * vocabulary.
 *
 * Rather than teach the component three shapes, each DTO is PROJECTED onto the
 * single presentational contract here. The component knows only about covers,
 * kickers, stats and progress; the DTOs stay owned by their producers.
 *
 * Types live in this `.ts` (not a `<script module>` in the component): exporting
 * a type from a Svelte module block passes `svelte-check` but fails `tsc` with
 * TS2614 when a `.ts` file imports it.
 */

import type {
  CourseCardSummary,
  EnrolledCourseSummary,
} from '$lib/journeys/types';
import type { EnrolledJourneyCard, JourneyCardView } from '$lib/page-builder';

/**
 * The card's two silhouettes.
 *
 * `tile` — a 3:4 portrait with the title INSIDE the cover, for grid/rail
 * browsing contexts. Matches `ContentCard`'s `shape='3:4' titleInCover` tiles,
 * so a journey and a piece of content in the same grid read as one system.
 *
 * `row` — a horizontal resume strip: the SAME cover (brand gradient, flair,
 * scrim ramp, progress bar) at a smaller 4:3 ratio, with the text beside it
 * rather than inside it. A 3:4 portrait in a "Jump back in" strip would be a
 * poster masquerading as a resume control; the shared cover treatment is what
 * makes them one system, not a shared silhouette.
 */
export type JourneyEntryLayout = 'tile' | 'row';

/** One curriculum segment — the numeral takes the weight, the noun stays quiet. */
export interface JourneyEntryStat {
  value: number;
  label: string;
}

/**
 * Enrolled progress. Drives the determinate bar on the cover's bottom edge and
 * the status line in the foot. Absent → a discover card, which shows no bar.
 */
export interface JourneyEntryProgress {
  /** Integer 0–100. */
  percent: number;
  /** Status line ("12 of 24 practices" / "Completed"), or null for none. */
  label: string | null;
}

export interface JourneyEntryCardProps {
  /** Destination URL — the caller builds it (cross-org aware). */
  href: string;
  title: string;
  /** Eyebrow above the title. Its initial also derives the flair dropcap. */
  kicker?: string | null;
  /** Short framing under the title (the sell lede). Clamped to two lines. */
  tagline?: string | null;
  /** One quiet meta line ("Guided by …", "Next · …", "1:23 of 4:56"). */
  meta?: string | null;
  /** Public CDN cover URL; null → the brand gradient carries the cover. */
  coverImageUrl?: string | null;
  layout?: JourneyEntryLayout;
  /** Featured/hero entries earn card chrome; browsing tiles stay transparent. */
  featured?: boolean;
  /** Overlay pill on the cover naming the kind ("Portal"). */
  badge?: string | null;
  stats?: JourneyEntryStat[];
  progress?: JourneyEntryProgress | null;
  /** One-off price in GBP pence; null → `membershipLabel`. */
  priceCents?: number | null;
  /** Shown in place of a price when `priceCents` is null. */
  membershipLabel?: string | null;
  /** Access/source chip in the foot ("purchased", "via membership"). */
  accessLabel?: string | null;
  /** CTA verb. */
  cta?: string;
}

/** Extras a call site layers on top of a DTO projection. */
interface EntryExtras {
  accessLabel?: string | null;
}

/**
 * Curriculum stats as SEGMENTS rather than one joined string, so the numeral can
 * carry the emphasis and the noun stay quiet. Singular-aware; a stageless draft
 * shows practices only (defensive — a published journey normally has stages).
 *
 * Built imperatively rather than with `.filter(Boolean)`: apps/web has
 * strictNullChecks OFF, so a filtered array of `T | null` does not narrow.
 */
export function journeyStats(
  stageCount: number,
  practiceCount: number
): JourneyEntryStat[] {
  const segments: JourneyEntryStat[] = [];
  if (stageCount > 0) {
    segments.push({
      value: stageCount,
      label: stageCount === 1 ? 'stage' : 'stages',
    });
  }
  segments.push({
    value: practiceCount,
    label: practiceCount === 1 ? 'practice' : 'practices',
  });
  return segments;
}

/** Enrollment status → the foot's status line. */
export function enrolledStatusLabel(progress: {
  status: 'not-started' | 'in-progress' | 'completed';
  done: number;
  total: number;
}): string {
  if (progress.status === 'completed') return 'Completed';
  if (progress.status === 'not-started') return 'Not started yet';
  return `${progress.done} of ${progress.total} practices`;
}

/** Enrollment status → the CTA verb. */
export function enrolledCta(
  status: 'not-started' | 'in-progress' | 'completed'
): string {
  if (status === 'completed') return 'Revisit';
  if (status === 'not-started') return 'Begin';
  return 'Continue';
}

/**
 * `JourneyCardView` (the page-builder discovery projection) → tile props.
 * `progress`, when supplied, turns the tile into an enrolled one: the price
 * affordance becomes a status line and the cover earns its progress bar.
 */
export function journeyViewEntry(
  journey: JourneyCardView,
  href: string,
  progress?: {
    percent: number;
    status: EnrolledJourneyCard['status'];
    completedPractices: number;
    totalPractices: number;
  }
): JourneyEntryCardProps {
  return {
    href,
    title: journey.title,
    kicker: journey.kicker,
    tagline: journey.tagline,
    coverImageUrl: journey.coverImageUrl,
    layout: 'tile',
    featured: journey.featured,
    badge: 'Portal',
    stats: journeyStats(journey.stageCount, journey.practiceCount),
    progress: progress
      ? {
          percent: progress.percent,
          label: enrolledStatusLabel({
            status: progress.status,
            done: progress.completedPractices,
            total: progress.totalPractices,
          }),
        }
      : null,
    priceCents: progress ? null : journey.priceCents,
    membershipLabel: progress ? null : 'Membership',
    cta: progress ? enrolledCta(progress.status) : 'View portal',
  };
}

/**
 * `CourseCardSummary` (the public /explore rail read) → tile props. Fully
 * public: no entitlement, so never a progress bar. `guideName` becomes the meta
 * line, matching the credit the rail carried before.
 */
export function courseSummaryEntry(
  journey: CourseCardSummary,
  href: string
): JourneyEntryCardProps {
  return {
    href,
    title: journey.title,
    kicker: journey.kicker,
    tagline: journey.lede,
    meta: journey.guideName ? `Guided by ${journey.guideName}` : null,
    coverImageUrl: journey.coverImageUrl,
    layout: 'tile',
    badge: 'Portal',
    priceCents: journey.priceCents,
    membershipLabel: 'Free',
    cta: 'See the journey',
  };
}

/**
 * `EnrolledCourseSummary` → the library "Your journeys" TILE. Always carries a
 * progress bar (an enrolled row by definition has a rollup) and drops the price
 * affordance — you already own it.
 */
export function enrolledCourseTileEntry(
  course: EnrolledCourseSummary,
  href: string,
  extras: EntryExtras = {}
): JourneyEntryCardProps {
  return {
    href,
    title: course.course.title,
    kicker: course.course.kicker,
    tagline: course.course.lede,
    coverImageUrl: course.course.coverImageUrl,
    layout: 'tile',
    badge: 'Portal',
    progress: {
      percent: course.progress.percent,
      label: enrolledStatusLabel(course.progress),
    },
    accessLabel: extras.accessLabel ?? null,
    cta: enrolledCta(course.progress.status),
  };
}

/**
 * `EnrolledCourseSummary` → the library "Jump back in" ROW. Same cover
 * treatment as the tile, at a resume silhouette; the meta line names the next
 * practice rather than the curriculum size.
 */
export function enrolledCourseRowEntry(
  course: EnrolledCourseSummary,
  href: string
): JourneyEntryCardProps {
  return {
    href,
    title: course.course.title,
    kicker: course.course.kicker ?? 'Portal',
    meta: `Next · ${course.progress.nextPracticeTitle ?? 'Continue'}`,
    coverImageUrl: course.course.coverImageUrl,
    layout: 'row',
    badge: 'Portal',
    progress: {
      percent: course.progress.percent,
      label: null,
    },
    cta: 'Resume',
  };
}
