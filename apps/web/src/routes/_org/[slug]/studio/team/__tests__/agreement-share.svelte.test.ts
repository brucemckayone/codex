/**
 * Studio → Team: the revenue-share column shows the agreement's own
 * `creatorSharePercent`, never `10000 - organizationFeePercentage`
 * (Codex-fazy6).
 *
 * The fixture's legacy column DISAGREES with the real share (it would rebuild
 * 70% from a 40% agreement). A missing share (`null`) reads "— subs".
 *
 * Mounts the real `+page.svelte` and MemberTable; the remote modules and
 * `$app/navigation` are mocked.
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
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    },
    error: undefined,
    loading: false,
    refresh: async () => {},
  }),
  getDeparturePreview: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import {
  agreementRow,
  LEGACY_SHARE,
  ORG_ID,
  REAL_SHARE,
  reset,
  setActiveAgreements,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import * as m from '$paraglide/messages';
import TeamPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountWith(rows: ReturnType<typeof agreementRow>[]) {
  setActiveAgreements(rows);
  component = mount(TeamPage, {
    target: document.body,
    props: {
      data: { userRole: 'owner', org: { id: ORG_ID, name: 'Studio Alpha' } },
    } as never,
  });
  flushSync();
}

const shareCell = () =>
  document.querySelector('.rev-cell')?.textContent?.replace(/\s+/g, ' ') ?? '';

describe('the revenue-share column', () => {
  test("shows the agreement's own 40%, not the legacy column's 70%", () => {
    mountWith([agreementRow()]);
    expect(shareCell()).toContain(`${REAL_SHARE} subs`);
    expect(shareCell()).not.toContain(LEGACY_SHARE);
  });

  test('a missing share reads "— subs", never "0% subs"', () => {
    mountWith([agreementRow({ creatorSharePercent: null })]);
    expect(shareCell()).toContain('— subs');
    expect(shareCell()).not.toContain('0% subs');
    expect(shareCell()).not.toContain(LEGACY_SHARE);
  });

  test('a screen reader hears "No share recorded subs" in place of the dash', () => {
    mountWith([agreementRow({ creatorSharePercent: null })]);
    const badge = document.querySelector('.rev-cell');
    expect(
      badge?.querySelector('[aria-hidden="true"]')?.textContent?.trim()
    ).toBe('— subs');
    expect(badge?.querySelector('.sr-only')?.textContent?.trim()).toBe(
      `${m.agreement_share_missing()} subs`
    );
  });

  test('a recorded share needs no separate spoken label', () => {
    mountWith([agreementRow()]);
    expect(document.querySelector('.rev-cell .sr-only')).toBeNull();
  });
});
