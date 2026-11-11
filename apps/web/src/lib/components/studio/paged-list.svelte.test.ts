/**
 * PagedList (Codex-a6ofh.3.1): a studio list read a page at a time, shared by
 * the content list and the media library. Driven here with a reactive view
 * and kit-shaped queries, so a view change is a new query, as on the page.
 */
import type { RemoteQuery } from '@sveltejs/kit';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagedList } from './paged-list.svelte';

type Args = { view: string; page: number };
type Item = { id: string };
type Page = { items: Item[]; pagination: { total: number } };

function pageOf(ids: string[], total = ids.length): Page {
  return { items: ids.map((id) => ({ id })), pagination: { total } };
}

/** A first-page query as kit holds it: `current`, `error`, `refresh`. */
function makeQuery() {
  const state = $state({
    current: undefined as Page | undefined,
    error: undefined as unknown,
  });
  return {
    get current() {
      return state.current;
    },
    get error() {
      return state.error;
    },
    land(page: Page) {
      state.error = undefined;
      state.current = page;
    },
    fail(error: unknown) {
      state.error = error;
    },
    refresh: vi.fn(async () => {}),
  };
}

let view = $state('a');
let queries = new Map<string, ReturnType<typeof makeQuery>>();
let later = new Map<string, Page | Error | Promise<Page>>();
let list: PagedList<Args, Page>;
let cleanup: (() => void) | null = null;
const onMoreFailed = vi.fn();

/** The first-page query for a view, made on first ask. */
function q(name: string) {
  let query = queries.get(name);
  if (!query) {
    query = makeQuery();
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
  queries = new Map();
  later = new Map();
  onMoreFailed.mockClear();
  cleanup = $effect.root(() => {
    list = new PagedList<Args, Page>({
      args: (page) => ({ view, page }),
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
    q('a').fail({ status: 400 });
    flushSync();
    expect(list.refused).toBe(true);
    for (const status of [408, 429, 503]) {
      q('a').fail({ status });
      flushSync();
      expect(list.refused).toBe(false);
    }
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
    expect(onMoreFailed).toHaveBeenCalledWith(expect.any(Error));
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
