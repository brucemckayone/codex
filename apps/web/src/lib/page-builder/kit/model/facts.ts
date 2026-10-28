/**
 * What the page can say about the course without being told, read off the
 * curriculum it renders (`context.stages`).
 *
 * `courseFacts` is the ONE count of the course's shape (Codex-61zsk.73): the
 * hero's facts line, the pricing block's "What's included", the numbers
 * block's live figures and the checkout's summary all read their stages,
 * practices, length and mix of kinds from it, so no two of them can disagree
 * about the course, nor with its curriculum section.
 */
import type {
  JourneyContentType,
  JourneyPracticeView,
} from '$lib/page-builder';
import type { JourneySalesContext } from '../../render/types';
import { COPY, priceWithCadence } from './copy';
import { pricingView } from './offer';

/** What a count reads off a stage: its practices' kinds and lengths. */
export interface FactStage {
  practices: readonly Pick<
    JourneyPracticeView,
    'contentType' | 'durationSeconds'
  >[];
}

export interface CourseFacts {
  stages: number;
  practices: number;
  /**
   * The timed practices' length added up (`TIMED`: video and audio; a
   * reading has none to add), in seconds. Null unless there is at least one
   * and EVERY one has a measured length: a sum missing a film nobody
   * measured would claim less than the course holds.
   */
  seconds: number | null;
  /** How many practices are of each kind. */
  kinds: Record<JourneyContentType, number>;
}

const KINDS: readonly JourneyContentType[] = ['video', 'audio', 'written'];

/** The kinds a practice is played for a length, rather than read. */
export const TIMED: readonly JourneyContentType[] = ['video', 'audio'];

/** A length somebody measured, as the curriculum's own length line reads one. */
function measured(seconds: number | null | undefined): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0;
}

export function courseFacts(stages: readonly FactStage[]): CourseFacts {
  const kinds: Record<JourneyContentType, number> = {
    video: 0,
    audio: 0,
    written: 0,
  };
  let practices = 0;
  let timed = 0;
  let seconds: number | null = 0;
  for (const stage of stages) {
    for (const practice of stage.practices) {
      practices += 1;
      // A kind the platform does not have is a practice, but no kind of one.
      if (KINDS.includes(practice.contentType)) {
        kinds[practice.contentType] += 1;
      }
      if (!TIMED.includes(practice.contentType)) continue;
      timed += 1;
      const length = practice.durationSeconds;
      seconds = seconds !== null && measured(length) ? seconds + length : null;
    }
  }
  return {
    stages: stages.length,
    practices,
    seconds: timed > 0 ? seconds : null,
    kinds,
  };
}

/**
 * The hero's facts line (3b round 1): the course's shape and its way in, so a
 * visitor knows both at once — "3 stages · 4 practices · from £15 per month".
 *
 * The price is `pricingView`'s, so it is only ever a path the live offer has,
 * at what that path charges: the lowest of them, marked "from" when there is
 * more than one. A viewer who is enrolled, a course with no way in and an
 * offer that could not be read all get the shape alone. A count of nothing is
 * left out, and a page with nothing to say draws no line at all.
 */
export function heroFacts(context: JourneySalesContext): string[] {
  const facts: string[] = [];
  const { stages, practices } = courseFacts(context.stages);
  if (stages > 0) facts.push(COPY.course.stages(stages));
  if (practices > 0) facts.push(COPY.course.practices(practices));

  const view = pricingView(context, {});
  const [first, ...rest] = view.paths;
  if (view.state === 'priced' && first) {
    const lowest = rest.reduce(
      (low, path) => (path.priceCents < low.priceCents ? path : low),
      first
    );
    const price = priceWithCadence(lowest);
    facts.push(rest.length > 0 ? COPY.hero.from(price) : price);
  }
  return facts;
}
