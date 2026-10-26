/**
 * The search palette: where a selection goes (Codex-ynktj), and which
 * results it shows (Codex-qhtw7).
 *
 * SvelteKit's `goto()` refuses another origin, so a result on another
 * subdomain (another org's item, a creator's profile on the creators host)
 * must be a full page load: `window.location.href`, stubbed here so the
 * assignment can be observed. jsdom applies no styles, so these assert the
 * DOM contract and the navigation, never geometry.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from 'vitest';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const { goto, page } = vi.hoisted(() => ({
  goto: vi.fn(() => Promise.resolve()),
  page: { url: new URL('http://studio-alpha.lvh.me:3000/explore') },
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page }));

import CommandPaletteSearch from './CommandPaletteSearch.svelte';

type Results = {
  content: Array<Record<string, unknown>>;
  creators: Array<Record<string, unknown>>;
};

const item = (id: string, organizationSlug = 'studio-alpha') => ({
  id,
  title: `Title ${id}`,
  slug: `slug-${id}`,
  contentType: 'video',
  thumbnailUrl: null,
  organizationSlug,
});

const answer = (results: Partial<Results>) =>
  new Response(JSON.stringify({ content: [], creators: [], ...results }));

let component: ReturnType<typeof mount> | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let hrefSpy: Mock<(href: string) => void>;
let originalLocation: Location;

function openPalette() {
  component = mount(CommandPaletteSearch, {
    target: document.body,
    props: { scope: 'org', orgSlug: 'studio-alpha', open: true },
  });
  flushSync();
}

const input = () =>
  document.querySelector<HTMLInputElement>('#command-palette-search-input');

// Types the term and lets the 300ms debounce fire and the answer land.
async function search(term: string) {
  const el = input();
  if (!el) throw new Error('palette input not rendered');
  el.value = term;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await vi.advanceTimersByTimeAsync(300);
  flushSync();
}

const titles = () =>
  [...document.querySelectorAll('.palette__item-title')].map(
    (el) => el.textContent
  );

beforeEach(() => {
  vi.useFakeTimers();
  goto.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  hrefSpy = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() {
        return page.url.href;
      },
      set href(value: string) {
        hrefSpy(value);
      },
    },
  });
});

afterEach(() => {
  if (component) unmount(component);
  component = undefined;
  document.body.innerHTML = '';
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('which results the palette shows (Codex-qhtw7)', () => {
  test("a failed search lists no results, never the last query's", async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ content: [item('a')] }))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    openPalette();

    await search('yoga');
    expect(titles()).toEqual(['Title a']);

    await search('yoga mat');
    expect(titles()).toEqual([]);
    expect(document.querySelector('.palette__empty')).not.toBeNull();
  });

  test('drops an answer for a query the box no longer holds', async () => {
    let answerYoga: (res: Response) => void = () => {};
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          answerYoga = resolve;
        })
      )
      .mockResolvedValueOnce(answer({ content: [item('pilates')] }));
    openPalette();

    await search('yoga');
    await search('pilates');
    expect(titles()).toEqual(['Title pilates']);

    // The slow answer for the earlier query lands last.
    answerYoga(answer({ content: [item('yoga')] }));
    await vi.runAllTimersAsync();
    flushSync();

    expect(titles()).toEqual(['Title pilates']);
  });

  test('keys never reach the results hidden while a new search loads', async () => {
    fetchMock.mockResolvedValue(answer({ content: [item('a')] }));
    openPalette();
    await search('yoga');

    // Typed on: the old results are hidden, and the debounce has not fired.
    const el = input();
    if (!el) throw new Error('palette input not rendered');
    el.value = 'yogaa';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    // Bubbling: Svelte delegates keydown to the root.
    const key = (k: string) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowDown');
    flushSync();
    key('Enter');
    flushSync();

    // Enter with nothing selectable is "see all results", never the hidden
    // match for the earlier query.
    expect(goto).toHaveBeenCalledWith('/explore?q=yogaa');
    expect(hrefSpy).not.toHaveBeenCalled();
  });
});

describe('where a selection goes (Codex-ynktj)', () => {
  const click = (selector: string) => {
    document.querySelector<HTMLButtonElement>(selector)?.click();
    flushSync();
  };

  test("opens an item on this org's subdomain with goto", async () => {
    fetchMock.mockResolvedValue(answer({ content: [item('a')] }));
    openPalette();
    await search('yoga');

    click('.palette__item--content');

    expect(goto).toHaveBeenCalledWith('/content/slug-a');
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  test("opens an item on another org's subdomain with a full page load", async () => {
    fetchMock.mockResolvedValue(answer({ content: [item('b', 'other-org')] }));
    openPalette();
    await search('yoga');

    click('.palette__item--content');

    expect(goto).not.toHaveBeenCalled();
    const target = new URL(hrefSpy.mock.calls[0]?.[0]);
    expect(target.host).toBe('other-org.lvh.me:3000');
    expect(target.pathname).toBe('/content/slug-b');
  });

  test("opens a creator's profile on the creators host", async () => {
    fetchMock.mockResolvedValue(
      answer({
        creators: [{ name: 'Alex Rivers', username: 'alex', avatarUrl: null }],
      })
    );
    openPalette();
    await search('alex');

    click('.palette__item--creator');

    expect(goto).not.toHaveBeenCalled();
    const target = new URL(hrefSpy.mock.calls[0]?.[0]);
    expect(target.host).toBe('creators.lvh.me:3000');
    expect(target.pathname).toBe('/@alex');
  });

  test("opens the org's creators page for a creator with no username", async () => {
    fetchMock.mockResolvedValue(
      answer({
        creators: [{ name: 'Sam Lee', username: null, avatarUrl: null }],
      })
    );
    openPalette();
    await search('sam');

    click('.palette__item--creator');

    expect(goto).toHaveBeenCalledWith('/creators');
    expect(hrefSpy).not.toHaveBeenCalled();
  });
});
