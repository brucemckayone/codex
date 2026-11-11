/**
 * PagedList (Codex-a6ofh.3.1): a studio list read a page at a time, shared by
 * the content list and the media library. Driven here with a reactive view
 * and kit-shaped queries, so a view change is a new query, as on the page.
 */
import type { RemoteQuery } from '@sveltejs/kit';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type KitRead, kitQuery } from './__fixtures__/kit-query.mock.svelte';
import { PagedList } from './paged-list.svelte';

type Args = { view: string; page: number };
type Item = { id: string };
type Page = { items: Item[]; pagination: { total: number } };

function pageOf(ids: string[], total = ids.length): Page {
  return { items: ids.map((id) => ({ id })), pagination: { total } };
}

/**
 * A first-page query as kit holds it: `current`, `error`, `refresh`. As kit
 * (2.55) does, one whose FIRST read fails is dropped from the cache, so the
 * next ask for that view is a new query, still loading.
 */
function makeQuery(name: string) {
  const state = $state({
    current: undefined as Page | undefined,
    error: undefined as unknown,
  });
  let settled = false;
  const query = {
    get current() {
      return state.current;
    },
    get error() {
      return state.error;
    },
    land(page: Page) {
      settled = true;
      state.error = undefined;
      state.current = page;
    },
    fail(error: unknown) {
      if (!settled && queries.get(name) === query) queries.delete(name);
      settled = true;
      state.error = error;
    },
    refresh: vi.fn(async () => {}),
  };
  return query;
}

let view = $state('a');
/** A URL param the args never read (`?view=grid`): each write is a new view object. */
let layout = $state('list');
let queries = new Map<string, ReturnType<typeof makeQuery>>();
let later = new Map<string, Page | Error | Promise<Page>>();
let list: PagedList<Args, Page>;
let cleanup: (() => void) | null = null;
const onMoreFailed = vi.fn();

/** The first-page query for a view, made on first ask. */
function q(name: string) {
  let query = queries.get(name);
  if (!query) {
    query = makeQuery(name);
    queries.set(name, query);
  }
  return query;
}

function read(args: Args): RemoteQuery<Page> {
  if (args.page === 1) return q(args.view) as unknown as RemoteQuery<Page>;
  const next = later.get(`${args.view}:${args.page}`);
  return (next instanceof Error
    ? Promise.reject(next)
    : Promise.resolve(next)) as unknown as RemoteQuery<Page>;
}

