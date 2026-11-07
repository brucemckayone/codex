/**
 * The editor's Publish step (Codex-a6ofh.2.4): only what is missing is
 * listed, the button names what it does, a choice here saves as it goes,
 * and Publish saves what is on screen, then publishes. A refusal the server
 * sends anyway is listed by its code, or said in its own words.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

const remotes = vi.hoisted(() => ({
  saveContent: vi.fn(),
  createContentDraft: vi.fn(),
  publishContent: vi.fn(),
  deleteThumbnailCommand: vi.fn(),
  checkContentSlug: vi.fn(),
}));
vi.mock('$lib/remote/content.remote', () => ({
  ...remotes,
  uploadThumbnailForm: {
    for: () => ({
      result: undefined,
      enhance: () => ({ method: 'POST', action: '' }),
    }),
  },
}));

/**
 * The media's own read: what `media.item` holds, or a 404 when it is null;
 * `failure` is a read that never answered (an outage).
 */
const media = vi.hoisted(() => ({
  item: null as Record<string, unknown> | null,
  failure: null as unknown,
  refresh: vi.fn(async () => {}),
}));
vi.mock('$lib/remote/media.remote', () => ({
  getMediaItem: () =>
    media.failure
      ? { current: undefined, error: media.failure, refresh: media.refresh }
      : {
          current: media.item ?? undefined,
          error: media.item ? undefined : { status: 404 },
          refresh: media.refresh,
        },
}));
const watched = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    items: new Map(),
    connection: 'idle',
    register: (subscriber: { listed: () => Map<string, string> }) => {
      watched.ids.push(...subscriber.listed().keys());
      return () => {};
    },
    resume: () => {},
  },
}));

const connect = vi.hoisted(() => ({
  ready: true,
  failure: null as unknown,
  refresh: vi.fn(async () => {}),
}));
vi.mock('$lib/remote/subscription.remote', () => ({
  getMyConnectStatus: () =>
    connect.failure
      ? { current: undefined, error: connect.failure, refresh: connect.refresh }
      : {
          current: {
            chargesEnabled: connect.ready,
            payoutsEnabled: connect.ready,
          },
          error: undefined,
          refresh: connect.refresh,
        },
  listTiers: () => ({ current: [], error: undefined, refresh: async () => {} }),
}));
const categories = vi.hoisted(() => ({
  failure: null as unknown,
  create: vi.fn(),
}));
vi.mock('$lib/remote/categories.remote', () => ({
  getCategories: () =>
    categories.failure
      ? {
          current: undefined,
          error: categories.failure,
          refresh: async () => {},
        }
      : { current: [], error: undefined, refresh: async () => {} },
  createCategoryInline: (...args: unknown[]) => categories.create(...args),
}));

// The guards a move goes past (the draft session's): a test plays a move
// through them by hand.
type Move = {
  willUnload: boolean;
  to: { url: URL } | null;
  cancel: () => void;
};
const nav = vi.hoisted(() => ({
  goto: vi.fn(),
  guards: [] as ((move: Move) => void)[],
}));
vi.mock('$app/navigation', () => ({
  beforeNavigate: (guard: (move: Move) => void) => nav.guards.push(guard),
  afterNavigate: () => {},
  replaceState: () => {},
  goto: (...args: unknown[]) => nav.goto(...args),
}));
/** A move kit already has under way: `to` while it loads. */
const moving = vi.hoisted(() => ({ to: null as unknown }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://alpha.lvh.me/studio/content/c1/edit?step=publish'),
    state: {},
  },
  navigating: moving,
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  add: vi.fn(),
}));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({ toast: toasts }));
const told = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('$lib/observability', () => ({ logger: told }));
vi.mock('$lib/components/ui/ContentCard/ContentCard.svelte', async () => ({
  default: (await import('./__fixtures__/ContentCardStub.svelte')).default,
}));

