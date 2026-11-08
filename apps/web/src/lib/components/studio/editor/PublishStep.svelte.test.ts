/**
 * The editor's Publish step (Codex-a6ofh.2.4): only what is missing is
 * listed, the button names what it does, a choice here saves as it goes,
 * and Publish saves what is on screen, then publishes. A refusal the server
 * sends anyway is listed by its code, or said in its own words.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { uploadQueue } from '$lib/client/upload-queue.svelte';
import {
  ACTIVE_ACCOUNT,
  land,
  myConnectSlot,
  reset as resetSubscriptionRemote,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import type { ContentWithRelations } from '$lib/types';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { REREAD_DELAYS_MS } from './publish-schedule.svelte';

const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

const remotes = vi.hoisted(() => ({
  saveContent: vi.fn(),
  createContentDraft: vi.fn(),
  publishContent: vi.fn(),
  publishContentWhenReady: vi.fn(),
  cancelPublishRequest: vi.fn(),
  readPublishState: vi.fn(),
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
/**
 * The live status client's items: reactive, as the real one's are, so a test
 * can move the media on (it went ready, it failed) and the step follows.
 */
const live = vi.hoisted(() => ({
  items: new Map<
    string,
    {
      lifecycle?: string;
      progress?: number | null;
      errorCode?: string | null;
      attemptsLeft?: number;
      upload?: { here: boolean; pct: number | null } | null;
    }
  >(),
}));
vi.mock('$lib/client/media-status.svelte', async () => {
  const { SvelteMap } = await import('svelte/reactivity');
  live.items = new SvelteMap();
  return {
    mediaStatus: {
      items: live.items,
      connection: 'idle',
      register: (subscriber: { listed: () => Map<string, string> }) => {
        watched.ids.push(...subscriber.listed().keys());
        return () => {};
      },
      resume: () => {},
    },
  };
});
const retry = vi.hoisted(() => ({
  media: vi.fn(async (_mediaId: string) => {}),
}));
vi.mock('../media-library/media-retry', () => ({
  retryMediaTranscoding: (mediaId: string) => retry.media(mediaId),
}));

