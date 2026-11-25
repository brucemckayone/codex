/**
 * Editing a piece that has been live (Codex-a6ofh.2.5, mockup W5): two tabs
 * over one draft session, changes that wait for Update and go with it
 * alone, Discard, the editor's own leave question, the locked link, the
 * portals it is in, and what only a live piece has on Settings.
 */
import { LEAVING_NOTICE_DAYS } from '@codex/constants';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ACTIVE_ACCOUNT,
  land,
  myConnectSlot,
  reset as resetSubscriptionRemote,
} from '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte';
import type { ContentWithRelations } from '$lib/types';
import { formatSentenceDate } from '$lib/utils/format';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import { LEAVES_AT, LEAVING } from '../__fixtures__/draft-row';
import { leaveDayFrom, retryWords } from '../content-list/leaving-words';

const remotes = vi.hoisted(() => ({
  saveContent: vi.fn(),
  createContentDraft: vi.fn(),
  deleteThumbnailCommand: vi.fn(),
  deleteContent: vi.fn(),
  keepContent: vi.fn(),
  readLeaveState: vi.fn(),
  publishContent: vi.fn(),
  unpublishContent: vi.fn(),
  checkContentSlug: vi.fn(),
}));
/** The portals read: `uses`, or a failure when `failure` is set. */
const portals = vi.hoisted(() => ({
  uses: [] as unknown[],
  failure: null as unknown,
  refresh: vi.fn(async () => {}),
}));
/**
 * The cover forms as kit hands them over: the stage's submission waits for
 * `stage.land()`, so a test can hold a cover on its way.
 */
const stage = vi.hoisted(() => ({
  land: () => {},
  submitted: 0,
  /** Each key a stage form was asked for: kit hands one instance per key, which one `<form>` may take. */
  keys: new Set<string>(),
}));
const coverForm = (held: boolean) => ({
  for: (key: string) => {
    if (held) stage.keys.add(key);
    return coverInstance(held);
  },
});
const coverInstance = (held: boolean) => ({
  result: undefined as unknown,
  enhance(
    callback: (opts: {
      form: HTMLFormElement;
      submit: () => Promise<void>;
    }) => Promise<void>
  ) {
    return {
      method: 'POST',
      action: '',
      onsubmit: (event: SubmitEvent) => {
        event.preventDefault();
        if (!held) return;
        void callback({
          form: event.currentTarget as HTMLFormElement,
          submit: () =>
            new Promise<void>((resolve) => {
              stage.submitted += 1;
              stage.land = resolve;
            }),
        });
      },
    };
  },
});
vi.mock('$lib/remote/content.remote', () => ({
  ...remotes,
  uploadThumbnailForm: coverForm(false),
  stageThumbnailForm: coverForm(true),
  getContentPortals: () =>
    portals.failure
      ? { current: undefined, error: portals.failure, refresh: portals.refresh }
      : {
          current: { uses: portals.uses },
          error: undefined,
          refresh: portals.refresh,
        },
}));
vi.mock('$lib/remote/media.remote', () => ({
  getMediaItem: () => ({
    current: undefined,
    error: undefined,
    refresh: async () => {},
  }),
  listMedia: () => ({
    current: undefined,
    error: undefined,
    refresh: async () => {},
  }),
  getMediaPreview: vi.fn(),
}));
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    items: new Map(),
    now: 0,
    connection: 'idle',
    register: () => () => {},
    resume: () => {},
  },
}));
vi.mock('$lib/client/upload-queue.svelte', () => ({
  uploadQueue: {
    items: [],
    rejections: [],
    add: () => [],
    cancel: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    // An empty queue has no word on any upload.
    wordOn: () => null,
  },
}));
// The photo goes as picked: shrinking is its own module's to test.
vi.mock('$lib/utils/shrink-photo', () => ({
  shrinkPhotoInput: async (input: HTMLInputElement) => input.files?.[0],
}));
/** The payout-setup read: ready, or a failure when `failure` is set. */
const connect = vi.hoisted(() => ({
  failure: null as unknown,
  refresh: vi.fn(async () => {}),
}));
vi.mock('$lib/remote/subscription.remote', async () => {
  const kit = await import(
    '$lib/components/studio/__fixtures__/subscription-remote.mock.svelte'
  );
  return {
    // A kit-shaped slot set from `connect` when it is read, so a Try again
    // can land its answer and the page follows.
    getMyConnectStatus: () => {
      const slot = kit.myConnectSlot();
      slot.refresh = connect.refresh;
      if (connect.failure) kit.fail(slot, connect.failure);
      else kit.land(slot, kit.ACTIVE_ACCOUNT);
      return slot;
    },
    listTiers: () => ({
      current: [],
      error: undefined,
      refresh: async () => {},
    }),
  };
});
vi.mock('$lib/remote/categories.remote', () => ({
  getCategories: () => ({
    current: [],
    error: undefined,
    refresh: async () => {},
  }),
  createCategoryInline: vi.fn(),
}));

type Move = {
  to: { url: URL } | null;
  type?: string;
  willUnload: boolean;
  cancel: () => void;
};
const nav = vi.hoisted(() => ({
  replaceState: vi.fn(),
  goto: vi.fn(),
  guards: [] as ((move: Move) => void)[],
}));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('https://alpha.lvh.me/studio/content/c1/edit'),
    state: {},
  },
  navigating: { to: null },
}));
vi.mock('$app/navigation', () => ({
  beforeNavigate: (guard: (move: Move) => void) => nav.guards.push(guard),
  afterNavigate: () => {},
  replaceState: (...args: unknown[]) => nav.replaceState(...args),
  goto: (...args: unknown[]) => nav.goto(...args),
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  add: vi.fn(),
}));
vi.mock('$lib/components/ui/Toast/toast-store', () => ({ toast: toasts }));
const told = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock('$lib/observability', () => ({ logger: told }));
vi.mock('$lib/components/editor/RichTextEditor.svelte', async () => ({
  default: (await import('./__fixtures__/RichTextEditorStub.svelte')).default,
}));
vi.mock('$lib/components/ui/ContentCard/ContentCard.svelte', async () => ({
  default: (await import('./__fixtures__/ContentCardStub.svelte')).default,
}));
// The fold's slide out never ends under jsdom: it closes at once here.
vi.mock('svelte/transition', async (actual) => ({
  ...(await actual<typeof import('svelte/transition')>()),
  slide: () => ({ duration: 0 }),
}));

