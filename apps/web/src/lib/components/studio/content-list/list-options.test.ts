/**
 * The personal studio's Where menu (Codex-a6ofh.3.2, mockup L4b): its
 * choices and their counts, from the where-counts read and the layout's orgs.
 */
import type { ContentWhereCounts } from '@codex/shared-types';
import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { categoryOptions, whereOptions } from './list-options';
import { CATEGORY_ANY, WHERE_ALL, WHERE_PERSONAL } from './list-url';

const ALPHA = '5f0c7b2e-1d3a-4c8e-9b6f-2a7d1e4c9b30';
const BETA = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const ORGS = [
  { id: ALPHA, name: 'Studio Alpha' },
  { id: BETA, name: 'Studio Beta' },
];
const COUNTS: ContentWhereCounts = {
  all: 9,
  personal: 4,
  orgs: [{ id: ALPHA, name: 'Studio Alpha', count: 5 }],
};

/** What a menu row shows: its value, label and count. */
function rows(options: ReturnType<typeof whereOptions>) {
  return options.map((option) => ({
    value: option.value,
    label: option.label(),
    count: option.count,
  }));
}

describe('whereOptions', () => {
  it('leads with Everywhere and Personal, then each counted org, with counts', () => {
    expect(rows(whereOptions(COUNTS, WHERE_PERSONAL, ORGS))).toEqual([
      { value: WHERE_ALL, label: m.studio_content_where_all(), count: 9 },
      {
        value: WHERE_PERSONAL,
        label: m.studio_content_where_personal(),
        count: 4,
      },
      { value: ALPHA, label: 'Studio Alpha', count: 5 },
    ]);
  });

  it('unread counts give no numbers, never a 0, and no orgs of their own', () => {
    expect(rows(whereOptions(undefined, WHERE_ALL, ORGS))).toEqual([
      {
        value: WHERE_ALL,
        label: m.studio_content_where_all(),
        count: undefined,
      },
      {
        value: WHERE_PERSONAL,
        label: m.studio_content_where_personal(),
        count: undefined,
      },
    ]);
  });

  it('names the org the URL is on from the layout while the counts are unread', () => {
    const last = rows(whereOptions(undefined, BETA, ORGS)).at(-1);
    expect(last).toEqual({
      value: BETA,
      label: 'Studio Beta',
      count: undefined,
    });
  });

  it('an org the counts leave out has none there: 0, once they are read', () => {
    const last = rows(whereOptions(COUNTS, BETA, ORGS)).at(-1);
    expect(last).toEqual({ value: BETA, label: 'Studio Beta', count: 0 });
  });

  it('never lists the URL org twice when the counts already name it', () => {
    const values = whereOptions(COUNTS, ALPHA, ORGS).map((o) => o.value);
    expect(values.filter((value) => value === ALPHA)).toHaveLength(1);
  });

  it('leaves out an org neither names: the menu never shows an id', () => {
    const stranger = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const values = whereOptions(COUNTS, stranger, ORGS).map((o) => o.value);
    expect(values).not.toContain(stranger);
  });
});

/** The org studio's Category facet (Codex-a6ofh.3.3, mockup L1 pin 4). */
describe('categoryOptions', () => {
  const TUTORIALS = '7c000000-0000-4000-8000-000000000001';
  const LIVE = '7c000000-0000-4000-8000-000000000002';
  const CATEGORIES = [
    { id: TUTORIALS, name: 'Tutorials' },
    { id: LIVE, name: 'Live' },
  ];

  it('leads with Any, then the categories in their order', () => {
    expect(rows(categoryOptions(CATEGORIES, CATEGORY_ANY))).toEqual([
      {
        value: CATEGORY_ANY,
        label: m.studio_content_category_any(),
        count: undefined,
      },
      { value: TUTORIALS, label: 'Tutorials', count: undefined },
      { value: LIVE, label: 'Live', count: undefined },
    ]);
  });

  it('unread, it offers Any alone', () => {
    expect(
      categoryOptions(undefined, CATEGORY_ANY).map((o) => o.value)
    ).toEqual([CATEGORY_ANY]);
  });

  it('names a URL category nothing names "This category", never its id', () => {
    const stranger = '7c000000-0000-4000-8000-00000000dead';
    for (const read of [undefined, CATEGORIES]) {
      const last = rows(categoryOptions(read, stranger)).at(-1);
      expect(last).toMatchObject({
        value: stranger,
        label: m.studio_content_category_this(),
      });
    }
  });

  it('never lists the URL category twice when the read names it', () => {
    const values = categoryOptions(CATEGORIES, LIVE).map((o) => o.value);
    expect(values.filter((value) => value === LIVE)).toHaveLength(1);
  });
});