// The fold's slide out never ends under jsdom (its `animate` shim never
// finishes), so the fold closes at once here, as with reduced motion.
vi.mock('svelte/transition', async (actual) => ({
  ...(await actual<typeof import('svelte/transition')>()),
  slide: () => ({ duration: 0 }),
}));

const PublishStep = (await import('./PublishStep.svelte')).default;
const { TYPE_WORD } = await import('./canvas-text');

/** The autosave's debounce, with room. */
const SETTLE_MS = 1_600;

let component: ReturnType<typeof mount> | null = null;

function draft(
  fields: Partial<ContentWithRelations> = {}
): ContentWithRelations {
  return {
    id: 'c1',
    title: 'Svelte runes deep dive',
    slug: 'runes-explained',
    contentType: 'video',
    status: 'draft',
    publishedAt: null,
    description: null,
    contentBody: null,
    contentBodyJson: null,
    mediaItemId: MEDIA_ID,
    thumbnailUrl: null,
    isFree: true,
    isPurchasable: false,
    priceCents: null,
    isTierGated: false,
    isFollowerGated: false,
    isTeamOnly: false,
    includedInTierIds: [],
    categoryIds: [],
    tags: [],
    featured: false,
    ...fields,
  } as ContentWithRelations;
}

function render(
  content: ContentWithRelations = draft(),
  props: Record<string, unknown> = {}
) {
  component = mount(PublishStep, {
    target: document.body,
    props: {
      content,
      contentType: content.contentType,
      organizationId: 'org-1',
      orgSlug: 'alpha',
      authorName: 'Studio Alpha',
      ...props,
    } as never,
  });
  flushSync();
}

const text = () => document.body.textContent ?? '';
const publishButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.publish-foot button')][0];
function choose(kind: string) {
  const radio = document.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${kind}"]`
  );
  if (!radio) throw new Error(`no ${kind} option`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}
function typePrice(value: string) {
  const input = document.querySelector<HTMLInputElement>('input#price');
  if (!input) throw new Error('no price field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

beforeEach(() => {
  vi.useFakeTimers();
  media.item = {
    id: MEDIA_ID,
    status: 'ready',
    title: 'Winter Light',
    durationSeconds: 1660,
  };
  connect.ready = true;
  connect.failure = null;
  media.failure = null;
  categories.failure = null;
  moving.to = null;
  nav.goto.mockResolvedValue(undefined);
  remotes.saveContent.mockResolvedValue({});
  remotes.publishContent.mockResolvedValue({});
  remotes.checkContentSlug.mockResolvedValue({ available: true });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  watched.ids.length = 0;
  nav.guards.length = 0;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PublishStep · what is missing', () => {
  test('a free video with ready media lists nothing, and Publish puts it live', async () => {
    render();
    expect(text()).toContain(m.studio_publish_gaps_none());
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button()
    );
    expect(publishButton()?.disabled).toBe(false);

    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.publishContent).toHaveBeenCalledWith('c1');
    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
    expect(nav.goto).toHaveBeenCalledWith('/studio/content');
  });

  test('media on its way says how far it has got, is watched, and Publish waits', () => {
    media.item = {
      id: MEDIA_ID,
      status: 'transcoding',
      transcodingProgress: 64,
      title: 'Winter Light',
    };
    render();
    expect(text()).toContain(
      m.studio_publish_gap_preparing_pct({ type: 'video', pct: 64 })
    );
    expect(publishButton()?.disabled).toBe(true);
    expect(watched.ids).toEqual([MEDIA_ID]);
  });

  test('media gone (deleted, or not theirs) is listed, with the way back to writing', () => {
    media.item = null;
    render();
    expect(text()).toContain(
      m.studio_publish_gap_media_deleted({ type: 'video' })
    );
    const fix = [
      ...document.querySelectorAll<HTMLAnchorElement>('.publish-gap-fix'),
    ];
    expect(fix.map((link) => link.getAttribute('href'))).toEqual([
      '/studio/content/c1/edit',
    ]);
  });

  test('an article with nothing to read lists it; it has no media to wait for', () => {
    render(draft({ contentType: 'written', mediaItemId: null }));
    expect(text()).toContain(m.studio_publish_gap_body());
    expect(publishButton()?.disabled).toBe(true);
  });

  test('a cover that is a frame of a deleted video is listed', () => {
    render(
      draft({
        thumbnailUrl: 'https://cdn.test/frame.webp',
        thumbnailFrame: {
          mediaItemId: MEDIA_ID,
          title: 'Old cut',
          deletedAt: '2026-11-01T00:00:00Z',
        },
      })
    );
    expect(text()).toContain(m.studio_publish_gap_cover_deleted());
  });
});