const ids = () => list.items.map((item) => item.id);
const settle = async () => {
  for (let i = 0; i < 3; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

beforeEach(() => {
  view = 'a';
  layout = 'list';
  queries = new Map();
  later = new Map();
  onMoreFailed.mockClear();
  cleanup = $effect.root(() => {
    list = new PagedList<Args, Page>({
      // Reads `layout` as the page's args read the whole view from the URL.
      args: (page) => {
        void layout;
        return { view, page };
      },
      read,
      onMoreFailed,
    });
  });
  flushSync();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('PagedList: the first page', () => {
  it('is loading until something arrives, then shows it', () => {
    expect(list.loading).toBe(true);
    q('a').land(pageOf(['a1', 'a2'], 5));
    flushSync();
    expect(list.loading).toBe(false);
    expect(ids()).toEqual(['a1', 'a2']);
    expect(list.total).toBe(5);
    expect(list.left).toBe(3);
  });

  it('holds the last list while a changed view loads: dimmed, never blank', () => {
    q('a').land(pageOf(['a1']));
    flushSync();
    view = 'b';
    flushSync();
    expect(list.refreshing).toBe(true);
    expect(list.loading).toBe(false);
    expect(ids()).toEqual(['a1']);

    q('b').land(pageOf(['b1']));
    flushSync();
    expect(list.refreshing).toBe(false);
    expect(ids()).toEqual(['b1']);
  });

  it('calls a changed view whose read failed unread: the rows held are another view’s', () => {
    q('a').land(pageOf(['a1']));
    flushSync();
    view = 'b';
    flushSync();
    q('b').fail({ status: 503 });
    flushSync();
    expect(list.failed).toBe(true);
    expect(list.unread).toBe(true);
    expect(list.refreshing).toBe(false);
  });

  it('keeps a refetch that failed as the rows it had, never unread', () => {
    q('a').land(pageOf(['a1']));
    flushSync();
    q('a').fail({ status: 503 });
    flushSync();
    expect(list.failed).toBe(true);
    expect(list.unread).toBe(false);
    expect(ids()).toEqual(['a1']);
  });

  it('calls a 4xx refused, but never a timeout or a rate limit', () => {
    const a = q('a');
    a.fail({ status: 400 });
    flushSync();
    expect(list.refused).toBe(true);
    for (const status of [408, 429, 503]) {
      a.fail({ status });
      flushSync();
      expect(list.refused).toBe(false);
    }
  });

  it('keeps a failed read through a URL write that leaves the args alone: no quiet re-read', () => {
    q('a').fail({ status: 503 });
    flushSync();
    const failed = list.first;
    expect(queries.has('a')).toBe(false); // dropped: asking again is a new query

    layout = 'grid';
    flushSync();
    expect(list.first).toBe(failed);
    expect(list.unread).toBe(true);
  });

  it('says nothing about a held list for the view that is loading', () => {
    q('a').land(pageOf(['a1'], 5));
    flushSync();
    expect(list.total).toBe(5);
    expect(list.left).toBe(4);

    view = 'b';
    flushSync();
    expect(ids()).toEqual(['a1']); // dimmed, never blank
    expect(list.landed).toBe(false);
    expect(list.total).toBeNull(); // a's count, not b's
    expect(list.left).toBe(0); // no "Show more" of a under b
  });

  it('is loading, never "none", while a view loads over an empty one', () => {
    q('a').land(pageOf([]));
    flushSync();
    expect(list.empty).toBe(true);

    view = 'b';
    flushSync();
    expect(list.empty).toBe(false);
    expect(list.loading).toBe(true);

    q('b').land(pageOf([]));
    flushSync();
    expect(list.empty).toBe(true);
    expect(list.loading).toBe(false);
  });
});

describe('PagedList: a Retry after a failed first read', () => {
  it('holds the query it refreshed, never the new one kit hands over', async () => {
    const kit = kitQuery<Page>();
    let held!: PagedList<Args, Page>;
    const stop = $effect.root(() => {
      held = new PagedList<Args, Page>({
        args: (page) => ({ view: 'a', page }),
        read: () => kit.get() as unknown as RemoteQuery<Page>,
        onMoreFailed,
      });
    });
    flushSync();
    const failed = held.first;
    kit.fail({ status: 503 });
    flushSync();
    expect(held.unread).toBe(true);

    const retried = failed.refresh();
    flushSync();
    expect(kit.held()).not.toBe(failed); // kit made a new one...
    expect(held.first).toBe(failed); // ...which this list never asked for
    expect(held.unread).toBe(true); // the failure stands while it re-reads
    expect(held.empty).toBe(false);

    kit.land(pageOf(['a1']), failed as unknown as KitRead<Page>);
    await retried;
    flushSync();
    expect(held.unread).toBe(false);
    expect(held.items.map((item) => item.id)).toEqual(['a1']);
    stop();
  });
});

describe('PagedList: Show more', () => {
  it('appends the next page of the same view, each row once', async () => {
    q('a').land(pageOf(['a1', 'a2'], 4));
    later.set('a:2', pageOf(['a2', 'a3', 'a4'], 4));
    flushSync();

    await list.showMore();
    flushSync();
    expect(ids()).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(list.left).toBe(0);
  });

  it('drops the pages it added when the view changes', async () => {
    q('a').land(pageOf(['a1'], 2));
    later.set('a:2', pageOf(['a2'], 2));
    flushSync();
    await list.showMore();
    flushSync();

    view = 'b';
    q('b').land(pageOf(['b1']));
    flushSync();
    expect(ids()).toEqual(['b1']);
  });

  it('never appends a page that lands after the creator moved to another view', async () => {
    q('a').land(pageOf(['a1'], 2));
    // Page 2 of view a, still in flight when the view changes.
    let resolve: (page: Page) => void = () => {};
    later.set(
      'a:2',
      new Promise<Page>((done) => {
        resolve = done;
      })
    );
    flushSync();

    const reading = list.showMore();
    view = 'b';
    q('b').land(pageOf(['b1'], 1));
    flushSync();
    resolve(pageOf(['a2'], 2));
    await reading;
    flushSync();
    expect(ids()).toEqual(['b1']);
    expect(list.moreLoading).toBe(false);
  });

  it('says a page that failed, logs it, and keeps the rows', async () => {
    q('a').land(pageOf(['a1'], 2));
    later.set('a:2', new Error('Down'));
    flushSync();

    await list.showMore();
    flushSync();
    expect(list.moreFailed).toBe(true);
    // With the args it read, so the log says which page of which view.
    expect(onMoreFailed).toHaveBeenCalledWith(expect.any(Error), {
      view: 'a',
      page: 2,
    });
    expect(ids()).toEqual(['a1']);
  });
});

describe('PagedList: refresh', () => {
  it('reads the first page and every page shown again', async () => {
    q('a').land(pageOf(['a1'], 2));
    later.set('a:2', pageOf(['a2'], 2));
    flushSync();
    await list.showMore();

    later.set('a:2', pageOf(['a2-new'], 2));
    await list.refresh();
    flushSync();
    expect(q('a').refresh).toHaveBeenCalledTimes(1);
    expect(ids()).toEqual(['a1', 'a2-new']);
  });

  it('rejects when a page fails, so the caller can say so', async () => {
    q('a').land(pageOf(['a1'], 2));
    later.set('a:2', pageOf(['a2'], 2));
    flushSync();
    await list.showMore();

    later.set('a:2', new Error('Down'));
    await expect(list.refresh()).rejects.toThrow('Down');
    await settle();
    expect(ids()).toEqual(['a1', 'a2']);
  });
});
