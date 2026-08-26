/**
 * Journey checkout — the ORDER SUMMARY derivation (Codex-2pryk.3.6).
 *
 * The checkout is the offer/pay surface (SPEC §7 "one course, three ways in").
 * This module owns only the left-hand "what you're getting" card: the factual,
 * DB-derived lines about what the course actually holds. No Svelte, no DOM, no
 * server-only imports, so it is unit-testable in isolation (Neon-free).
 *
 * THE OFFER CATALOGUE IS NOT HERE. It moved to
 * `$lib/page-builder/offer-paths.ts` in Codex-2pryk.2.4.3, because the sell
 * page's `invite` section needs the exact same derivation and had the exact same
 * bug: both surfaces used to build their offers out of AUTHORED MARKETING COPY
 * (`invite.props.offers`, including a free-text `priceLabel`) rather than the
 * authoritative `CourseOffer`. See that module's header for the provenance rule.
 */
import type { JourneyCourseView } from '$lib/page-builder';

/** The left-hand "what you're getting" summary card. */
export interface CheckoutSummary {
  /** Cover kicker — the course's own kicker, else a neutral fallback. */
  kicker: string;
  title: string;
  /** Factual, DB-derived "what's inside" lines. */
  bullets: string[];
}

/** Minimal shape the derivation reads off a stage (public sales projection). */
interface StageLike {
  practices: { contentType: string }[];
}

/** Title-case a content-type token for the "what's inside" mix line. */
function contentTypeLabel(type: string): string {
  if (type === 'written') return 'written';
  return type; // 'video' | 'audio' — already lower, joined into a sentence
}

/** "Video, audio & written practice" from the real practice content types. */
function formatContentMix(stages: StageLike[]): string | undefined {
  const seen: string[] = [];
  for (const stage of stages) {
    for (const practice of stage.practices) {
      const label = contentTypeLabel(practice.contentType);
      if (label && !seen.includes(label)) seen.push(label);
    }
  }
  if (seen.length === 0) return undefined;
  const capped = seen[0].charAt(0).toUpperCase() + seen[0].slice(1);
  const rest = seen.slice(1);
  const tail =
    rest.length === 0
      ? ''
      : rest.length === 1
        ? ` & ${rest[0]}`
        : `, ${rest.slice(0, -1).join(', ')} & ${rest[rest.length - 1]}`;
  return `${capped}${tail} practice`;
}

/**
 * The left-hand order summary. Every factual line is DB-derived — the practice/
 * stage counts and the content-type mix come straight off the awaited course +
 * stages, so the card can never claim more than the course actually holds.
 */
export function deriveCourseSummary(
  course: JourneyCourseView,
  stages: StageLike[]
): CheckoutSummary {
  const bullets: string[] = [];

  if (course.practiceCount > 0 && course.stageCount > 0) {
    const practices = `${course.practiceCount} ${course.practiceCount === 1 ? 'practice' : 'practices'}`;
    const stagesLabel = `${course.stageCount} ${course.stageCount === 1 ? 'stage' : 'stages'}`;
    bullets.push(`${practices} across ${stagesLabel}`);
  }

  const mix = formatContentMix(stages);
  if (mix) bullets.push(mix);

  bullets.push('Yours to return to, as often as you need');

  return {
    kicker: course.kicker ?? 'The course',
    title: course.title,
    bullets,
  };
}
