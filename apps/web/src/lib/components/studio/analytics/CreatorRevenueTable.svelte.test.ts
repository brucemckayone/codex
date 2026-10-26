/**
 * CreatorRevenueTable (Codex-zsh2p): one row per creator, Earned, and each
 * share as a percentage, "None" (no agreement of that kind) or "—" (an
 * agreement with no share on record), never "0%".
 */
import type { CreatorRevenueSplitItem } from '@codex/admin';
import { afterEach, describe, expect, test } from 'vitest';
import { mount, unmount } from '$tests/utils/component-test-utils.svelte';
import CreatorRevenueTable from './CreatorRevenueTable.svelte';

function row(
  overrides: Partial<CreatorRevenueSplitItem>
): CreatorRevenueSplitItem {
  return {
    creatorId: 'creator-maya',
    name: 'Maya Okafor',
    avatarUrl: null,
    earnedCents: 23452,
    subscriptionShare: { kind: 'share', percent: 30 },
    salesShare: { kind: 'share', percent: 20 },
    lastPayoutAt: '2026-10-03T10:00:00.000Z',
    pendingPayoutCents: 3520,
    ...overrides,
  };
}

const ITEMS: CreatorRevenueSplitItem[] = [
  row({}),
  row({
    creatorId: 'creator-jonah',
    name: 'Jonah Reyes',
    earnedCents: 1620,
    subscriptionShare: { kind: 'none' },
    salesShare: { kind: 'none' },
    lastPayoutAt: null,
    pendingPayoutCents: 1620,
  }),
  row({
    creatorId: 'creator-ruth',
    name: 'Ruth Calder',
    earnedCents: 0,
    subscriptionShare: { kind: 'unreadable' },
    salesShare: { kind: 'none' },
    pendingPayoutCents: 0,
  }),
];

/** The cells of one body row, by column header. */
function cellsOf(name: string): Record<string, string> {
  const headers = [...document.querySelectorAll('thead th')].map(
    (th) => th.textContent?.trim() ?? ''
  );
  const tr = [...document.querySelectorAll('tbody tr')].find((candidate) =>
    candidate.querySelector('.name')?.textContent?.includes(name)
  );
  if (!tr) throw new Error(`no row for ${name}`);
  const cells = [...tr.querySelectorAll('td')];
  return Object.fromEntries(
    headers.map((header, index) => [
      header,
      cells[index]?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ])
  );
}

describe('CreatorRevenueTable', () => {
  let component: ReturnType<typeof mount> | null = null;

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    document.body.innerHTML = '';
  });

  test('has the owner’s columns: Earned and both shares, not "Total revenue" and "Split"', () => {
    component = mount(CreatorRevenueTable, {
      target: document.body,
      props: { items: ITEMS },
    });

    const headers = [...document.querySelectorAll('thead th')].map((th) =>
      th.textContent?.trim()
    );
    expect(headers).toEqual([
      '',
      'Creator',
      'Earned',
      'Subscription share',
      'Sales share',
      'Last payout',
      'Pending',
    ]);
  });

  test('one row per creator, with Earned and both shares', () => {
    component = mount(CreatorRevenueTable, {
      target: document.body,
      props: { items: ITEMS },
    });

    expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
    const maya = cellsOf('Maya Okafor');
    expect(maya.Earned).toBe('£234.52');
    expect(maya['Subscription share']).toBe('30%');
    expect(maya['Sales share']).toBe('20%');
    expect(maya.Pending).toBe('£35.20');
  });

  test('no agreement of a kind reads "None"', () => {
    component = mount(CreatorRevenueTable, {
      target: document.body,
      props: { items: ITEMS },
    });

    const jonah = cellsOf('Jonah Reyes');
    expect(jonah['Subscription share']).toBe('None');
    expect(jonah['Sales share']).toBe('None');
  });

  test('an agreement with no share on record reads "—", never "0%"', () => {
    component = mount(CreatorRevenueTable, {
      target: document.body,
      props: { items: ITEMS },
    });

    const ruth = cellsOf('Ruth Calder');
    // The dash is what is seen; the words are what is heard.
    expect(ruth['Subscription share']).toBe('— No share recorded');
    expect(ruth['Subscription share']).not.toMatch(/\d%/);
  });

  test('the narrow-width line under the name carries both shares', () => {
    component = mount(CreatorRevenueTable, {
      target: document.body,
      props: { items: ITEMS },
    });

    const inline = [...document.querySelectorAll('.shares-inline')].map((el) =>
      el.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(inline).toEqual([
      'Subs 30% · Sales 20%',
      'Subs None · Sales None',
      'Subs — · Sales None',
    ]);
  });
});
