/**
 * The studio content list (Codex-a6ofh.3.1, mockup L1/L5), one component for
 * both studios. Every read renders three states, and a failed one never reads
 * as "No content yet" (the old org page's empty state did, mockup L4). Also:
 * the view from the URL reaching the read, a row's words, "Show more"
 * appending the next page, and the cards.
 */
import { CONTENT_ATTENTION_KINDS } from '@codex/constants';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from '$lib/components/ui/Toast/toast-store';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { nav } from '../../__fixtures__/app-state.svelte';
import { draftRow, LIVE, PAID, withMedia } from '../../__fixtures__/draft-row';
import { kitQuery } from '../../__fixtures__/kit-query.mock.svelte';
import { editHref, publishStepHref } from '../../editor/editor-url';

type Page = {
  items: ContentWithRelations[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const s = vi.hoisted(() => ({
  first: { current: undefined as unknown, error: undefined as unknown },
  whereCounts: { current: undefined as unknown, error: undefined as unknown },
  categories: { current: undefined as unknown, error: undefined as unknown },
  attention: { current: undefined as unknown, error: undefined as unknown },
  later: new Map<number, unknown>(),
  refreshFirst: vi.fn(async () => {}),
}));
/**
 * A query kit holds for the page, over `s[slot]`: one object, as kit keeps
 * one per args, so a re-derive that asks again is not a new read.
 */
const heldQuery = vi.hoisted(
  () =>
    (
      slot: 'first' | 'whereCounts' | 'categories' | 'attention',
      refresh: () => Promise<void> = async () => {}
    ) => ({
      get current() {
        return s[slot].current;
      },
      get error() {
        return s[slot].error;
      },
      refresh,
    })
);

vi.mock('$app/state', () => import('../../__fixtures__/app-state.svelte'));

const goto = vi.hoisted(() =>
  vi.fn(async (_href: string, _opts?: Record<string, unknown>) => {})
);
vi.mock('$app/navigation', () => ({ goto }));

/** Page 1 is the view's held query; a later page is the promise "Show more" awaits. */
const listContent = vi.hoisted(() => {
  const firstQuery = heldQuery('first', () => s.refreshFirst());
  return vi.fn((args?: { page?: number }) => {
    if ((args?.page ?? 1) === 1) return firstQuery;
    const next = s.later.get(args?.page ?? 1);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
});
/** The personal studio's Where counts (Codex-a6ofh.3.2). */
const getContentWhereCounts = vi.hoisted(() => {
  const query = heldQuery('whereCounts');
  return vi.fn(() => query);
});
/** "Needs you" (Codex-a6ofh.3.4). */
const getContentAttention = vi.hoisted(() => {
  const query = heldQuery('attention');
  return vi.fn((_args?: unknown) => query);
});
/** The bulk actions (Codex-a6ofh.3.5): one request, a result per piece. */
const runContentBulk = vi.hoisted(() => vi.fn());
const deleteContent = vi.hoisted(() => vi.fn(async (_id: string) => {}));
vi.mock('$lib/remote/content.remote', () => ({
  listContent,
  getContentWhereCounts,
  getContentAttention,
  runContentBulk,
  deleteContent,
}));
/** The org studio's categories (Codex-a6ofh.3.3). */
const getCategories = vi.hoisted(() => {
  const query = heldQuery('categories');
  return vi.fn((_organizationId: string) => query);
});
vi.mock('$lib/remote/categories.remote', () => ({ getCategories }));

vi.mock('$lib/remote/subscription.remote', () => ({
  getMyConnectStatus: vi.fn(() => ({ current: undefined, error: undefined })),
  listTiers: vi.fn(() => ({
    current: [{ id: 't2', name: 'Pro' }],
    error: undefined,
  })),
}));

const logReadFailure = vi.hoisted(() => vi.fn());
vi.mock('../../media-library/log-read-failure', () => ({ logReadFailure }));

const StudioContentList = (await import('../StudioContentList.svelte')).default;

const ORG = '5f0c7b2e-1d3a-4c8e-9b6f-2a7d1e4c9b30';

function piece(
  n: number,
  fields: Partial<ContentWithRelations> = {}
): ContentWithRelations {
  return draftRow({
    id: `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Piece ${n}`,
    slug: `piece-${n}`,
    ...fields,
  });
}

function pageOf(
  items: ContentWithRelations[],
  total = items.length,
  page = 1
): Page {
  return {
    items,
    pagination: { page, limit: 24, total, totalPages: Math.ceil(total / 24) },
  };
}

let component: ReturnType<typeof mount> | null = null;

function render(
  query = '',
  organizationId: string | null = ORG,
  orgs: { id: string; name: string }[] = [],
  canReadCategories = true
) {
  nav.url = new URL(`https://studio.test/studio/content${query}`);
  component = mount(StudioContentList, {
    target: document.body,
    props: {
      organizationId,
      studioName: 'Studio Alpha',
      orgs,
      canReadCategories,
    },
  });
  flushSync();
}

const text = () => document.body.textContent ?? '';
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
function button(name: string | RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) =>
      typeof name === 'string'
        ? b.textContent?.trim() === name
        : name.test(b.textContent ?? '')
  );
}
/** The list's own reads: the New menu's drafts read asks for no page. */
const listCalls = () =>
  listContent.mock.calls
    .map(([args]) => args as Record<string, unknown> | undefined)
    .filter((args) => args?.page !== undefined);

beforeEach(() => {
  nav.to = null;
  s.first = { current: undefined, error: undefined };
  s.whereCounts = { current: undefined, error: undefined };
  getContentWhereCounts.mockClear();
  s.categories = { current: undefined, error: undefined };
  getCategories.mockClear();
  s.attention = { current: undefined, error: undefined };
  getContentAttention.mockClear();
  s.later.clear();
  listContent.mockClear();
  goto.mockClear();
  logReadFailure.mockClear();
  s.refreshFirst.mockClear();
  runContentBulk.mockReset();
  deleteContent.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('StudioContentList: the three states', () => {
  test('a skeleton while nothing has arrived, never an empty state', () => {
    render();
    expect(document.querySelector('.list-skeleton')).not.toBeNull();
    expect(text()).not.toContain(m.studio_content_empty_title());
    expect(document.querySelector('.content-table')).toBeNull();
  });

  test('a failed read says so, and never "No content yet"', () => {
    s.first = {
      current: undefined,
      error: { status: 503, body: { message: 'Down' } },
    };
    render();
    expect(
      document.querySelector('[data-testid="content-list-load-error"]')
    ).not.toBeNull();
    expect(text()).not.toContain(m.studio_content_empty_title());
    expect(document.querySelector('.list-skeleton')).toBeNull();
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.list_unread',
      expect.anything(),
      // Where it looked: one org, never "all" beside an org's id.
      expect.objectContaining({
        studio: 'org',
        organizationId: ORG,
        scope: 'org',
      })
    );
  });

  // The alert is for a read that never landed (LoadFailedAlert's rule): a
  // refetch kit kept `current` for is the rows as they were, never empty.
  test('a refetch that failed keeps the rows it had', () => {
    s.first = { current: pageOf([piece(1)]), error: { status: 503 } };
    render();
    expect(text()).toContain('Piece 1');
    expect(text()).not.toContain(m.studio_content_empty_title());
    // A lesser failure than a list never read, and logged as one.
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.list_refetch_failed',
      expect.anything(),
      expect.objectContaining({ studio: 'org' })
    );
    expect(logReadFailure).not.toHaveBeenCalledWith(
      'studio_content.list_unread',
      expect.anything(),
      expect.anything()
    );
  });

  test('a filter the API refuses says so, and offers to clear it', () => {
    s.first = {
      current: undefined,
      error: { status: 400, body: { message: 'Bad request' } },
    };
    render('?type=audio');
    expect(text()).toContain(m.media_library_error_refused());
    expect(text()).not.toContain(m.studio_content_load_failed());
    expect(button(m.media_clear_filters())).toBeDefined();
  });

  test('no content at all invites the first piece', () => {
    s.first = { current: pageOf([]), error: undefined };
    render();
    expect(text()).toContain(m.studio_content_empty_title());
    expect(
      document.querySelector('a[href="/studio/content/new"]')
    ).not.toBeNull();
  });

  test('a filter with no matches offers to clear it, not to start over', async () => {
    s.first = { current: pageOf([]), error: undefined };
    render('?type=audio&access=paid');
    expect(text()).toContain(m.studio_content_list_no_match());
    expect(text()).not.toContain(m.studio_content_empty_title());

    button(m.media_clear_filters())?.click();
    await settle();
    expect(goto).toHaveBeenCalledWith('/studio/content', expect.anything());
  });
});

describe('StudioContentList: the view, from the URL', () => {
  test('asks for 24 of the org’s content, last updated first, by default', () => {
    render();
    expect(listCalls()[0]).toEqual({
      page: 1,
      limit: 24,
      organizationId: ORG,
      include: 'categories',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  });

  test('forwards the Type, Access, status and sort the URL holds', () => {
    render('?type=audio&access=subscribers&status=published&sort=views');
    expect(listCalls()[0]).toMatchObject({
      contentType: 'audio',
      accessType: 'subscribers',
      lifecycle: 'published',
      sortBy: 'viewCount',
      sortOrder: 'desc',
    });
  });

  // The leak (Codex-a6ofh.3.2): asked with no org, the API lists every org.
  test('the personal studio asks for its own pieces, and has no Categories link', () => {
    render('', null);
    expect(listCalls()[0]).toMatchObject({ scope: 'personal' });
    expect(listCalls()[0]).not.toHaveProperty('organizationId');
    expect(document.querySelector('a[href="/studio/categories"]')).toBeNull();
  });

  test('the org studio links its categories', () => {
    render();
    expect(
      document.querySelector('a[href="/studio/categories"]')
    ).not.toBeNull();
  });

  test('checks the status the URL shows, and only it', () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render('?status=draft');
    const checked = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="radio"][aria-checked="true"]'
      ),
    ].map((radio) => radio.textContent?.trim());
    expect(checked).toContain(m.studio_content_filter_draft());
    expect(checked).not.toContain(m.studio_content_filter_all());
  });

  test('an old Archived link opens Off sale, and asks the API for it (Codex-a6ofh.3.6)', () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render('?status=archived');
    expect(listCalls()[0]).toMatchObject({ lifecycle: 'off-sale' });
    expect(listCalls()[0]).not.toHaveProperty('status');
    const checked = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="radio"][aria-checked="true"]'
      ),
    ].map((radio) => radio.textContent?.trim());
    expect(checked).toContain(m.studio_content_filter_off_sale());
  });

  test('a facet written while typing keeps what was typed in the box', () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render();
    const box = document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    );
    expect(box).not.toBeNull();
    box!.value = 'intro';
    box!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    // The status lands in the URL before the search's debounce has written it.
    nav.url = new URL('https://studio.test/studio/content?status=draft');
    flushSync();
    expect(box!.value).toBe('intro');
  });

  test('a failed read is logged once, not again when the view toggles', () => {
    s.first = { current: undefined, error: new Error('down') };
    render();
    nav.url = new URL('https://studio.test/studio/content?view=grid');
    flushSync();
    const logged = logReadFailure.mock.calls.filter(
      ([event]) => event === 'studio_content.list_unread'
    );
    expect(logged).toHaveLength(1);
  });

  test('a status chosen is one navigation, back to the first page', async () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render('?page=3');
    button(m.studio_content_filter_draft())?.click();
    await settle();
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith(
      '/studio/content?status=draft',
      expect.anything()
    );
  });
});

