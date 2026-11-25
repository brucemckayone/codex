/**
 * The studio content list (Codex-a6ofh.3.1, mockup L1/L5), one component for
 * both studios. Every read renders three states, and a failed one never reads
 * as "No content yet" (the old org page's empty state did, mockup L4). Also:
 * the view from the URL reaching the read, a row's words, "Show more"
 * appending the next page, and the cards.
 */
import { CONTENT_ATTENTION_KINDS, LEAVING_NOTICE_DAYS } from '@codex/constants';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MOBILE_QUERY } from '$lib/components/ui/FilterDrawer/breakpoint';
import { toast } from '$lib/components/ui/Toast/toast-store';
import type { ContentWithRelations } from '$lib/types';
import { formatSentenceDate, formatShortSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { nav } from '../../__fixtures__/app-state.svelte';
import {
  draftRow,
  LEAVES_AT,
  LEAVING,
  LIVE,
  PAID,
  withMedia,
} from '../../__fixtures__/draft-row';
import { kitQuery } from '../../__fixtures__/kit-query.mock.svelte';
import { editHref, publishStepHref } from '../../editor/editor-url';
import { leaveDayFrom, retryWords } from '../leaving-words';

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
  media: { current: undefined as unknown, error: undefined as unknown },
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
      slot: 'first' | 'whereCounts' | 'categories' | 'attention' | 'media',
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
const deleteContent = vi.hoisted(() =>
  vi.fn(async (_id: string): Promise<unknown> => undefined)
);
/** Keep it on a leaving piece (Codex-a6ofh.6). */
const keepContent = vi.hoisted(() =>
  vi.fn(async (_id: string): Promise<unknown> => undefined)
);
vi.mock('$lib/remote/content.remote', () => ({
  listContent,
  getContentWhereCounts,
  getContentAttention,
  runContentBulk,
  deleteContent,
  keepContent,
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

// The first piece's unused uploads (Codex-a6ofh.3.6).
const listMedia = vi.hoisted(() => vi.fn(() => heldQuery('media')));
vi.mock('$lib/remote/media.remote', () => ({ listMedia }));

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
  s.media = { current: undefined, error: undefined };
  listMedia.mockClear();
  s.later.clear();
  listContent.mockClear();
  goto.mockClear();
  logReadFailure.mockClear();
  s.refreshFirst.mockClear();
  runContentBulk.mockReset();
  deleteContent.mockClear();
  // Reset, so an answer one test queued and never used can't reach the next.
  keepContent.mockReset();
  keepContent.mockResolvedValue({
    kept: true,
    staying: 0,
    stillLeavingBy: null,
  });
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

  test('the first piece offers up to three unused uploads, each starting a piece (Codex-a6ofh.3.6)', () => {
    s.first = { current: pageOf([]), error: undefined };
    s.media = {
      current: {
        items: [
          {
            id: 'm1',
            title: 'Studio tour',
            mediaType: 'video',
            thumbnailUrl: null,
          },
          {
            id: 'm2',
            title: 'Interview',
            mediaType: 'audio',
            thumbnailUrl: null,
          },
        ],
        pagination: { page: 1, limit: 3, total: 4, totalPages: 2 },
      },
      error: undefined,
    };
    render();

    expect(listMedia).toHaveBeenCalledWith(
      expect.objectContaining({ usage: 'unused', status: 'ready', limit: 3 })
    );
    expect(text()).toContain(m.studio_content_first_uploads({ count: 4 }));
    const from = document.querySelector<HTMLAnchorElement>(
      `a[aria-label="${m.studio_content_first_from_this({ title: 'Interview' })}"]`
    );
    expect(from?.getAttribute('href')).toBe(
      '/studio/content/new?media=m2&type=audio'
    );
    expect(
      document.querySelector('a[href="/studio/media?usage=unused"]')
        ?.textContent
    ).toContain(m.studio_content_first_from_upload());
    expect(
      document.querySelector('a[href="/studio/content/new?type=written"]')
    ).not.toBeNull();
  });

  test('an unread uploads list leaves the plain first piece, and is logged', () => {
    s.first = { current: pageOf([]), error: undefined };
    s.media = { current: undefined, error: { status: 503 } };
    render();

    expect(text()).toContain(m.studio_content_empty_how());
    expect(
      document.querySelector('a[href="/studio/content/new"]')
    ).not.toBeNull();
    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.first_piece_uploads_unread',
      { status: 503 },
      expect.objectContaining({ studio: 'org' })
    );
  });

  test('a list with pieces never reads the uploads', () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render();
    expect(listMedia).not.toHaveBeenCalled();
  });

  test('a filter with no matches offers to clear it, not to start over', async () => {
    s.first = { current: pageOf([]), error: undefined };
    render('?type=audio&access=paid');
    // Named as the menus name them (Codex-a6ofh.3.6, mockup L3).
    expect(text()).toContain(
      m.studio_content_list_no_match_named({
        filters: [
          m.studio_content_list_filter_named({ title: 'Type', value: 'Audio' }),
          m.studio_content_list_filter_named({
            title: 'Access',
            value: 'Paid',
          }),
        ].join(' + '),
      })
    );
    expect(listMedia).not.toHaveBeenCalled();
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
        lifecycle: 'all',
        needs: 'none',
        hasCategory: false,
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
      expect.objectContaining({
        page: 2,
        lifecycle: 'all',
        type: 'video',
      })
    );
  });

  // The tabs ask a lifecycle (Codex-a6ofh.3.6 review): a Drafts page that
  // failed names the tab, not a read of every piece.
  test('a page that failed on a tab names the tab', async () => {
    s.first = { current: pageOf([piece(1)], 2), error: undefined };
    s.later.set(2, new Error('Down'));
    render('?status=draft');

    button(/Show more/)?.click();
    await settle();

    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.show_more_failed',
      expect.any(Error),
      expect.objectContaining({ page: 2, lifecycle: 'draft' })
    );
  });

  // A chip's read is the one with a step of its own (`needs=ready` reads
  // article bodies): its failure names the chip, not a read of every piece.
  test('a page that failed on a chip names the chip', async () => {
    s.first = { current: pageOf([piece(1)], 2), error: undefined };
    s.later.set(2, new Error('Down'));
    render('?needs=ready');

    button(/Show more/)?.click();
    await settle();

    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.show_more_failed',
      expect.any(Error),
      expect.objectContaining({ page: 2, needs: 'ready' })
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
    expect(text()).toContain(
      m.studio_content_list_no_match_named({
        filters: m.studio_content_list_filter_named({
          title: 'Category',
          value: 'Q&A',
        }),
      })
    );
    button(m.media_clear_filters())?.click();
    await settle();
    expect(goto).toHaveBeenCalledWith('/studio/content', expect.anything());
  });

  // A failed category read names a category, never which (review round 3):
  // without it, the read logged as one of every piece.
  test('a page that failed in a category says a category narrowed it', async () => {
    s.categories = { current: CATEGORIES, error: undefined };
    s.first = { current: pageOf([piece(1)], 2), error: undefined };
    s.later.set(2, new Error('Down'));
    render(`?category=${QA}`);

    button(/Show more/)?.click();
    await settle();

    expect(logReadFailure).toHaveBeenCalledWith(
      'studio_content.show_more_failed',
      expect.any(Error),
      expect.objectContaining({ page: 2, hasCategory: true })
    );
    expect(JSON.stringify(vi.mocked(logReadFailure).mock.calls)).not.toContain(
      QA
    );
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

  // Leaving (Codex-a6ofh.6.7, LN3): first, as its row line is, in warning,
  // with the day the first one goes.
  test('a leaving chip comes first and names the first day one goes', () => {
    s.attention = {
      current: {
        ...COUNTS,
        leaving: 2,
        leavingFirst: '2026-12-17T00:00:00.000Z',
      },
      error: undefined,
    };
    render();
    expect(chips()[0]).toEqual({
      kind: 'leaving',
      words: m.studio_content_needs_leaving_on({
        words: m.studio_content_needs_leaving({ count: 2 }),
        date: formatShortSentenceDate('2026-12-17T00:00:00.000Z'),
      }),
      pressed: 'false',
    });
    expect(
      document
        .querySelector('.needs-chip[data-kind="leaving"]')
        ?.getAttribute('data-tone')
    ).toBe('warning');
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

  test('the Delete dialog gives a leaving piece its address when a deleted one shares its title', () => {
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
      m.studio_leaving_delete_leave_one_download({
        name: '“Introduction” (/intro)',
      })
    );
    // Both go: one now, one in 30 days (Codex-a6ofh.6, LN2).
    expect(button(m.studio_content_delete_count({ count: 2 }))).toBeDefined();
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

// The leaving notice (Codex-a6ofh.6, mockup leaving-notice.html LN1-LN3;
// owner 2026-11-20).
describe('StudioContentList: the leaving notice (Codex-a6ofh.6)', () => {
  const box = (title: string) =>
    document.querySelector<HTMLInputElement>(
      `input[aria-label="${m.studio_content_bulk_select_row({ title })}"]`
    );
  const pageBox = () =>
    document.querySelector<HTMLInputElement>('th input[type="checkbox"]');
  const keepOnLine = (title: string) =>
    document.querySelector<HTMLButtonElement>(
      `button[aria-label="${m.studio_leaving_keep_named({ title })}"]`
    );
  const dialog = () => document.querySelector('[role="alertdialog"]');
  async function menuOf(title: string) {
    document
      .querySelector<HTMLElement>(
        `[aria-label="${m.studio_content_row_actions({ title })}"]`
      )
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    await settle();
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }
  const named = (items: HTMLElement[], name: string) =>
    items.find((el) => el.textContent?.trim() === name);
  const owned = () => piece(1, { ...LIVE, ...PAID, holderCount: 57 });
  const leaving = (fields: Partial<ContentWithRelations> = {}) =>
    piece(1, { ...PAID, ...LEAVING, ...fields });
  const shortDate = formatShortSentenceDate(LEAVES_AT);

  test('a row delete of a piece people own says who and when, and the line says it leaves (LN1)', async () => {
    const row = owned();
    s.first = { current: pageOf([row]), error: undefined };
    deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 57,
      started: true,
      leavingByCreator: true,
      leavingByOrg: false,
    });
    render();

    named(await menuOf('Piece 1'), m.studio_content_row_delete())?.click();
    await settle();
    expect(text()).toContain(m.studio_leaving_delete_owners({ count: 57 }));
    expect(text()).toContain(
      m.studio_leaving_delete_body_download({
        date: formatSentenceDate(leaveDayFrom()),
      })
    );
    expect(button(m.studio_content_delete_unpublish_instead())).toBeDefined();

    button(
      m.studio_leaving_delete_in_days({ days: LEAVING_NOTICE_DAYS })
    )?.click();
    await settle();

    expect(deleteContent).toHaveBeenCalledWith(row.id);
    expect(text()).toContain(
      m.studio_leaving_deleted({
        title: 'Piece 1',
        date: formatSentenceDate(LEAVES_AT),
        count: 57,
      })
    );
    expect(dialog()).toBeNull();
    expect(s.refreshFirst).toHaveBeenCalled();
  });

  test('a delete too soon after the last notice is said in the dialog, which stays open with Unpublish instead', async () => {
    s.first = { current: pageOf([owned()]), error: undefined };
    const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    deleteContent.mockRejectedValueOnce({
      status: 409,
      body: {
        code: 'CONTENT_LEAVING_TOO_SOON',
        message: 'This started leaving less than a day ago.',
        retryAfter: at,
      },
    });
    const said = vi.spyOn(toast, 'error');
    render();

    named(await menuOf('Piece 1'), m.studio_content_row_delete())?.click();
    await settle();
    button(
      m.studio_leaving_delete_in_days({ days: LEAVING_NOTICE_DAYS })
    )?.click();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain(retryWords(at) ?? 'no words');
    expect(button(m.studio_content_delete_unpublish_instead())).toBeDefined();
    expect(said).not.toHaveBeenCalled();
    said.mockRestore();
  });

  test('a leaving row reads Leaving, says when, and Keep it on its line keeps it (LN3)', async () => {
    const row = leaving();
    s.first = { current: pageOf([row]), error: undefined };
    render();

    expect(
      document.querySelector('[data-status="leaving"]')?.textContent?.trim()
    ).toBe(m.studio_leaving_status());
    expect(text()).toContain(
      m.studio_leaving_row({ date: shortDate, count: 57 })
    );
    expect(text()).toContain(
      m.studio_leaving_owners_keep_until({ date: shortDate })
    );

    keepOnLine('Piece 1')?.click();
    await settle();

    expect(keepContent).toHaveBeenCalledWith(row.id);
    expect(text()).toContain(m.studio_leaving_kept({ title: 'Piece 1' }));
    expect(s.refreshFirst).toHaveBeenCalled();
  });

  test('a leaving row’s menu offers Keep it, never Publish or Delete', async () => {
    const row = leaving();
    s.first = { current: pageOf([row]), error: undefined };
    keepContent.mockResolvedValueOnce({
      kept: false,
      staying: 0,
      stillLeavingBy: 'org',
    });
    render();

    const items = await menuOf('Piece 1');
    expect(named(items, m.studio_content_row_publish())).toBeUndefined();
    expect(named(items, m.studio_content_row_delete())).toBeUndefined();
    named(items, m.studio_leaving_keep())?.click();
    await settle();

    expect(keepContent).toHaveBeenCalledWith(row.id);
    // The org's delete still stands: said, with its date.
    expect(text()).toContain(
      m.studio_leaving_kept_org_stands({
        title: 'Piece 1',
        date: formatSentenceDate(LEAVES_AT),
      })
    );
  });

  test('a Keep only an org admin can make says so in its own words (403)', async () => {
    s.first = { current: pageOf([leaving()]), error: undefined };
    keepContent.mockRejectedValueOnce({
      status: 403,
      body: {
        code: 'CONTENT_LEAVE_NOT_YOURS',
        message: 'An org admin deleted this, so only an org admin can keep it.',
      },
    });
    const said = vi.spyOn(toast, 'error');
    render();

    keepOnLine('Piece 1')?.click();
    await settle();

    expect(said).toHaveBeenCalledWith(
      m.studio_leaving_keep_not_yours({ title: 'Piece 1' })
    );
    said.mockRestore();
  });

  // "Delete it too" (owner 2026-11-20): the creator's delete beside the org's.
  const deleteTooOnLine = (title: string) =>
    document.querySelector<HTMLButtonElement>(
      `button[aria-label="${m.studio_leaving_delete_too_named({ title })}"]`
    );
  const orgOnly = () =>
    leaving({ leavingByCreator: false, leavingByOrg: true });
  const bothSides = () => leaving({ leavingByOrg: true });
  /** The first page in a reactive slot, so a re-read after a change can swap its rows. */
  function shown(rows: ContentWithRelations[]) {
    const slot = $state({
      current: pageOf(rows) as unknown,
      error: undefined as unknown,
    });
    s.first = slot;
    return slot;
  }

  test('a row the org’s delete alone holds is a note, with Delete it too… in its menu, no Keep, Publish or Delete', async () => {
    shown([orgOnly()]);
    render();

    expect(text()).toContain(m.studio_leaving_org_note({ date: shortDate }));
    expect(keepOnLine('Piece 1')).toBeNull();
    const items = await menuOf('Piece 1');
    expect(named(items, m.studio_leaving_keep())).toBeUndefined();
    expect(named(items, m.studio_content_row_publish())).toBeUndefined();
    expect(named(items, m.studio_content_row_delete())).toBeUndefined();

    named(items, m.studio_leaving_delete_too_menu())?.click();
    await settle();
    expect(dialog()?.textContent).toContain(
      m.studio_leaving_delete_too_title({ title: 'Piece 1' })
    );
  });

  test('Delete it too on an org-only row’s line: its confirm says the owners were already told, and the row then offers Keep it beside the org’s delete', async () => {
    const row = orgOnly();
    const slot = shown([row]);
    deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 57,
      started: false,
      leavingByCreator: true,
      leavingByOrg: true,
    });
    s.refreshFirst.mockImplementationOnce(async () => {
      slot.current = pageOf([bothSides()]);
    });
    render();

    deleteTooOnLine('Piece 1')?.click();
    await settle();
    expect(dialog()?.textContent).toContain(
      m.studio_leaving_delete_too_title({ title: 'Piece 1' })
    );
    expect(dialog()?.textContent).toContain(
      m.studio_leaving_delete_too_body({ date: formatSentenceDate(LEAVES_AT) })
    );
    expect(dialog()?.textContent).not.toContain('emailed today');
    expect(button(m.studio_content_delete_unpublish_instead())).toBeUndefined();

    button(m.studio_leaving_delete_too_confirm())?.click();
    await settle();

    expect(deleteContent).toHaveBeenCalledWith(row.id);
    expect(text()).toContain(
      m.studio_leaving_deleted_too({
        title: 'Piece 1',
        date: formatSentenceDate(LEAVES_AT),
      })
    );
    expect(dialog()).toBeNull();
    // Read again: both deletes hold it, so Keep it, and the org's too.
    expect(keepOnLine('Piece 1')).not.toBeNull();
    expect(text()).toContain(m.studio_leaving_org_too());
    expect(deleteTooOnLine('Piece 1')).toBeNull();
  });

  test('a row both deletes hold offers Keep it in its menu, never Delete it too…', async () => {
    shown([bothSides()]);
    render();

    expect(deleteTooOnLine('Piece 1')).toBeNull();
    const items = await menuOf('Piece 1');
    expect(named(items, m.studio_leaving_keep())).toBeDefined();
    expect(named(items, m.studio_leaving_delete_too_menu())).toBeUndefined();
  });

  test('a Keep of a row both deletes hold withdraws only the creator’s, and the row goes back to the org’s note with Delete it too', async () => {
    const row = bothSides();
    const slot = shown([row]);
    keepContent.mockResolvedValueOnce({
      kept: false,
      staying: 0,
      stillLeavingBy: 'org',
    });
    s.refreshFirst.mockImplementationOnce(async () => {
      slot.current = pageOf([orgOnly()]);
    });
    render();
    expect(text()).toContain(m.studio_leaving_org_too());

    keepOnLine('Piece 1')?.click();
    await settle();

    expect(keepContent).toHaveBeenCalledWith(row.id);
    expect(text()).toContain(
      m.studio_leaving_kept_org_stands({
        title: 'Piece 1',
        date: formatSentenceDate(LEAVES_AT),
      })
    );
    expect(text()).toContain(m.studio_leaving_org_note({ date: shortDate }));
    expect(text()).not.toContain(m.studio_leaving_org_too());
    expect(keepOnLine('Piece 1')).toBeNull();
    expect(deleteTooOnLine('Piece 1')).not.toBeNull();
  });

  test('a bulk delete names the ones that leave, sends them all, and the line counts both (LN2)', async () => {
    const rows = [piece(1), piece(2, { holderCount: 3 })];
    s.first = { current: pageOf(rows), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [
        { id: rows[0]?.id, outcome: 'done' },
        {
          id: rows[1]?.id,
          outcome: 'leaving',
          leavesAt: LEAVES_AT,
          holders: 3,
          started: true,
          leavingByCreator: true,
          leavingByOrg: false,
        },
      ],
    });
    render();
    pageBox()?.click();
    flushSync();
    button(m.studio_content_bulk_delete())?.click();
    flushSync();

    expect(text()).toContain(m.studio_leaving_delete_going_one());
    expect(text()).toContain(
      m.studio_leaving_delete_leave_title_one({
        date: formatSentenceDate(leaveDayFrom()),
      })
    );
    button(m.studio_content_delete_count({ count: 2 }))?.click();
    await settle();

    expect(runContentBulk).toHaveBeenCalledWith({
      action: 'delete',
      ids: rows.map((row) => row.id),
    });
    expect(text()).toContain(
      m.studio_leaving_bulk_deleted_leave_one({ done: 1, date: shortDate })
    );
    // Both went through: nothing stays selected.
    expect(document.querySelector('.bulk-bar')).toBeNull();
  });

  test('a leaving row is never sent to bulk Publish or Delete', async () => {
    const rows = [piece(1), piece(2, { ...LEAVING })];
    s.first = { current: pageOf(rows), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [{ id: rows[0]?.id, outcome: 'done' }],
    });
    render();
    box('Piece 2')?.click();
    flushSync();
    // The leaving one alone: neither is offered.
    expect(button(m.studio_content_bulk_publish())).toBeUndefined();
    expect(button(m.studio_content_bulk_delete())).toBeUndefined();

    box('Piece 1')?.click();
    flushSync();
    button(m.studio_content_bulk_delete())?.click();
    flushSync();
    button(m.studio_content_delete_count({ count: 1 }))?.click();
    await settle();

    expect(runContentBulk).toHaveBeenCalledWith({
      action: 'delete',
      ids: [rows[0]?.id],
    });
  });

  test('a publish refused because the piece is leaving says Keep it first (409)', async () => {
    const rows = [piece(1)];
    s.first = { current: pageOf(rows), error: undefined };
    runContentBulk.mockResolvedValue({
      results: [
        {
          id: rows[0]?.id,
          outcome: 'refused',
          error: {
            code: 'CONFLICT',
            message: 'This is leaving. Keep it first, then publish it.',
            details: { code: 'CONTENT_LEAVING' },
          },
        },
      ],
    });
    render();
    box('Piece 1')?.click();
    flushSync();
    button(m.studio_content_bulk_publish())?.click();
    await settle();
    button(m.studio_content_bulk_show())?.click();
    flushSync();

    expect(text()).toContain(m.studio_leaving_publish_refused());
  });
});

