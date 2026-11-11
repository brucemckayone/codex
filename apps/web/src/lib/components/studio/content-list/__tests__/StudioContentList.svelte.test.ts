/**
 * The studio content list (Codex-a6ofh.3.1, mockup L1/L5), one component for
 * both studios. Every read renders three states, and a failed one never reads
 * as "No content yet" (the old org page's empty state did, mockup L4). Also:
 * the view from the URL reaching the read, a row's words, "Show more"
 * appending the next page, and the cards.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { nav } from '../../__fixtures__/app-state.svelte';
import { draftRow, LIVE, PAID, withMedia } from '../../__fixtures__/draft-row';
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
  later: new Map<number, unknown>(),
  refreshFirst: vi.fn(async () => {}),
}));

vi.mock('$app/state', () => import('../../__fixtures__/app-state.svelte'));

const goto = vi.hoisted(() =>
  vi.fn(async (_href: string, _opts?: Record<string, unknown>) => {})
);
vi.mock('$app/navigation', () => ({ goto }));

/**
 * Page 1 is the view's query, one object as kit keeps one per args (so a
 * re-derive that asks again is not a new read); a later page is the promise
 * "Show more" awaits.
 */
const listContent = vi.hoisted(() => {
  const firstQuery = {
    get current() {
      return s.first.current;
    },
    get error() {
      return s.first.error;
    },
    refresh: () => s.refreshFirst(),
  };
  return vi.fn((args?: { page?: number }) => {
    if ((args?.page ?? 1) === 1) return firstQuery;
    const next = s.later.get(args?.page ?? 1);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
});
/** The personal studio's Where counts (Codex-a6ofh.3.2): one query, as kit keeps one. */
const getContentWhereCounts = vi.hoisted(() => {
  const query = {
    get current() {
      return s.whereCounts.current;
    },
    get error() {
      return s.whereCounts.error;
    },
  };
  return vi.fn(() => query);
});
vi.mock('$lib/remote/content.remote', () => ({
  listContent,
  getContentWhereCounts,
}));

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
  orgs: { id: string; name: string }[] = []
) {
  nav.url = new URL(`https://studio.test/studio/content${query}`);
  component = mount(StudioContentList, {
    target: document.body,
    props: { organizationId, studioName: 'Studio Alpha', orgs },
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
  s.later.clear();
  listContent.mockClear();
  goto.mockClear();
  logReadFailure.mockClear();
  s.refreshFirst.mockClear();
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
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  });

  test('forwards the Type, Access, status and sort the URL holds', () => {
    render('?type=audio&access=subscribers&status=published&sort=views');
    expect(listCalls()[0]).toMatchObject({
      contentType: 'audio',
      accessType: 'subscribers',
      status: 'published',
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
          purchaseCount: 57,
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
