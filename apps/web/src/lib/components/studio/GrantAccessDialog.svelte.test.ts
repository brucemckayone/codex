/**
 * The grant pickers offer only items a grant can open, and a refused grant
 * says why (Codex-2hxff.21; owner decision "only items it can open").
 *
 * - Both dialogs (single and bulk) share GrantContentPicker: it hides
 *   followers-only, team-only, course-only and free items, even ones with a
 *   price or a tier, and shows paid and tier items.
 * - It reads the ORG's catalogue (`browseContent`), so another creator's item
 *   is offered, and it pages through it (up to 10 pages, then a quiet note),
 *   so a grantable item on page 2 is offered when page 1 has none.
 * - Nothing grantable: one plain line instead of an empty select, and only
 *   once EVERY page has loaded. A failed read has its own line and never
 *   claims that.
 * - The admin route's 422 message reaches the dialog in its own words: inline
 *   in the single dialog, as the failure toast's description in the bulk one.
 *   A 5xx keeps the generic line.
 *
 * Mounts the real dialogs, DialogForm and Select; only the remote modules
 * (they import `$app/server`) and the toast store are mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
vi.mock(
  '$lib/remote/content.remote',
  () => import('./__fixtures__/content-remote.mock.svelte')
);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({ toast }));

import {
  grantContentAccess,
  reset as resetAdmin,
} from './__fixtures__/admin-remote.mock.svelte';
import {
  browseContent,
  contentItem,
  reset as resetContent,
  setContent,
  setPage,
  setPageError,
} from './__fixtures__/content-remote.mock.svelte';
import BulkGrantAccessDialog from './BulkGrantAccessDialog.svelte';
import GrantAccessDialog from './GrantAccessDialog.svelte';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

const PAID = contentItem('c-paid', 'Kettlebell Foundations', {
  priceCents: 1500,
});
const TIER = contentItem('c-tier', 'Sleep Reset Programme', {
  isTierGated: true,
});
const FREE = contentItem('c-free', 'Breathing for Runners', {});
const FREE_ZERO = contentItem('c-zero', 'Desk Stretch Series', {
  priceCents: 0,
});
const FOLLOWERS = contentItem('c-followers', 'Core Conditioning', {
  isFollowerGated: true,
  priceCents: 900,
});
const TEAM = contentItem('c-team', 'Coaching Notes', {
  isTeamOnly: true,
  isTierGated: true,
});
const COURSE = contentItem('c-course', 'Week One: Mobility', {
  courseOnly: true,
  priceCents: 1200,
});

const ANOTHER_CREATORS = contentItem('c-other', 'Mobility for Lifters', {
  creatorId: 'another-creator',
  priceCents: 2400,
});

const EVERYTHING = [PAID, FREE, FOLLOWERS, TIER, TEAM, COURSE, FREE_ZERO];
const NOTHING_GRANTABLE = [FREE, FREE_ZERO, FOLLOWERS, TEAM, COURSE];

const REFUSAL =
  "This item can't be granted: a grant only opens paid or subscriber content.";
/** What a forwarded 4xx looks like on the client: kit's `HttpError`. */
const REFUSED = {
  status: 422,
  body: { message: REFUSAL, code: 'BUSINESS_LOGIC_ERROR' },
};

let component: ReturnType<typeof mount> | null = null;

function mountSingle() {
  component = mount(GrantAccessDialog, {
    target: document.body,
    props: { open: true, customerId: 'ellie', orgId: ORG_ID },
  });
  flushSync();
}

function mountBulk(customerIds = ['ellie', 'tom']) {
  component = mount(BulkGrantAccessDialog, {
    target: document.body,
    props: { open: true, customerIds, orgId: ORG_ID },
  });
  flushSync();
}

const clean = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const trigger = () =>
  document.querySelector<HTMLButtonElement>('button.select-trigger');

function optionLabels(): string[] {
  trigger()?.click();
  flushSync();
  return [...document.querySelectorAll('[role="option"]')].map((o) => clean(o));
}

function choose(label: string) {
  trigger()?.click();
  flushSync();
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((o) => clean(o) === label);
  if (!option) throw new Error(`no option ${label}`);
  option.click();
  flushSync();
}

function submit() {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button[type="submit"]'),
  ].find((b) => clean(b) === m.studio_customers_grant_confirm());
  if (!button) throw new Error('no Grant Access button');
  button.click();
  flushSync();
}

const pickerNote = () => document.querySelector('.picker-note');