const LiveEditor = (await import('./LiveEditor.svelte')).default;
const { handOffToLive, LIVE_HANDOFF_FRESH_MS, takeLiveHandoff } = await import(
  './live-handoff'
);

/** The autosave's debounce, with room: a live piece must not save by then. */
const SETTLE_MS = 1_600;

let component: ReturnType<typeof mount> | null = null;

function live(
  fields: Partial<ContentWithRelations> = {}
): ContentWithRelations {
  return {
    id: 'c1',
    title: 'Advanced Svelte Patterns',
    slug: 'advanced-svelte-patterns',
    contentType: 'written',
    status: 'published',
    publishedAt: '2026-11-01T09:00:00.000Z',
    description: null,
    contentBody: 'Body',
    contentBodyJson: null,
    mediaItemId: null,
    thumbnailUrl: null,
    shaderPreset: null,
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

function render(content = live(), props: Record<string, unknown> = {}) {
  stage.keys.clear();
  component = mount(LiveEditor, {
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
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === name
  );
const title = () =>
  document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${m.studio_editor_title_label()}"]`
  );
function typeTitle(value: string) {
  const field = title();
  if (!field) throw new Error('no title field');
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}
function click(name: string) {
  const target = button(name);
  if (!target) throw new Error(`no ${name} button`);
  target.click();
  flushSync();
}
/** Melt switches a tab on its own pointer and key events: a click alone is a browser's. */
function openTab(name: string) {
  const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (node) => node.textContent?.trim() === name
  );
  if (!tab) throw new Error(`no ${name} tab`);
  tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  tab.click();
  tab.focus();
  flushSync();
}
function openWhere() {
  document.querySelector<HTMLButtonElement>('.settings-fold')?.click();
  flushSync();
}
/** Pick a photo in the page's cover line: its stage waits for `stage.land()`. */
function chooseCover() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no cover input');
  const photo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'p.png', {
    type: 'image/png',
  });
  Object.defineProperty(input, 'files', { value: [photo], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
/** A move through the editor's guards, as SvelteKit's would go. */
function leave(cancel = vi.fn()) {
  const to = new URL('https://alpha.lvh.me/studio/content');
  for (const guard of nav.guards) {
    guard({ to: { url: to }, type: 'link', willUnload: false, cancel });
  }
  flushSync();
  return { to, cancel };
}

beforeEach(() => {
  vi.useFakeTimers();
  portals.uses = [];
  portals.failure = null;
  resetSubscriptionRemote();
  connect.failure = null;
  stage.submitted = 0;
  nav.goto.mockResolvedValue(undefined);
  // Reset, so an answer one test queued and never used can't reach the next.
  for (const remote of [
    remotes.saveContent,
    remotes.deleteContent,
    remotes.keepContent,
    remotes.readLeaveState,
  ]) {
    remote.mockReset();
  }
  remotes.saveContent.mockResolvedValue({});
  remotes.unpublishContent.mockResolvedValue({});
  remotes.publishContent.mockResolvedValue({});
  remotes.deleteContent.mockResolvedValue(undefined);
  remotes.keepContent.mockResolvedValue({
    kept: true,
    staying: 0,
    stillLeavingBy: null,
  });
  remotes.readLeaveState.mockResolvedValue({
    leavesAt: LEAVES_AT,
    leavingByCreator: true,
    leavingByOrg: true,
  });
  remotes.checkContentSlug.mockResolvedValue({ available: true });
});

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  nav.guards.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
});

// Codex-a6ofh.2 (owner 2026-11-09): the piece went live under its draft's
// editor, and "Open it to update" carried the changes not on it yet here.
describe('LiveEditor · changes carried from writing', () => {
  test('they wait for Update, said so, and go with it as an ordinary save', async () => {
    handOffToLive('c1', { title: 'Carried from writing' });
    render();

    expect(title()?.value).toBe('Carried from writing');
    expect(text()).toContain(m.studio_live_changes_one());
    expect(document.querySelector('.live-carried')?.textContent).toBe(
      m.studio_live_carried()
    );
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).not.toHaveBeenCalled();

    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: 'c1',
      patch: { title: 'Carried from writing' },
    });
    expect(document.querySelector('.live-carried')?.textContent).toBe('');
    // Taken once: the next visit finds none.
    expect(takeLiveHandoff('c1')).toBeNull();
  });

  test('calibration: none carried, none said', () => {
    render();

    expect(title()?.value).toBe('Advanced Svelte Patterns');
    expect(document.querySelector('.live-carried')?.textContent).toBe('');
  });

  // The round-2 review: the line keyed on "something carried" and "dirty",
  // so it came back for edits made here, after Update had ended it.
  test('once Update ends it, an edit made here is never said to be carried', async () => {
    handOffToLive('c1', { title: 'Carried from writing' });
    render();
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.live-carried')?.textContent).toBe('');

    typeTitle('Edited in the live editor');
    flushSync();

    expect(text()).toContain(m.studio_live_changes_one());
    expect(document.querySelector('.live-carried')?.textContent).toBe('');
  });

  test('nothing carried that differs from what is live: never said, nor after an edit', () => {
    handOffToLive('c1', { title: 'Advanced Svelte Patterns' });
    render();
    expect(document.querySelector('.live-carried')?.textContent).toBe('');

    typeTitle('Edited in the live editor');
    flushSync();

    expect(document.querySelector('.live-carried')?.textContent).toBe('');
  });

  test('off sale, Update saves them and it stays off sale: said so', () => {
    handOffToLive('c1', { title: 'Carried from writing' });
    render(live({ status: 'draft' }));

    expect(document.querySelector('.live-carried')?.textContent).toBe(
      m.studio_live_carried_off_sale()
    );
  });

  test('ones that came too late are said, and never applied', () => {
    handOffToLive('c1', { title: 'Carried from writing' });
    vi.advanceTimersByTime(LIVE_HANDOFF_FRESH_MS + 1);
    render();

    expect(title()?.value).toBe('Advanced Svelte Patterns');
    expect(text()).toContain(m.studio_live_no_changes());
    expect(document.querySelector('.live-carried')?.textContent).toBe(
      m.studio_live_carried_lost()
    );
  });

  // An Update out ends nothing: refused, the carried changes still wait,
  // and the line still says where they came from (the round-3 review).
  test('a refused Update leaves them waiting, still said', async () => {
    const out = Promise.withResolvers<never>();
    remotes.saveContent.mockReturnValueOnce(out.promise);
    handOffToLive('c1', { title: 'Carried from writing' });
    render();

    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);
    // Out: the line waits for how it lands.
    expect(document.querySelector('.live-carried')?.textContent).toBe(
      m.studio_live_carried()
    );
    out.reject({ status: 422, body: { message: 'That title is too long.' } });
    await vi.advanceTimersByTimeAsync(0);

    expect(text()).toContain('That title is too long.');
    expect(document.querySelector('.live-carried')?.textContent).toBe(
      m.studio_live_carried()
    );
  });

  // Once an Update has landed, the screen is not the piece as it was live:
  // the too-late line ends then (the round-3 review).
  test('the too-late line ends once an Update lands', async () => {
    handOffToLive('c1', { title: 'Carried from writing' });
    vi.advanceTimersByTime(LIVE_HANDOFF_FRESH_MS + 1);
    render();
    typeTitle('Retyped here');
    flushSync();
    expect(document.querySelector('.live-carried')?.textContent).toBe(
      m.studio_live_carried_lost()
    );

    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.saveContent).toHaveBeenCalled();
    expect(document.querySelector('.live-carried')?.textContent).toBe('');
  });
});