describe('StudioContentList: the rows', () => {
  test('a real page title, with the count', () => {
    s.first = { current: pageOf([piece(1), piece(2)], 11), error: undefined };
    render();
    const h1 = document.querySelector('h1');
    expect(h1?.textContent).toContain(m.studio_content_title());
    expect(h1?.textContent).toContain(
      m.studio_content_list_count({ count: 11 })
    );
  });

  test('a draft opens at the step it is on; a live piece in the live editor', () => {
    const live = piece(2, { ...LIVE });
    s.first = {
      current: pageOf([
        piece(1, { contentType: 'written', contentBody: 'Body' }),
        live,
      ]),
      error: undefined,
    };
    render();
    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '.content-table a.row-title'
      ),
    ];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      publishStepHref('c0000000-0000-4000-8000-000000000001'),
      editHref(live.id),
    ]);
  });

  test('says what a piece costs and sells, in plain words', () => {
    s.first = {
      current: pageOf([
        piece(1, {
          ...LIVE,
          ...PAID,
          priceCents: 499,
          viewCount: 812,
          // Its buyers (owner R2): purchase_count is never written.
          buyerCount: 57,
        } as never),
        piece(2, {
          ...LIVE,
          isFree: false,
          isTierGated: true,
          includedInTierIds: ['t2'],
          viewCount: 1204,
        } as never),
      ]),
      error: undefined,
    };
    render();
    const rows = [...document.querySelectorAll('.content-table tbody tr')].map(
      (row) => row.textContent?.replace(/\s+/g, ' ') ?? ''
    );
    expect(rows[0]).toContain('£4.99');
    expect(rows[0]).toContain('812');
    expect(rows[0]).toContain('57');
    expect(rows[1]).toContain('Subscribers');
    expect(rows[1]).toContain('Pro');
    expect(rows[1]).toContain('1,204');
  });

  test('warns under a live piece whose media was deleted', () => {
    s.first = {
      current: pageOf([
        piece(1, { ...LIVE, ...withMedia('ready', new Date()) }),
      ]),
      error: undefined,
    };
    render();
    expect(text()).toContain(
      m.studio_publish_gap_media_deleted({ type: 'video' })
    );
  });

  test('shows the cards for ?view=grid', () => {
    s.first = { current: pageOf([piece(1), piece(2)]), error: undefined };
    render('?view=grid');
    expect(document.querySelectorAll('.content-grid .card')).toHaveLength(2);
    expect(document.querySelector('.content-table')).toBeNull();
  });
});