beforeEach(() => {
  resetAdmin();
  resetContent();
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('picker', () => {
  test('reads the organisation’s catalogue, 100 items a page', () => {
    setContent(EVERYTHING);
    mountSingle();

    expect(browseContent).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      page: 1,
      limit: 100,
    });
    expect(browseContent).toHaveBeenCalledTimes(1);
  });

  test('offers another creator’s paid item', () => {
    setContent([FREE, ANOTHER_CREATORS]);
    mountSingle();

    expect(optionLabels()).toEqual([ANOTHER_CREATORS.title]);
  });

  test('offers a grantable item from page 2 when page 1 has none', () => {
    setPage(1, NOTHING_GRANTABLE, 2);
    setPage(2, [PAID], 2);
    mountSingle();

    expect(browseContent).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      page: 2,
      limit: 100,
    });
    expect(optionLabels()).toEqual([PAID.title]);
    expect(pickerNote()).toBeNull();
  });

  test('the nothing line waits for the last page', () => {
    setPage(1, NOTHING_GRANTABLE, 3);
    setPage(2, [FREE], 3);
    mountSingle();

    // Page 3 is still loading: no verdict yet.
    expect(clean(trigger())).toBe(m.common_loading());
    expect(pickerNote()).toBeNull();

    setPage(3, [COURSE], 3);
    flushSync();

    expect(clean(pickerNote())).toBe(m.studio_customers_grant_none());
    expect(trigger()).toBeNull();
  });

  test('reads at most 10 pages, then says it is showing the first 1,000', () => {
    for (let page = 1; page <= 10; page++) setPage(page, [PAID], 12);
    mountSingle();

    const pagesRead = browseContent.mock.calls.map(([input]) => input.page);
    expect(new Set(pagesRead)).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    );
    expect(clean(pickerNote())).toBe(
      m.studio_customers_grant_capped({ count: '1,000' })
    );
    expect(trigger()).toBeTruthy();
  });

  test('a catalogue under the cap has no note', () => {
    setPage(1, [PAID], 2);
    setPage(2, [TIER], 2);
    mountSingle();

    expect(optionLabels()).toEqual([PAID.title, TIER.title]);
    expect(pickerNote()).toBeNull();
  });

  test.each([
    ['single', mountSingle],
    ['bulk', () => mountBulk()],
  ])('%s: offers paid and tier items only', (_name, mountDialog) => {
    setContent(EVERYTHING);
    mountDialog();

    expect(optionLabels()).toEqual([PAID.title, TIER.title]);
    expect(pickerNote()).toBeNull();
  });

  test.each([
    ['single', mountSingle],
    ['bulk', () => mountBulk()],
  ])('%s: with nothing grantable, one plain line and no select', (_name, mountDialog) => {
    setContent(NOTHING_GRANTABLE);
    mountDialog();

    expect(clean(pickerNote())).toBe(m.studio_customers_grant_none());
    expect(pickerNote()?.getAttribute('role')).toBeNull();
    expect(trigger()).toBeNull();
  });

  test('while loading, the select says so and no line is shown', () => {
    mountSingle();

    expect(clean(trigger())).toBe(m.common_loading());
    expect(pickerNote()).toBeNull();
  });

  test('a failed read has its own line, never "nothing can be granted"', () => {
    setPage(1, NOTHING_GRANTABLE, 2);
    setPageError(2, { status: 500, body: { message: 'boom' } });
    mountSingle();

    expect(clean(pickerNote())).toBe(m.studio_customers_grant_load_error());
    expect(pickerNote()?.getAttribute('role')).toBe('alert');
    expect(clean(document.body)).not.toContain(m.studio_customers_grant_none());
    expect(trigger()).toBeNull();
  });
});

describe('a refused grant', () => {
  test('single: the 422 message is shown inline, in the worker’s words', async () => {
    setContent(EVERYTHING);
    grantContentAccess.mockRejectedValue(REFUSED);
    mountSingle();

    choose(PAID.title);
    submit();

    await vi.waitFor(() =>
      expect(clean(document.querySelector('.dialog-form .alert'))).toContain(
        REFUSAL
      )
    );
    expect(grantContentAccess).toHaveBeenCalledWith({
      customerId: 'ellie',
      contentId: PAID.id,
      organizationId: ORG_ID,
    });
    expect(clean(document.body)).not.toContain(
      m.studio_customers_grant_error()
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  test('single: a 5xx keeps the generic line', async () => {
    setContent(EVERYTHING);
    grantContentAccess.mockRejectedValue({
      status: 500,
      body: { message: 'An unexpected error occurred' },
    });
    mountSingle();

    choose(TIER.title);
    submit();

    await vi.waitFor(() =>
      expect(clean(document.querySelector('.dialog-form .alert'))).toContain(
        m.studio_customers_grant_error()
      )
    );
  });

  test('bulk: the failure toast carries the 422 message', async () => {
    setContent(EVERYTHING);
    grantContentAccess.mockRejectedValue(REFUSED);
    mountBulk(['ellie', 'tom']);

    choose(PAID.title);
    submit();

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      m.studio_customers_bulk_grant_partial({ succeeded: '0', failed: '2' }),
      REFUSAL
    );
    expect(grantContentAccess).toHaveBeenCalledTimes(2);
  });

  test('bulk: a 5xx keeps the plain partial toast', async () => {
    setContent(EVERYTHING);
    grantContentAccess
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce({
        status: 500,
        body: { message: 'An unexpected error occurred' },
      });
    mountBulk(['ellie', 'tom']);

    choose(TIER.title);
    submit();

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      m.studio_customers_bulk_grant_partial({ succeeded: '1', failed: '1' }),
      undefined
    );
  });
});
