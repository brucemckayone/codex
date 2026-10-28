/**
 * MemberTable — the owner's row (Codex-2hxff.2).
 *
 * One owner per organisation; the worker refuses to change the owner's role or
 * remove them (409 `OWNERSHIP_TRANSFER_REQUIRED`) and refuses `owner` as a role
 * value (400). So the owner's row must offer neither control, and points at
 * Settings → Ownership instead; every other row keeps both. (`owner` is not
 * among the role choices — `roleOptions` — and the remote's schema refuses it,
 * see `org.remote.ts`.)
 */

import { afterEach, describe, expect, test } from 'vitest';
import type { OrgMemberItem } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import MemberTable from './MemberTable.svelte';

const MEMBERS: OrgMemberItem[] = [
  {
    userId: 'alex',
    email: 'alex@studio-alpha.test',
    name: 'Alex Morgan',
    avatarUrl: null,
    role: 'owner',
    status: 'active',
    joinedAt: '2026-03-02T00:00:00.000Z',
    hasCreatorAccount: true,
  },
  {
    userId: 'sam',
    email: 'sam@studio-alpha.test',
    name: 'Sam Patel',
    avatarUrl: null,
    role: 'creator',
    status: 'active',
    joinedAt: '2026-06-01T00:00:00.000Z',
    hasCreatorAccount: true,
  },
];

let component: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

function rowFor(name: string): HTMLTableRowElement {
  const row = [
    ...document.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ].find((r) => r.textContent?.includes(name));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

function mountTable(ownerAction?: { href: string; label: string }) {
  component = mount(MemberTable, {
    target: document.body,
    props: { members: MEMBERS, ownerAction },
  });
  flushSync();
}

describe('MemberTable owner row', () => {
  test('offers no role change and no remove — links to Settings → Ownership', () => {
    mountTable({
      href: '/studio/settings#ownership',
      label: m.team_owner_transfer(),
    });
    const owner = rowFor('Alex Morgan');

    expect(owner.querySelector('.remove-btn')).toBeNull();
    expect(owner.querySelector('.select-trigger')).toBeNull();
    const link = owner.querySelector<HTMLAnchorElement>('a.owner-link');
    expect(link?.getAttribute('href')).toBe('/studio/settings#ownership');
    expect(link?.textContent?.trim()).toBe(m.team_owner_transfer());
  });

  test('without ownerAction the owner cell stays empty', () => {
    mountTable();
    expect(rowFor('Alex Morgan').querySelector('a.owner-link')).toBeNull();
  });

  test('every other row keeps its role control and Remove', () => {
    mountTable({ href: '/studio/settings#ownership', label: 'x' });
    const sam = rowFor('Sam Patel');
    expect(sam.querySelector('.select-trigger')).toBeTruthy();
    expect(sam.querySelector('.remove-btn')).toBeTruthy();
    expect(sam.querySelector('a.owner-link')).toBeNull();
  });
});