describe('PublishStep · who can watch', () => {
  test('a price under £1 is listed; once set, the button names it and the choice saves', async () => {
    render();
    choose('paid');
    typePrice('0.50');
    expect(text()).toContain(m.studio_publish_gap_price({ price: '£1.00' }));
    expect(publishButton()?.disabled).toBe(true);

    typePrice('12');
    expect(text()).not.toContain(
      m.studio_publish_gap_price({ price: '£1.00' })
    );
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button_price({ price: '£12.00' })
    );

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: 'c1',
      patch: {
        isFree: false,
        isPurchasable: true,
        priceCents: 1200,
        isTierGated: false,
        isFollowerGated: false,
        isTeamOnly: false,
      },
    });
  });

  test('a piece that earns without payouts set up lists them, with the way there', () => {
    connect.ready = false;
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    expect(text()).toContain(m.studio_publish_gap_payouts());
    const fix = [
      ...document.querySelectorAll<HTMLAnchorElement>('.publish-gap-fix'),
    ];
    expect(fix.map((link) => link.getAttribute('href'))).toEqual([
      '/studio/monetisation',
    ]);
  });

  test('going back to free clears the price', async () => {
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    choose('free');
    expect(document.querySelector('input#price')).toBeNull();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).toHaveBeenLastCalledWith({
      id: 'c1',
      patch: expect.objectContaining({
        isFree: true,
        isPurchasable: false,
        priceCents: null,
      }),
    });
  });
});

describe('PublishStep · Publish', () => {
  test('saves what is on screen first, then publishes', async () => {
    render();
    choose('followers');
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.saveContent).toHaveBeenCalledTimes(1);
    expect(remotes.publishContent).toHaveBeenCalledTimes(1);
    expect(remotes.saveContent.mock.invocationCallOrder[0]).toBeLessThan(
      remotes.publishContent.mock.invocationCallOrder[0] ?? 0
    );
  });

  test('a refusal with a row is listed by its code, and focus goes to the list', async () => {
    remotes.publishContent.mockRejectedValueOnce({
      status: 403,
      body: {
        code: 'NOT_ON_ORG_TEAM',
        message: 'You are not on this organization’s team.',
      },
    });
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_gap_team());
    expect(nav.goto).not.toHaveBeenCalled();
    expect(document.activeElement?.classList.contains('publish-gaps')).toBe(
      true
    );
    // Still offered: the server judges again.
    expect(publishButton()?.disabled).toBe(false);
  });

  test('a refusal with no row says its own words', async () => {
    remotes.publishContent.mockRejectedValueOnce({
      status: 422,
      body: {
        code: 'BUSINESS_LOGIC_ERROR',
        message: 'Something only the server knows.',
      },
    });
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.publish-refusal')?.textContent).toBe(
      'Something only the server knows.'
    );
  });
});