describe('StudioContentList: Show more', () => {
  test('appends the next page of the same view', async () => {
    s.first = { current: pageOf([piece(1), piece(2)], 3), error: undefined };
    s.later.set(2, pageOf([piece(3)], 3, 2));
    render('?type=video');

    const more = button(m.media_library_show_more({ left: 1, total: 3 }));
    expect(more).toBeDefined();
    more?.click();
    await settle();

    expect(text()).toContain('Piece 3');
    expect(listCalls().at(-1)).toMatchObject({ page: 2, contentType: 'video' });
    expect(button(/Show more/)).toBeUndefined();
  });

  test('a page that failed says so and keeps the rows', async () => {
    s.first = { current: pageOf([piece(1)], 2), error: undefined };
    s.later.set(2, new Error('Down'));
    render();

    button(/Show more/)?.click();
    await settle();

    expect(text()).toContain(m.media_library_show_more_failed());
    expect(text()).toContain('Piece 1');
    // Which page of which view failed, never what was searched for.
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.show_more_failed',
      expect.any(Error),
      expect.objectContaining({
        page: 2,
        statusFilter: 'all',
        sortBy: 'updatedAt',
        hasSearch: false,
      })
    );
  });

  test('a page that fails after the view moved logs the view it was read for', async () => {
    s.first = { current: pageOf([piece(1)], 2), error: undefined };
    let fail: (error: Error) => void = () => {};
    s.later.set(
      2,
      new Promise<never>((_, reject) => {
        fail = reject;
      })
    );
    render('?type=video');

    button(/Show more/)?.click();
    flushSync();
    // The creator moves to Drafts while page 2 of the videos is in flight.
    nav.url = new URL('https://studio.test/studio/content?status=draft');
    flushSync();
    fail(new Error('Down'));
    await settle();

    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.show_more_failed',
      expect.any(Error),
      expect.objectContaining({ page: 2, statusFilter: 'all', type: 'video' })
    );
  });
});

/**
 * The personal studio's Where (Codex-a6ofh.3.2, mockup L4b): Everywhere,
 * Personal (the default), then each org it has pieces in, with counts.
 */
