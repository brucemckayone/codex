/**
 * The studio media library (Codex-a6ofh.1.6). Every read renders three
 * states, and a failed one never reads as an empty library (data-design §0:
 * today's org page did exactly that). Also: the header's whole-library sums,
 * the needs-attention line, "Show more" appending the next page, the search
 * floor on the query argument, and the list view.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

type Item = {
  id: string;
  title: string;
  status: string;
  mediaType: 'video' | 'audio';
  durationSeconds: number | null;
  fileSizeBytes: number | null;
  createdAt: string;
  thumbnailUrl: string | null;
  usage: { total: number; live: number };
};
type ListPage = {
  items: Item[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
type Summary = {
  total: number;
  totalBytes: number;
  failed: number;
  stopped: number;
};

const s = vi.hoisted(() => ({
  url: new URL('https://studio.test/studio/media'),
  first: { current: undefined as unknown, error: undefined as unknown },
  later: new Map<number, unknown>(),
  summary: { current: undefined as unknown, error: undefined as unknown },
  refreshFirst: vi.fn(async () => {}),
  refreshSummary: vi.fn(async () => {}),
}));

vi.mock('$app/state', () => ({
  get page() {
    return { url: s.url };
  },
}));

const goto = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ goto }));

const listMedia = vi.hoisted(() =>
  vi.fn((args: { page: number }) => {
    if (args.page === 1) {
      return {
        get current() {
          return s.first.current;
        },
        get error() {
          return s.first.error;
        },
        refresh: s.refreshFirst,
      };
    }
    const next = s.later.get(args.page);
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  })
);

vi.mock('$lib/remote/media.remote', () => ({
  listMedia,
  getMediaSummary: vi.fn(() => ({
    get current() {
      return s.summary.current;
    },
    get error() {
      return s.summary.error;
    },
    refresh: s.refreshSummary,
  })),
  getMediaUsage: vi.fn(() => ({
    current: undefined,
    error: undefined,
    refresh: vi.fn(),
  })),
  deleteMedia: vi.fn(),
  updateMedia: vi.fn(),
  retryTranscoding: vi.fn(),
}));

vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    register: vi.fn(() => () => {}),
    connection: 'idle',
    items: new Map(),
    now: 0,
    resume: vi.fn(),
    refreshList: vi.fn(),
  },
}));

vi.mock('$lib/client/upload-queue.svelte', () => ({
  uploadQueue: {
    items: [],
    rejections: [],
    onComplete: vi.fn(() => () => {}),
    cancel: vi.fn(),
    add: vi.fn(),
  },
}));

const StudioMediaLibrary = (await import('./StudioMediaLibrary.svelte'))
  .default;

const GB = 1024 ** 3;

function item(n: number, overrides: Partial<Item> = {}): Item {
  return {
    id: `6b000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: `Item ${n}`,
    status: 'ready',
    mediaType: 'video',
    durationSeconds: 60,
    fileSizeBytes: 1024 * 1024,
    createdAt: '2026-10-01T10:00:00.000Z',
    thumbnailUrl: null,
    usage: { total: 0, live: 0 },
    ...overrides,
  };
}

function listOf(items: Item[], total = items.length, page = 1): ListPage {
  return {
    items,
    pagination: { page, limit: 24, total, totalPages: Math.ceil(total / 24) },
  };
}

let component: ReturnType<typeof mount> | null = null;

function render(query = '') {
  s.url = new URL(`https://studio.test/studio/media${query}`);
  component = mount(StudioMediaLibrary, {
    target: document.body,
    props: { studioName: 'Studio Alpha' },
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

beforeEach(() => {
  s.first = { current: undefined, error: undefined };
  s.summary = { current: undefined, error: undefined };
  s.later.clear();
  listMedia.mockClear();
  goto.mockClear();
  s.refreshFirst.mockClear();
  s.refreshSummary.mockClear();
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('StudioMediaLibrary: the three states', () => {
  test('nothing has arrived: a skeleton, never the empty state', () => {
    render();
    expect(document.querySelector('.library-skeleton')).not.toBeNull();
    expect(document.querySelector('.empty-state')).toBeNull();
  });

  // The regression data-design §0 names: a rejected read rendered "No media
  // files yet" to a creator whose library is full.
  test('the read failed: an error with Try again, never "your library is empty"', () => {
    s.first.error = new Error('500');
    render();
    expect(text()).toContain("We couldn't load your media");
    expect(text()).not.toContain('Upload your first video or audio');

    button('Try again')?.click();
    expect(s.refreshFirst).toHaveBeenCalledTimes(1);
  });

  test('data: the tiles, and the header names the whole library', () => {
    s.first.current = listOf([item(1), item(2)], 12);
    s.summary.current = {
      total: 12,
      totalBytes: 6.4 * GB,
      failed: 0,
      stopped: 0,
    } satisfies Summary;
    render();
    expect(document.querySelectorAll('.tile-grid .tile')).toHaveLength(2);
    expect(document.querySelector('.library-count')?.textContent).toBe(
      '12 items · 6.4 GB'
    );
    // Decision 1A: say whose library this is.
    expect(text()).toContain('Only you can see these.');
  });
});

describe('StudioMediaLibrary: empty is two different things', () => {
  test('a new library invites the first upload', () => {
    s.first.current = listOf([]);
    s.summary.current = { total: 0, totalBytes: 0, failed: 0, stopped: 0 };
    render();
    expect(document.querySelector('.empty-state')).not.toBeNull();
    expect(text()).toContain('Upload your first video or audio');
  });

  test('a filter with no results says so, counts the library, and clears', async () => {
    s.first.current = listOf([]);
    s.summary.current = { total: 12, totalBytes: GB, failed: 0, stopped: 0 };
    render('?usage=unused&view=list');
    expect(text()).toContain('Nothing matches');
    expect(text()).toContain('12 items in your library.');
    expect(text()).not.toContain('Upload your first');

    button('Clear filters')?.click();
    await settle();
    // The facets go; the view is kept.
    expect(goto).toHaveBeenCalledWith(
      '/studio/media?view=list',
      expect.anything()
    );
  });

  test('"Needs attention" with nothing in it reads as good news (M6)', () => {
    s.first.current = listOf([]);
    s.summary.current = { total: 12, totalBytes: GB, failed: 0, stopped: 0 };
    render('?status=attention');
    expect(text()).toContain('Nothing needs attention');
    expect(text()).toContain('No failed or stopped items.');
  });
});

describe('StudioMediaLibrary: header and attention', () => {
  test('narrowed by one facet: "5 of 12 · Unused"', () => {
    s.first.current = listOf([item(1)], 5);
    s.summary.current = { total: 12, totalBytes: GB, failed: 0, stopped: 0 };
    render('?usage=unused');
    expect(document.querySelector('.library-count')?.textContent).toBe(
      '5 of 12 · Unused'
    );
  });

  test('one line for everything that needs the creator, and Show them filters to it', async () => {
    s.first.current = listOf([item(1)], 12);
    s.summary.current = { total: 12, totalBytes: GB, failed: 1, stopped: 1 };
    render();
    expect(text()).toContain('2 need attention.');
    expect(text()).toContain(
      '1 failed to process, and 1 upload stopped before it finished.'
    );

    button('Show them')?.click();
    await settle();
    expect(goto).toHaveBeenCalledWith(
      '/studio/media?status=attention',
      expect.anything()
    );
  });

  test('no attention line while that is the filter, or when nothing needs it', () => {
    s.first.current = listOf([item(1)], 1);
    s.summary.current = { total: 12, totalBytes: GB, failed: 2, stopped: 0 };
    render('?status=attention');
    expect(document.querySelector('.attention')).toBeNull();
  });
});

describe('StudioMediaLibrary: reads', () => {
  test('"Show more" appends the next page of the same view, once each', async () => {
    const first = Array.from({ length: 24 }, (_, i) => item(i + 1));
    s.first.current = listOf(first, 30);
    s.later.set(
      2,
      listOf(
        Array.from({ length: 6 }, (_, i) => item(i + 25)),
        30,
        2
      )
    );
    render('?sort=largest');

    const more = button('Show more · 6 of 30 left');
    expect(more).toBeDefined();
    more?.click();
    await settle();

    expect(listMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        limit: 24,
        sortBy: 'fileSizeBytes',
        sortOrder: 'desc',
      })
    );
    expect(document.querySelectorAll('.tile-grid .tile')).toHaveLength(30);
    expect(button(/Show more/)).toBeUndefined();
  });

  test('a failed "Show more" keeps the rows and says it, with the button to try again', async () => {
    s.first.current = listOf(
      Array.from({ length: 24 }, (_, i) => item(i + 1)),
      30
    );
    s.later.set(2, new Error('502'));
    render();
    button(/Show more/)?.click();
    await settle();
    expect(document.querySelectorAll('.tile-grid .tile')).toHaveLength(24);
    expect(text()).toContain("Couldn't load more.");
    expect(button(/Show more/)).toBeDefined();
  });

  // Codex-k618q: below the floor the list asks for no pattern at all.
  test('a search reaches the API only once it reaches the floor', () => {
    s.first.current = listOf([]);
    render('?q=ho');
    expect(listMedia.mock.calls[0]?.[0]).not.toHaveProperty('search');
    if (component) unmount(component);
    component = null;

    render('?q=hono');
    expect(listMedia.mock.calls.at(-1)?.[0]).toMatchObject({ search: 'hono' });
  });

  test('the list view is a table of the same rows', () => {
    s.first.current = listOf([item(1), item(2)], 2);
    render('?view=list');
    expect(document.querySelector('.media-table')).not.toBeNull();
    expect(document.querySelectorAll('.media-table tbody tr')).toHaveLength(2);
    expect(document.querySelector('.tile-grid')).toBeNull();
  });

  // M1 note 7: always visible, and named with the title.
  test("each item's actions are one menu named with its title", () => {
    s.first.current = listOf([item(1, { title: 'Studio tour b-roll' })], 1);
    render();
    expect(
      document.querySelector(
        'button[aria-label="Actions for Studio tour b-roll"]'
      )
    ).not.toBeNull();
  });
});

describe('StudioMediaLibrary: a read that fails later (review, Codex-a6ofh.1.6)', () => {
  // kit keeps `current` when a refresh rejects: the empty page from before
  // the creator's first upload must not be redrawn as "Upload your first".
  test('a failed refetch over an empty page is an error, never the new-library state', () => {
    s.first.current = listOf([]);
    s.first.error = new Error('503');
    render();
    expect(text()).toContain("We couldn't load your media");
    expect(text()).not.toContain('Upload your first video or audio');
  });

  test('a failed refetch over rows keeps them and says they may be out of date', async () => {
    s.first.current = listOf([item(1), item(2)], 2);
    s.first.error = new Error('503');
    render();
    expect(document.querySelectorAll('.tile-grid .tile')).toHaveLength(2);
    expect(text()).toContain("Couldn't refresh your library.");
    expect(
      document.querySelector('.library-body')?.getAttribute('aria-busy')
    ).toBeNull();

    s.refreshFirst.mockRejectedValueOnce(new Error('503'));
    button('Try again')?.click();
    await settle();
    expect(s.refreshFirst).toHaveBeenCalledTimes(1);
    // A second failure says so, rather than looking like nothing happened.
    expect(text()).toContain("Still couldn't load.");
  });

  test('a refused view (4xx) never blames the connection, and offers to clear', () => {
    s.first.error = Object.assign(new Error('Bad request'), { status: 400 });
    render('?usage=unused');
    expect(text()).toContain("This search or filter couldn't be loaded.");
    expect(text()).not.toContain('connection problem');
    expect(button('Clear filters')).toBeDefined();
  });

  test('an over-long search is cut to the API bound, never sent to be refused', () => {
    s.first.current = listOf([]);
    render(`?q=${'a'.repeat(300)}`);
    const args = listMedia.mock.calls[0]?.[0] as { search?: string };
    expect(args.search).toHaveLength(255);
  });
});

describe('StudioMediaLibrary: the summary fails (review, Codex-a6ofh.1.6)', () => {
  test('the attention slot says it could not check, with its own Try again', async () => {
    s.first.current = listOf([item(1)], 1);
    s.summary.error = new Error('503');
    render();
    expect(text()).toContain("Couldn't check for items that need attention.");
    button('Try again')?.click();
    await settle();
    expect(s.refreshSummary).toHaveBeenCalledTimes(1);
  });

  // kit keeps a failed refresh's old `current`: those sums are not today's.
  test('stale sums are never shown as current', () => {
    s.first.current = listOf([item(1), item(2)], 15);
    s.summary.current = {
      total: 12,
      totalBytes: 6.4 * GB,
      failed: 2,
      stopped: 0,
    };
    s.summary.error = new Error('503');
    render();
    expect(document.querySelector('.library-count')?.textContent).toBe(
      '15 items'
    );
    expect(text()).not.toContain('2 need attention.');
  });

  test('a summary failure never fails the list refetch the live channel waits on', async () => {
    const { mediaStatus } = await import('$lib/client/media-status.svelte');
    s.first.current = listOf([item(1)], 1);
    render();
    const subscriber = vi
      .mocked(mediaStatus.register)
      .mock.calls.at(-1)?.[0] as {
      refresh: () => Promise<void>;
    };
    s.refreshSummary.mockRejectedValueOnce(new Error('429'));
    await expect(subscriber.refresh()).resolves.toBeUndefined();
    expect(s.refreshFirst).toHaveBeenCalled();
  });
});

describe('StudioMediaLibrary: the list row explains a failure (review, Codex-a6ofh.1.6)', () => {
  test('a failed row says why, as the tile does', () => {
    s.first.current = listOf(
      [item(1, { status: 'failed', title: 'Hono APIs' })],
      1
    );
    render('?view=list');
    const row = document.querySelector('.media-table tbody tr');
    expect(row?.getAttribute('data-status')).toBe('failed');
    expect(row?.querySelector('.row-kind')?.textContent).toMatch(
      /Video\s+·\s+\S/
    );
  });
});
