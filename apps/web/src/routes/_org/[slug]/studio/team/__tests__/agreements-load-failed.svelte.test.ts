/**
 * Studio → Team: a failed agreements read is not "no agreements"
 * (Codex-2hxff.74, owner decision S4).
 *
 * It used to make every member's Revenue share cell read "Set up", including
 * creators with an agreement, and the link sent the owner off to propose one
 * again. Now "We couldn't load your agreements." with Retry sits ABOVE the
 * members table, and the Revenue share column is hidden until the agreements
 * load. Members, roles and Remove do not depend on it, so they stay.
 *
 * Mounts the real `+page.svelte` and MemberTable; the remote modules and
 * `$app/navigation` are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
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
  activeSlot,
  agreementRow,
  fail,
  httpError,
  ORG_ID,
  REAL_SHARE,
  reset,
  setActiveAgreements,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { logger } from '$lib/observability';
import TeamPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => reset());

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountPage() {
  component = mount(TeamPage, {
    target: document.body,
    props: {
      data: { userRole: 'owner', org: { id: ORG_ID, name: 'Studio Alpha' } },
    } as never,
  });
  flushSync();
}

const q = (selector: string) => document.querySelector(selector);
const loadError = () => q('[data-testid="team-agreements-load-error"]');
const retryButton = () =>
  loadError()?.querySelector('button') as HTMLButtonElement | null;
const headers = () =>
  [...document.querySelectorAll('th')].map((th) => th.textContent?.trim());
const settle = async () => {
  for (let turn = 0; turn < 3; turn++) {
    await new Promise((r) => setTimeout(r, 0));
  }
  flushSync();
};

describe('a failed agreements read', () => {
  test('shows the alert ABOVE the members table, with Retry', () => {
    mountPage();
    fail(activeSlot());
    flushSync();

    const alert = loadError();
    expect(alert?.textContent).toContain(m.agreement_load_failed());
    expect(retryButton()?.textContent?.trim()).toBe(
      m.money_setup_load_failed_retry()
    );
    const table = q('.members-section');
    expect(table).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING: the table comes after the alert.
    expect(
      (alert as Node).compareDocumentPosition(table as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test('hides the Revenue share column, so no cell says "Set up"', () => {
    mountPage();
    fail(activeSlot());
    flushSync();

    expect(headers()).not.toContain('Revenue share');
    expect(q('.rev-cell')).toBeNull();
    expect(document.body.textContent).not.toContain('Set up');
  });

  test('keeps the members, their roles and Remove', () => {
    mountPage();
    fail(activeSlot());
    flushSync();

    expect(document.body.textContent).toContain('Maya Lin');
    expect(headers()).toContain(m.team_col_role());
    expect(headers()).toContain(m.team_col_actions());
  });

  test('logs the failure', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    mountPage();
    fail(activeSlot());
    flushSync();

    expect(error).toHaveBeenCalledWith(
      'studio/team: agreements failed to load',
      expect.objectContaining({ organizationId: ORG_ID })
    );
  });

  test('a Retry that fails again says "We still couldn\'t…"', async () => {
    mountPage();
    const slot = activeSlot();
    fail(slot);
    flushSync();
    slot.refresh.mockImplementationOnce(async () => {
      fail(slot);
      throw httpError();
    });

    retryButton()?.click();
    await settle();

    expect(slot.refresh).toHaveBeenCalledTimes(1);
    expect(loadError()?.textContent).toContain(m.agreement_load_failed_again());
  });

  test('a Retry that loads them brings the column back', async () => {
    mountPage();
    const slot = activeSlot();
    fail(slot);
    flushSync();
    slot.refresh.mockImplementationOnce(async () => {
      setActiveAgreements([agreementRow()]);
    });

    retryButton()?.click();
    await settle();

    expect(loadError()).toBeNull();
    expect(headers()).toContain('Revenue share');
    expect(q('.rev-cell')?.textContent).toContain(`${REAL_SHARE} subs`);
  });
});

test('while the agreements are still loading, the column waits too', () => {
  mountPage();
  expect(headers()).not.toContain('Revenue share');
  expect(document.body.textContent).not.toContain('Set up');
});
