/**
 * Visitor-facing strings the kit renders itself (contract amendment A1).
 *
 * One module, English constants, translation-ready: every string a VISITOR can
 * read that a creator did not type lives here, so a later i18n pass has exactly
 * one file to key. Creator-facing labels live in each block's `definition.ts`.
 *
 * Offer notes are DERIVED from the path kind (contract §1 "Honest offer copy"):
 * a one-off never promises "Cancel anytime", and a recurring path never claims
 * to be yours to keep.
 */
import type { JourneyContentType } from '$lib/page-builder';
import type { OfferPath } from '../../offer-paths';

/**
 * A length the way a visitor plans by it: whole minutes, then hours.
 * Rounded, not floored, so a 9:40 film reads "10 min"; under a minute says
 * so rather than "0 min". Nothing for a length nobody measured.
 */
function duration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)
    return null;
  if (seconds < 60) return 'under 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** A kind of practice, as a course's length names what it timed. */
const KIND_WORD: Record<JourneyContentType, string> = {
  video: 'video',
  audio: 'audio',
  written: 'reading',
};

export const COPY = {
  cta: {
    /** The buy label when the creator wrote none. */
    buy: 'Join now',
    /** The only label an enrolled viewer sees — authored buy copy is wrong for them. */
    continue: 'Continue',
    unavailableTitle: 'Not open for enrolment yet',
    unavailableBody:
      'This course is not taking new members right now. Check back soon.',
    /*
      A disputed owner (Codex-2hxff.60): the content page's dispute notice,
      word for word. Those strings are paraglide's `access_paused_dispute_*`
      and `access_contact_support`; this module stays English by contract A20,
      so `cta.test.ts` pins the two to each other.
    */
    pausedTitle: 'Access paused',
    pausedPurchase:
      'Access is paused while a payment dispute on this purchase is open.',
    pausedSubscription:
      'Access is paused while a payment dispute on this subscription is open.',
    contactSupport: 'Contact support',
  },
  pricing: {
    recommended: 'Recommended',
    enrolledTitle: 'You are already enrolled',
    enrolledBody: 'Everything is waiting where you left it.',
    /** Shown when the offer could not be read: never an invented price. */
    atCheckout: 'You will see the price before you pay.',
    otherWays: 'Other ways to join',
    from: 'From',
  },
  /** A course's shape, counted: "3 stages", "1 practice". */
  course: {
    stages: (count: number) => `${count} ${count === 1 ? 'stage' : 'stages'}`,
    practices: (count: number) =>
      `${count} ${count === 1 ? 'practice' : 'practices'}`,
    /** One practice's length: "10 min", "1 hr 15 min". */
    duration,
    /**
     * How long the timed practices run, naming the kinds that were timed so
     * a course with readings never claims their time too: "5 hr 40 min of
     * video and audio". Nothing for a length nobody measured. Read through
     * `lengthFact` (`model/facts.ts`), which the benefits line and pricing's
     * "What's included" both say.
     */
    length: (seconds: number, timed: readonly JourneyContentType[]) => {
      const time = duration(seconds);
      const kinds = timed.map((kind) => KIND_WORD[kind]).join(' and ');
      return time ? `${time} of ${kinds}` : null;
    },
  },
  hero: {
    watch: 'Watch the film',
    /** The facts line's price when there are several (`model/facts.ts`). */
    from: (price: string) => `from ${price}`,
  },
  faq: {
    /** Opens the list's closing row, before the creator's own contact link. */
    stillWondering: 'Still wondering?',
  },
  media: {
    play: 'Play video',
  },
  sticky: {
    /** Accessible name of the floating bar's landmark. */
    region: 'Join this course',
  },
} as const;

/**
 * The reassurance line under a path's CTA when the creator authored none.
 *
 * Complements rather than repeats the path's own bullets (`offer-paths.ts`
 * already lists "Cancel anytime" for the recurring kinds), so this states the
 * BILLING fact only.
 */
export function derivedNote(path: OfferPath): string {
  if (path.kind === 'purchase') return 'Pay once and keep it for good.';
  if (path.kind === 'tier') return `Billed monthly as part of ${path.name}.`;
  return path.billingInterval === 'annual'
    ? 'Billed once a year.'
    : 'Billed monthly.';
}

/** "£12 per month" / "£49 one-off" — the price as one readable phrase. */
export function priceWithCadence(path: OfferPath): string {
  return `${path.priceLabel} ${path.cadenceLabel}`;
}

/** A card CTA's accessible name: the visible label plus WHICH path it buys. */
export function pathActionName(label: string, path: OfferPath): string {
  return `${label}, ${path.name}`;
}