// Mockup L4a (owner 2026-11-15): below `sm` the List is rows, not the table.
describe('StudioContentList: on a phone', () => {
  const wide = window.matchMedia;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query === MOBILE_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: wide,
    });
  });

  test('the list is rows, each with its facts on one line', () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render();
    expect(document.querySelector('.content-table')).toBeNull();
    const row = document.querySelector('.content-rows [data-content-id]');
    expect(row?.querySelector('.crow-title')?.textContent?.trim()).toBe(
      'Piece 1'
    );
    // A draft never live: its access, then when it was changed.
    expect(row?.querySelector('.crow-fact')?.textContent).toMatch(/^Free · /);
    // The box and the menu, as on the table.
    expect(row?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(row?.querySelector('.row-actions-trigger')).not.toBeNull();
  });

  test('its Grid is the cards, and the view toggle is there to choose', () => {
    s.first = { current: pageOf([piece(1)]), error: undefined };
    render('?view=grid');
    expect(
      document.querySelector('.content-grid [data-content-id]')
    ).not.toBeNull();
    expect(document.querySelector('.content-rows')).toBeNull();
    // One View toggle, on every width: a phone keeps it beside Filters.
    expect(
      document.querySelectorAll(
        `[role="radiogroup"][aria-label="${m.media_view_label()}"]`
      )
    ).toHaveLength(1);
  });
});
