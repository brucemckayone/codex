/**
 * Words for what a creator is told about a price change (Codex-2hxff.85 M3,
 * .86; batch C1 Part B page 4).
 *
 * The Edit Tier dialog's one quiet line before saving (owner decision Q7,
 * P1): shown only when a price differs from the saved one and the tier has
 * subscribers, so the save isn't a surprise. The count is the tier row's
 * subscriber count, which the page already has.
 */

import * as m from '$paraglide/messages';

export interface EditTierHint {
  lead: string;
  body: string;
}

/**
 * The line, or null when there is nothing to say: no price moved, or nobody
 * subscribes to the tier. A price field left empty is not a new price.
 */
export function editTierHint(input: {
  name: string;
  subscribers: number;
  saved: { monthly: number; annual: number };
  next: { monthly: unknown; annual: unknown };
}): EditTierHint | null {
  const moved = (next: unknown, saved: number) =>
    typeof next === 'number' && Number.isFinite(next) && next !== saved;
  const monthly = moved(input.next.monthly, input.saved.monthly);
  const annual = moved(input.next.annual, input.saved.annual);
  if ((!monthly && !annual) || input.subscribers <= 0) return null;
  const { name } = input;
  if (monthly && annual) {
    return {
      lead:
        input.subscribers === 1
          ? m.price_note_edit_lead_one({ name })
          : m.price_note_edit_lead({
              count: input.subscribers.toLocaleString('en-GB'),
              name,
            }),
      body: m.price_note_edit_body(),
    };
  }
  // One interval moved: the tier's count covers both, so it isn't said.
  return {
    lead: monthly
      ? m.price_note_edit_lead_monthly({ name })
      : m.price_note_edit_lead_annual({ name }),
    body: m.price_note_edit_body_one(),
  };
}