describe('StudioContentList: Where', () => {
  const BETA = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const COUNTS = {
    all: 14,
    personal: 3,
    orgs: [
      { id: ORG, name: 'Studio Alpha', count: 9 },
      { id: BETA, name: 'Studio Beta', count: 2 },
    ],
  };

  const whereTrigger = () =>
    [...document.querySelectorAll<HTMLElement>('.toolbar-menu')].find(
      (menu) =>
        menu.querySelector('.toolbar-menu-key')?.textContent?.trim() ===
        m.studio_content_where_label()
    );
  const items = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map(
      (item) => item.textContent?.replace(/\s+/g, ' ').trim()
    );
  async function openWhere() {
    whereTrigger()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    await settle();
  }

  test('offers Everywhere, Personal and each org, with their counts', async () => {
    s.whereCounts = { current: COUNTS, error: undefined };
    render('', null);
    await openWhere();
    expect(items()).toEqual([
      `${m.studio_content_where_all()} 14`,
      `${m.studio_content_where_personal()} 3`,
      'Studio Alpha 9',
      'Studio Beta 2',
    ]);
  });

  test('an org chosen is one navigation, by its id', async () => {
    s.whereCounts = { current: COUNTS, error: undefined };
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render('', null);
    await openWhere();
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .find((item) => item.textContent?.includes('Studio Beta'))
      ?.click();
    await settle();
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith(
      `/studio/content?where=${BETA}`,
      expect.anything()
    );
  });

  test('counts that failed leave the options without numbers, and are logged', async () => {
    s.whereCounts = { current: undefined, error: new Error('down') };
    render('', null);
    await openWhere();
    expect(items()).toEqual([
      m.studio_content_where_all(),
      m.studio_content_where_personal(),
    ]);
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.where_counts_unread',
      expect.any(Error),
      expect.objectContaining({ studio: 'personal' })
    );
  });

  test('an org the URL is on is named from the layout while the counts are unread', () => {
    render(`?where=${ORG}`, null, [{ id: ORG, name: 'Studio Alpha' }]);
    expect(whereTrigger()?.textContent).toContain('Studio Alpha');
    expect(whereTrigger()?.textContent).not.toContain(ORG);
    expect(listCalls()[0]).toMatchObject({ organizationId: ORG });
    expect(listCalls()[0]).not.toHaveProperty('scope');
  });

  test('an org with no matches offers Clear filters, which goes back to Personal', async () => {
    s.first = { current: pageOf([]), error: undefined };
    render(`?where=${ORG}`, null);
    expect(text()).toContain(m.studio_content_list_no_match());
    button(m.media_clear_filters())?.click();
    await settle();
    expect(goto).toHaveBeenCalledWith('/studio/content', expect.anything());
  });

  test('the org studio has no Where, and reads no counts', () => {
    render();
    expect(whereTrigger()).toBeUndefined();
    expect(getContentWhereCounts).not.toHaveBeenCalled();
  });
});

/**
 * The org studio's Category (Codex-a6ofh.3.3, mockup L1 pin 4): the org's
 * categories as a facet, and a Category column whose row reads the first
 * name and how many more. The personal studio has neither (owner).
 */