describe('LiveEditor · changes wait for Update', () => {
  // The epic review: Update and Discard disable themselves once pressed,
  // which drops focus; it goes to the line that says how it went.
  test.each([
    ['Update', () => m.studio_live_update()],
    ['Discard', () => m.studio_live_discard()],
  ])('%s leaves focus on the changes line, never the page', async (_name, label) => {
    render();
    typeTitle('Changed');
    const pressed = button(label());
    pressed?.focus();
    click(label());
    pressed?.blur();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.activeElement).toBe(
      document.querySelector('.live-changes')
    );
  });

  test('opens on the page, live, with nothing to update', () => {
    render();
    expect(text()).toContain(m.studio_live_badge());
    expect(text()).toContain(m.studio_live_no_changes());
    expect(button(m.studio_live_update())?.disabled).toBe(true);
    // The link is locked, and the page says so under the title.
    expect(text()).toContain(m.studio_live_link_stays());
  });

  test('a change is counted, never saved by itself, and goes with Update alone', async () => {
    render();
    typeTitle('Advanced Svelte, renamed');
    expect(text()).toContain(m.studio_live_changes_one());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(remotes.saveContent).not.toHaveBeenCalled();

    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: 'c1',
      patch: { title: 'Advanced Svelte, renamed' },
    });
    expect(toasts.success).toHaveBeenCalledWith(m.studio_live_updated());
    expect(text()).toContain(m.studio_live_no_changes());
  });

  test('a refused Update keeps the changes, and the bar says why', async () => {
    remotes.saveContent.mockRejectedValue({
      status: 422,
      body: { message: 'That title is too long.' },
    });
    render();
    typeTitle('Refused');
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    expect(text()).toContain('That title is too long.');
    expect(title()?.value).toBe('Refused');
    expect(toasts.success).not.toHaveBeenCalled();
  });

  test('Discard puts every field back as it is live, and the refusal goes with them', async () => {
    remotes.saveContent.mockRejectedValue({
      status: 422,
      body: { message: 'That title is too long.' },
    });
    render();
    typeTitle('Refused');
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    click(m.studio_live_discard());

    expect(title()?.value).toBe('Advanced Svelte Patterns');
    expect(text()).toContain(m.studio_live_no_changes());
    expect(text()).not.toContain('That title is too long.');
  });

  // Discarded meanwhile, the cover would land after and put a change back.
  test('while a cover is on its way, Discard waits for it and Update says why', async () => {
    render();
    typeTitle('Renamed');
    chooseCover();
    await vi.waitFor(() => expect(stage.submitted).toBe(1));
    flushSync();

    expect(button(m.studio_live_discard())?.disabled).toBe(true);
    expect(button(m.studio_live_update())?.disabled).toBe(true);
    expect(text()).toContain(m.studio_editor_next_needs_cover());

    stage.land();
    await vi.waitFor(() =>
      expect(button(m.studio_live_discard())?.disabled).toBe(false)
    );
  });

  test('a move while a cover is on its way says so in the bar, Stay keeps the creator, and a failed cover never sends them away', async () => {
    render();
    chooseCover();
    await vi.waitFor(() => expect(stage.submitted).toBe(1));
    flushSync();

    const { cancel } = leave();
    expect(cancel).toHaveBeenCalled();
    expect(text()).toContain(m.studio_live_leaving_held());
    click(m.studio_live_leave_stay());
    expect(text()).not.toContain(m.studio_live_leaving_held());

    // Held again, and the cover fails: the creator stays where that is said.
    leave();
    stage.land();
    await vi.waitFor(() =>
      expect(text()).toContain(m.studio_editor_cover_failed())
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.goto).not.toHaveBeenCalled();
    expect(text()).not.toContain(m.studio_live_leaving_held());
  });

  test('Leave now goes while the cover is still on its way', async () => {
    render();
    chooseCover();
    await vi.waitFor(() => expect(stage.submitted).toBe(1));
    flushSync();
    const { to } = leave();

    click(m.studio_live_leave_now());
    await vi.advanceTimersByTimeAsync(0);

    expect(String(nav.goto.mock.calls[0]?.[0])).toBe(String(to));
  });

  // The body's editor starts from its content once, so only starting it
  // again puts the words back (the price as typed too).
  test('Discard puts the body back in its editor', () => {
    render();
    const body = document.querySelector<HTMLTextAreaElement>(
      '[data-testid="body"]'
    );
    if (!body) throw new Error('no body');
    body.value = 'Rewritten body';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(text()).toContain(m.studio_live_changes_one());

    click(m.studio_live_discard());

    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="body"]')?.value
    ).toBe('Body');
  });

  test('a tab switch keeps every change, and the address says the tab', () => {
    render();
    typeTitle('Kept across tabs');
    openTab(m.studio_live_tab_settings());
    expect(nav.replaceState).toHaveBeenCalledWith(
      expect.objectContaining({ search: '?tab=settings' }),
      expect.anything()
    );
    openTab(m.studio_live_tab_page());

    expect(title()?.value).toBe('Kept across tabs');
    expect(text()).toContain(m.studio_live_changes_one());
  });

  test('a piece that is off sale says so, and Update keeps it off sale', async () => {
    render(live({ status: 'draft' }));
    expect(text()).toContain(m.studio_live_badge_unpublished());
    typeTitle('Still for its buyers');
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.publishContent).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_live_updated_unpublished()
    );
  });
});

