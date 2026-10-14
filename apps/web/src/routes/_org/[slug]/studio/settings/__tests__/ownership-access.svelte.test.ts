/**
 * Studio → Settings: the guard widens for an ownership offer's recipient, and
 * for nobody else (Codex-2hxff.2, mockup state 6).
 *
 * Before this change Settings admitted admins and owners only. A creator who is
 * offered ownership must be able to reach the card to accept or decline, so a
 * creator WITH an open offer now gets the Ownership card — and only the card:
 * the General form stays admin/owner-only.
 *
 * Mounts the real `+page.svelte` with the real `OwnershipCard`; only the remote
 * modules (they import `$app/server`) and `$app/navigation` are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OwnershipView } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const navigation = vi.hoisted(() => ({
  invalidate: vi.fn(async (_dep: string) => {}),
  goto: vi.fn(async (_url: string) => {}),
}));

vi.mock('$app/navigation', () => navigation);
vi.mock(
  '$lib/remote/settings.remote',
  () => import('./__fixtures__/settings-remote.mock.svelte')
);
vi.mock(
  '$lib/remote/ownership.remote',
  () =>
    import(
      '$lib/components/studio/ownership/__fixtures__/ownership-remote.mock.svelte'
    )
);

import {
  reset as resetOwnership,
  setView,
} from '$lib/components/studio/ownership/__fixtures__/ownership-remote.mock.svelte';
import SettingsPage from '../+page.svelte';
import {
  pageData,
  reset as resetSettings,
  setPageData,
} from './__fixtures__/settings-remote.mock.svelte';

const ORG = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Studio Alpha',
};
const PENDING = {
  offerId: '7c1e2b9a-4f3d-4c8e-9a61-2d5b8e0f1a37',
  offeredByName: 'Alex Morgan',
  expiresAt: '2099-10-20T10:00:00.000Z',
};

const OWNER = {
  userId: 'alex',
  name: 'Alex Morgan',
  avatarUrl: null,
  ownerSince: '2026-03-02T00:00:00.000Z',
  payoutsReady: true,
};

const RECIPIENT_VIEW: OwnershipView = {
  owner: OWNER,
  viewerRole: 'creator',
  openOffer: {
    id: PENDING.offerId,
    recipient: { userId: 'sam', name: 'Sam Patel', payoutsReady: false },
    offeredBy: { userId: 'alex', name: 'Alex Morgan' },
    offeredAt: '2026-10-13T10:00:00.000Z',
    expiresAt: PENDING.expiresAt,
  },
  activeAgreements: [],
};

let component: ReturnType<typeof mount> | null = null;

function mountPage(
  userRole: string | undefined,
  pendingOwnershipOffer: typeof PENDING | null = null
) {
  setPageData({ org: ORG, orgId: ORG.id, userRole, pendingOwnershipOffer });
  component = mount(SettingsPage, {
    target: document.body,
    // A getter over `$state`, so a later role change reaches the mounted page.
    props: {
      get data() {
        return pageData.value;
      },
    } as never,
  });
  flushSync();
}

const generalForm = () => document.querySelector('form.settings-form');
const ownershipCard = () => document.getElementById('ownership');

beforeEach(() => {
  resetOwnership();
  resetSettings();
  navigation.goto.mockClear();
  navigation.invalidate.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('Settings guard', () => {
  test('a creator with an open offer sees the Ownership card — and only the card', () => {
    setView(RECIPIENT_VIEW);
    mountPage('creator', PENDING);

    expect(navigation.goto).not.toHaveBeenCalled();
    expect(ownershipCard()).toBeTruthy();
    expect(document.body.textContent).toContain(m.ownership_recipient_accept());
    expect(generalForm()).toBeNull();
    expect(document.querySelector('#platformName')).toBeNull();
  });

  test('a creator WITHOUT an offer is still sent back to the studio', () => {
    mountPage('creator', null);

    expect(navigation.goto).toHaveBeenCalledWith('/studio');
    expect(ownershipCard()).toBeNull();
    expect(generalForm()).toBeNull();
  });

  test.each([
    'member',
    'subscriber',
  ])('a %s is sent back even holding an offer', (role) => {
    mountPage(role, PENDING);
    expect(navigation.goto).toHaveBeenCalledWith('/studio');
    expect(ownershipCard()).toBeNull();
  });

  test.each([
    'admin',
    'owner',
  ])('an %s sees the General form and the card', (role) => {
    setView({ owner: OWNER, viewerRole: 'admin', openOffer: null });
    mountPage(role, null);

    expect(navigation.goto).not.toHaveBeenCalled();
    expect(generalForm()).toBeTruthy();
    expect(ownershipCard()).toBeTruthy();
  });

  test('nothing happens while the role is still unknown (ssr = false)', () => {
    mountPage(undefined, PENDING);
    expect(navigation.goto).not.toHaveBeenCalled();
    expect(ownershipCard()).toBeNull();
    expect(generalForm()).toBeNull();
  });

  test('accepting (creator → owner) keeps the SAME card mounted while the form appears', () => {
    setView(RECIPIENT_VIEW);
    mountPage('creator', PENDING);
    const before = ownershipCard();
    expect(before).toBeTruthy();

    // What the studio layout's reload hands the page after an accept.
    setPageData({
      org: ORG,
      orgId: ORG.id,
      userRole: 'owner',
      pendingOwnershipOffer: null,
    });
    flushSync();

    expect(generalForm()).toBeTruthy();
    expect(ownershipCard()).toBe(before);
    expect(navigation.goto).not.toHaveBeenCalled();
  });
});