describe('StudioContentList: Category', () => {
  const TUTORIALS = '7c000000-0000-4000-8000-000000000001';
  const LIVE = '7c000000-0000-4000-8000-000000000002';
  const QA = '7c000000-0000-4000-8000-000000000003';
  const CATEGORIES = [
    { id: TUTORIALS, name: 'Tutorials' },
    { id: LIVE, name: 'Live' },
    { id: QA, name: 'Q&A' },
  ];

  const categoryTrigger = () =>
    [...document.querySelectorAll<HTMLElement>('.toolbar-menu')].find(
      (menu) =>
        menu.querySelector('.toolbar-menu-key')?.textContent?.trim() ===
        m.studio_content_category_label()
    );
  const items = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map(
      (item) => item.textContent?.replace(/\s+/g, ' ').trim()
    );
  async function openCategory() {
    categoryTrigger()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    await settle();
  }

  test('offers Any, then the org’s categories, read for its org', async () => {
    s.categories = { current: CATEGORIES, error: undefined };
    render();
    await openCategory();
    expect(getCategories).toHaveBeenCalledWith(ORG);
    expect(items()).toEqual([
      m.studio_content_category_any(),
      'Tutorials',
      'Live',
      'Q&A',
    ]);
  });

  test('a category chosen is one navigation, by its id', async () => {
    s.categories = { current: CATEGORIES, error: undefined };
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render();
    await openCategory();
    [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .find((item) => item.textContent?.includes('Live'))
      ?.click();
    await settle();
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto).toHaveBeenCalledWith(
      `/studio/content?category=${LIVE}`,
      expect.anything()
    );
  });

  test('the URL’s category filters the read, and a miss offers Clear filters', async () => {
    s.categories = { current: CATEGORIES, error: undefined };
    s.first = { current: pageOf([]), error: undefined };
    render(`?category=${QA}`);
    expect(listCalls()[0]).toMatchObject({ categoryId: QA });
    expect(categoryTrigger()?.textContent).toContain('Q&A');
    expect(text()).toContain(m.studio_content_list_no_match());
    button(m.media_clear_filters())?.click();
    await settle();
    expect(goto).toHaveBeenCalledWith('/studio/content', expect.anything());
  });

  /** The menu's words when its categories are unread, and its Try again. */
  const note = () =>
    document.querySelector('.toolbar-menu-note')?.textContent?.trim();
  const tryAgain = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === m.common_try_again()
    );

  /** The categories read as kit holds it: one query, failed or landed. */
  function categoriesRead() {
    const q = kitQuery<typeof CATEGORIES>();
    getCategories.mockImplementationOnce(() => q.get() as never);
    return q;
  }

  // Owner, 2026-11-12: a read that failed is never shown as an org with
  // no categories.
  test('an outage says so after what it can offer, named the URL’s one, and is logged', async () => {
    const q = categoriesRead();
    render(`?category=${LIVE}`);
    q.fail();
    await settle();
    expect(categoryTrigger()?.textContent).toContain(
      m.studio_content_category_this()
    );
    expect(categoryTrigger()?.textContent).not.toContain(LIVE);
    await openCategory();
    expect(items()).toEqual([
      m.studio_content_category_any(),
      m.studio_content_category_this(),
    ]);
    expect(note()).toBe(m.studio_content_categories_unread());
    expect(tryAgain()).toBeDefined();
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.list_categories_unread',
      expect.objectContaining({ status: 500 }),
      expect.objectContaining({ studio: 'org', organizationId: ORG })
    );
  });

  test('Try again reads the held query again, and its categories replace the note', async () => {
    const q = categoriesRead();
    render();
    const held = q.held();
    q.fail();
    await settle();
    await openCategory();
    tryAgain()?.click();
    await settle();
    expect(q.refreshes(held)).toBe(1);
    expect(note()).toBe(m.studio_list_facet_retrying());

    // The page holds its query untracked: kit refreshes it in place.
    q.land(CATEGORIES, held);
    await settle();
    expect(items()).toEqual([
      m.studio_content_category_any(),
      'Tutorials',
      'Live',
      'Q&A',
    ]);
    expect(note()).toBeUndefined();
    expect(tryAgain()).toBeUndefined();
  });

  test('a Try again that fails too says so', async () => {
    const q = categoriesRead();
    render();
    const held = q.held();
    q.fail();
    await settle();
    await openCategory();
    tryAgain()?.click();
    await settle();
    q.fail(undefined, held);
    await settle();
    expect(note()).toBe(m.studio_content_categories_unread_again());
    expect(tryAgain()).toBeDefined();
  });

  test('a refusal to a viewer the route admits says so too: the guards disagree', async () => {
    const q = categoriesRead();
    render();
    q.fail({ status: 403, body: { message: 'Forbidden' } });
    await settle();
    await openCategory();
    expect(items()).toEqual([m.studio_content_category_any()]);
    expect(note()).toBe(m.studio_content_categories_unread());
    expect(tryAgain()).toBeDefined();
  });

  test('a Try again answered by a refusal says it failed again, never nothing', async () => {
    const q = categoriesRead();
    render();
    const held = q.held();
    q.fail();
    await settle();
    await openCategory();
    tryAgain()?.click();
    await settle();
    q.fail({ status: 401, body: { message: 'Authentication required' } }, held);
    await settle();
    expect(categoryTrigger()).toBeDefined();
    expect(note()).toBe(m.studio_content_categories_unread_again());
  });

  test('a member without the role is asked for none and has no menu, unless the URL is on one', async () => {
    render('', ORG, [], false);
    expect(getCategories).not.toHaveBeenCalled();
    expect(categoryTrigger()).toBeUndefined();
    expect(listCalls()[0]).toMatchObject({ include: 'categories' });
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';

    render(`?category=${LIVE}`, ORG, [], false);
    expect(getCategories).not.toHaveBeenCalled();
    await openCategory();
    expect(items()).toEqual([
      m.studio_content_category_any(),
      m.studio_content_category_this(),
    ]);
    expect(tryAgain()).toBeUndefined();
  });

  test('a row reads its first category and how many more, and says them all', () => {
    s.first = {
      current: pageOf([
        piece(1, { categories: CATEGORIES }),
        piece(2, { categories: [] }),
      ]),
      error: undefined,
    };
    render();
    const header = [...document.querySelectorAll('th')].map((th) =>
      th.textContent?.trim()
    );
    expect(header).toContain(m.studio_content_category_label());
    const filed = document.querySelector(
      '[data-content-id] .content-categories'
    );
    expect(
      filed?.querySelector('[aria-hidden="true"]')?.textContent?.trim()
    ).toBe(m.studio_content_categories_more({ name: 'Tutorials', count: 2 }));
    expect(filed?.getAttribute('title')).toBe('Tutorials, Live, Q&A');
    expect(filed?.querySelector('.sr-only')?.textContent).toBe(
      'Tutorials, Live, Q&A'
    );
  });

  test('the personal studio has no Category, reads none, and ignores the URL’s', () => {
    s.first = {
      current: pageOf([piece(1, { categories: CATEGORIES })]),
      error: undefined,
    };
    render(`?category=${LIVE}`, null);
    expect(categoryTrigger()).toBeUndefined();
    expect(getCategories).not.toHaveBeenCalled();
    expect(listCalls()[0]).not.toHaveProperty('categoryId');
    expect(listCalls()[0]).not.toHaveProperty('include');
    expect(document.querySelector('[data-content-id]')).not.toBeNull();
    expect(document.querySelector('.content-categories')).toBeNull();
  });
});