describe('LiveEditor · leaving with changes not live yet', () => {
  test('asks in its own dialog, never the browser’s, and Stay keeps them', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render();
    typeTitle('Not updated');
    const { cancel } = leave();

    expect(cancel).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(text()).toContain(m.studio_live_leave_title());
    expect(text()).toContain(m.studio_live_leave_body_one());

    click(m.studio_live_leave_stay());
    await vi.advanceTimersByTimeAsync(0);
    expect(nav.goto).not.toHaveBeenCalled();
    expect(title()?.value).toBe('Not updated');
  });

  test('Discard changes drops them and goes, sending nothing', async () => {
    render();
    typeTitle('Not updated');
    const { to } = leave();
    click(m.studio_live_leave_discard());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.saveContent).not.toHaveBeenCalled();
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  test('Update sends them, then goes', async () => {
    render();
    typeTitle('Updated on the way out');
    const { to } = leave();
    const dialogUpdate = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((node) => node.textContent?.trim() === m.studio_live_update());
    dialogUpdate?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: 'c1',
      patch: { title: 'Updated on the way out' },
    });
    expect(nav.goto).toHaveBeenCalledWith(to);
  });

  test('nothing to update: the move goes without a question', () => {
    render();
    const { cancel } = leave();
    expect(cancel).not.toHaveBeenCalled();
    expect(text()).not.toContain(m.studio_live_leave_title());
  });
});

