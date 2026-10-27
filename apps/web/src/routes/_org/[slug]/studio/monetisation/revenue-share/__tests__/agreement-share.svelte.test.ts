/**
 * Studio → Monetisation → Revenue share: every share on the page is the
 * agreement's own `creatorSharePercent`, never `10000 - organizationFeePercentage`
 * (Codex-fazy6).
 *
 * The fixture's legacy column DISAGREES with the real share (it would rebuild
 * 70% from a 40% agreement), so each assertion tells the two reads apart. A
 * share that is missing (`null`) shows "—" and gets no pie slice.
 *
 * Mounts the real `+page.svelte` with the real AgreementCard and pie; the
 * remote modules and `$app/navigation` are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/org.remote', () => ({
  getOrgMembers: () => ({
    current: {
      items: [
        {
          userId: 'creator-maya',
          email: 'maya@studio-alpha.test',
          name: 'Maya Lin',
          avatarUrl: null,
          role: 'creator',
          status: 'active',
          joinedAt: '2026-08-01T00:00:00.000Z',
          hasCreatorAccount: true,
        },
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    },
    error: undefined,
    loading: false,
  }),
}));

import {
  agreementRow,
  LEGACY_SHARE,
  ORG_ID,
  REAL_SHARE,
  reset,
  setActiveAgreements,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import {
  MISSING_SHARE_PARTS,
  missingShareParts,
} from '$lib/components/agreements/__fixtures__/missing-share';
import RevenueSharePage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountWith(rows: ReturnType<typeof agreementRow>[]) {
  setActiveAgreements(rows);
  component = mount(RevenueSharePage, {
    target: document.body,
    props: {
      data: {
        userRole: 'owner',
        org: { id: ORG_ID, name: 'Studio Alpha', slug: 'studio-alpha' },
      },
    } as never,
  });
  flushSync();
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const activeShare = () =>
  document.querySelector('.revenue-share-page__active-share');
const cardShare = () =>
  document.querySelector(
    '.agreement-card [aria-label="Subscription agreement"] dd strong'
  );
const pie = () => document.querySelector('.revenue-split-pie');

describe('a creator with a 40% agreement whose legacy column says 70%', () => {
  test('the active list shows 40%', () => {
    mountWith([agreementRow()]);
    expect(text(activeShare())).toContain(REAL_SHARE);
    expect(text(activeShare())).not.toContain(LEGACY_SHARE);
  });

  test("the creator's card shows 40%", () => {
    mountWith([agreementRow()]);
    expect(text(cardShare())).toBe(REAL_SHARE);
  });

  test('the team-budget pie gives the creator a 40% slice', () => {
    mountWith([agreementRow()]);
    expect(text(pie())).toContain(REAL_SHARE);
    expect(text(pie())).not.toContain(LEGACY_SHARE);
    expect(text(pie())).toContain('Maya Lin');
  });
});

describe('an agreement whose share is missing', () => {
  test('shows an em dash in the active list and on the card', () => {
    mountWith([agreementRow({ creatorSharePercent: null })]);
    expect(missingShareParts(activeShare())).toEqual(MISSING_SHARE_PARTS);
    expect(text(activeShare())).not.toContain(LEGACY_SHARE);
    expect(missingShareParts(cardShare())).toEqual(MISSING_SHARE_PARTS);
  });

  test('gets no pie slice, so the legend never says 0% for it', () => {
    mountWith([agreementRow({ creatorSharePercent: null })]);
    expect(text(pie())).not.toContain('Maya Lin');
    expect(text(pie())).not.toContain(LEGACY_SHARE);
  });

  test('an older payload without the share (undefined) gets no slice either', () => {
    mountWith([agreementRow({ creatorSharePercent: undefined })]);
    expect(text(pie())).not.toContain('Maya Lin');
    expect(missingShareParts(activeShare())).toEqual(MISSING_SHARE_PARTS);
  });
});
