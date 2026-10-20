/**
 * What an `offer` field offers (Codex-61zsk.14): the page's live ways in.
 *
 * The pricing section describes each option by its id (`purchase`,
 * `subscription-monthly`, `tier:<id>`, from `offer-paths.ts`), and the id was
 * a text box: a creator could not know the ids, so a description they wrote
 * matched no option and silently showed nothing. The field now picks from the
 * paths the block itself draws (`deriveOfferPaths`), by name and price.
 */
import type { OfferPath } from '$lib/page-builder/offer-paths';
import * as m from '$paraglide/messages';

/**
 * What an `offer` field can pick from: the page's live ways in, or, while
 * the offer read has not answered or has failed, which of those. Then the
 * field says so instead of reading an unread offer as "no way in".
 */
export type OfferChoices = readonly OfferPath[] | 'loading' | 'failed';

export interface OfferOption {
  value: string;
  label: string;
}

/**
 * Each live path as `name · price cadence`, in the offer's order. A stored
 * id that is not one of them (a way in since switched off, or text written
 * before this was a picker) is kept as a last option, named as such: the
 * field shows what the section holds, and the creator can change it.
 */
export function offerOptions(
  paths: readonly OfferPath[],
  stored: unknown
): OfferOption[] {
  const options = paths.map((path) => ({
    value: path.id,
    label: `${path.name} · ${path.priceLabel} ${path.cadenceLabel}`,
  }));
  if (
    typeof stored === 'string' &&
    stored !== '' &&
    !paths.some((path) => path.id === stored)
  ) {
    options.push({ value: stored, label: m.studio_page_editor_offer_gone() });
  }
  return options;
}
