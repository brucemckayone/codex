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
import type { OfferPath } from '../../offer-paths';

export const COPY = {
  cta: {
    /** The buy label when the creator wrote none. */
    buy: 'Join now',
    /** The only label an enrolled viewer sees — authored buy copy is wrong for them. */
    continue: 'Continue',
    unavailableTitle: 'Not open for enrolment yet',
    unavailableBody:
      'This course is not taking new members right now. Check back soon.',
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
  hero: {
    watch: 'Watch the film',
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
