/**
 * The org studio's edit page reads the piece afresh on every arrival at a
 * step, and mounts that step only on its own read (Codex-a6ofh.2.3 review).
 *
 * The form seeds itself once and saves every field it holds, and the Write
 * step's session starts from its read: one made before the other step's
 * saves would put them back. A step must never mount on an earlier
 * arrival's read, even one for the same step, and a read that answers late
 * must never count for a later arrival.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

// The page's address, as kit's `page` holds it: changed in place by a move.
const nav = $state({
  url: new URL('https://alpha.test/studio/content/c1/edit'),
});
vi.mock('$app/state', () => ({
  page: {
    get url() {
      return nav.url;
    },
    params: { slug: 'alpha', contentId: 'c1' },
  },
}));

// The piece's query, as kit's behaves for this page: `current` holds the
// last answer, a refresh keeps it until a new one lands, and each read here
// answers or fails only when a test says so (`answer`, `fail`).
type Read = { resolve: () => void; reject: (reason: unknown) => void };
const q = $state({
  current: undefined as unknown,
  error: undefined as unknown,
  ready: false,
  loading: true,
});
const reads: Read[] = [];
const startRead = () =>
  new Promise<void>((resolve, reject) => reads.push({ resolve, reject }));
const refresh = vi.fn(() => {
  q.loading = true;
  return startRead();
});
/** One query instance: kit makes a new one after dropping a query whose first read failed. */
function makeQuery() {
  const firstRead = startRead();
  return {
    get current() {
      return q.current;
    },
    get error() {
      return q.error;
    },
    get ready() {
      return q.ready;
    },
    get loading() {
      return q.loading;
    },
    refresh,
    // biome-ignore lint/suspicious/noThenProperty: a thenable stands in for kit's query
    then: (ok: () => unknown, fail: (reason: unknown) => unknown) =>
      firstRead.then(ok, fail),
  };
}
const cache = { query: makeQuery(), evicted: false };
vi.mock('$lib/remote/content.remote', () => ({
  getContent: () => {
    if (cache.evicted) {
      cache.evicted = false;
      cache.query = makeQuery();
    }
    return cache.query;
  },
}));

vi.mock('$lib/components/studio/editor/ContentEditor.svelte', async () => ({
  default: (await import('./EditorProbe.svelte')).default,
}));
vi.mock('$lib/components/studio/ContentForm.svelte', async () => ({
  default: (await import('./FormProbe.svelte')).default,
}));
const told = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/observability', () => ({
  logger: { warn: told.warn, error: told.error },
}));

const EditPage = (await import('../+page.svelte')).default;
const { mounts } = await import('./probe-log');

const piece = (title: string) => ({
  id: 'c1',
  title,
  contentType: 'video',
  status: 'draft',
  publishedAt: null,
  creator: null,
});

function answer(index: number, value: unknown) {
  q.current = value;
  q.error = undefined;
  q.ready = true;
  q.loading = false;
  reads[index]?.resolve();
}

function fail(index: number, reason: unknown) {
  q.error = reason;
  q.loading = false;
  reads[index]?.reject(reason);
}

/** Lets each read's answer travel through the page's own handlers. */
async function settle() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  flushSync();
}

function go(step: 'write' | 'publish') {
  nav.url = new URL(
    `https://alpha.test/studio/content/c1/edit${step === 'publish' ? '?step=publish' : ''}`
  );
  flushSync();
}

const probe = (name: string) =>
  document.querySelector(`[data-probe="${name}"]`)?.textContent ?? null;
const text = () => document.body.textContent ?? '';

let component: ReturnType<typeof mount> | null = null;
function render() {
  component = mount(EditPage, {
    target: document.body,
    props: {
      data: {
        org: { id: 'org-1', slug: 'alpha' },
        studioUser: { name: 'Alex Creator' },
      },
    } as never,
  });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  reads.length = 0;
  mounts.length = 0;
  cache.query = makeQuery();
  cache.evicted = false;
  Object.assign(q, {
    current: undefined,
    error: undefined,
    ready: false,
    loading: true,
  });
  nav.url = new URL('https://alpha.test/studio/content/c1/edit');
  vi.clearAllMocks();
});