describe('LiveEditor · Settings', () => {
  test('its cover line and the page’s each take a stage form of their own', () => {
    render();
    openTab(m.studio_live_tab_settings());

    // Both tabs stay mounted: one key for the two would hand one form
    // instance to two <form>s, which kit refuses, and the editor falls over.
    expect(stage.keys.size).toBe(2);
  });

  // A live piece has no checklist to say it in, and nothing left to publish:
  // its Update is what checks the payout setup again.
  test('an unread payout setup says so by the options, in words for Update', () => {
    connect.failure = new Error('fetch failed');
    render();
    openTab(m.studio_live_tab_settings());

    expect(text()).toContain(m.studio_live_connect_unread());
    expect(text()).not.toContain(m.studio_publish_connect_unread());

    connect.refresh.mockClear();
    click(m.common_try_again());
    expect(connect.refresh).toHaveBeenCalledTimes(1);
  });

  // The alert goes with its focused button: the news, and focus, land on a
  // line that says what was found (Codex-a6ofh.2.6 review R4).
  test.each([
    ['set up', ACTIVE_ACCOUNT, () => m.studio_live_connect_checked()],
    [
      'not set up',
      { ...ACTIVE_ACCOUNT, chargesEnabled: false, payoutsEnabled: false },
      () => m.studio_content_form_access_payouts_hint(),
    ],
  ] as const)('a Try again that finds payouts %s says so, with focus', async (_found, account, words) => {
    connect.failure = new Error('fetch failed');
    connect.refresh.mockImplementationOnce(async () => {
      land(myConnectSlot(), account);
    });
    render();
    openTab(m.studio_live_tab_settings());
    button(m.common_try_again())?.focus();
    click(m.common_try_again());

    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('role')).toBe('status')
    );
    expect(document.activeElement?.textContent?.trim()).toBe(words());
  });

  test('the link is locked: Change warns that old links stop working, then opens it', async () => {
    render();
    openTab(m.studio_live_tab_settings());
    openWhere();
    expect(text()).toContain(
      m.studio_live_link_path({ slug: 'advanced-svelte-patterns' })
    );
    expect(document.getElementById('slug')).toBeNull();

    click(m.studio_live_link_change());
    await vi.advanceTimersByTimeAsync(0);

    expect(text()).toContain(m.studio_live_link_warning());
    expect(document.getElementById('slug')).not.toBeNull();
  });

  test('lists the portals it is in, with a link to each one’s stages', () => {
    portals.uses = [
      {
        courseId: 'course-1',
        pageId: 'page-1',
        title: 'Svelte Mastery',
        stageNumbers: [2],
      },
    ];
    render();
    openTab(m.studio_live_tab_settings());
    openWhere();

    expect(text()).toContain(m.studio_live_portal_in());
    expect(text()).toContain('Svelte Mastery');
    expect(text()).toContain(m.studio_live_portal_stage({ number: '2' }));
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
      (node) => node.textContent?.trim() === m.studio_live_portal_change()
    );
    expect(link?.getAttribute('href')).toBe(
      '/studio/journeys/page-1/curriculum'
    );
  });

  test('a portals read that failed is said and logged, never taken for none', () => {
    portals.failure = new TypeError('Failed to fetch');
    render();
    openTab(m.studio_live_tab_settings());
    openWhere();

    expect(text()).toContain(m.studio_live_portals_unread());
    expect(told.error).toHaveBeenCalledWith(
      'studio_live.portals_unread',
      expect.objectContaining({ contentId: 'c1' })
    );
    click(m.common_try_again());
    expect(portals.refresh).toHaveBeenCalled();
  });

  test('Unpublish takes it off sale at once, and the bar says so', async () => {
    render();
    openTab(m.studio_live_tab_settings());
    click(m.studio_content_form_unpublish());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.unpublishContent).toHaveBeenCalledWith('c1');
    expect(text()).toContain(m.studio_live_badge_unpublished());
    expect(button(m.studio_live_republish())).toBeDefined();
  });

  // The epic review: busy while it goes, the pressed toggle loses focus.
  test('Unpublish has focus back on its toggle once it settles', async () => {
    render();
    openTab(m.studio_live_tab_settings());
    const toggle = button(m.studio_content_form_unpublish());
    // A browser drops focus from a control as it is disabled; jsdom keeps it
    // there, and ignores a blur once it is. So it is dropped as pressed.
    toggle?.focus();
    toggle?.blur();
    click(m.studio_content_form_unpublish());
    expect(document.activeElement).toBe(document.body);
    await vi.advanceTimersByTimeAsync(0);

    expect(document.activeElement).toBe(button(m.studio_live_republish()));
  });

  test('a failed Unpublish leaves it live and is logged as an outage', async () => {
    remotes.unpublishContent.mockRejectedValue(
      new TypeError('Failed to fetch')
    );
    render();
    openTab(m.studio_live_tab_settings());
    click(m.studio_content_form_unpublish());
    await vi.advanceTimersByTimeAsync(0);

    expect(text()).toContain(m.studio_live_badge());
    expect(told.error).toHaveBeenCalledWith(
      'studio_live.publish_toggle_failed',
      expect.objectContaining({ contentId: 'c1' })
    );
  });

  test('Delete asks first, then goes to the list without asking to leave', async () => {
    render();
    typeTitle('About to go');
    openTab(m.studio_live_tab_settings());
    click(m.studio_live_delete());
    const confirmDelete = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button'
      ),
    ].find(
      (node) => node.textContent?.trim() === m.studio_content_delete_confirm()
    );
    // The session's move to the list comes by the guards, as kit's would.
    const cancel = vi.fn();
    nav.goto.mockImplementationOnce(async () => {
      leave(cancel);
    });
    confirmDelete?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.deleteContent).toHaveBeenCalledWith('c1');
    expect(nav.goto).toHaveBeenCalledWith('/studio/content');
    expect(cancel).not.toHaveBeenCalled();
  });

  /** Delete, confirmed, answered by `refusal` as kit hands a forwarded 4xx. */
  async function deleteRefused(refusal: { status: number; body: object }) {
    remotes.deleteContent.mockRejectedValueOnce(refusal);
    render();
    openTab(m.studio_live_tab_settings());
    click(m.studio_live_delete());
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button'
      ),
    ]
      .find(
        (node) => node.textContent?.trim() === m.studio_content_delete_confirm()
      )
      ?.click();
    await vi.advanceTimersByTimeAsync(0);
  }

  test('a piece already deleted elsewhere is what Delete was for: it says so by its own code', async () => {
    await deleteRefused({
      status: 404,
      body: { code: 'CONTENT_NOT_FOUND', message: 'Content not found' },
    });

    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_content_form_delete_success()
    );
    expect(nav.goto).toHaveBeenCalledWith('/studio/content');
  });

  test('any other 404 is a failed delete, never a deleted piece', async () => {
    await deleteRefused({ status: 404, body: { message: 'Not Found' } });

    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_content_form_delete_error()
    );
    expect(nav.goto).not.toHaveBeenCalled();
  });

  test('a lapsed sign-in says to sign in again, as Update does', async () => {
    await deleteRefused({
      status: 401,
      body: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });

    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_content_draft_signed_out()
    );
    expect(nav.goto).not.toHaveBeenCalled();
  });

  test('an audio piece’s full-screen background goes with Update', async () => {
    render(live({ contentType: 'audio', contentBody: null }));
    openTab(m.studio_live_tab_settings());
    const preset = document.querySelector<HTMLButtonElement>(
      '[role="radiogroup"] [role="radio"][aria-checked="false"]'
    );
    if (!preset) throw new Error('no preset');
    preset.click();
    flushSync();
    expect(text()).toContain(m.studio_live_changes_one());

    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);
    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: 'c1',
      patch: { shaderPreset: expect.any(String) },
    });
  });
});

