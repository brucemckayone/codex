/**
 * Studio → Monetisation → Revenue share: who the roster offers an agreement
 * to (owner decisions 2026-10-27).
 *
 * - The owner is never on the roster (Codex-2hxff.77). They already get the
 *   creator slice and the organisation slice of their own sales, and the
 *   whole pool with no subscription agreements, so the server refuses a
 *   proposal to yourself. The roster used to list them under "No agreement
 *   yet" with Propose.
 * - An agreement the owner holds from before still carries their name.
 * - A member without a creator account says "Needs a creator account first"
 *   and is offered no Propose or Amend (Codex-2hxff.76, "Creator accounts
 *   only"). The server refuses both, because a creator negotiates in the
 *   creators' Studio, which their account can't enter.
 *
 * Mounts the real `+page.svelte`; the remote modules and `$app/navigation`
 * are mocked, as in `load-failed-and-readonly.svelte.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const members = vi.hoisted(() => ({
  result: null as unknown,
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock(
  '$lib/remote/agreements.remote',
  () =>
    import(
      '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte'
    )
);
vi.mock('$lib/remote/org.remote', () => ({
  getOrgMembers: () => members.result,
}));

import {
  agreementRow,
  CREATOR_ID,
  ORG_ID,
  reset,
  setActiveAgreements,
  setPendingProposals,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import RevenueSharePage from '../+page.svelte';

const OWNER_ID = 'owner-olive';

const member = (overrides: Record<string, unknown>) => ({
  userId: CREATOR_ID,
  email: 'maya@studio-alpha.test',
  name: 'Maya Lin',
  avatarUrl: null,
  role: 'creator',
  status: 'active',
  joinedAt: '2026-08-01T00:00:00.000Z',
  hasCreatorAccount: true,
  ...overrides,
});
const MAYA = member({});
const OLIVE = member({
  userId: OWNER_ID,
  email: 'olive@studio-alpha.test',
  name: 'Olive Owner',
  role: 'owner',
});
/** On the team as a creator, but their account is a customer's. */
const JO = member({
  userId: 'member-jo',
  email: 'jo@studio-alpha.test',
  name: 'Jo Park',
  hasCreatorAccount: false,
});

function membersLoaded(rows: unknown[]) {
  return {
    current: {
      items: rows,
      pagination: { page: 1, limit: 100, total: rows.length, totalPages: 1 },
    },
    error: undefined,
    loading: false,
    refresh: vi.fn(async () => {}),
  };
}

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  members.result = membersLoaded([OLIVE, MAYA]);
  setPendingProposals([]);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage(userRole: 'owner' | 'admin' = 'owner') {
  component = mount(RevenueSharePage, {
    target: document.body,
    props: {
      data: {
        userRole,
        org: { id: ORG_ID, name: 'Studio Alpha', slug: 'studio-alpha' },
      },
    } as never,
  });
  flushSync();
}

const rosterNames = () =>
  [...document.querySelectorAll('.revenue-share-page__roster-name')].map((el) =>
    el.textContent?.trim()
  );
const cardNames = () =>
  [...document.querySelectorAll('.agreement-card__name')].map((el) =>
    el.textContent?.trim()
  );
const rosterRow = (name: string) =>
  [...document.querySelectorAll('.revenue-share-page__roster-row')].find(
    (row) =>
      row
        .querySelector('.revenue-share-page__roster-name')
        ?.textContent?.trim() === name
  );
const cardFor = (name: string) =>
  [...document.querySelectorAll('.agreement-card')].find(
    (card) =>
      card.querySelector('.agreement-card__name')?.textContent?.trim() === name
  );
const buttonLabels = (root: Element | undefined) =>
  [...(root?.querySelectorAll('button') ?? [])].map((b) =>
    b.textContent?.trim()
  );

describe('the owner (Codex-2hxff.77)', () => {
  test('is never on the roster; a creator is', () => {
    setActiveAgreements([]);
    mountPage();
    expect(rosterNames()).toEqual(['Maya Lin']);
    expect(cardNames()).toEqual([]);
    expect(
      [...document.querySelectorAll('button')].some((b) =>
        b.getAttribute('aria-label')?.includes('Olive Owner')
      )
    ).toBe(false);
  });

  test('an agreement they hold from before is still labelled with their name', () => {
    setActiveAgreements([
      agreementRow({ creatorId: OWNER_ID, creatorSharePercent: 3000 }),
    ]);
    mountPage();
    // Not offered on the roster or as a card...
    expect(rosterNames()).not.toContain('Olive Owner');
    expect(cardNames()).not.toContain('Olive Owner');
    // ...but the bar and the active list still name them.
    const legend = [
      ...document.querySelectorAll('.revenue-split-pie__legend-label'),
    ].map((el) => el.textContent?.trim());
    expect(legend).toContain('Olive Owner');
    expect(
      document.querySelector('.revenue-share-page__active-creator')?.textContent
    ).toBe('Olive Owner');
  });
});

describe('a member without a creator account (Codex-2hxff.76)', () => {
  beforeEach(() => {
    members.result = membersLoaded([OLIVE, MAYA, JO]);
  });

  test('is listed with "Needs a creator account first" and no Propose', () => {
    setActiveAgreements([]);
    mountPage();
    expect(rosterNames()).toEqual(['Maya Lin', 'Jo Park']);
    const jo = rosterRow('Jo Park');
    expect(jo?.textContent).toContain(m.agreement_needs_creator_account());
    expect(buttonLabels(jo)).toEqual([]);
    // A creator account keeps both Propose buttons.
    const maya = rosterRow('Maya Lin');
    expect(maya?.textContent).not.toContain(
      m.agreement_needs_creator_account()
    );
    expect(buttonLabels(maya)).toEqual([
      m.monetisation_revshare_type_subscription(),
      m.monetisation_revshare_type_content(),
    ]);
  });

  test('an admin sees the same note', () => {
    setActiveAgreements([]);
    mountPage('admin');
    expect(rosterRow('Jo Park')?.textContent).toContain(
      m.agreement_needs_creator_account()
    );
  });

  test('an agreement they hold from before can be read and ended, not amended or added to', () => {
    setActiveAgreements([
      agreementRow({ creatorId: 'member-jo', creatorSharePercent: 3000 }),
    ]);
    mountPage();
    const card = cardFor('Jo Park');
    expect(card).toBeDefined();
    // Subscription is active: View thread, no Amend.
    expect(buttonLabels(card)).toEqual(['View thread']);
    // Content purchase has nothing: the note, no Propose.
    expect(card?.textContent).toContain(m.agreement_needs_creator_account());
    // Ending it stays on the active list.
    expect(
      document.querySelector('.revenue-share-page__active-creator')?.textContent
    ).toBe('Jo Park');
  });
});