describe('PublishStep · the bar and the card', () => {
  test('the bar goes back to writing, Write reads as done, and there is no Next', () => {
    render();
    const back = document.querySelector<HTMLAnchorElement>('.editor-back');
    expect(back?.getAttribute('href')).toBe('/studio/content/c1/edit');
    expect(back?.textContent).toContain(m.studio_editor_back_to_writing());
    expect(
      document.querySelector('.write-step[aria-current="step"]')?.textContent
    ).toContain(m.studio_editor_step_publish());
    expect(document.querySelector('.write-next')).toBeNull();
  });

  test('a video with no cover shows its poster on the card, and offers an image', () => {
    media.item = {
      id: MEDIA_ID,
      status: 'ready',
      title: 'Winter Light',
      thumbnailUrl: 'https://cdn.test/poster.webp',
    };
    render();
    expect(
      document
        .querySelector('[data-probe="card"]')
        ?.getAttribute('data-thumbnail')
    ).toBe('https://cdn.test/poster.webp');
    expect(text()).toContain(m.studio_editor_cover_add_video());
  });

  test('a video with a cover shows it, and offers its poster back', () => {
    media.item = {
      id: MEDIA_ID,
      status: 'ready',
      title: 'Winter Light',
      thumbnailUrl: 'https://cdn.test/poster.webp',
    };
    render(draft({ thumbnailUrl: 'https://cdn.test/cover.webp' }));
    expect(
      document
        .querySelector('[data-probe="card"]')
        ?.getAttribute('data-thumbnail')
    ).toBe('https://cdn.test/cover.webp');
    expect(text()).toContain(m.studio_editor_cover_use_poster());
    // The card is the picture: the line shows no image of its own.
    expect(document.querySelector('.cover-image')).toBeNull();
  });

  test('going back to the poster shows it on the card, and a deleted frame is no longer missing', async () => {
    remotes.deleteThumbnailCommand.mockResolvedValue(undefined);
    media.item = {
      id: MEDIA_ID,
      status: 'ready',
      title: 'Winter Light',
      thumbnailUrl: 'https://cdn.test/poster.webp',
    };
    render(
      draft({
        thumbnailUrl: 'https://cdn.test/frame.webp',
        thumbnailFrame: {
          mediaItemId: MEDIA_ID,
          title: 'Old cut',
          deletedAt: '2026-11-01T00:00:00Z',
        },
      })
    );
    expect(text()).toContain(m.studio_publish_gap_cover_deleted());

    const poster = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === m.studio_editor_cover_use_poster()
    );
    poster?.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(remotes.deleteThumbnailCommand).toHaveBeenCalledWith('c1');
    expect(
      document
        .querySelector('[data-probe="card"]')
        ?.getAttribute('data-thumbnail')
    ).toBe('https://cdn.test/poster.webp');
    expect(text()).not.toContain(m.studio_publish_gap_cover_deleted());
  });

  test('the card shows the price it is for sale at', () => {
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    expect(
      document.querySelector('[data-probe="card"]')?.getAttribute('data-price')
    ).toBe('GBP 1200');
  });
});

