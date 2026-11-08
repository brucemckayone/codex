/**
 * The customer drawer's "Access grants" section (Codex-2hxff.21, mockup
 * A1–A3).
 *
 * States: loading (skeleton rows, requested as the drawer opens, alongside
 * the details), populated (live rows with Revoke, revoked rows muted with
 * "Revoked <date>" and no button), empty (the A3 line), error (a rejected
 * query renders an error, never the empty line). Revoke confirms in
 * ConfirmDialog, then refreshes the list; a refused revoke keeps the row live
 * and says so on it.
 *
 * Mounts the real drawer and ConfirmDialog; only the remote modules (they
 * import `$app/server`) are mocked.
 */

import type { CustomerDetails } from '@codex/admin';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CustomerGrant } from '$lib/types';
import { formatDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

vi.mock(
  '$lib/remote/admin.remote',
  () => import('./__fixtures__/admin-remote.mock.svelte')
);
vi.mock('$lib/remote/content.remote', () => ({
  listContent: vi.fn(async () => ({ items: [] })),
}));

import {
  getCustomerDetail,
  getCustomerGrants,
  grantsPage,
  refreshGrants,
  reset,
  revokeCustomerGrant,
  setGrants,
  setGrantsError,
} from './__fixtures__/admin-remote.mock.svelte';
import CustomerDetailDrawer from './CustomerDetailDrawer.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

const ELLIE: CustomerDetails = {
  userId: 'ellie',
  email: 'ellie.marsh@example.com',
  name: 'Ellie Marsh',
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  totalPurchases: 1,
  totalSpentCents: 1500,
  purchaseHistory: [
    {
      purchaseId: 'p1',
      contentId: 'c-kettlebell',
      contentTitle: 'Kettlebell Foundations',
      amountPaidCents: 1500,
      purchasedAt: new Date('2026-10-16T00:00:00.000Z'),
    },
  ],
};

const SLEEP: CustomerGrant = {
  id: '1b7c0d3e-0000-4000-8000-000000000001',
  contentId: 'c-sleep',
  contentTitle: 'Sleep Reset Programme',
  contentSlug: 'sleep-reset-programme',
  grantedAt: '2026-10-12T10:00:00.000Z',
  grantedByName: 'Sam Owner',
  revokedAt: null,
  revokedByName: null,
};
const CORE: CustomerGrant = {
  id: '1b7c0d3e-0000-4000-8000-000000000002',
  contentId: 'c-core',
  contentTitle: 'Core Conditioning',
  contentSlug: 'core-conditioning',
  grantedAt: '2026-10-10T10:00:00.000Z',
  grantedByName: 'Alex Morgan',
  revokedAt: '2026-10-18T09:00:00.000Z',
  revokedByName: 'Alex Morgan',
};
const MOBILITY: CustomerGrant = {
  id: '1b7c0d3e-0000-4000-8000-000000000003',
  contentId: 'c-mobility',
  contentTitle: 'Mobility for Lifters',
  contentSlug: 'mobility-for-lifters',
  grantedAt: '2026-10-03T10:00:00.000Z',
  grantedByName: 'Alex Morgan',
  revokedAt: null,
  revokedByName: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let component: ReturnType<typeof mount> | null = null;

function mountDrawer() {
  component = mount(CustomerDetailDrawer, {
    target: document.body,
    props: { open: true, customerId: ELLIE.userId, orgId: ORG_ID },
  });
  flushSync();
}

const drawer = () =>
  document.querySelector<HTMLElement>('.dialog-content.drawer-content');

/** The "Access grants" section, once the details have rendered. */
function grantsSection(): HTMLElement {
  const heading = [...document.querySelectorAll('h4.section-heading')].find(
    (h) => h.textContent?.trim() === m.studio_customers_grants_heading()
  );
  const section = heading?.closest('section');
  if (!section) throw new Error('no Access grants section');
  return section as HTMLElement;
}

function rows(): HTMLLIElement[] {
  return [...grantsSection().querySelectorAll<HTMLLIElement>('li.grant-row')];
}

function row(title: string): HTMLLIElement {
  const found = rows().find((r) => r.textContent?.includes(title));
  if (!found) throw new Error(`no grant row for ${title}`);
  return found;
}

function confirmDialog(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('.dialog-content')].find(
      (d) => !d.classList.contains('drawer-content')
    ) ?? null
  );
}

