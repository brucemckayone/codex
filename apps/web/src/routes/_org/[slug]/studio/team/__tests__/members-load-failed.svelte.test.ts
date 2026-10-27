/**
 * Studio → Team: a failed members read is not "no members"
 * (Codex-2hxff.74).
 *
 * It used to show "No team members yet. Invite your first member…" with an
 * Invite button, to an owner or admin who is a member themselves. Now "We
 * couldn't load your team." with Retry stands in for the table, and Invite
 * waits for the list.
 *
 * Mounts the real `+page.svelte` and MemberTable; the remote modules and
 * `$app/navigation` are mocked. The members read is a plain object a test
 * swaps before mounting.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const members = vi.hoisted(() => ({ result: null as unknown }));

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
  getDeparturePreview: vi.fn(),
  inviteMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeMember: vi.fn(),
}));

import {
  ORG_ID,
  reset,
  setActiveAgreements,
} from '$lib/components/agreements/__fixtures__/agreements-remote.mock.svelte';
import { logger } from '$lib/observability';
import TeamPage from '../+page.svelte';

let component: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  reset();
  setActiveAgreements([]);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function mountWith(result: unknown) {
  members.result = result;
  component = mount(TeamPage, {
    target: document.body,
    props: {
      data: { userRole: 'owner', org: { id: ORG_ID, name: 'Studio Alpha' } },
    } as never,
  });
  flushSync();
}

const FAILED = {
  current: undefined,
  error: { status: 500, body: { message: 'Internal Error' } },
  loading: false,
  refresh: vi.fn(async () => {}),
};

const q = (selector: string) => document.querySelector(selector);
const text = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';
const inviteButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(m.team_invite())
  );

test('a failed members read says so with Retry, in place of the table', () => {
  mountWith(FAILED);

  const alert = q('[data-testid="team-members-load-error"]');
  expect(alert?.getAttribute('role')).toBe('alert');
  expect(alert?.textContent).toContain(m.team_load_failed());
  expect(q('.members-section')).toBeNull();
  expect(text()).not.toContain(m.team_empty());
});

test('offers no Invite while the members are unknown', () => {
  mountWith(FAILED);
  expect(inviteButton()).toBeUndefined();
});

test('logs the failure', () => {
  const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
  mountWith(FAILED);
  expect(error).toHaveBeenCalledWith(
    'studio/team: members failed to load',
    expect.objectContaining({ organizationId: ORG_ID })
  );
});

test('a members list that loaded keeps the table and Invite (negative control)', () => {
  mountWith({
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
    refresh: vi.fn(async () => {}),
  });

  expect(q('[data-testid="team-members-load-error"]')).toBeNull();
  expect(q('.members-section')).not.toBeNull();
  expect(inviteButton()).toBeDefined();
});