/** Open "Where it appears". */
function openFold() {
  document.querySelector<HTMLButtonElement>('.settings-fold')?.click();
  flushSync();
}
function typeSlug(value: string) {
  const input = document.querySelector<HTMLInputElement>('input#slug');
  if (!input) throw new Error('no slug field');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
const outage = { status: 503, body: { message: 'Service unavailable' } };

describe('PublishStep · a read it checks by fails', () => {
  test('the media, unread, is said and logged with Try again; its arrival status is not taken for now', () => {
    media.failure = outage;
    // As it arrived, the video was still being prepared.
    render(
      draft({ mediaItem: { id: MEDIA_ID, status: 'transcoding' } } as never)
    );
    const words = m.studio_publish_media_unread({ type: TYPE_WORD.video() });
    expect(text()).toContain(words);
    expect(text()).not.toContain(m.studio_publish_gaps_none());
    expect(text()).not.toContain(
      m.studio_publish_gap_preparing({ type: TYPE_WORD.video() })
    );
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.media_unread',
      expect.objectContaining({ mediaId: MEDIA_ID, status: 503 })
    );
    // The server still judges: Publish stays open.
    expect(publishButton()?.disabled).toBe(false);

    const retry = [...document.querySelectorAll('.publish-gap')]
      .find((row) => row.textContent?.includes(words))
      ?.querySelector('button');
    retry?.click();
    expect(media.refresh).toHaveBeenCalled();
  });

  test('a read that failed, and nothing else, is said in the live region', () => {
    media.failure = outage;
    render();
    expect(document.querySelector('.publish-status')?.textContent?.trim()).toBe(
      m.studio_publish_media_unread({ type: TYPE_WORD.video() })
    );
  });

  test('payouts, unread, are said and logged, never "nothing missing"', () => {
    connect.failure = outage;
    render();
    expect(text()).toContain(m.studio_publish_connect_unread());
    expect(text()).not.toContain(m.studio_publish_gaps_none());
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.connect_unread',
      expect.objectContaining({ status: 503 })
    );
    const retry = [...document.querySelectorAll('.publish-gap')]
      .find((row) =>
        row.textContent?.includes(m.studio_publish_connect_unread())
      )
      ?.querySelector('button');
    retry?.click();
    expect(connect.refresh).toHaveBeenCalled();
  });

  test("categories, unread, are said in the fold's summary and logged", () => {
    categories.failure = outage;
    render(draft({ categoryIds: ['cat-1'] } as never));
    expect(document.querySelector('.settings-summary')?.textContent).toContain(
      m.studio_publish_where_categories_unread()
    );
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.categories_unread',
      expect.objectContaining({ organizationId: 'org-1' })
    );
    openFold();
    expect(text()).toContain(m.studio_content_form_categories_failed());
  });
});

describe('PublishStep · the slug and the fold', () => {
  test('the fold is found by its heading', () => {
    render();
    const trigger = document.querySelector('.settings-fold');
    expect(trigger?.parentElement?.tagName).toBe('H2');
  });

  test('a slug typed in a bad shape stops Publish, and Fix it goes to it', () => {
    render();
    openFold();
    typeSlug('my spring course');
    expect(text()).toContain(m.studio_publish_gap_slug());
    expect(publishButton()?.disabled).toBe(true);

    const fix = [...document.querySelectorAll('.publish-gap')]
      .find((row) => row.textContent?.includes(m.studio_publish_gap_slug()))
      ?.querySelector('button');
    fix?.click();
    expect(document.activeElement?.id).toBe('slug');

    typeSlug('my-spring-course');
    expect(text()).not.toContain(m.studio_publish_gap_slug());
    expect(publishButton()?.disabled).toBe(false);
  });

  test('closing the fold over a bad slug drops it: the slug that stands is the last good one', async () => {
    render();
    openFold();
    typeSlug('my spring course');
    expect(publishButton()?.disabled).toBe(true);
    openFold(); // Its trigger closes it again.
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('input#slug')).toBeNull();
    expect(publishButton()?.disabled).toBe(false);
  });

  test('a category being created holds Publish until it is in', async () => {
    const made = Promise.withResolvers<unknown>();
    categories.create.mockReturnValueOnce(made.promise);
    render();
    openFold();
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="New topic name"]'
    );
    if (!name) throw new Error('no topic field');
    name.value = 'Breathwork';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    flushSync();
    expect(publishButton()?.disabled).toBe(true);
    expect(text()).toContain(m.studio_publish_wait_category());

    made.resolve({
      success: true,
      category: { id: 'cat-new', name: 'Breathwork' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(publishButton()?.disabled).toBe(false);
  });
});