function button(scope: HTMLElement, label: string) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
}

const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

beforeEach(() => {
  reset();
  getCustomerDetail.mockResolvedValue(ELLIE);
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

// Melt points the panel's aria-labelledby at Dialog.Title's id: with no
// Title, a loading or failed drawer was an unnamed dialog.
describe('a name in every state', () => {
  const name = () =>
    clean(
      document.getElementById(drawer()?.getAttribute('aria-labelledby') ?? '')
    );

  test('the drawer is named while the details load', () => {
    getCustomerDetail.mockReturnValue(new Promise(() => {}));
    mountDrawer();

    expect(drawer()?.querySelector('.drawer-loading')).toBeTruthy();
    expect(name()).toBe(m.studio_customers_drawer_title());
  });

  test('the drawer is named when the details failed to load', async () => {
    getCustomerDetail.mockRejectedValue(new Error('load failed'));
    mountDrawer();

    await vi.waitFor(() =>
      expect(drawer()?.querySelector('.drawer-error')).toBeTruthy()
    );
    expect(name()).toBe(m.studio_customers_drawer_title());
  });
});

describe('loading', () => {
  test('asks for the grants as the drawer opens, before the details land', () => {
    const details = deferred<CustomerDetails>();
    getCustomerDetail.mockReturnValue(details.promise);
    mountDrawer();

    expect(getCustomerDetail).toHaveBeenCalledWith({
      customerId: ELLIE.userId,
      organizationId: ORG_ID,
    });
    expect(getCustomerGrants).toHaveBeenCalledWith({
      customerId: ELLIE.userId,
      organizationId: ORG_ID,
    });
  });

  test('shows skeleton rows while the grants are still loading', async () => {
    mountDrawer();
    await vi.waitFor(() => expect(grantsSection()).toBeTruthy());

    const skeleton = grantsSection().querySelector('ul.grant-list');
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.querySelectorAll('li')).toHaveLength(2);
    expect(clean(grantsSection())).toContain(
      m.studio_customers_grants_loading()
    );
    expect(clean(grantsSection())).not.toContain(
      m.studio_customers_grants_empty()
    );
  });
});

describe('populated', () => {
  test('lists live grants first with Revoke, and revoked ones muted with no button', async () => {
    // API order: newest grantedAt first, live and revoked mixed.
    setGrants(grantsPage([SLEEP, CORE, MOBILITY]));
    mountDrawer();
    await vi.waitFor(() => expect(rows()).toHaveLength(3));

    expect(
      rows().map((r) => r.querySelector('.grant-title')?.textContent?.trim())
    ).toEqual([SLEEP.contentTitle, MOBILITY.contentTitle, CORE.contentTitle]);
    expect(rows().map((r) => r.dataset.state)).toEqual([
      'live',
      'live',
      'revoked',
    ]);

    const sleep = row(SLEEP.contentTitle);
    expect(clean(sleep.querySelector('.grant-meta'))).toBe(
      m.studio_customers_grants_granted_by({
        date: formatDate(SLEEP.grantedAt),
        name: 'Sam Owner',
      })
    );
    expect(sleep.querySelector('a.grant-title')?.getAttribute('href')).toBe(
      '/content/sleep-reset-programme'
    );
    const revoke = button(sleep, m.studio_customers_grants_revoke());
    expect(revoke?.getAttribute('aria-label')).toBe(
      m.studio_customers_grants_revoke_label({ title: SLEEP.contentTitle })
    );

    const core = row(CORE.contentTitle);
    expect(clean(core.querySelector('.grant-meta'))).toBe(
      m.studio_customers_grants_revoked({
        date: formatDate(CORE.revokedAt ?? ''),
      })
    );
    expect(core.querySelector('button')).toBeNull();
  });

  test('a grant whose maker is unknown reads "Granted <date>"', async () => {
    setGrants(grantsPage([{ ...MOBILITY, grantedByName: null }]));
    mountDrawer();
    await vi.waitFor(() => expect(rows()).toHaveLength(1));

    expect(clean(row(MOBILITY.contentTitle).querySelector('.grant-meta'))).toBe(
      m.studio_customers_grants_granted({
        date: formatDate(MOBILITY.grantedAt),
      })
    );
  });
});

describe('empty', () => {
  test('keeps the section with the A3 line', async () => {
    setGrants(grantsPage([]));
    mountDrawer();
    await vi.waitFor(() =>
      expect(clean(grantsSection())).toContain(
        m.studio_customers_grants_empty()
      )
    );
    expect(grantsSection().querySelector('ul')).toBeNull();
  });
});

describe('error', () => {
  test('a rejected query renders an error with Try again, never the empty line', async () => {
    setGrantsError({ status: 500, body: { message: 'boom' } });
    mountDrawer();
    await vi.waitFor(() =>
      expect(clean(grantsSection())).toContain(
        m.studio_customers_grants_load_error()
      )
    );

    const section = grantsSection();
    expect(section.querySelector('[role="alert"]')).toBeTruthy();
    expect(clean(section)).not.toContain(m.studio_customers_grants_empty());
    expect(section.querySelector('ul')).toBeNull();

    button(section, m.studio_customers_grants_retry())?.click();
    expect(refreshGrants).toHaveBeenCalledTimes(1);
  });
});

describe('revoke', () => {
  async function openRevoke(grant: CustomerGrant) {
    mountDrawer();
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
    button(
      row(grant.contentTitle),
      m.studio_customers_grants_revoke()
    )?.click();
    flushSync();
    const dialog = confirmDialog();
    if (!dialog) throw new Error('confirm did not open');
    return dialog;
  }

  test('confirms with the A2 copy, calls the command, then refreshes the list', async () => {
    setGrants(grantsPage([SLEEP, MOBILITY]));
    refreshGrants.mockImplementation(async () => {
      setGrants(
        grantsPage([
          MOBILITY,
          {
            ...SLEEP,
            revokedAt: '2026-10-21T12:00:00.000Z',
            revokedByName: 'Sam Owner',
          },
        ])
      );
    });
    const dialog = await openRevoke(SLEEP);

    expect(clean(dialog)).toContain(
      m.studio_customers_grants_revoke_title({ title: SLEEP.contentTitle })
    );
    expect(clean(dialog)).toContain(
      m.studio_customers_grants_revoke_description({ name: 'Ellie Marsh' })
    );
    expect(dialog.dataset.size).toBe('sm');
    expect(dialog.querySelector('.dialog-body')).toBeNull();

    button(dialog, m.studio_customers_grants_revoke_confirm())?.click();

    await vi.waitFor(() =>
      expect(row(SLEEP.contentTitle).dataset.state).toBe('revoked')
    );
    expect(revokeCustomerGrant).toHaveBeenCalledWith({
      customerId: ELLIE.userId,
      entitlementId: SLEEP.id,
      organizationId: ORG_ID,
    });
    expect(refreshGrants).toHaveBeenCalledTimes(1);
    expect(row(SLEEP.contentTitle).querySelector('button')).toBeNull();
    await vi.waitFor(() => expect(confirmDialog()).toBeNull());
  });

  test('names the customer by email when they have no name', async () => {
    getCustomerDetail.mockResolvedValue({ ...ELLIE, name: null });
    setGrants(grantsPage([SLEEP]));
    const dialog = await openRevoke(SLEEP);

    expect(clean(dialog)).toContain(
      m.studio_customers_grants_revoke_description({ name: ELLIE.email })
    );
  });

  test('Cancel changes nothing', async () => {
    setGrants(grantsPage([SLEEP]));
    const dialog = await openRevoke(SLEEP);

    button(dialog, m.common_cancel())?.click();
    flushSync();

    await vi.waitFor(() => expect(confirmDialog()).toBeNull());
    expect(revokeCustomerGrant).not.toHaveBeenCalled();
    expect(row(SLEEP.contentTitle).dataset.state).toBe('live');
  });

  test('a refused revoke keeps the row live and says so on it', async () => {
    setGrants(grantsPage([SLEEP, MOBILITY]));
    revokeCustomerGrant.mockRejectedValue({
      status: 500,
      body: { message: 'An unexpected error occurred' },
    });
    const dialog = await openRevoke(SLEEP);

    button(dialog, m.studio_customers_grants_revoke_confirm())?.click();

    await vi.waitFor(() =>
      expect(clean(row(SLEEP.contentTitle))).toContain(
        m.studio_customers_grants_revoke_error()
      )
    );
    const sleep = row(SLEEP.contentTitle);
    expect(sleep.dataset.state).toBe('live');
    expect(button(sleep, m.studio_customers_grants_revoke())).toBeTruthy();
    expect(sleep.querySelector('[role="alert"]')).toBeTruthy();
    // Only the row that failed is marked.
    expect(clean(row(MOBILITY.contentTitle))).not.toContain(
      m.studio_customers_grants_revoke_error()
    );
    expect(refreshGrants).not.toHaveBeenCalled();
    expect(drawer()).toBeTruthy();
  });
});

// The confirmed revoke takes its grant's Revoke away, and that button opened
// the confirm. Focus goes to the next live grant's Revoke, else the previous
// one's, else Grant access, never back to the top of the drawer
// (Codex-p10nx). A cancel takes nothing away, so focus goes home.
describe('focus after a revoke', () => {
  const revokeButton = (grant: CustomerGrant) =>
    button(row(grant.contentTitle), m.studio_customers_grants_revoke());

  async function revoke(grant: CustomerGrant, after: CustomerGrant[]) {
    refreshGrants.mockImplementation(async () => setGrants(grantsPage(after)));
    mountDrawer();
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));
    revokeButton(grant)?.focus();
    revokeButton(grant)?.click();
    flushSync();
    const dialog = confirmDialog();
    if (!dialog) throw new Error('confirm did not open');
    await focusIn(dialog);
    button(dialog, m.studio_customers_grants_revoke_confirm())?.click();
    await vi.waitFor(() => expect(confirmDialog()).toBeNull());
  }
  /** Focus moves into an opening dialog a moment after it opens. */
  const focusIn = (dialog: HTMLElement) =>
    vi.waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true)
    );
  const gone = (grant: CustomerGrant) => ({
    ...grant,
    revokedAt: '2026-11-07T12:00:00.000Z',
    revokedByName: 'Sam Owner',
  });

  test("the next live grant's Revoke", async () => {
    setGrants(grantsPage([SLEEP, MOBILITY, CORE]));
    await revoke(SLEEP, [MOBILITY, gone(SLEEP), CORE]);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(revokeButton(MOBILITY))
    );
  });

  test("the previous one's, when the last live grant went", async () => {
    setGrants(grantsPage([SLEEP, MOBILITY, CORE]));
    await revoke(MOBILITY, [SLEEP, gone(MOBILITY), CORE]);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(revokeButton(SLEEP))
    );
  });

  test('Grant access, when no live grant is left', async () => {
    setGrants(grantsPage([SLEEP]));
    await revoke(SLEEP, [gone(SLEEP)]);

    const grantAccess = button(
      drawer() as HTMLElement,
      m.studio_customers_drawer_grant_access()
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(grantAccess));
  });

  test('a cancel, even after a revoke, gives focus back to the Revoke that opened the confirm', async () => {
    const YOGA = {
      ...MOBILITY,
      id: `${MOBILITY.id.slice(0, -1)}4`,
      contentTitle: 'Yoga Basics',
    };
    setGrants(grantsPage([SLEEP, MOBILITY, YOGA]));
    await revoke(SLEEP, [MOBILITY, YOGA, gone(SLEEP)]);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(revokeButton(MOBILITY))
    );

    revokeButton(YOGA)?.focus();
    revokeButton(YOGA)?.click();
    flushSync();
    const dialog = confirmDialog() as HTMLElement;
    await focusIn(dialog);
    button(dialog, m.common_cancel())?.click();
    flushSync();

    await vi.waitFor(() => expect(confirmDialog()).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(revokeButton(YOGA))
    );
  });

  // The refresh after a revoke re-ran the drawer's load: its details went
  // back to loading, at the top of its scroll, and the confirm was rebuilt
  // while the request ran.
  test('the refresh after a revoke loads nothing else', async () => {
    setGrants(grantsPage([SLEEP, MOBILITY]));
    await revoke(SLEEP, [MOBILITY, gone(SLEEP)]);

    expect(refreshGrants).toHaveBeenCalledTimes(1);
    expect(getCustomerDetail).toHaveBeenCalledTimes(1);
    expect(getCustomerGrants).toHaveBeenCalledTimes(1);
  });

  // A busy confirm can be dismissed (ConfirmDialog's session counter). The
  // revoke's answer marked the confirm open WHEN IT LANDED, another grant's,
  // so that one's Cancel sent focus to the revoked grant's place, not home
  // (review fu-focus-2).
  test("an Escape during a revoke, then another grant's confirm: its Cancel still goes home", async () => {
    const YOGA = {
      ...MOBILITY,
      id: `${MOBILITY.id.slice(0, -1)}4`,
      contentTitle: 'Yoga Basics',
    };
    const PILATES = {
      ...MOBILITY,
      id: `${MOBILITY.id.slice(0, -1)}5`,
      contentTitle: 'Pilates Flow',
    };
    setGrants(grantsPage([SLEEP, MOBILITY, YOGA, PILATES]));
    refreshGrants.mockImplementation(async () =>
      setGrants(grantsPage([SLEEP, MOBILITY, PILATES, gone(YOGA)]))
    );
    const answer = deferred<null>();
    revokeCustomerGrant.mockReturnValue(answer.promise);
    mountDrawer();
    await vi.waitFor(() => expect(rows()).toHaveLength(4));

    // Yoga's revoke starts, and its confirm is dismissed while it runs.
    revokeButton(YOGA)?.focus();
    revokeButton(YOGA)?.click();
    flushSync();
    const first = confirmDialog() as HTMLElement;
    await focusIn(first);
    button(first, m.studio_customers_grants_revoke_confirm())?.click();
    flushSync();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flushSync();
    await vi.waitFor(() => expect(confirmDialog()).toBeNull());
    // Home first, as the close takes it there a moment later.
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(revokeButton(YOGA))
    );

    // Mobility's confirm opens, and then Yoga's revoke answers.
    revokeButton(MOBILITY)?.focus();
    revokeButton(MOBILITY)?.click();
    flushSync();
    const second = confirmDialog() as HTMLElement;
    await focusIn(second);
    answer.resolve(null);
    await vi.waitFor(() =>
      expect(row(YOGA.contentTitle).dataset.state).toBe('revoked')
    );

    button(second, m.common_cancel())?.click();
    flushSync();
    await vi.waitFor(() => expect(confirmDialog()).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(revokeButton(MOBILITY))
    );
  });
});
