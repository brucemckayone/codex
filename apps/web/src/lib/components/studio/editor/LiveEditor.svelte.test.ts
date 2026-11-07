/**
 * Editing a piece that has been live (Codex-a6ofh.2.5, mockup W5): two tabs
 * over one draft session, changes that wait for Update and go with it
 * alone, Discard, the editor's own leave question, the locked link, the
 * portals it is in, and what only a live piece has on Settings.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

const remotes = vi.hoisted(() => ({
  saveContent: vi.fn(),
  createContentDraft: vi.fn(),
  deleteThumbnailCommand: vi.fn(),
  deleteContent: vi.fn(),
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
  remotes.saveContent.mockResolvedValue({});
  remotes.unpublishContent.mockResolvedValue({});
  remotes.publishContent.mockResolvedValue({});
  remotes.deleteContent.mockResolvedValue(undefined);
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

describe('LiveEditor · changes wait for Update', () => {
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
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((node) => node.textContent?.trim() === m.studio_live_delete());
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
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((node) => node.textContent?.trim() === m.studio_live_delete())
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