describe('PublishStep · creating a category', () => {
  function addTopic(name: string) {
    const field = document.querySelector<HTMLInputElement>(
      'input[aria-label="New topic name"]'
    );
    if (!field) throw new Error('no topic field');
    field.value = name;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
    flushSync();
  }

  test('one that fails is logged, never with the name typed', async () => {
    categories.create.mockRejectedValueOnce(outage);
    render();
    openFold();
    addTopic('Private retreat notes');
    await vi.advanceTimersByTimeAsync(0);
    expect(told.error).toHaveBeenCalledWith(
      'studio_content.category_create_failed',
      expect.objectContaining({ organizationId: 'org-1', status: 503 })
    );
    expect(JSON.stringify(told.error.mock.calls)).not.toContain(
      'Private retreat'
    );
  });

  test('one refused is logged, never with the name typed', async () => {
    categories.create.mockResolvedValueOnce({ success: false, error: 'No.' });
    render();
    openFold();
    addTopic('Private retreat notes');
    await vi.advanceTimersByTimeAsync(0);
    expect(told.warn).toHaveBeenCalledWith(
      'studio_content.category_create_refused',
      {
        organizationId: 'org-1',
      }
    );
  });
});

describe('PublishStep · what it tells, and when', () => {
  test('one live region is always there: how much is left, then the all-clear', () => {
    media.item = { id: MEDIA_ID, status: 'transcoding' };
    render();
    const status = document.querySelector('[role="status"].publish-status');
    expect(status?.textContent?.trim()).toBe(
      m.studio_publish_gaps_left({ count: 1 })
    );
    expect(status?.classList.contains('sr-only')).toBe(true);
  });

  test('the all-clear is said in the live region, seen', () => {
    render();
    const status = document.querySelector('[role="status"].publish-status');
    expect(status?.textContent?.trim()).toBe(m.studio_publish_gaps_none());
    expect(status?.classList.contains('sr-only')).toBe(false);
  });

  test('a refusal goes with a change here that may put it right', async () => {
    remotes.publishContent.mockRejectedValueOnce({
      status: 422,
      body: { code: 'CREATOR_CONNECT_REQUIRED', message: 'Set up payouts.' },
    });
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_gap_payouts());

    choose('followers');
    expect(text()).not.toContain(m.studio_publish_gap_payouts());
  });

  test('a refusal no change here can put right stays, and the all-clear is not said', async () => {
    remotes.publishContent.mockRejectedValueOnce({
      status: 403,
      body: { code: 'NOT_ON_ORG_TEAM', message: 'Not on the team.' },
    });
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    choose('followers');
    expect(text()).toContain(m.studio_publish_gap_team());
    expect(
      document.querySelector('.publish-status')?.textContent?.trim()
    ).not.toBe(m.studio_publish_gaps_none());
  });

  test('a save still out says so, and the words go once it lands', async () => {
    const saved = Promise.withResolvers<unknown>();
    remotes.saveContent.mockReturnValueOnce(saved.promise);
    render();
    choose('followers');
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      document.querySelector('.publish-refusal')?.textContent?.trim()
    ).toBe(m.studio_editor_publish_save_slow());
    expect(remotes.publishContent).not.toHaveBeenCalled();

    saved.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    // Saved, but never published: it says so, and to press Publish again.
    expect(
      document.querySelector('.publish-refusal')?.textContent?.trim()
    ).toBe(m.studio_publish_saved_press_again());
  });

  test("a save refused on Publish says the save's own words, not that it is still saving", async () => {
    remotes.saveContent.mockRejectedValueOnce({
      status: 409,
      body: {
        code: 'CONFLICT',
        message: 'Content with this slug already exists',
      },
    });
    render();
    choose('followers');
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      document.querySelector('.publish-refusal')?.textContent?.trim()
    ).toBe('Content with this slug already exists');
    expect(remotes.publishContent).not.toHaveBeenCalled();
  });

  test('a refusal for a deleted frame goes once a cover is chosen here', async () => {
    remotes.deleteThumbnailCommand.mockResolvedValue(undefined);
    media.item = {
      id: MEDIA_ID,
      status: 'ready',
      title: 'Winter Light',
      thumbnailUrl: 'https://cdn.test/poster.webp',
    };
    remotes.publishContent.mockRejectedValueOnce({
      status: 422,
      body: {
        code: 'THUMBNAIL_MEDIA_DELETED',
        message: 'The cover is a frame of a deleted video.',
      },
    });
    // As it arrived, the frame's video was still there.
    render(draft({ thumbnailUrl: 'https://cdn.test/frame.webp' }));
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_gap_cover_deleted());

    [...document.querySelectorAll('button')]
      .find(
        (node) =>
          node.textContent?.trim() === m.studio_editor_cover_use_poster()
      )
      ?.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
    expect(text()).not.toContain(m.studio_publish_gap_cover_deleted());
  });

  // The bar's error gives way at once (the session arms the autosave
  // again), so the step's line is the one that stays.
  test('a save that fails during Publish is announced once', async () => {
    remotes.saveContent.mockRejectedValueOnce(outage);
    render();
    choose('followers');
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const alerts = [...document.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.classList.contains('publish-refusal')).toBe(true);
  });
});