describe('StudioContentList: Needs you (Codex-a6ofh.3.4)', () => {
  const COUNTS = {
    'live-media-gone': 1,
    scheduled: 0,
    'didnt-go-live': 2,
    'media-gone': 0,
    processing: 3,
    ready: 1,
  };
  const strip = () => document.querySelector('.needs-you');
  const chips = () =>
    [...document.querySelectorAll<HTMLButtonElement>('.needs-chip')].map(
      (chip) => ({
        kind: chip.dataset.kind,
        words: chip.textContent?.trim(),
        pressed: chip.getAttribute('aria-pressed'),
      })
    );
  const chip = (kind: string) =>
    document.querySelector<HTMLButtonElement>(
      `.needs-chip[data-kind="${kind}"]`
    );
  /** The params of the one navigation the page made. */
  function navigatedTo(): URLSearchParams {
    expect(goto).toHaveBeenCalledTimes(1);
    const [href] = goto.mock.calls[0] ?? [];
    return new URL(String(href), 'https://studio.test').searchParams;
  }

  test('reads the counts where the list looks: the org studio its org, the personal its Where', () => {
    render();
    expect(getContentAttention).toHaveBeenLastCalledWith({
      organizationId: ORG,
    });
    if (component) unmount(component);
    component = null;

    render('', null);
    expect(getContentAttention).toHaveBeenLastCalledWith({ scope: 'personal' });
    if (component) unmount(component);
    component = null;

    render('?where=all', null);
    expect(getContentAttention).toHaveBeenLastCalledWith({});
  });

  test('the counts ask for no facet, search or chip of the view: a to-do, not a view', () => {
    render('?type=video&search=lesson&needs=ready');
    expect(getContentAttention).toHaveBeenCalledTimes(1);
    expect(getContentAttention).toHaveBeenLastCalledWith({
      organizationId: ORG,
    });
  });

  test('a chip for each kind with pieces, in the row line’s order, in plain words', () => {
    s.attention = { current: COUNTS, error: undefined };
    render();
    expect(strip()?.getAttribute('role')).toBe('group');
    expect(strip()?.textContent).toContain(m.studio_content_needs_label());
    expect(chips()).toEqual([
      {
        kind: 'live-media-gone',
        words: m.studio_content_needs_live_media_gone_one(),
        pressed: 'false',
      },
      {
        kind: 'didnt-go-live',
        words: m.studio_content_needs_didnt_go_live({ count: 2 }),
        pressed: 'false',
      },
      {
        kind: 'processing',
        words: m.studio_content_needs_processing({ count: 3 }),
        pressed: 'false',
      },
      {
        kind: 'ready',
        words: m.studio_content_needs_ready_one(),
        pressed: 'false',
      },
    ]);
  });

  test('nothing needing you is no strip; unread yet is none either', () => {
    render();
    expect(strip()).toBeNull();
    if (component) unmount(component);
    component = null;

    s.attention = {
      current: Object.fromEntries(
        CONTENT_ATTENTION_KINDS.map((kind) => [kind, 0])
      ),
      error: undefined,
    };
    render();
    expect(strip()).toBeNull();
  });

  test('a chip lists its pieces and only those: status, facets and search go; Where, sort and view stay', async () => {
    s.attention = { current: COUNTS, error: undefined };
    render(
      '?where=all&status=draft&type=video&access=paid&search=lesson&sort=title&view=grid',
      null
    );
    chip('ready')?.click();
    await Promise.resolve();
    const params = navigatedTo();
    expect(params.get('needs')).toBe('ready');
    expect(params.get('where')).toBe('all');
    expect(params.get('sort')).toBe('title');
    expect(params.get('view')).toBe('grid');
    for (const gone of ['status', 'type', 'access', 'search', 'category']) {
      expect(params.has(gone), gone).toBe(false);
    }
  });

  test('the URL’s chip filters the read, is pressed, stays at none, and pressing it lists them all', async () => {
    s.attention = { current: { ...COUNTS, ready: 0 }, error: undefined };
    render('?needs=ready&sort=title');
    expect(listCalls()[0]).toMatchObject({ needs: 'ready' });
    expect(chip('ready')?.getAttribute('aria-pressed')).toBe('true');
    expect(chip('ready')?.textContent?.trim()).toBe(
      m.studio_content_needs_ready({ count: 0 })
    );
    chip('ready')?.click();
    await Promise.resolve();
    const params = navigatedTo();
    expect(params.has('needs')).toBe(false);
    expect(params.get('sort')).toBe('title');
  });

  test('Clear filters lets a chip go too', async () => {
    s.first = { current: pageOf([]), error: undefined };
    render('?needs=processing');
    button(m.media_clear_filters())?.click();
    await Promise.resolve();
    expect(navigatedTo().has('needs')).toBe(false);
  });

  // Owner, 2026-11-12: a read that failed is never shown as nothing needing you.
  test('a failed read says so, with a Try again, and is logged', async () => {
    const q = kitQuery<typeof COUNTS>();
    getContentAttention.mockImplementationOnce(() => q.get() as never);
    render('?where=all', null);
    const held = q.held();
    q.fail();
    await settle();
    expect(strip()?.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      m.studio_content_needs_unread()
    );
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.attention_unread',
      expect.objectContaining({ status: 500 }),
      expect.objectContaining({
        studio: 'personal',
        organizationId: null,
        scope: 'all',
        listedOrganizationId: null,
      })
    );

    strip()?.querySelector<HTMLButtonElement>('.unread-note-retry')?.click();
    await settle();
    expect(q.refreshes(held)).toBe(1);
    q.fail(undefined, held);
    await settle();
    expect(strip()?.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      m.studio_content_needs_unread_again()
    );

    strip()?.querySelector<HTMLButtonElement>('.unread-note-retry')?.click();
    await settle();
    q.land(COUNTS, held);
    await settle();
    expect(strip()?.querySelector('[role="status"]')).toBeNull();
    expect(chips().map((c) => c.kind)).toEqual([
      'live-media-gone',
      'didnt-go-live',
      'processing',
      'ready',
    ]);
  });

  // Codex-a6ofh.3.4 review: a list the chip narrows can always be let go.
  test('the chip in use stays, by name, while the counts are read and when they could not be', async () => {
    const q = kitQuery<typeof COUNTS>();
    getContentAttention.mockImplementationOnce(() => q.get() as never);
    render('?needs=ready');
    expect(chips()).toEqual([
      {
        kind: 'ready',
        words: m.studio_content_needs_ready_named(),
        pressed: 'true',
      },
    ]);

    q.fail();
    await settle();
    expect(chips().map((c) => c.kind)).toEqual(['ready']);
    expect(strip()?.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      m.studio_content_needs_unread()
    );
    chip('ready')?.click();
    await Promise.resolve();
    expect(navigatedTo().has('needs')).toBe(false);
  });

  test('each Where’s read says its own: a Try again that failed is not the next Where’s', async () => {
    const everywhere = kitQuery<typeof COUNTS>();
    const personal = kitQuery<typeof COUNTS>();
    getContentAttention
      .mockImplementationOnce(() => everywhere.get() as never)
      .mockImplementationOnce(() => personal.get() as never);
    const note = () =>
      strip()?.querySelector('[role="status"]')?.textContent?.trim();
    render('?where=all', null);
    const held = everywhere.held();
    everywhere.fail();
    await settle();
    strip()?.querySelector<HTMLButtonElement>('.unread-note-retry')?.click();
    await settle();
    everywhere.fail(undefined, held);
    await settle();
    expect(note()).toBe(m.studio_content_needs_unread_again());

    nav.url = new URL('https://studio.test/studio/content');
    flushSync();
    expect(getContentAttention).toHaveBeenLastCalledWith({ scope: 'personal' });
    personal.fail();
    await settle();
    expect(note()).toBe(m.studio_content_needs_unread());
  });
});

