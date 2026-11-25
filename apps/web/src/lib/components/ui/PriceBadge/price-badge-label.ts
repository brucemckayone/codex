/**
 * PriceBadge's wording, as pure functions (Codex-7104r, plan D10).
 *
 * PriceBadge.svelte draws these, and the card styles' StyledCard writes the
 * same words into its badge and foot (`card-styles/adapters.ts`), so a price
 * or an access label reads the same whichever card style an org picks.
 *
 * Priority: purchased > included > followers+isFollower > stacked-hybrid >
 * subscribers > followers > team > free > price.
 */

import { formatPrice } from '$lib/utils/format';
import * as m from '$paraglide/messages';

export type PriceBadgeAccessType =
  | 'free'
  | 'paid'
  | 'followers'
  | 'subscribers'
  | 'team';

export type PriceBadgeVariant =
  | 'purchased'
  | 'included'
  | 'hybrid'
  | 'subscribers'
  | 'followers'
  | 'team'
  | 'free'
  | 'paid';

export interface PriceBadgeInput {
  amount: number | null;
  purchased?: boolean;
  included?: boolean;
  accessType?: PriceBadgeAccessType | null;
  isFollower?: boolean;
  /** The plan label (`planBadgeLabel`), not necessarily one plan's name. */
  tierName?: string | null;
  /** The caller draws the hybrid (price ▲ plans ▼) as two lines. */
  stacked?: boolean;
}

/** Purchasable AND plan-included, held by neither, drawn as two lines. */
export function isHybridPrice(input: PriceBadgeInput): boolean {
  return (
    !!input.stacked &&
    input.accessType === 'paid' &&
    !!input.tierName &&
    !input.purchased &&
    !input.included &&
    input.amount != null &&
    input.amount > 0
  );
}

export function priceBadgeVariant(input: PriceBadgeInput): PriceBadgeVariant {
  const { amount, purchased, included, accessType, isFollower } = input;
  if (purchased) return 'purchased';
  if (included) return 'included';
  if (accessType === 'followers' && isFollower) return 'included';
  if (isHybridPrice(input)) return 'hybrid';
  if (accessType === 'subscribers') return 'subscribers';
  if (accessType === 'followers') return 'followers';
  if (accessType === 'team') return 'team';
  if (amount === 0 || accessType === 'free') return 'free';
  return 'paid';
}

/**
 * The badge's one line. A hybrid's is its price: PriceBadge draws the plans
 * as a second line of its own.
 */
export function priceBadgeLabel(input: PriceBadgeInput): string {
  const { amount, purchased, included, accessType, isFollower, tierName } =
    input;
  if (purchased) return m.content_price_purchased();
  if (included) return m.content_price_included();
  if (accessType === 'followers' && isFollower) {
    return m.content_price_included();
  }
  if (accessType === 'subscribers') {
    // Subscriber-gated content may still carry a price (legacy dual-gated
    // case where `paid + minimumTierId` was modelled as `subscribers`).
    // Show the price if present, else tier name, else generic label.
    if (amount && amount > 0) return formatPrice(amount);
    if (tierName) return tierName;
    return m.content_price_subscribers();
  }
  if (accessType === 'followers') return m.content_price_followers();
  if (accessType === 'team') return m.content_price_team();
  if (amount === 0 || accessType === 'free') return m.content_price_free();
  if (amount != null) return formatPrice(amount);
  return '';
}
