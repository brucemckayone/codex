/**
 * The page's primary call to action — ONE decision every block goes through
 * (contract §1 "Every page state has a next step", §6 `model/cta.ts`).
 *
 *   enrolled                → 'continue'    → the member dashboard
 *   has a way in (or unsure) → 'buy'         → the checkout
 *   confidently no way in    → 'unavailable' → an explicit notice, never nothing
 *
 * `purchasable` is a CONFIDENT NEGATIVE only (see `JourneySalesContext`): a
 * failed offer read leaves it true, so a pricing hiccup never removes the
 * button. Every href passes `safeHref`, because the URLs are built from
 * creator-authored slugs and a CTA must never become a script URL.
 */
import { checkoutUrlForPath, type OfferPath } from '../../offer-paths';
import { safeHref } from '../../render/safe-href';
import type { JourneySalesContext } from '../../render/types';
import { COPY } from './copy';

export type PrimaryCtaState = 'buy' | 'continue' | 'unavailable';

export interface PrimaryCta {
  state: PrimaryCtaState;
  /** Absent only for `unavailable`. */
  href?: string;
  label: string;
}

/** Whether this viewer already holds the course (either signal is enough). */
export function isEnrolled(context: JourneySalesContext): boolean {
  return context.enrolled === true || context.offer?.entitled === true;
}

export function resolvePrimaryCta(
  context: JourneySalesContext,
  label?: string | null
): PrimaryCta {
  if (isEnrolled(context)) {
    return {
      state: 'continue',
      href: safeHref(context.dashboardUrl),
      label: COPY.cta.continue,
    };
  }
  if (context.purchasable !== false) {
    const authored = label?.trim();
    return {
      state: 'buy',
      href: safeHref(context.checkoutUrl),
      label: authored || COPY.cta.buy,
    };
  }
  return { state: 'unavailable', label: COPY.cta.unavailableTitle };
}

/** The checkout deep link for one real offer path (pre-selects it there). */
export function pathHref(
  context: JourneySalesContext,
  path: OfferPath
): string {
  return safeHref(checkoutUrlForPath(context.checkoutUrl, path.id));
}
