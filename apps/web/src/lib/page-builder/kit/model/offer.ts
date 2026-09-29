/**
 * What the pricing block has to say, before any layout draws it.
 *
 * Every price comes from `deriveOfferPaths` — the one derivation the checkout
 * also uses — so the block can only ever show a path the live offer has, at
 * the amount the offer charges.
 */
import { deriveOfferPaths, type OfferPath } from '../../offer-paths';
import type { JourneySalesContext } from '../../render/types';
import { isEnrolled } from './cta';

export type PricingState =
  /** The viewer already holds the course: no prices, a way back in. */
  | 'enrolled'
  /** The offer resolved with no way in: say so where the price would be. */
  | 'unavailable'
  /** The offer could not be read: a price-less button, never a guessed price. */
  | 'unpriced'
  /** At least one real path, priced. */
  | 'priced';

export interface PricingView {
  state: PricingState;
  /** Every real path, in offer order. Empty unless `priced`. */
  paths: OfferPath[];
  /** The recommended path, when priced. */
  featured: OfferPath | null;
  /** Every path but the recommended one, in offer order. */
  others: OfferPath[];
}

const NONE = { paths: [], featured: null, others: [] };

export function pricingView(
  context: JourneySalesContext,
  props: Record<string, unknown>
): PricingView {
  if (isEnrolled(context)) return { state: 'enrolled', ...NONE };
  if (context.purchasable === false) return { state: 'unavailable', ...NONE };
  const paths = deriveOfferPaths(context.offer, context.course, props);
  if (paths.length === 0) return { state: 'unpriced', ...NONE };
  const featured = paths.find((path) => path.best) ?? paths[0];
  return {
    state: 'priced',
    paths,
    featured,
    others: paths.filter((path) => path.id !== featured.id),
  };
}
