/**
 * departureImpactGroups — singular and plural copy, zero-hiding, and the
 * "Kept" rule (Codex-2hxff.64). Paraglide has no plural forms here, so every
 * count must pick a `_one` or `_other` message: "1 revenue-share agreement
 * ends", never "1 revenue-share agreements end".
 */

import { describe, expect, test } from 'vitest';
import type { DeparturePreview } from '$lib/types';
import { departureImpactGroups, memberFirstName } from './departure-impact';

const NONE: DeparturePreview = {
  agreements: 0,
  contentOnSale: 0,
  coursesOnSale: 0,
  courseSubscriptions: 0,
  tierSubscribersAffected: 0,
};

const leads = (
  preview: Partial<DeparturePreview>,
  name: string | null = 'Jane'
) =>
  departureImpactGroups({ ...NONE, ...preview }, name).flatMap((group) =>
    group.lines.map((line) => line.lead)
  );

describe('departureImpactGroups', () => {
  test('nothing to unwind gives no groups', () => {
    expect(departureImpactGroups(NONE, 'Jane')).toEqual([]);
  });

  test('every count of one reads in the singular', () => {
    expect(
      leads({
        agreements: 1,
        contentOnSale: 1,
        courseSubscriptions: 1,
        tierSubscribersAffected: 1,
      })
    ).toEqual([
      '1 revenue-share agreement ends',
      '1 item comes off sale',
      '1 course subscription cancels when its current period ends',
      "1 tier subscriber keeps Jane's content until their next renewal",
      'One-off buyers keep what they bought',
    ]);
  });

  test('larger counts read in the plural, with grouped thousands', () => {
    expect(leads({ contentOnSale: 1200 })).toEqual([
      '1,200 items come off sale',
      'One-off buyers keep what they bought',
    ]);
    expect(leads({ contentOnSale: 1, coursesOnSale: 1 })).toEqual([
      '1 item and 1 course come off sale',
      'One-off buyers keep what they bought',
    ]);
  });

  test('agreements alone stop now, and nothing is kept because nothing came off sale', () => {
    const groups = departureImpactGroups({ ...NONE, agreements: 2 }, 'Jane');
    expect(groups.map((group) => group.tone)).toEqual(['now']);
  });

  test('without a name the copy says "this member"', () => {
    expect(leads({ tierSubscribersAffected: 3 }, null)).toEqual([
      "3 tier subscribers keep this member's content until their next renewal",
    ]);
  });
});

describe('memberFirstName', () => {
  test.each([
    ['Jane Doe', 'Jane'],
    ['  Priya  Shah ', 'Priya'],
    ['Cher', 'Cher'],
    ['', null],
    ['   ', null],
    [null, null],
  ])('%j → %j', (name, first) => {
    expect(memberFirstName(name)).toBe(first);
  });
});
