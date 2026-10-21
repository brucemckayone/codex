/**
 * The team page's Remove dialog (Codex-2hxff.64, mockup Variant 2), driven
 * through MemberTable the way the page uses it: Remove fetches the departure
 * preview in the same click that opens the dialog.
 *
 * States: loading (skeleton, Remove disabled), populated (grouped "Stops now" /
 * "Ends later" / "Kept"), nothing to unwind (one sentence), error (inline
 * warning with Try again; Remove still allowed). Remove then stays open and
 * busy until the removal settles.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DeparturePreview, OrgMemberItem } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import MemberTable from './MemberTable.svelte';

const ORG_NAME = 'Studio Alpha';

const OWNER: OrgMemberItem = {
  userId: 'alex',
  email: 'alex@studio-alpha.test',
  name: 'Alex Morgan',
  avatarUrl: null,
  role: 'owner',
  status: 'active',
  joinedAt: '2026-01-04T00:00:00.000Z',
};
const JANE: OrgMemberItem = {
  userId: 'jane',
  email: 'jane@studio-alpha.test',
  name: 'Jane Doe',
  avatarUrl: null,
  role: 'creator',
  status: 'active',
  joinedAt: '2026-03-12T00:00:00.000Z',
};
const NAMELESS: OrgMemberItem = {
  userId: 'nameless',
  email: 'nameless@studio-alpha.test',
  name: null,
  avatarUrl: null,
  role: 'member',
  status: 'active',
  joinedAt: '2026-08-19T00:00:00.000Z',
};

const EVERYTHING: DeparturePreview = {
  agreements: 2,
  contentOnSale: 14,
  coursesOnSale: 2,
  courseSubscriptions: 9,
  tierSubscribersAffected: 37,
};
const NOTHING: DeparturePreview = {
  agreements: 0,
  contentOnSale: 0,
  coursesOnSale: 0,
  courseSubscriptions: 0,
  tierSubscribersAffected: 0,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function mountTable(props: {
  loadDeparturePreview?: (userId: string) => PromiseLike<DeparturePreview>;
  onRemove?: (userId: string) => undefined | Promise<unknown>;
}) {
  component = mount(MemberTable, {
    target: document.body,
    props: {
      members: [OWNER, JANE, NAMELESS],
      orgName: ORG_NAME,
      ...props,
    },
  });
  flushSync();
}

function openRemove(member: OrgMemberItem) {
  const row = [
    ...document.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].find((r) => r.textContent?.includes(member.email));
  const remove = row?.querySelector<HTMLButtonElement>('.remove-btn');
  if (!remove) throw new Error(`no Remove for ${member.email}`);
  remove.click();
  flushSync();
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.dialog-content');
  if (!el) throw new Error('dialog not open');
  return el;
}

function text(): string {
  return dialog().textContent?.replace(/\s+/g, ' ') ?? '';
}

function button(label: string): HTMLButtonElement | undefined {
  return [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
}

function groupLabels(): string[] {
  return [...dialog().querySelectorAll('.impact-group-label')].map(
    (h) => h.textContent?.trim() ?? ''
  );
}

describe('loading', () => {
  test('names who and where, shows skeleton rows, and holds Remove disabled', () => {
    const pending = deferred<DeparturePreview>();
    const load = vi.fn(() => pending.promise);
    mountTable({ loadDeparturePreview: load });
    openRemove(JANE);

    expect(load).toHaveBeenCalledWith('jane');
    expect(text()).toContain(
      m.team_remove_title_from_org({ name: 'Jane Doe', orgName: ORG_NAME })
    );
    expect(text()).toContain(m.team_remove_loses_access({ name: 'Jane' }));
    const caption = dialog().querySelector('.impact-caption');
    expect(caption?.textContent).toBe(m.team_remove_checking());
    expect(caption?.getAttribute('aria-live')).toBe('polite');
    const skeleton = dialog().querySelector('ul.impact-list');
    expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton?.querySelectorAll('li')).toHaveLength(3);

    expect(
      button(m.team_remove_confirm_named({ name: 'Jane' }))?.disabled
    ).toBe(true);
    expect(button(m.common_cancel())?.disabled).toBe(false);
  });
});

describe('populated', () => {
  test('groups the effects by when they land, in order', async () => {
    mountTable({ loadDeparturePreview: async () => EVERYTHING });
    openRemove(JANE);

    await vi.waitFor(() =>
      expect(groupLabels()).toEqual([
        m.team_remove_group_now(),
        m.team_remove_group_later(),
        m.team_remove_group_kept(),
      ])
    );
    const leads = [...dialog().querySelectorAll('.impact-lead')].map(
      (p) => p.textContent
    );
    expect(leads).toEqual([
      m.team_remove_agreements_other({ count: '2' }),
      m.team_remove_off_sale_both({
        items: m.team_remove_items_other({ count: '14' }),
        courses: m.team_remove_courses_other({ count: '2' }),
      }),
      m.team_remove_course_subscriptions_other({ count: '9' }),
      m.team_remove_tier_subscribers_other({ count: '37', name: 'Jane' }),
      m.team_remove_kept_lead(),
    ]);
    // The copy the owner approved, verbatim.
    expect(text()).toContain('14 items and 2 courses come off sale');
    expect(text()).toContain(
      "37 tier subscribers keep Jane's content until their next renewal"
    );
    const tones = [...dialog().querySelectorAll('.impact-row')].map((row) =>
      row.getAttribute('data-tone')
    );
    expect(tones).toEqual(['now', 'now', 'later', 'later', 'kept']);
    expect(
      button(m.team_remove_confirm_named({ name: 'Jane' }))?.disabled
    ).toBe(false);
  });

  test('hides a zero line, and a group left with none', async () => {
    mountTable({
      loadDeparturePreview: async () => ({ ...NOTHING, coursesOnSale: 1 }),
    });
    openRemove(JANE);

    await vi.waitFor(() =>
      expect(groupLabels()).toEqual([
        m.team_remove_group_now(),
        m.team_remove_group_kept(),
      ])
    );
    expect(text()).toContain('1 course comes off sale');
    expect(text()).toContain(m.team_remove_off_sale_detail_one());
  });
});

describe('nothing to unwind', () => {
  test('says so in one sentence, with no list', async () => {
    mountTable({ loadDeparturePreview: async () => NOTHING });
    openRemove(JANE);

    await vi.waitFor(() =>
      expect(text()).toContain(m.team_remove_nothing_else({ name: 'Jane' }))
    );
    expect(dialog().querySelector('.dialog-body')).toBeNull();
    expect(
      button(m.team_remove_confirm_named({ name: 'Jane' }))?.disabled
    ).toBe(false);
  });
});

describe('preview failed', () => {
  test('warns inline, still allows Remove, and Try again asks again', async () => {
    const load = vi
      .fn<(userId: string) => Promise<DeparturePreview>>()
      .mockRejectedValueOnce(new Error('preview down'))
      .mockResolvedValueOnce(EVERYTHING);
    mountTable({ loadDeparturePreview: load });
    openRemove(JANE);

    await vi.waitFor(() =>
      expect(text()).toContain(m.team_remove_preview_error_title())
    );
    const alert = dialog().querySelector('.alert');
    expect(alert?.getAttribute('data-variant')).toBe('warning');
    expect(alert?.getAttribute('role')).toBe('status');
    expect(text()).toContain(
      m.team_remove_preview_error_body({ name: 'Jane' })
    );
    expect(
      button(m.team_remove_confirm_named({ name: 'Jane' }))?.disabled
    ).toBe(false);

    button(m.team_remove_preview_retry())?.click();
    flushSync();
    expect(load).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(groupLabels()).toHaveLength(3));
  });
});

describe('removing', () => {
  test('stays open and busy until the removal settles, then closes', async () => {
    const removal = deferred<void>();
    const onRemove = vi.fn(() => removal.promise);
    mountTable({ loadDeparturePreview: async () => NOTHING, onRemove });
    openRemove(JANE);
    const confirmLabel = m.team_remove_confirm_named({ name: 'Jane' });
    await vi.waitFor(() => expect(button(confirmLabel)?.disabled).toBe(false));

    button(confirmLabel)?.click();
    flushSync();

    expect(onRemove).toHaveBeenCalledWith('jane');
    expect(button(confirmLabel)?.getAttribute('aria-busy')).toBe('true');
    expect(button(m.common_cancel())?.disabled).toBe(true);

    removal.resolve();
    await vi.waitFor(() =>
      expect(document.querySelector('.dialog-content')).toBeNull()
    );
  });

  test('a member with no name: their email in the title, "Remove member" on the button', async () => {
    mountTable({ loadDeparturePreview: async () => NOTHING });
    openRemove(NAMELESS);

    expect(text()).toContain(
      m.team_remove_title_from_org({
        name: 'nameless@studio-alpha.test',
        orgName: ORG_NAME,
      })
    );
    await vi.waitFor(() =>
      expect(text()).toContain(m.team_remove_nothing_else_unnamed())
    );
    expect(button(m.team_remove_confirm_member())).toBeDefined();
  });
});