describe('PublishStep · leaving', () => {
  test('a move asked for while Publish is out waits, then goes there once it is live', async () => {
    const sent = Promise.withResolvers<unknown>();
    remotes.publishContent.mockReturnValueOnce(sent.promise);
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);

    const to = new URL('https://alpha.lvh.me/studio/media');
    const cancel = vi.fn();
    for (const guard of nav.guards)
      guard({ willUnload: false, to: { url: to }, cancel });
    expect(cancel).toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();

    sent.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.goto).toHaveBeenCalledTimes(1);
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  test('while Publish is out, the whole step is held still, its way back included', async () => {
    const sent = Promise.withResolvers<unknown>();
    remotes.publishContent.mockReturnValueOnce(sent.promise);
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    // jsdom has no `inert`: Svelte sets the property.
    const heldParts = [
      ...document.querySelectorAll<HTMLElement>('.publish-held'),
    ];
    expect(heldParts).toHaveLength(2);
    expect(heldParts.every((part) => part.inert)).toBe(true);
    // The foot is not held: it says what is happening, and has focus.
    const progress = document.querySelector<HTMLElement>('.publish-progress');
    expect(progress?.closest('.publish-held')).toBeNull();
    expect(progress?.textContent?.trim()).toBe(m.studio_publish_publishing());
    expect(document.activeElement).toBe(progress);

    sent.resolve({});
    await vi.advanceTimersByTimeAsync(0);
    // Live: still held while the next page loads.
    expect(heldParts.every((part) => part.inert)).toBe(true);
    expect(progress?.textContent?.trim()).toBe(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
  });

  test('a move kit already has under way: Publish waits', async () => {
    moving.to = { url: new URL('https://alpha.lvh.me/studio/content/c1/edit') };
    render();
    expect(publishButton()?.disabled).toBe(true);
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.publishContent).not.toHaveBeenCalled();
  });

  test('a move asked for while Publish is out is said to wait', async () => {
    const sent = Promise.withResolvers<unknown>();
    remotes.publishContent.mockReturnValueOnce(sent.promise);
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    for (const guard of nav.guards) {
      guard({
        willUnload: false,
        to: { url: new URL('https://alpha.lvh.me/studio/media') },
        cancel: vi.fn(),
      });
    }
    flushSync();
    expect(
      document.querySelector('.publish-progress')?.textContent?.trim()
    ).toBe(m.studio_publish_publishing_then_move());
    sent.resolve({});
    await vi.advanceTimersByTimeAsync(0);
  });

  test('a move that fails after it is live still lands, and is logged', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    nav.goto.mockRejectedValueOnce(new Error('navigation aborted'));
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(told.warn).toHaveBeenCalledWith(
      'studio_publish.leave_failed',
      expect.objectContaining({ contentId: 'c1' })
    );
    expect(assign).toHaveBeenCalledWith('/studio/content');
  });
});