// The leaving notice (Codex-a6ofh.6, mockup leaving-notice.html LN1, LN4,
// LN5, N1-B; owner 2026-11-20).
describe('LiveEditor · leaving', () => {
  const date = formatSentenceDate(LEAVES_AT);
  const inDialog = (name: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button'
      ),
    ].find((node) => node.textContent?.trim() === name);
  const deleteInDays = m.studio_leaving_delete_in_days({
    days: LEAVING_NOTICE_DAYS,
  });

  test('a Delete of a piece people own says who, and the editor stays on it, leaving (LN1, LN4)', async () => {
    remotes.deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 3,
      started: true,
      leavingByCreator: true,
      leavingByOrg: false,
    });
    render(live({ holderCount: 3 }));
    openTab(m.studio_live_tab_settings());
    click(m.studio_live_delete());
    // The list's own dialog: whose it is, and who owns it.
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent
    ).toContain(
      m.studio_content_delete_one_title({ title: 'Advanced Svelte Patterns' })
    );
    expect(text()).toContain(m.studio_leaving_delete_owners({ count: 3 }));

    inDialog(deleteInDays)?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.deleteContent).toHaveBeenCalledWith('c1');
    expect(nav.goto).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_leaving_deleted({
        title: 'Advanced Svelte Patterns',
        date,
        count: 3,
      })
    );
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    // Leaving now: the bar says so, Keep it in place of Publish again.
    expect(document.querySelector('.live-pill')?.textContent?.trim()).toBe(
      m.studio_leaving_status()
    );
    expect(text()).toContain(m.studio_leaving_bar_title({ date }));
    expect(button(m.studio_live_republish())).toBeUndefined();
    expect(button(m.studio_live_delete())).toBeUndefined();
    expect(button(m.studio_leaving_keep())).toBeDefined();
  });

  test('a Delete too soon after the last notice is said in the dialog, which stays', async () => {
    const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    remotes.deleteContent.mockRejectedValueOnce({
      status: 409,
      body: {
        code: 'CONTENT_LEAVING_TOO_SOON',
        message: 'This started leaving less than a day ago.',
        retryAfter: at,
      },
    });
    render(live({ holderCount: 3 }));
    openTab(m.studio_live_tab_settings());
    click(m.studio_live_delete());
    inDialog(deleteInDays)?.click();
    await vi.advanceTimersByTimeAsync(0);

    const open = document.querySelector('[role="alertdialog"]');
    expect(open?.textContent).toContain(retryWords(at) ?? 'no words');
    expect(toasts.error).not.toHaveBeenCalled();
    expect(nav.goto).not.toHaveBeenCalled();
  });

  test('Keep it from the bar puts it back off sale (LN4)', async () => {
    render(live({ ...LEAVING }));
    expect(text()).toContain(m.studio_leaving_bar_download({ count: 57 }));

    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.keepContent).toHaveBeenCalledWith('c1');
    expect(toasts.success).toHaveBeenCalledWith(m.studio_leaving_kept_here());
    expect(document.querySelector('.live-pill')?.textContent?.trim()).toBe(
      m.studio_live_badge_unpublished()
    );
    expect(button(m.studio_leaving_keep())).toBeUndefined();
  });

  test('Keep it from Settings, where Publish again gives way to it', async () => {
    render(live({ ...LEAVING }));
    openTab(m.studio_live_tab_settings());
    expect(button(m.studio_live_republish())).toBeUndefined();
    expect(text()).toContain(m.studio_leaving_keep_hint({ date }));

    // The bar's is first; Settings' is the last.
    const keeps = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].filter((node) => node.textContent?.trim() === m.studio_leaving_keep());
    expect(keeps).toHaveLength(2);
    keeps.at(-1)?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.keepContent).toHaveBeenCalledWith('c1');
    expect(button(m.studio_live_republish())).toBeDefined();
  });

  test('a Keep refused as the org’s says so, and the bar becomes its note (403)', async () => {
    remotes.keepContent.mockRejectedValueOnce({
      status: 403,
      body: { code: 'CONTENT_LEAVE_NOT_YOURS', message: 'x' },
    });
    render(live({ ...LEAVING }));
    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);

    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_leaving_keep_not_yours({ title: 'Advanced Svelte Patterns' })
    );
    expect(text()).toContain(m.studio_leaving_org_note({ date }));
    expect(button(m.studio_leaving_keep())).toBeUndefined();
  });

  test('a piece the org’s delete alone holds is a note: no Keep, no Publish (owner 2026-11-20)', () => {
    render(live({ ...LEAVING, leavingByCreator: false, leavingByOrg: true }));
    expect(text()).toContain(m.studio_leaving_org_note({ date }));
    expect(button(m.studio_leaving_keep())).toBeUndefined();

    openTab(m.studio_live_tab_settings());
    expect(button(m.studio_leaving_keep())).toBeUndefined();
    expect(button(m.studio_live_republish())).toBeUndefined();
    expect(button(m.studio_live_delete())).toBeUndefined();
  });

  // "Delete it too" (owner 2026-11-20): the creator's delete beside the org's.
  const orgOnly = { ...LEAVING, leavingByCreator: false, leavingByOrg: true };
  const deleteToo = () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (node) => node.textContent?.trim() === m.studio_leaving_delete_too()
    );

  test('Delete it too, from the bar: its confirm says the owners were already told, then Keep it is offered beside the org’s delete', async () => {
    remotes.deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 57,
      started: false,
      leavingByCreator: true,
      leavingByOrg: true,
    });
    render(live(orgOnly));
    expect(deleteToo()).toHaveLength(1);

    deleteToo()[0]?.click();
    flushSync();
    const open = document.querySelector('[role="alertdialog"]');
    expect(open?.textContent).toContain(
      m.studio_leaving_delete_too_title({ title: 'Advanced Svelte Patterns' })
    );
    expect(open?.textContent).toContain(
      m.studio_leaving_delete_too_body({ date })
    );
    expect(open?.textContent).not.toContain('emailed today');
    expect(
      inDialog(m.studio_content_delete_unpublish_instead())
    ).toBeUndefined();

    inDialog(m.studio_leaving_delete_too_confirm())?.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.deleteContent).toHaveBeenCalledWith('c1');
    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_leaving_deleted_too({ title: 'Advanced Svelte Patterns', date })
    );
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(nav.goto).not.toHaveBeenCalled();
    // Both deletes hold it: Keep it, and a line that the org deleted it too.
    expect(text()).toContain(m.studio_leaving_bar_org_too());
    expect(button(m.studio_leaving_keep())).toBeDefined();
    expect(deleteToo()).toHaveLength(0);
  });

  test('Delete it too, from Settings, asks the same, in place of Delete', () => {
    render(live(orgOnly));
    openTab(m.studio_live_tab_settings());
    // The bar's is first; Settings' is the last.
    expect(deleteToo()).toHaveLength(2);
    expect(button(m.studio_live_delete())).toBeUndefined();

    deleteToo().at(-1)?.click();
    flushSync();
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent
    ).toContain(
      m.studio_leaving_delete_too_title({ title: 'Advanced Svelte Patterns' })
    );
  });

  test('a Keep of a piece both deletes hold withdraws only the creator’s: back to the org’s note, with Delete it too', async () => {
    remotes.keepContent.mockResolvedValueOnce({
      kept: false,
      staying: 0,
      stillLeavingBy: 'org',
    });
    render(live({ ...LEAVING, leavingByOrg: true }));
    expect(text()).toContain(m.studio_leaving_bar_org_too());
    expect(deleteToo()).toHaveLength(0);

    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.keepContent).toHaveBeenCalledWith('c1');
    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_leaving_kept_here_org_stands({ date })
    );
    expect(text()).toContain(m.studio_leaving_org_note({ date }));
    expect(text()).not.toContain(m.studio_leaving_bar_org_too());
    expect(button(m.studio_leaving_keep())).toBeUndefined();
    expect(deleteToo()).toHaveLength(1);
  });

  // Review round 1, M1: a refused Keep keeps the refusal's words.
  test('a Keep of a piece already gone says so, and offers no Keep any more (404)', async () => {
    remotes.keepContent.mockRejectedValueOnce({
      status: 404,
      body: { code: 'CONTENT_NOT_FOUND', message: 'Content not found' },
    });
    render(live({ ...LEAVING }));
    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);

    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_leaving_keep_gone({ title: 'Advanced Svelte Patterns' })
    );
    expect(button(m.studio_leaving_keep())).toBeUndefined();
    expect(text()).not.toContain(m.studio_leaving_bar_title({ date }));
  });

  test('a Keep after the sign-in lapsed says to sign in, and the leave stands (401)', async () => {
    remotes.keepContent.mockRejectedValueOnce({
      status: 401,
      body: { code: 'UNAUTHORIZED', message: 'Not signed in' },
    });
    render(live({ ...LEAVING }));
    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);

    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_content_draft_signed_out()
    );
    expect(button(m.studio_leaving_keep())).toBeDefined();
  });

  test('a Keep refused by a rule says the rule’s own words', async () => {
    remotes.keepContent.mockRejectedValueOnce({
      status: 409,
      body: { code: 'CONFLICT', message: 'It is being deleted right now.' },
    });
    render(live({ ...LEAVING }));
    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);

    expect(toasts.error).toHaveBeenCalledWith('It is being deleted right now.');
  });

  /** Settings' download switch. */
  const downloadSwitch = () =>
    document.querySelector<HTMLButtonElement>('button[role="switch"]');

  // Review round 1, M2: a delete tells its owners what is saved.
  test('the Delete dialog says what is saved, not the switch’s unsaved change, and says so; the change goes back once it leaves', async () => {
    remotes.deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 3,
      started: true,
      leavingByCreator: true,
      leavingByOrg: false,
    });
    render(
      live({
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        holderCount: 3,
        ownersCanDownload: true,
      })
    );
    openTab(m.studio_live_tab_settings());
    downloadSwitch()?.click();
    flushSync();
    expect(downloadSwitch()?.getAttribute('aria-checked')).toBe('false');

    click(m.studio_live_delete());
    const open = document.querySelector('[role="alertdialog"]');
    expect(open?.textContent).toContain(
      m.studio_leaving_delete_body_download({
        date: formatSentenceDate(leaveDayFrom()),
      })
    );
    expect(open?.textContent).toContain(
      m.studio_leaving_delete_download_unsaved()
    );

    inDialog(deleteInDays)?.click();
    await vi.advanceTimersByTimeAsync(0);

    // Leaving: held as they were told, and said.
    expect(downloadSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(downloadSwitch()?.disabled).toBe(true);
    expect(text()).toContain(m.studio_leaving_download_locked());
  });

  /** Delete, confirmed, answered with a leave that started nothing, held by `sides`. */
  async function deleteAddingSide(sides: {
    leavingByCreator: boolean;
    leavingByOrg: boolean;
  }) {
    remotes.deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 3,
      started: false,
      ...sides,
    });
    render(live({ holderCount: 3 }));
    openTab(m.studio_live_tab_settings());
    click(m.studio_live_delete());
    inDialog(deleteInDays)?.click();
    await vi.advanceTimersByTimeAsync(0);
  }

  // Review rounds 1 and 2: a delete that started nothing emailed nobody, and
  // says whose deletes hold it as the delete answered, with no read.
  test('a delete beside the org’s says it leaves even if the org keeps it, held by both', async () => {
    await deleteAddingSide({ leavingByCreator: true, leavingByOrg: true });

    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_leaving_deleted_too({ title: 'Advanced Svelte Patterns', date })
    );
    expect(remotes.readLeaveState).not.toHaveBeenCalled();
    expect(text()).toContain(m.studio_leaving_bar_org_too());
    expect(button(m.studio_leaving_keep())).toBeDefined();
  });

  test('a repeat of the creator’s own delete (a second tab) names no org: it was already leaving', async () => {
    await deleteAddingSide({ leavingByCreator: true, leavingByOrg: false });

    expect(toasts.success).toHaveBeenCalledWith(
      m.studio_leaving_deleted_again({
        title: 'Advanced Svelte Patterns',
        date,
      })
    );
    expect(text()).not.toContain(m.studio_leaving_bar_org_too());
    expect(button(m.studio_leaving_keep())).toBeDefined();
  });

  // Owner 2026-11-21: the switch holds as its owners were told.
  test('while it leaves, the download switch is held and says who told them: you, your org, or both', () => {
    const paid = { isFree: false, isPurchasable: true, priceCents: 499 };
    const sides = [
      [
        { leavingByCreator: true, leavingByOrg: false },
        m.studio_leaving_download_locked(),
      ],
      [
        { leavingByCreator: false, leavingByOrg: true },
        m.studio_leaving_download_locked_org(),
      ],
      [
        { leavingByCreator: true, leavingByOrg: true },
        m.studio_leaving_download_locked_both(),
      ],
    ] as const;
    for (const [held, words] of sides) {
      render(live({ ...LEAVING, ...paid, ...held }));
      openTab(m.studio_live_tab_settings());
      expect(downloadSwitch()?.disabled).toBe(true);
      expect(text()).toContain(words);
      if (component) unmount(component);
      component = null;
      document.body.innerHTML = '';
    }
  });

  /** The switch changed and Update refused as leaving: it started elsewhere. */
  async function updateRefusedAsLeaving() {
    remotes.saveContent.mockRejectedValueOnce({
      status: 409,
      body: {
        code: 'CONTENT_LEAVING',
        message:
          'Its owners were told when it was deleted whether they can download it. Keep it first, then change that.',
      },
    });
    render(
      live({
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        holderCount: 3,
        ownersCanDownload: true,
      })
    );
    openTab(m.studio_live_tab_settings());
    downloadSwitch()?.click();
    flushSync();
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);
  }

  // Review round 2, M1: the refusal reads the leave, so the screen shows it.
  test('an Update refused as leaving reads the leave: the org’s note, the switch locked, and the org’s words', async () => {
    remotes.readLeaveState.mockResolvedValueOnce({
      leavesAt: LEAVES_AT,
      leavingByCreator: false,
      leavingByOrg: true,
    });
    await updateRefusedAsLeaving();

    expect(remotes.readLeaveState).toHaveBeenCalledWith('c1');
    expect(downloadSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(downloadSwitch()?.disabled).toBe(true);
    expect(text()).toContain(m.studio_leaving_org_note({ date }));
    expect(button(m.studio_leaving_keep())).toBeUndefined();
    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_leaving_download_locked_org()
    );
    expect(toasts.error).not.toHaveBeenCalledWith(
      m.studio_leaving_download_refused()
    );
  });

  test('an Update refused as leaving by the creator’s own delete says it stays until they keep it, and offers Keep', async () => {
    remotes.readLeaveState.mockResolvedValueOnce({
      leavesAt: LEAVES_AT,
      leavingByCreator: true,
      leavingByOrg: false,
    });
    await updateRefusedAsLeaving();

    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_leaving_download_refused()
    );
    expect(button(m.studio_leaving_keep())).toBeDefined();
  });

  // Review round 3, L1: a failed read is not "not leaving".
  test('an Update refused as leaving whose leave can’t be read asks for a reload, the switch put back', async () => {
    remotes.readLeaveState.mockRejectedValueOnce(new Error('down'));
    await updateRefusedAsLeaving();

    expect(toasts.error).toHaveBeenCalledWith(m.studio_editor_failed());
    expect(toasts.error).not.toHaveBeenCalledWith(
      m.studio_leaving_download_locked_both()
    );
    expect(downloadSwitch()?.getAttribute('aria-checked')).toBe('true');
  });

  test('an Update refused as leaving, read as kept meanwhile, keeps the change for the next Update', async () => {
    remotes.readLeaveState.mockResolvedValueOnce({
      leavesAt: null,
      leavingByCreator: false,
      leavingByOrg: false,
    });
    await updateRefusedAsLeaving();

    expect(toasts.error).toHaveBeenCalledWith(
      m.studio_content_draft_save_failed()
    );
    expect(downloadSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(downloadSwitch()?.disabled).toBe(false);
  });

  // Review round 3, L2: the refusal's "Keep it first" goes with the switch.
  test('with another change waiting, a switch put back takes the bar’s refusal with it', async () => {
    remotes.readLeaveState.mockResolvedValueOnce({
      leavesAt: LEAVES_AT,
      leavingByCreator: false,
      leavingByOrg: true,
    });
    remotes.saveContent.mockRejectedValueOnce({
      status: 409,
      body: {
        code: 'CONTENT_LEAVING',
        message:
          'Its owners were told when it was deleted whether they can download it. Keep it first, then change that.',
      },
    });
    render(
      live({
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        holderCount: 3,
        ownersCanDownload: true,
      })
    );
    typeTitle('A new title');
    openTab(m.studio_live_tab_settings());
    downloadSwitch()?.click();
    flushSync();
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    expect(text()).toContain(m.studio_leaving_org_note({ date }));
    // The title still waits for Update; the refusal does not stay.
    expect(text()).toContain(m.studio_live_changes_one());
    expect(text()).not.toContain('Keep it first');
  });

  // Review round 2, L: a read still out when a Keep lands is older than it.
  test('a leave read still out when a Keep lands is dropped: the Keep stands', async () => {
    let land: (sides: unknown) => void = () => {};
    remotes.readLeaveState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          land = resolve;
        })
    );
    remotes.deleteContent.mockResolvedValueOnce({
      outcome: 'leaving',
      leavesAt: LEAVES_AT,
      holders: 3,
      started: true,
      leavingByCreator: true,
      leavingByOrg: false,
    });
    await updateRefusedAsLeaving();
    // The read is out. The creator deletes here, then keeps it.
    click(m.studio_live_delete());
    inDialog(deleteInDays)?.click();
    await vi.advanceTimersByTimeAsync(0);
    click(m.studio_leaving_keep());
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.success).toHaveBeenCalledWith(m.studio_leaving_kept_here());

    land({ leavesAt: LEAVES_AT, leavingByCreator: true, leavingByOrg: false });
    await vi.advanceTimersByTimeAsync(0);

    expect(button(m.studio_leaving_keep())).toBeUndefined();
    expect(text()).not.toContain(m.studio_leaving_bar_title({ date }));
  });

  // Review round 1, L1 (backend): a count the read did not send is not known.
  test('a Delete of a piece whose owners the read did not count never says nobody owns it', () => {
    render(live({ holderCount: undefined }));
    openTab(m.studio_live_tab_settings());
    click(m.studio_live_delete());
    const open = document.querySelector('[role="alertdialog"]');
    expect(open?.textContent).toContain(
      m.studio_leaving_delete_unknown({
        date: formatSentenceDate(leaveDayFrom()),
      })
    );
    expect(open?.textContent).not.toContain(m.studio_content_delete_one_body());
  });

  test('Owners can download it is a switch on Buy once, never a radio, and goes with Update (N1-B)', async () => {
    render(live({ isFree: false, isPurchasable: true, priceCents: 499 }));
    openTab(m.studio_live_tab_settings());
    const toggle = document.querySelector<HTMLButtonElement>(
      'button[role="switch"]'
    );
    if (!toggle) throw new Error('no download switch');
    expect(toggle.closest('[role="radiogroup"]')).toBeNull();
    const labelId = toggle.getAttribute('aria-labelledby') ?? '';
    expect(document.getElementById(labelId)?.textContent).toBe(
      m.studio_leaving_download_label()
    );
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    toggle.click();
    flushSync();
    click(m.studio_live_update());
    await vi.advanceTimersByTimeAsync(0);

    expect(remotes.saveContent).toHaveBeenCalledWith({
      id: 'c1',
      patch: { ownersCanDownload: false },
    });
  });

  test('moving a piece people own to Followers says they keep it (LN5)', () => {
    render(
      live({
        isFree: false,
        isPurchasable: true,
        priceCents: 499,
        holderCount: 57,
      })
    );
    openTab(m.studio_live_tab_settings());
    expect(text()).not.toContain(
      m.studio_leaving_access_owners_keep({ count: 57 })
    );
    const followers = document.querySelector<HTMLInputElement>(
      'input[type="radio"][value="followers"]'
    );
    if (!followers) throw new Error('no Followers option');
    followers.click();
    flushSync();

    expect(text()).toContain(
      m.studio_leaving_access_owners_keep({ count: 57 })
    );
  });
});