describe('the org edit page · a read per arrival', () => {
  test('Back to Write after a failed step-2 read waits for its own read, never the old one', async () => {
    render();
    answer(0, piece('R1'));
    await settle();
    expect(probe('editor')).toBe('R1');

    go('publish');
    await settle();
    expect(probe('publish')).toBeNull();
    fail(1, new TypeError('Failed to fetch'));
    await settle();
    expect(text()).toContain('Couldn’t load this piece.');

    // Back: the query still holds R1, from before Write's autosaves.
    go('write');
    await settle();
    expect(probe('editor')).toBeNull();

    answer(2, piece('R3'));
    await settle();
    expect(probe('editor')).toBe('R3');
  });

  test('a read that answers late never counts for a later arrival', async () => {
    render();
    answer(0, piece('R1'));
    await settle();

    go('publish');
    go('write');
    await settle();
    answer(2, piece('R3'));
    await settle();
    expect(probe('editor')).toBe('R3');

    // The step-2 read lands last: it was for an arrival already gone.
    reads[1]?.resolve();
    await settle();
    expect(probe('editor')).toBe('R3');
    expect(probe('publish')).toBeNull();
  });

  test('a step never mounts on the last read, not even for the flush the address changes in', async () => {
    render();
    answer(0, piece('R1'));
    await settle();
    go('publish');
    await settle();
    answer(1, piece('R2'));
    await settle();
    go('write');
    await settle();
    answer(2, piece('R3'));
    await settle();
    expect(mounts).toEqual(['editor:R1', 'publish:R2', 'editor:R3']);
  });

  test('a read kit answers only because a later one failed counts as that failure', async () => {
    render();
    answer(0, piece('R1'));
    await settle();
    go('publish');
    await settle();
    // Something else refreshed the same query and failed; kit settles this
    // arrival's read with it, keeping the value from before.
    q.error = new TypeError('Failed to fetch');
    q.loading = false;
    reads[1]?.resolve();
    await settle();
    expect(probe('publish')).toBeNull();
    expect(text()).toContain('Couldn’t load this piece.');
  });

  test('step 2 mounts the Publish step on the read made as it arrived', async () => {
    render();
    answer(0, piece('R1'));
    await settle();
    go('publish');
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    answer(1, piece('R2'));
    await settle();
    expect(probe('publish')).toBe('R2');
  });

  test('a piece that has been live keeps the form at either step, until its tabs', async () => {
    render();
    answer(0, {
      ...piece('L1'),
      status: 'published',
      publishedAt: '2026-11-01T09:00:00Z',
    });
    await settle();
    expect(probe('form')).toBe('L1');
    go('publish');
    await settle();
    answer(1, {
      ...piece('L2'),
      status: 'published',
      publishedAt: '2026-11-01T09:00:00Z',
    });
    await settle();
    expect(probe('form')).toBe('L2');
    expect(mounts).toEqual(['form:L1', 'form:L2']);
  });
});

describe('the org edit page · a read that fails', () => {
  test('a refusal is final: it says so, and offers no Try again', async () => {
    render();
    fail(0, { status: 404, body: { message: 'Content not found' } });
    await settle();
    expect(text()).toContain('This piece was deleted, or isn’t yours to edit.');
    expect(text()).not.toContain('Try Again');
  });

  test('a session that ended says so, with a way back in', async () => {
    render();
    fail(0, { status: 401, body: { message: 'Unauthorized' } });
    await settle();
    expect(text()).toContain('Your session ended.');
    const link = document.querySelector<HTMLAnchorElement>('a.sign-in');
    expect(link?.getAttribute('href')).toBe(
      `/login?redirect=${encodeURIComponent('/studio/content/c1/edit')}`
    );
    expect(text()).not.toContain('deleted');
  });

  test('Try again on a piece never read asks once, for a new query, and keeps focus if it fails', async () => {
    render();
    fail(0, new TypeError('Failed to fetch'));
    await settle();
    // Kit drops a query whose first read failed.
    cache.evicted = true;
    const again = () =>
      [...document.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === 'Try Again'
      );
    again()?.focus();
    again()?.click();
    await settle();
    expect(refresh).not.toHaveBeenCalled();
    expect(reads).toHaveLength(2);

    fail(1, new TypeError('Failed to fetch'));
    await settle();
    await settle();
    expect(document.activeElement).toBe(again());
  });

  test('an outage offers Try again, which reads afresh', async () => {
    render();
    fail(0, new TypeError('Failed to fetch'));
    await settle();
    expect(told.error).toHaveBeenCalledWith(
      'studio_content_edit.read_failed',
      expect.objectContaining({ contentId: 'c1' })
    );
    const again = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Try Again'
    );
    again?.click();
    await settle();
    expect(refresh).toHaveBeenCalledOnce();
    answer(1, piece('R1'));
    await settle();
    expect(probe('editor')).toBe('R1');
  });
});