describe('StudioContentList: bulk actions (Codex-a6ofh.3.5)', () => {
  const box = (title: string) =>
    document.querySelector<HTMLInputElement>(
      `input[aria-label="${m.studio_content_bulk_select_row({ title })}"]`
    );
  const pageBox = () =>
    document.querySelector<HTMLInputElement>('th input[type="checkbox"]');

  test('selecting rows shows the bar, with Publish for drafts and Unpublish for live ones', () => {
    s.first = {
      current: pageOf([piece(1), piece(2, { ...LIVE })]),
      error: undefined,
    };
    render();
    expect(document.querySelector('.bulk-bar')).toBeNull();

    box('Piece 1')?.click();
    flushSync();
    expect(text()).toContain(m.studio_content_bulk_selected({ count: 1 }));
    expect(button(m.studio_content_bulk_publish())).toBeDefined();
    expect(button(m.studio_content_bulk_unpublish())).toBeUndefined();

    box('Piece 2')?.click();
    flushSync();
    expect(text()).toContain(m.studio_content_bulk_selected({ count: 2 }));
    expect(button(m.studio_content_bulk_unpublish())).toBeDefined();
  });

  test('holds at most 15: the page box stops there, and the other boxes wait', () => {
    s.first = {
      current: pageOf(
        Array.from({ length: 20 }, (_, i) => piece(i + 1)),
        20
      ),
      error: undefined,
    };
    render();

    pageBox()?.click();
    flushSync();
    expect(text()).toContain(m.studio_content_bulk_selected({ count: 15 }));
    expect(text()).toContain(m.studio_content_bulk_cap({ max: 15 }));
    expect(box('Piece 16')?.disabled).toBe(true);
    expect(box('Piece 1')?.disabled).toBe(false);
  });

  test('Publish sends the selected drafts in one request, says what happened, and reads the list again', async () => {
    const drafts = [piece(1), piece(2, { contentType: 'video' })];
    s.first = { current: pageOf(drafts), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [
        { id: drafts[0]?.id, outcome: 'done' },
        { id: drafts[1]?.id, outcome: 'scheduled' },
      ],
    });
    render();
    box('Piece 1')?.click();
    box('Piece 2')?.click();
    flushSync();

    button(m.studio_content_bulk_publish())?.click();
    await settle();

    expect(runContentBulk).toHaveBeenCalledTimes(1);
    expect(runContentBulk).toHaveBeenCalledWith({
      action: 'publish',
      ids: drafts.map((row) => row.id),
    });
    expect(text()).toContain(
      m.studio_content_bulk_published_some({ done: 1, total: 2 })
    );
    expect(text()).toContain(
      m.studio_content_bulk_scheduled_one({
        title: 'Piece 2',
        type: m.studio_editor_type_video(),
      })
    );
    // Read again in place, the held query refreshed.
    expect(s.refreshFirst).toHaveBeenCalled();
    // Nothing was refused, so nothing stays selected.
    expect(document.querySelector('.bulk-bar')).toBeNull();
  });

  test('a refused piece stays selected, and Show says why in its own words', async () => {
    const rows = [piece(1), piece(2)];
    s.first = { current: pageOf(rows), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [
        { id: rows[0]?.id, outcome: 'done' },
        {
          id: rows[1]?.id,
          outcome: 'refused',
          error: {
            code: 'CONFLICT',
            message: '2 people have it, bought or given, so it was left alone.',
            details: { code: 'CONTENT_HAS_BUYERS', buyers: 2 },
          },
        },
      ],
    });
    render();
    pageBox()?.click();
    flushSync();
    button(m.studio_content_bulk_delete())?.click();
    flushSync();
    button(m.studio_content_delete_count({ count: 2 }))?.click();
    await settle();

    expect(runContentBulk).toHaveBeenCalledWith({
      action: 'delete',
      ids: rows.map((row) => row.id),
    });
    expect(text()).toContain(m.studio_content_bulk_selected({ count: 1 }));
    expect(box('Piece 2')?.checked).toBe(true);
    button(m.studio_content_bulk_show())?.click();
    flushSync();
    expect(text()).toContain(
      '2 people have it, bought or given, so it was left alone.'
    );
  });

  test('a request that failed as a whole says so, and reads the list again', async () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    runContentBulk.mockRejectedValue({
      status: 503,
      body: { message: 'Down' },
    });
    render();
    box('Piece 1')?.click();
    flushSync();

    button(m.studio_content_bulk_publish())?.click();
    await settle();

    expect(text()).toContain(m.studio_content_bulk_request_failed());
    expect(s.refreshFirst).toHaveBeenCalled();
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.bulk_failed',
      expect.anything(),
      expect.objectContaining({ action: 'publish', count: 1 })
    );
  });

  test('a re-read after a change that fails says so, with Try again', async () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [{ id: piece(1).id, outcome: 'done' }],
    });
    s.refreshFirst.mockRejectedValueOnce(new Error('down'));
    render();
    box('Piece 1')?.click();
    flushSync();

    button(m.studio_content_bulk_publish())?.click();
    await settle();

    expect(text()).toContain(m.studio_content_refresh_failed());
    expect(button(m.common_try_again())).toBeDefined();

    // A Try again that fails says so again; one that reads the list ends it.
    s.refreshFirst.mockRejectedValueOnce(new Error('still down'));
    button(m.common_try_again())?.click();
    await settle();
    expect(text()).toContain(m.studio_content_refresh_failed_again());

    button(m.common_try_again())?.click();
    await settle();
    expect(text()).not.toContain(m.studio_content_refresh_failed_again());
    expect(text()).not.toContain(m.studio_content_refresh_failed());
  });

  // The row menu (Melt): opened from the keyboard, as its own suite does.
  async function rowMenuItem(title: string, item: string) {
    document
      .querySelector<HTMLElement>(
        `[aria-label="${m.studio_content_row_actions({ title })}"]`
      )
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    await settle();
    return [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent?.trim() === item);
  }

  test('a row menu acts on its row alone, and leaves the selection as it was', async () => {
    const rows = [piece(1), piece(2)];
    s.first = { current: pageOf(rows), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [{ id: rows[1]?.id, outcome: 'done' }],
    });
    render();
    pageBox()?.click();
    flushSync();

    (await rowMenuItem('Piece 2', m.studio_content_row_publish()))?.click();
    await settle();

    expect(runContentBulk).toHaveBeenCalledWith({
      action: 'publish',
      ids: [rows[1]?.id],
    });
    expect(text()).toContain(m.studio_content_bulk_selected({ count: 2 }));
  });

  test("Copy link copies the piece's whole address, on the org's own host too", async () => {
    // The list reads only the org's slug for the address.
    const organization = {
      id: ORG,
      name: 'Studio Alpha',
      slug: 'studio-alpha',
    } as unknown as ContentWithRelations['organization'];
    const row = piece(1, { ...LIVE, organization });
    s.first = { current: pageOf([row]), error: undefined };
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render();
    // On the org's own subdomain, where the builder gives a bare path.
    nav.url = new URL('https://studio-alpha.lvh.me/studio/content');
    await settle();

    (await rowMenuItem('Piece 1', m.studio_content_row_copy_link()))?.click();
    await settle();

    expect(writeText).toHaveBeenCalledWith(
      'https://studio-alpha.lvh.me/content/piece-1'
    );
  });

  test("a row delete that timed out names the piece, never the client's own words", async () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    deleteContent.mockRejectedValueOnce({
      status: 408,
      body: { message: 'Request to content/api/content/x timed out' },
    });
    const said = vi.spyOn(toast, 'error');
    render();

    (await rowMenuItem('Piece 1', m.studio_content_row_delete()))?.click();
    await settle();
    button(m.studio_content_delete_confirm())?.click();
    await settle();

    expect(said).toHaveBeenCalledWith(
      m.studio_content_delete_failed({ title: 'Piece 1' })
    );
    said.mockRestore();
  });

  test('a row deleted elsewhere already reads as deleted, and leaves the selection', async () => {
    const rows = [piece(1), piece(2)];
    s.first = { current: pageOf(rows), error: undefined };
    deleteContent.mockRejectedValueOnce({
      status: 404,
      body: { message: 'Content not found', code: 'CONTENT_NOT_FOUND' },
    });
    render();
    pageBox()?.click();
    flushSync();

    (await rowMenuItem('Piece 1', m.studio_content_row_delete()))?.click();
    await settle();
    button(m.studio_content_delete_confirm())?.click();
    await settle();

    expect(deleteContent).toHaveBeenCalledWith(rows[0]?.id);
    expect(text()).toContain(
      m.studio_content_deleted_one({ title: 'Piece 1' })
    );
    expect(text()).toContain(m.studio_content_bulk_selected({ count: 1 }));
  });

  test('the Delete dialog gives a kept piece its address when a deleted one shares its title', () => {
    const rows = [
      piece(1, { title: 'Introduction', slug: 'intro-old' }),
      piece(2, { title: 'Introduction', slug: 'intro', holderCount: 3 }),
    ];
    s.first = { current: pageOf(rows), error: undefined };
    render();
    pageBox()?.click();
    flushSync();
    button(m.studio_content_bulk_delete())?.click();
    flushSync();

    expect(text()).toContain(
      m.studio_content_delete_kept_one_title({
        name: '“Introduction” (/intro)',
      })
    );
    expect(button(m.studio_content_delete_count({ count: 1 }))).toBeDefined();
  });

  test('the Delete dialog stays busy until the list is read again, so it cannot send twice', async () => {
    const rows = [piece(1), piece(2)];
    s.first = { current: pageOf(rows), error: undefined };
    runContentBulk.mockResolvedValue({
      results: rows.map((row) => ({ id: row.id, outcome: 'done' })),
    });
    let reread = () => {};
    s.refreshFirst.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          reread = resolve;
        })
    );
    render();
    pageBox()?.click();
    flushSync();
    button(m.studio_content_bulk_delete())?.click();
    flushSync();

    button(m.studio_content_delete_count({ count: 2 }))?.click();
    await settle();
    // Sent, the re-read still out: the dialog's Delete waits.
    expect(button(m.studio_content_delete_count({ count: 2 }))?.disabled).toBe(
      true
    );
    button(m.studio_content_delete_count({ count: 2 }))?.click();
    await settle();
    expect(runContentBulk).toHaveBeenCalledTimes(1);

    reread();
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test('a changed view clears the selection', async () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render();
    box('Piece 1')?.click();
    flushSync();
    expect(document.querySelector('.bulk-bar')).not.toBeNull();

    nav.url = new URL('https://studio.test/studio/content?status=draft');
    await settle();

    expect(document.querySelector('.bulk-bar')).toBeNull();
  });
});
