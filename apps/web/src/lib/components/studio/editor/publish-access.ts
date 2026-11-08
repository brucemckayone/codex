/**
 * The Publish step's "Who can watch" (Codex-a6ofh.2.4) as the draft session
 * holds it: one group, so a save sends the kind, the price and the plans
 * together (the schema's refines read them together).
 */
import type { ContentAccessKind } from '$lib/utils/content-access';
import type { DraftAccess } from './draft-session.svelte';

/**
 * The creator picked a kind. One with no price and no plans clears both: the
 * save turns the plans' switch off and the server clears the ticks, so the
 * picker starts empty if they come back to a tiered kind. Plans never read
 * (`null`) stay unread: a save never sends a set it did not read.
 */
export function withKind(
  access: DraftAccess,
  kind: ContentAccessKind
): DraftAccess {
  if (kind === 'paid' || kind === 'subscribers') return { ...access, kind };
  return { kind, priceCents: 0, tierIds: access.tierIds === null ? null : [] };
}

/** The price as typed, in pounds: the form's rule, so what cannot be read is £0. */
export function withPrice(access: DraftAccess, text: string): DraftAccess {
  const pounds = parseFloat(text || '0');
  return {
    ...access,
    priceCents: Number.isNaN(pounds) ? 0 : Math.round(pounds * 100),
  };
}

/** The price field's words for a price: `12.00`. */
export function priceText(cents: number): string {
  return (cents / 100).toFixed(2);
}
