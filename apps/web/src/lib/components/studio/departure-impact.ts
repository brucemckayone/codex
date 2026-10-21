/**
 * The Remove dialog's impact list (Codex-2hxff.64, mockup Variant 2): the
 * departure preview's counts turned into lines grouped by WHEN each effect
 * lands — "Stops now", "Ends later", "Kept" — so "37 tier subscribers" never
 * reads as "37 people lose access today".
 *
 * A line whose count is 0 is left out, and so is a group with no lines. No
 * groups at all means the member has nothing to unwind.
 *
 * Paraglide here has no plural forms, so every count picks between a `_one`
 * and an `_other` message; nothing concatenates a number into English.
 */

import type { DeparturePreview } from '$lib/types';
import * as m from '$paraglide/messages';

/**
 * Where the dialog's preview request has got to. `idle` means there is no
 * preview to show (no loader was given), so the dialog makes no claim about
 * what else changes.
 */
export type DepartureImpact =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: DeparturePreview }
  | { status: 'error' };

export type ImpactTone = 'now' | 'later' | 'kept';

export interface ImpactLine {
  key: string;
  lead: string;
  detail: string;
}

export interface ImpactGroup {
  tone: ImpactTone;
  label: string;
  lines: ImpactLine[];
}

const counts = new Intl.NumberFormat('en-GB');

function itemsPhrase(n: number): string {
  return n === 1
    ? m.team_remove_items_one()
    : m.team_remove_items_other({ count: counts.format(n) });
}

function coursesPhrase(n: number): string {
  return n === 1
    ? m.team_remove_courses_one()
    : m.team_remove_courses_other({ count: counts.format(n) });
}

function offSaleLead(items: number, courses: number): string {
  if (items > 0 && courses > 0) {
    return m.team_remove_off_sale_both({
      items: itemsPhrase(items),
      courses: coursesPhrase(courses),
    });
  }
  const things = items > 0 ? itemsPhrase(items) : coursesPhrase(courses);
  return items + courses === 1
    ? m.team_remove_off_sale_one({ things })
    : m.team_remove_off_sale_other({ things });
}

function tierSubscribersLead(n: number, name: string | null): string {
  if (name) {
    return n === 1
      ? m.team_remove_tier_subscribers_one({ name })
      : m.team_remove_tier_subscribers_other({ count: counts.format(n), name });
  }
  return n === 1
    ? m.team_remove_tier_subscribers_unnamed_one()
    : m.team_remove_tier_subscribers_unnamed_other({ count: counts.format(n) });
}

/**
 * @param preview - The counts from the departure-preview endpoint
 * @param name - The member's first name, or null when they have none
 */
export function departureImpactGroups(
  preview: DeparturePreview,
  name: string | null
): ImpactGroup[] {
  const offSale = preview.contentOnSale + preview.coursesOnSale;

  const now: ImpactLine[] = [];
  if (preview.agreements > 0) {
    now.push({
      key: 'agreements',
      lead:
        preview.agreements === 1
          ? m.team_remove_agreements_one()
          : m.team_remove_agreements_other({
              count: counts.format(preview.agreements),
            }),
      detail: name
        ? m.team_remove_agreements_detail({ name })
        : m.team_remove_agreements_detail_unnamed(),
    });
  }
  if (offSale > 0) {
    now.push({
      key: 'off-sale',
      lead: offSaleLead(preview.contentOnSale, preview.coursesOnSale),
      detail:
        offSale === 1
          ? m.team_remove_off_sale_detail_one()
          : m.team_remove_off_sale_detail_other(),
    });
  }

  const later: ImpactLine[] = [];
  if (preview.courseSubscriptions > 0) {
    const one = preview.courseSubscriptions === 1;
    later.push({
      key: 'course-subscriptions',
      lead: one
        ? m.team_remove_course_subscriptions_one()
        : m.team_remove_course_subscriptions_other({
            count: counts.format(preview.courseSubscriptions),
          }),
      detail: one
        ? m.team_remove_course_subscriptions_detail_one()
        : m.team_remove_course_subscriptions_detail_other(),
    });
  }
  if (preview.tierSubscribersAffected > 0) {
    later.push({
      key: 'tier-subscribers',
      lead: tierSubscribersLead(preview.tierSubscribersAffected, name),
      detail: m.team_remove_tier_subscribers_detail(),
    });
  }

  // One-off buyers keep what they bought whenever anything comes off sale.
  // The preview carries no count of them, so the line has none.
  const kept: ImpactLine[] =
    offSale > 0
      ? [
          {
            key: 'buyers',
            lead: m.team_remove_kept_lead(),
            detail: m.team_remove_kept_detail(),
          },
        ]
      : [];

  const groups: ImpactGroup[] = [
    { tone: 'now', label: m.team_remove_group_now(), lines: now },
    { tone: 'later', label: m.team_remove_group_later(), lines: later },
    { tone: 'kept', label: m.team_remove_group_kept(), lines: kept },
  ];
  return groups.filter((group) => group.lines.length > 0);
}

/**
 * The first word of a member's name, for "Remove Jane". `name` is nullable and
 * the only name field, so an absent or blank one gives null and the copy falls
 * back to "this member" / "Remove member".
 */
export function memberFirstName(
  name: string | null | undefined
): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