const connect = vi.hoisted(() => ({
  ready: true,
  /** Not answered yet: no value, no failure. */
  loading: false,
  failure: null as unknown,
  refresh: vi.fn(async () => {}),
}));
vi.mock('$lib/remote/subscription.remote', async () => {
  const kit = await import(
    '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte'
  );
  return {
    // A kit-shaped slot set from `connect` when it is read, so a Try again
    // can land its answer and the step follows. The whole account shape
    // `deriveConnectState` reads: without `isConnected` every read was "not
    // set up" (Codex-a6ofh.2.6).
    getMyConnectStatus: () => {
      const slot = kit.myConnectSlot();
      slot.refresh = connect.refresh;
      if (connect.loading) return slot;
      if (connect.failure) kit.fail(slot, connect.failure);
      else
        kit.land(slot, {
          ...kit.ACTIVE_ACCOUNT,
          chargesEnabled: connect.ready,
          payoutsEnabled: connect.ready,
        });
      return slot;
    },
    listTiers: () => ({
      current: [],
      error: undefined,
      refresh: async () => {},
    }),
  };
});
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
  // A choice the creator cannot make is never made for them (a disabled
  // option hid the payouts mock's missing `isConnected`, Codex-a6ofh.2.6).
  if (radio.disabled) throw new Error(`${kind} is not offered`);
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
  resetSubscriptionRemote();
  connect.ready = true;
  connect.loading = false;
  connect.failure = null;
  connect.refresh.mockReset();
  connect.refresh.mockResolvedValue(undefined);
  media.failure = null;
  categories.failure = null;
  moving.to = null;
  nav.goto.mockResolvedValue(undefined);
  remotes.saveContent.mockResolvedValue({});
  remotes.publishContent.mockResolvedValue({});
  remotes.publishContentWhenReady.mockResolvedValue({});
  remotes.checkContentSlug.mockResolvedValue({ available: true });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  watched.ids.length = 0;
  live.items.clear();
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

  // Publish when ready (Codex-a6ofh.2.9): the wait no longer blocks it.
  test('media on its way says how far it has got, is watched, and can be published when ready', () => {
    media.item = {
      id: MEDIA_ID,
      status: 'transcoding',
      transcodingProgress: 64,
      title: 'Winter Light',
      createdAt: new Date(),
    };
    render();
    expect(text()).toContain(
      m.studio_publish_gap_preparing_pct_when_ready({ type: 'video', pct: 64 })
    );
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button_when_ready()
    );
    expect(publishButton()?.disabled).toBe(false);
    expect(watched.ids).toEqual([MEDIA_ID]);
  });

  test('a failed file is not on its way: Publish waits, and the way back is listed', () => {
    media.item = {
      id: MEDIA_ID,
      status: 'failed',
      title: 'Winter Light',
      createdAt: new Date(),
    };
    render();
    expect(text()).toContain(
      m.studio_publish_gap_media_failed({ type: 'video' })
    );
    expect(publishButton()?.disabled).toBe(true);
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
    expect(
      document.querySelector<HTMLInputElement>('input[value="paid"]')?.disabled
    ).toBe(true);
    expect(publishButton()?.disabled).toBe(true);
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
    const back = document.querySelector<HTMLAnchorElement>('.editor-bar-link');
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
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
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

  // The server's gate does not look for a free piece (`assertCreatorCanBePaid`).
  test('a free piece does not wait on payouts never read', () => {
    connect.failure = outage;
    render();
    expect(text()).not.toContain(m.studio_publish_connect_unread());
    expect(text()).toContain(m.studio_publish_gaps_none());
  });

  // The status line leads with the count: the retry is said on its own line.
  test("payouts' Try again is heard even with something else left", () => {
    connect.failure = outage;
    connect.refresh.mockImplementationOnce(() => new Promise<void>(() => {}));
    render(draft({ isFree: false, isPurchasable: true, priceCents: 50 }));
    [...document.querySelectorAll('.publish-gap--unread')][0]
      ?.querySelector('button')
      ?.click();
    flushSync();

    const heard = [...document.querySelectorAll('[role="status"]')].map(
      (line) => line.textContent?.trim()
    );
    expect(heard).toContain(m.studio_publish_connect_retrying());
    expect(
      document.querySelector('.publish-status')?.textContent?.trim()
    ).not.toBe(m.studio_publish_connect_retrying());
  });

  test('a piece that earns, with payouts set up, is ready', () => {
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    expect(text()).toContain(m.studio_publish_gaps_none());
    expect(text()).not.toContain(m.studio_publish_gap_payouts());
    expect(
      document.querySelector<HTMLInputElement>('input[value="paid"]')?.disabled
    ).toBe(false);
    expect(publishButton()?.disabled).toBe(false);
  });

  // The list says "Checking…" meanwhile; the checklist never says ready first.
  test('payouts not read yet are said on screen, not only heard', () => {
    connect.loading = true;
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    const rows = [...document.querySelectorAll('.publish-gap--unread')].map(
      (row) => row.textContent?.trim()
    );
    expect(rows).toEqual([m.studio_publish_connect_checking()]);
  });

  test('a piece that earns is never announced ready before payouts are read', () => {
    connect.loading = true;
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    expect(text()).not.toContain(m.studio_publish_gaps_none());
    expect(document.querySelector('.publish-status')?.textContent?.trim()).toBe(
      m.studio_publish_connect_checking()
    );
  });

  test('a free piece does not wait for payouts to be read', () => {
    connect.loading = true;
    render();
    expect(text()).toContain(m.studio_publish_gaps_none());
  });

  test("payouts' Try again says it is trying, then that it failed again", async () => {
    connect.failure = outage;
    let settle: () => void = () => {};
    connect.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    const retry = () =>
      [...document.querySelectorAll('.publish-gap')]
        .find((row) => row.classList.contains('publish-gap--unread'))
        ?.querySelector('button');

    retry()?.click();
    flushSync();
    expect(text()).toContain(m.studio_publish_connect_retrying());
    expect(retry()?.getAttribute('aria-busy')).toBe('true');

    settle();
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(text()).toContain(m.studio_publish_connect_unread_again());
  });

  // The pressed row goes with what it read: focus goes to the checklist,
  // whose status says what is left, unless the creator moved it meanwhile.
  const unreadRetry = () =>
    document
      .querySelector('.publish-gap--unread')
      ?.querySelector<HTMLButtonElement>('button');
  // `tick()` waits a frame in async mode: the fake clock has to move.
  const settled = async () => {
    for (let turn = 0; turn < 5; turn++) await vi.advanceTimersByTimeAsync(20);
  };

  test("payouts' Try again that reads them puts focus on the checklist", async () => {
    connect.failure = outage;
    connect.refresh.mockImplementationOnce(async () => {
      land(myConnectSlot(), ACTIVE_ACCOUNT);
    });
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    unreadRetry()?.focus();
    unreadRetry()?.click();
    await settled();

    expect(text()).toContain(m.studio_publish_gaps_none());
    expect(document.activeElement).toBe(
      document.querySelector('.publish-gaps')
    );
  });

  test("payouts' Try again leaves focus the creator moved meanwhile", async () => {
    connect.failure = outage;
    const field = () =>
      document.querySelector<HTMLInputElement>('input[value="free"]');
    connect.refresh.mockImplementationOnce(async () => {
      field()?.focus();
      land(myConnectSlot(), ACTIVE_ACCOUNT);
    });
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    unreadRetry()?.focus();
    unreadRetry()?.click();
    await settled();

    expect(text()).toContain(m.studio_publish_gaps_none());
    expect(document.activeElement).toBe(field());
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
    // Failed, so not on its way: a gap Publish when ready does not wait out.
    media.item = { id: MEDIA_ID, status: 'failed' };
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
    // The bar, the head, and the settings with the checklist: the banner of a
    // schedule sits between the last two, never held (Codex-a6ofh.2.9).
    expect(heldParts).toHaveLength(3);
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

describe('PublishStep · publish when ready (Codex-a6ofh.2.9)', () => {
  const ASKED_AT = new Date('2026-11-08T10:00:00Z');
  const scheduled = (fields: Partial<ContentWithRelations> = {}) =>
    draft({
      publishRequestedAt: ASKED_AT,
      publishBlockedReason: null,
      ...fields,
    });
  const wentLive = () => ({
    status: 'published',
    publishedAt: new Date(),
    publishRequestedAt: null,
    publishBlockedReason: null,
    slug: 'runes-explained',
  });
  const gapsFocused = () =>
    document.activeElement?.classList.contains('publish-gaps') === true;
  function onItsWay() {
    media.item = {
      id: MEDIA_ID,
      status: 'transcoding',
      transcodingProgress: 64,
      title: 'Winter Light',
      createdAt: new Date(),
    };
  }
  /** The media moves on, as the live status client hears it. */
  function mediaNow(
    lifecycle: string,
    fields: {
      errorCode?: string | null;
      attemptsLeft?: number;
      progress?: number | null;
    } = {}
  ) {
    live.items.set(MEDIA_ID, {
      lifecycle,
      progress: null,
      errorCode: null,
      attemptsLeft: 2,
      ...fields,
    });
    flushSync();
  }
  const [FIRST_READ_MS, SECOND_READ_MS] = REREAD_DELAYS_MS;
  const ALL_READS_MS = REREAD_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);
  const banner = () => document.querySelector<HTMLElement>('.publish-schedule');
  const bannerText = () => banner()?.textContent ?? '';
  /** What the step's quiet live regions hold, the schedule's one among them. */
  const notice = () =>
    [...document.querySelectorAll('.sr-only[role="status"]')]
      .map((el) => el.textContent ?? '')
      .join(' ');
  const checkAgain = () =>
    [...(banner()?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes(m.studio_publish_scheduled_check_again())
    );
  const cancelButton = () =>
    banner()?.querySelector<HTMLButtonElement>(
      `button[aria-label="${m.studio_publish_scheduled_cancel_label()}"]`
    );
  const lostToGoLive = {
    status: 409,
    body: { code: 'CONTENT_ALREADY_LIVE', message: 'Already live.' },
  };

  test('only the media in the way: Publish when ready schedules it, and the step says so', async () => {
    onItsWay();
    remotes.publishContentWhenReady.mockResolvedValue(scheduled());
    render();
    expect(text()).toContain(m.studio_publish_gaps_when_ready());

    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.publishContentWhenReady).toHaveBeenCalledWith('c1');
    expect(remotes.publishContent).not.toHaveBeenCalled();
    expect(bannerText()).toContain(m.studio_publish_scheduled_heading());
    expect(bannerText()).toContain(
      m.studio_publish_scheduled_body_pct({ type: 'video', pct: 64 })
    );
    expect(document.activeElement).toBe(banner());
    expect(text()).toContain(m.studio_publish_scheduled_close());
    expect(publishButton()?.textContent?.trim()).toBe(m.studio_publish_done());
    // Still a draft: not "is live", and the creator is not sent away.
    expect(toasts.success).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
  });

  test('a scheduled draft keeps saving its edits, which go live with it', async () => {
    onItsWay();
    remotes.publishContentWhenReady.mockResolvedValue(scheduled());
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    remotes.saveContent.mockClear();

    choose('followers');
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).toHaveBeenCalled();
  });

  test('another rule still missing blocks it: the button says what it does once that is set', () => {
    onItsWay();
    render(draft({ isFree: false, isPurchasable: true, priceCents: null }));
    expect(publishButton()?.disabled).toBe(true);
    // As the media row does: it publishes when ready once the rest is set.
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button_when_ready()
    );
    expect(text()).toContain(
      m.studio_publish_gap_preparing_pct_when_ready({ type: 'video', pct: 64 })
    );
    expect(text()).not.toContain(m.studio_publish_gaps_when_ready());
  });

  test('arriving scheduled: the banner says it, and Cancel makes it an ordinary draft', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockResolvedValue(draft());
    render(scheduled());
    expect(bannerText()).toContain(m.studio_publish_scheduled_heading());
    // The wait is the banner's to say: nothing else to list.
    expect(text()).not.toContain(
      m.studio_publish_gap_preparing_pct_when_ready({ type: 'video', pct: 64 })
    );

    const cancel = banner()?.querySelector('button');
    expect(cancel?.getAttribute('aria-label')).toBe(
      m.studio_publish_scheduled_cancel_label()
    );
    cancel?.focus();
    cancel?.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(remotes.cancelPublishRequest).toHaveBeenCalledWith('c1');
    expect(banner()).toBeNull();
    expect(text()).toContain(m.studio_publish_scheduled_cancelled());
    // Its Cancel went with the banner: focus goes to the checklist.
    expect(gapsFocused()).toBe(true);
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button_when_ready()
    );
  });

  test('a cancel that lost to the go-live shows it live at once, and reads the rest', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockRejectedValue({
      status: 409,
      body: { code: 'CONTENT_ALREADY_LIVE', message: 'Already live.' },
    });
    // The read never answers: the refusal alone says it is live.
    remotes.readPublishState.mockReturnValue(new Promise(() => {}));
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.readPublishState).toHaveBeenCalledWith('c1');
    expect(bannerText()).toContain(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
    expect(text()).not.toContain(m.studio_publish_scheduled_cancel_failed());
    // Its saved address is not known yet, and a route finds a piece by its
    // slug only: no View until the read brings it, never a link by id.
    expect(banner()?.querySelector('a')).toBeNull();
  });

  test('a cancel lost to the go-live whose read fails says so, and Check again brings View', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockRejectedValue({
      status: 409,
      body: { code: 'CONTENT_ALREADY_LIVE', message: 'Already live.' },
    });
    remotes.readPublishState.mockRejectedValueOnce({ status: 503 });
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).toContain(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
    expect(text()).toContain(m.studio_publish_live_unread());
    expect(banner()?.querySelector('a')).toBeNull();
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.schedule_unread',
      expect.objectContaining({ contentId: 'c1' })
    );

    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState.mockReturnValueOnce(check.promise);
    expect(checkAgain()).toBeDefined();
    checkAgain()?.click();
    await vi.advanceTimersByTimeAsync(0);
    // Pressed, it stays while it reads: busy, not gone from under focus.
    expect(checkAgain()).toBeDefined();
    check.resolve(wentLive());
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/content/runes-explained'
    );
    expect(text()).not.toContain(m.studio_publish_live_unread());
    expect(checkAgain()).toBeUndefined();
  });

  test('a cancel lost to a go-live a read already brought keeps View, and reads no more', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(wentLive());
    const sent = Promise.withResolvers<unknown>();
    remotes.cancelPublishRequest.mockReturnValueOnce(sent.promise);
    render(scheduled());
    mediaNow('ready');
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    const view = () => banner()?.querySelector('a')?.getAttribute('href');
    expect(view()).toBe('/content/runes-explained');
    sent.reject(lostToGoLive);
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toBe('/content/runes-explained');
    expect(remotes.readPublishState).toHaveBeenCalledTimes(1);
  });

  test('a Check again that fails after a newer answer landed says nothing of it', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState
      .mockReturnValueOnce(check.promise)
      .mockResolvedValueOnce(wentLive());
    remotes.cancelPublishRequest.mockRejectedValue(lostToGoLive);
    checkAgain()?.click();
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const view = () => banner()?.querySelector('a')?.getAttribute('href');
    expect(view()).toBe('/content/runes-explained');
    check.reject({ status: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).not.toContain(m.studio_publish_live_unread());
    expect(text()).not.toContain(m.studio_publish_scheduled_unread());
    expect(view()).toBe('/content/runes-explained');
  });

  test('an older read that lands live after a lost cancel brings View, whatever failed meanwhile', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState
      .mockReturnValueOnce(check.promise)
      .mockRejectedValueOnce({ status: 503 });
    remotes.cancelPublishRequest.mockRejectedValue(lostToGoLive);
    checkAgain()?.click();
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    // The read after the refusal failed, but the check sent before it is
    // still out: live, no View yet, and its Check again busy, saying
    // nothing until that check settles.
    expect(bannerText()).toContain(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.schedule_unread',
      expect.objectContaining({ contentId: 'c1' })
    );
    expect(banner()?.querySelector('a')).toBeNull();
    expect(checkAgain()?.getAttribute('aria-busy')).toBe('true');
    expect(text()).not.toContain(m.studio_publish_live_unread());
    // That check answers live, with its address.
    check.resolve(wentLive());
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/content/runes-explained'
    );
    expect(text()).not.toContain(m.studio_publish_live_unread());
  });

  test('after a lost cancel, the newer read stands over an older one that filled in the link', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const check = Promise.withResolvers<unknown>();
    const after = Promise.withResolvers<unknown>();
    remotes.readPublishState
      .mockReturnValueOnce(check.promise)
      .mockReturnValueOnce(after.promise);
    remotes.cancelPublishRequest.mockRejectedValue(lostToGoLive);
    checkAgain()?.click();
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    const view = () => banner()?.querySelector('a')?.getAttribute('href');
    // The older check lands first: it fills in the link.
    check.resolve(wentLive());
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toBe('/content/runes-explained');
    // The read sent after the refusal is newer: it stands.
    after.resolve({ ...wentLive(), slug: 'runes-renamed' });
    await vi.advanceTimersByTimeAsync(0);
    expect(view()).toBe('/content/runes-renamed');
  });

  test('after a lost cancel, an older read that brought the link leaves a failed newer one unsaid', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const check = Promise.withResolvers<unknown>();
    const after = Promise.withResolvers<unknown>();
    remotes.readPublishState
      .mockReturnValueOnce(check.promise)
      .mockReturnValueOnce(after.promise);
    remotes.cancelPublishRequest.mockRejectedValue(lostToGoLive);
    checkAgain()?.click();
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    check.resolve(wentLive());
    await vi.advanceTimersByTimeAsync(0);
    after.reject({ status: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/content/runes-explained'
    );
    expect(text()).not.toContain(m.studio_publish_live_unread());
    // Unsaid, as nothing waits on it, but still recorded.
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.schedule_unread',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('a Check again that fails says nothing once an older read brought the link', async () => {
    onItsWay();
    const loopRead = Promise.withResolvers<unknown>();
    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState
      .mockReturnValueOnce(loopRead.promise)
      .mockRejectedValueOnce({ status: 503 })
      .mockReturnValueOnce(check.promise);
    remotes.cancelPublishRequest.mockRejectedValue(lostToGoLive);
    render(scheduled());
    mediaNow('ready');
    // The first read after the media settles goes out, and stays out.
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    // Lost to the go-live, and the read for its link failed: said.
    expect(text()).toContain(m.studio_publish_live_unread());
    checkAgain()?.click();
    await vi.advanceTimersByTimeAsync(0);
    // The older read lands live, with its link.
    loopRead.resolve(wentLive());
    await vi.advanceTimersByTimeAsync(0);
    const view = () => banner()?.querySelector('a')?.getAttribute('href');
    expect(view()).toBe('/content/runes-explained');
    check.reject({ status: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).not.toContain(m.studio_publish_live_unread());
    expect(view()).toBe('/content/runes-explained');
  });

  test('…and when that older check fails too, the link that could not load is said', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState
      .mockReturnValueOnce(check.promise)
      .mockRejectedValueOnce({ status: 503 });
    remotes.cancelPublishRequest.mockRejectedValue(lostToGoLive);
    checkAgain()?.click();
    cancelButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    check.reject({ status: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_live_unread());
    expect(checkAgain()).toBeDefined();
    expect(banner()?.querySelector('a')).toBeNull();
  });

  test('Check again after reads that answered keeps "in a moment" while it reads', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const settling = m.studio_publish_scheduled_settling({ type: 'video' });
    expect(bannerText()).toContain(settling);
    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState.mockReturnValueOnce(check.promise);
    checkAgain()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).toContain(settling);
    check.resolve(scheduled());
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).toContain(settling);
    expect(text()).toContain(m.studio_publish_scheduled_still_waiting());
  });

  test('a cancel that fails says so, and it stays scheduled', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockRejectedValue({ status: 503 });
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).toContain(m.studio_publish_scheduled_heading());
    expect(text()).toContain(m.studio_publish_scheduled_cancel_failed());
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.cancel_failed',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('the media goes ready: read again until it is live, then View and Done', async () => {
    onItsWay();
    remotes.readPublishState
      .mockResolvedValueOnce(scheduled())
      .mockResolvedValueOnce(wentLive());
    render(scheduled());
    mediaNow('ready');

    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(1);
    expect(bannerText()).toContain(m.studio_publish_scheduled_heading());
    await vi.advanceTimersByTimeAsync(SECOND_READ_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(2);
    expect(bannerText()).toContain(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/content/runes-explained'
    );
    // Live: no more reads.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(2);

    publishButton()?.click();
    expect(publishButton()?.textContent?.trim()).toBe(m.studio_publish_done());
    expect(nav.goto).toHaveBeenCalledWith('/studio/content');
  });

  test('ready but not seen live after three reads: Check again, and no reads of its own after', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');

    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(3);
    expect(bannerText()).toContain(
      m.studio_publish_scheduled_settling({ type: 'video' })
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(3);

    remotes.readPublishState.mockResolvedValue(wentLive());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(4);
    expect(bannerText()).toContain(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
  });

  test('a check that cannot read says so, and offers Check again still', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);

    remotes.readPublishState.mockRejectedValue({ status: 503 });
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_unread());
    expect(bannerText()).toContain(m.studio_publish_scheduled_check_again());
  });

  test('the media failing while scheduled offers Try again, and the schedule carries on', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('failed');
    expect(bannerText()).toContain(
      m.studio_publish_scheduled_media_failed({ type: 'video' })
    );
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/studio/content/c1/edit'
    );

    media.refresh.mockClear();
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(retry.media).toHaveBeenCalledWith(MEDIA_ID);
    // Its read still says failed, so nothing watches it: it is read again.
    expect(media.refresh).toHaveBeenCalled();
    expect(remotes.cancelPublishRequest).not.toHaveBeenCalled();
    // Cancel is still there, as it is in every scheduled state.
    expect(
      banner()?.querySelector(
        `button[aria-label="${m.studio_publish_scheduled_cancel_label()}"]`
      )
    ).not.toBeNull();
  });

  test('a failure no Try again can cure: no Try again, only another file, and it reads for the outcome', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(
      draft({ publishBlockedReason: 'MEDIA_FAILED' })
    );
    render(scheduled());
    mediaNow('failed', { errorCode: 'UPLOAD_INCOMPLETE' });
    expect(bannerText()).toContain(
      m.studio_publish_blocked_media_failed({ type: 'video' })
    );
    expect(bannerText()).not.toContain(m.common_try_again());
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/studio/content/c1/edit'
    );

    // The server clears the schedule: the read sees it didn't go live.
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(1);
    expect(bannerText()).toContain(m.studio_publish_blocked());
  });

  test('a failure a Try again can cure is not read for: the server keeps the schedule', async () => {
    onItsWay();
    render(scheduled());
    mediaNow('failed');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS * 2);
    expect(remotes.readPublishState).not.toHaveBeenCalled();
  });

  test('the reads start once: a media read that changes nothing does not start them again', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS - 500);
    // The watcher hears the same "ready" again, as a new object.
    mediaNow('ready', { progress: 100 });
    await vi.advanceTimersByTimeAsync(500);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(3);
  });

  test('Check again goes once the media is on its way again, and the reads start over when it settles', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(bannerText()).toContain(m.studio_publish_scheduled_check_again());

    mediaNow('transcoding');
    expect(bannerText()).not.toContain(
      m.studio_publish_scheduled_check_again()
    );
    expect(bannerText()).toContain(m.studio_publish_scheduled_heading());

    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(4);
    expect(bannerText()).not.toContain(
      m.studio_publish_scheduled_check_again()
    );
  });

  test('a piece for sale says its price on Publish when ready, as the mockup does', () => {
    onItsWay();
    render(draft({ isFree: false, isPurchasable: true, priceCents: 1200 }));
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button_when_ready_price({ price: '£12.00' })
    );
  });

  test('gone while scheduled: never "when it is ready", only another file or Cancel', async () => {
    media.item = null;
    render(scheduled());
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).toContain(
      m.studio_publish_gap_media_deleted({ type: 'video' })
    );
    expect(bannerText()).not.toContain(m.studio_publish_scheduled_heading());
    expect(
      banner()?.querySelector(
        `button[aria-label="${m.studio_publish_scheduled_cancel_label()}"]`
      )
    ).not.toBeNull();
  });

  test('reads that never answer say so, not "it should be live in a moment" alone', async () => {
    onItsWay();
    remotes.readPublishState.mockRejectedValue({ status: 503 });
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(remotes.readPublishState).toHaveBeenCalledTimes(3);
    expect(text()).toContain(m.studio_publish_scheduled_unread());
    // One voice, and no claim it cannot back: not "live in a moment".
    const settling = m.studio_publish_scheduled_settling({ type: 'video' });
    expect(notice()).not.toContain(settling);
    expect(bannerText()).not.toContain(settling);
    expect(bannerText()).toContain(
      m.studio_publish_scheduled_ready({ type: 'video' })
    );
    // Checking again, it still claims nothing it cannot back.
    const check = Promise.withResolvers<unknown>();
    remotes.readPublishState.mockReturnValueOnce(check.promise);
    checkAgain()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).not.toContain(settling);
    check.reject({ status: 503 });
    await vi.advanceTimersByTimeAsync(0);
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.schedule_unread',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('Check again that finds it still waiting says so, and Cancel is offered', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(text()).not.toContain(m.studio_publish_scheduled_still_waiting());

    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_still_waiting());
    expect(
      banner()?.querySelector(
        `button[aria-label="${m.studio_publish_scheduled_cancel_label()}"]`
      )
    ).not.toBeNull();
  });

  test('Check again that sees it live moves focus to the banner, and View uses the saved address', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);

    remotes.readPublishState.mockResolvedValue({
      ...wentLive(),
      slug: 'saved-slug',
    });
    const check = banner()?.querySelector('button');
    check?.focus();
    check?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(banner());
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/content/saved-slug'
    );
  });

  test('a cancel the server refuses says so without "try again", and reads where it stands', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockRejectedValue({
      status: 403,
      body: { code: 'FORBIDDEN', message: 'No.' },
    });
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_cancel_refused());
    expect(remotes.readPublishState).toHaveBeenCalledWith('c1');
    expect(told.warn).toHaveBeenCalledWith(
      'studio_publish.cancel_failed',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('a cancel answered with something that is not the piece is said, and read again', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockResolvedValue({});
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_cancel_refused());
    expect(remotes.readPublishState).toHaveBeenCalledWith('c1');
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.unexpected_answer',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('a cancel that failed stays said when the media settles', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockRejectedValue({ status: 503 });
    remotes.readPublishState.mockReturnValue(new Promise(() => {}));
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_cancel_failed());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_cancel_failed());
  });

  test('a change of view is said in the step’s one live region', async () => {
    onItsWay();
    render(scheduled());
    const region = () =>
      [...document.querySelectorAll('.sr-only[role="status"]')]
        .map((el) => el.textContent ?? '')
        .join(' ');
    mediaNow('failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(region()).toContain(
      m.studio_publish_scheduled_media_failed({ type: 'video' })
    );
    mediaNow('transcoding');
    await vi.advanceTimersByTimeAsync(0);
    expect(region()).toContain(m.studio_publish_scheduled_heading());
    // The banner's own Alerts are furniture: no live region mounts with them.
    expect(
      banner()?.querySelector('[role="status"]:not(.schedule-note)')
    ).toBeNull();
  });

  test('a schedule that did not go live says why in the live region', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(
      draft({ publishBlockedReason: 'CREATOR_CONNECT_REQUIRED' })
    );
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    const region = [...document.querySelectorAll('.sr-only[role="status"]')]
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(region).toContain(m.studio_publish_blocked());
    expect(region).toContain(m.studio_publish_gap_payouts());
  });

  test('a check that fails while a cancel failure shows is said by its own line', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    remotes.cancelPublishRequest.mockRejectedValue({ status: 503 });
    banner()
      ?.querySelector<HTMLButtonElement>(
        `button[aria-label="${m.studio_publish_scheduled_cancel_label()}"]`
      )
      ?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_cancel_failed());

    remotes.readPublishState.mockRejectedValue({ status: 503 });
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_cancel_failed());
    expect(text()).toContain(m.studio_publish_scheduled_unread());
  });

  test('gone, with reads that answered still scheduled: Check again is said as it appears', async () => {
    media.item = null;
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(bannerText()).toContain(m.studio_publish_scheduled_check_again());
    const region = [...document.querySelectorAll('.sr-only[role="status"]')]
      .map((el) => el.textContent ?? '')
      .join(' ');
    expect(region).toContain(m.studio_publish_scheduled_still_waiting());
  });

  test('a cancel lost to the go-live is logged', async () => {
    onItsWay();
    remotes.cancelPublishRequest.mockRejectedValue({
      status: 409,
      body: { code: 'CONTENT_ALREADY_LIVE', message: 'Already live.' },
    });
    remotes.readPublishState.mockResolvedValue(wentLive());
    render(scheduled());
    banner()?.querySelector('button')?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(told.warn).toHaveBeenCalledWith(
      'studio_publish.cancel_lost_to_go_live',
      expect.objectContaining({ contentId: 'c1' })
    );
    expect(document.activeElement).toBe(banner());
    // The read brought its saved address: View.
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/content/runes-explained'
    );
  });

  test('an answer neither live nor scheduled is said as a failure, and logged', async () => {
    onItsWay();
    remotes.publishContentWhenReady.mockResolvedValue(draft());
    render();
    publishButton()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).toBeNull();
    expect(text()).toContain(m.studio_editor_publish_failed());
    expect(told.error).toHaveBeenCalledWith(
      'studio_publish.unexpected_answer',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('scheduled while a move was asked for: told on the way out', async () => {
    onItsWay();
    const sent = Promise.withResolvers<unknown>();
    remotes.publishContentWhenReady.mockReturnValueOnce(sent.promise);
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
    sent.resolve(scheduled());
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_publish_scheduled_toast({
        title: 'Svelte runes deep dive',
        type: 'video',
      })
    );
    expect(nav.goto).toHaveBeenCalled();
  });

  test('a retry that sets the media going moves focus from the gone Try again to the banner', async () => {
    onItsWay();
    render(scheduled());
    mediaNow('failed');
    const again = banner()?.querySelector<HTMLButtonElement>('button');
    expect(again?.textContent?.trim()).toBe(m.common_try_again());
    again?.focus();
    again?.click();
    await vi.advanceTimersByTimeAsync(0);

    mediaNow('transcoding');
    await vi.advanceTimersByTimeAsync(0);
    expect(bannerText()).toContain(m.studio_publish_scheduled_heading());
    expect(document.activeElement).toBe(banner());
  });

  test('a schedule cancelled elsewhere is said when a read sees it, and focus goes to the checklist', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(draft());
    render(scheduled());
    mediaNow('ready');
    const check = document.querySelector<HTMLElement>('.publish-schedule');
    check?.focus();
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    await vi.advanceTimersByTimeAsync(20);
    expect(banner()).toBeNull();
    // Not cancelled here: said without claiming a cancel.
    expect(text()).toContain(m.studio_publish_scheduled_ended());
    expect(text()).not.toContain(m.studio_publish_scheduled_cancelled());
    expect(gapsFocused()).toBe(true);
    // The media is ready now: an ordinary Publish.
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button()
    );
  });

  test('gone, with reads that never answered: the unread words come with Check again', async () => {
    media.item = null;
    remotes.readPublishState.mockRejectedValue({ status: 503 });
    render(scheduled());
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(text()).toContain(m.studio_publish_scheduled_unread());
    expect(bannerText()).toContain(m.studio_publish_scheduled_check_again());
    // The read alert is the one voice: not "Not live yet" as well.
    expect(notice()).not.toContain(m.studio_publish_scheduled_still_waiting());
  });

  test('a Check again that fails takes "in a moment" back out of the live region', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(scheduled());
    render(scheduled());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    const settling = m.studio_publish_scheduled_settling({ type: 'video' });
    expect(notice()).toContain(settling);
    remotes.readPublishState.mockRejectedValueOnce({ status: 503 });
    checkAgain()?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain(m.studio_publish_scheduled_unread());
    expect(notice()).not.toContain(settling);
    expect(bannerText()).not.toContain(settling);
  });

  test('reads that run out unanswered leave no old words in the live region', async () => {
    onItsWay();
    remotes.readPublishState.mockRejectedValue({ status: 503 });
    render(scheduled());
    mediaNow('failed');
    await vi.advanceTimersByTimeAsync(0);
    mediaNow('transcoding');
    await vi.advanceTimersByTimeAsync(0);
    expect(notice()).toContain(m.studio_publish_scheduled_heading());
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(ALL_READS_MS);
    expect(text()).toContain(m.studio_publish_scheduled_unread());
    expect(notice()).not.toContain(m.studio_publish_scheduled_heading());
  });

  test('the cancel and read alerts are there, empty, before anything goes wrong', () => {
    onItsWay();
    render(scheduled());
    const alerts = [...(banner()?.querySelectorAll('[role="alert"]') ?? [])];
    expect(alerts).toHaveLength(2);
    expect(alerts.every((el) => el.textContent?.trim() === '')).toBe(true);
  });

  test('a go-live seen while typing in the settings moves focus off the field it held still', async () => {
    onItsWay();
    remotes.readPublishState.mockResolvedValue(wentLive());
    render(scheduled());
    const field = document.querySelector<HTMLInputElement>(
      '.publish input[type="radio"]'
    );
    field?.focus();
    expect(document.activeElement).toBe(field);
    mediaNow('ready');
    await vi.advanceTimersByTimeAsync(FIRST_READ_MS);
    expect(bannerText()).toContain(
      m.studio_publish_live({ title: 'Svelte runes deep dive' })
    );
    // The banner's view moved: focus follows a tick later (a frame, in
    // async mode).
    await vi.advanceTimersByTimeAsync(20);
    expect(document.activeElement).toBe(banner());
  });

  test("uploading from this tab's own queue: keep it open, whatever the socket has heard", () => {
    media.item = {
      id: MEDIA_ID,
      status: 'uploading',
      title: 'Winter Light',
      createdAt: new Date(),
    };
    uploadQueue.items = [
      { key: 'k1', id: MEDIA_ID, status: 'uploading', progress: 30 } as never,
    ];
    try {
      render(scheduled());
      expect(text()).toContain(m.studio_publish_scheduled_keep_open());
    } finally {
      uploadQueue.items = [];
    }
  });

  test('uploading from this tab: the foot says to keep it open, not that it can close', () => {
    media.item = {
      id: MEDIA_ID,
      status: 'uploading',
      title: 'Winter Light',
      createdAt: new Date(),
    };
    live.items.set(MEDIA_ID, {
      lifecycle: 'uploading',
      progress: null,
      upload: { here: true, pct: 30 },
    });
    render(scheduled());
    expect(text()).toContain(m.studio_publish_scheduled_keep_open());
    expect(text()).not.toContain(m.studio_publish_scheduled_close());
  });

  test("didn't go live: why, and where it is put right, with no Dismiss (owner)", () => {
    render(draft({ publishBlockedReason: 'CREATOR_CONNECT_REQUIRED' }));
    expect(bannerText()).toContain(m.studio_publish_blocked());
    expect(bannerText()).toContain(m.studio_publish_gap_payouts());
    expect(banner()?.querySelector('a')?.textContent?.trim()).toBe(
      m.studio_content_form_access_payouts_link()
    );
    expect(banner()?.querySelector('button')).toBeNull();
    // Publish again is offered: it clears the reason.
    expect(publishButton()?.textContent?.trim()).toBe(
      m.studio_publish_button()
    );
  });

  test("didn't go live as the file failed for good: says so, and the way back to writing", () => {
    render(draft({ publishBlockedReason: 'MEDIA_FAILED' }));
    expect(bannerText()).toContain(
      m.studio_publish_blocked_media_failed({ type: 'video' })
    );
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe(
      '/studio/content/c1/edit'
    );
  });
});
