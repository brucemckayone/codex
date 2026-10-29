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
import type { JourneyContentType, JourneyCourseView } from '$lib/page-builder';
import { COPY } from '$lib/page-builder/kit/model/copy';
import {
  type CourseFacts,
  courseFacts,
  type FactStage,
} from '$lib/page-builder/kit/model/facts';

/** The left-hand "what you're getting" summary card. */
export interface CheckoutSummary {
  /** Cover kicker — the course's own kicker, else a neutral fallback. */
  kicker: string;
  title: string;
  /** Factual, DB-derived "what's inside" lines. */
  bullets: string[];
}

/** The kinds in the curriculum's own order, as a sentence names them. */
const KIND_ORDER: readonly JourneyContentType[] = ['video', 'audio', 'written'];

/** "Video, audio & written practice" from the kinds the course really holds. */
function formatContentMix(kinds: CourseFacts['kinds']): string | undefined {
  const named = KIND_ORDER.filter((kind) => kinds[kind] > 0);
  const last = named.at(-1);
  if (!last) return undefined;
  const list =
    named.length === 1 ? last : `${named.slice(0, -1).join(', ')} & ${last}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} practice`;
}

/**
 * The left-hand order summary. Every line is a fact, counted by
 * `courseFacts` off the awaited stages (the one count the sell page states
 * too), so the card can never claim more than the course actually holds.
 * Nothing generic: "Yours to return to" was untrue of every recurring way in
 * (Codex-61zsk.73), and each path's own fine print says how it is kept.
 */
export function deriveCourseSummary(
  course: JourneyCourseView,
  stages: readonly FactStage[]
): CheckoutSummary {
  const facts = courseFacts(stages);
  const bullets: string[] = [];

  if (facts.practices > 0) {
    bullets.push(
      `${COPY.course.practices(facts.practices)} across ${COPY.course.stages(facts.stages)}`
    );
  }

  const mix = formatContentMix(facts.kinds);
  if (mix) bullets.push(mix);

  return {
    kicker: course.kicker ?? 'The course',
    title: course.title,
    bullets,
  };
}
