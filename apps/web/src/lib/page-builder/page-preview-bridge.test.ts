/**
 * Page-builder preview bridge tests (Codex-2pryk.3.3 · WP-5).
 *
 * This is a security + correctness boundary (the `codex:page-preview:v1`
 * protocol), so it is tested as one, mirroring the brand-bridge suite:
 *   - SENDER: a pending edit posts a debounced, versioned message carrying the
 *     PageBuilderState with an EXPLICIT targetOrigin (never '*'); rapid edits
 *     coalesce (latest wins); a (re)loaded frame is re-synced; a copy edit never
 *     reloads or swaps src; a disconnected split frame is pruned.
 *   - APPLIER: a well-formed same-origin message from the parent frame applies
 *     the draft (store pending); every ill-formed / cross-origin / non-parent /
 *     wrong-type / standalone case is a proven no-op.
 */

import type { PageBuilderState } from '@codex/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageBuilder } from './page-builder-store.svelte';
import {
  createPagePreviewSender,
  initPagePreviewBridge,
} from './page-preview-bridge';
import {
  PAGE_PREVIEW_MESSAGE_TYPE,
  type PagePreviewMessage,
} from './preview-protocol';

const ORIGIN = 'https://acme.example';

function makePage(overrides: Partial<PageBuilderState> = {}): PageBuilderState {
  return {
    pageType: 'course',
    slug: 'stillness',
    title: 'Stillness',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    sections: [{ id: 'sec-hero', type: 'hero', enabled: true, props: {} }],
    ...overrides,
  };
}

// ── Fake preview frame ───────────────────────────────────────────────────────
interface FakeFrame {
  element: HTMLIFrameElement;
  posts: Array<{ message: unknown; targetOrigin: string }>;
  reload: ReturnType<typeof vi.fn>;
  setConnected(connected: boolean): void;
  readonly src: string;
}

function makeFrame(): FakeFrame {
  const posts: Array<{ message: unknown; targetOrigin: string }> = [];
  const reload = vi.fn();
  let connected = true;
  let src = '/';
  const contentWindow = {
    postMessage: (message: unknown, targetOrigin: string) => {
      posts.push({ message, targetOrigin });
    },
    location: { reload },
  } as unknown as Window;
  const element = {
    get isConnected() {
      return connected;
    },
    get contentWindow() {
      return contentWindow;
    },
    get src() {
      return src;
    },
    set src(value: string) {
      src = value;
    },
  } as unknown as HTMLIFrameElement;
  return {
    element,
    posts,
    reload,
    setConnected(value) {
      connected = value;
    },
    get src() {
      return src;
    },
  };
}

// ── Fake target window (for the applier) ─────────────────────────────────────
function makeTarget(origin = ORIGIN) {
  const messageListeners = new Set<(event: MessageEvent) => void>();
  const target = {
    location: { origin } as Location,
    addEventListener: (type: string, cb: (event: MessageEvent) => void) => {
      if (type === 'message') messageListeners.add(cb);
    },
    removeEventListener: (type: string, cb: (event: MessageEvent) => void) => {
      if (type === 'message') messageListeners.delete(cb);
    },
  } as unknown as Window & { parent: Window };
  const parent = {} as Window;
  target.parent = parent;
  return {
    target,
    parent,
    /** Force standalone: parent === target (a real visitor's top window). */
    makeStandalone() {
      target.parent = target;
    },
    dispatch(event: Partial<MessageEvent>) {
      for (const cb of messageListeners) cb(event as MessageEvent);
    },
    listenerCount() {
      return messageListeners.size;
    },
  };
}

describe('createPagePreviewSender (studio → iframe)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts a versioned message with the page draft and an explicit targetOrigin after debounce', () => {
    const sender = createPagePreviewSender({ debounceMs: 50 });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN); // latest is null → no immediate post
    expect(frame.posts).toHaveLength(0);

    sender.send(makePage({ title: 'Edited' }));
    expect(frame.posts).toHaveLength(0); // debounced — not yet
    vi.advanceTimersByTime(50);

    expect(frame.posts).toHaveLength(1);
    const { message, targetOrigin } = frame.posts[0];
    expect(targetOrigin).toBe(ORIGIN);
    expect(targetOrigin).not.toBe('*'); // NEVER wildcard
    const msg = message as PagePreviewMessage;
    expect(msg.type).toBe(PAGE_PREVIEW_MESSAGE_TYPE);
    expect(msg.page.title).toBe('Edited');
    sender.destroy();
  });

  it('coalesces rapid edits into a single post (latest wins)', () => {
    const sender = createPagePreviewSender({ debounceMs: 50 });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);

    sender.send(makePage({ title: 'one' }));
    sender.send(makePage({ title: 'two' }));
    sender.send(makePage({ title: 'three' }));
    expect(frame.posts).toHaveLength(0);
    vi.advanceTimersByTime(50);

    expect(frame.posts).toHaveLength(1);
    expect((frame.posts[0].message as PagePreviewMessage).page.title).toBe(
      'three'
    );
    sender.destroy();
  });

  it('re-sends the latest draft to a frame that (re)loads', () => {
    const sender = createPagePreviewSender({ debounceMs: 50 });
    sender.send(makePage({ title: 'restored' }));
    vi.advanceTimersByTime(50); // latest captured; no frames registered yet

    const frame = makeFrame();
    sender.register(frame.element, ORIGIN); // immediate re-send on load
    expect(frame.posts).toHaveLength(1);
    expect((frame.posts[0].message as PagePreviewMessage).page.title).toBe(
      'restored'
    );
    expect(frame.posts[0].targetOrigin).toBe(ORIGIN);
    sender.destroy();
  });

  it('does NOT reload or reassign src on a copy edit (no per-edit reload)', () => {
    const sender = createPagePreviewSender({ debounceMs: 50 });
    const frame = makeFrame();
    const srcBefore = frame.src;
    sender.register(frame.element, ORIGIN);

    sender.send(makePage({ title: 'streamed' }));
    vi.advanceTimersByTime(50);

    expect(frame.posts).toHaveLength(1); // applied via message …
    expect(frame.reload).not.toHaveBeenCalled(); // … not via reload
    expect(frame.src).toBe(srcBefore); // … not via src swap
    sender.destroy();
  });

  it('prunes a disconnected frame without throwing', () => {
    const sender = createPagePreviewSender({ debounceMs: 10 });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);
    frame.setConnected(false); // split frame unmounted

    sender.send(makePage());
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(frame.posts).toHaveLength(0);
    sender.destroy();
  });
});

describe('initPagePreviewBridge (iframe applier)', () => {
  beforeEach(() => {
    pageBuilder.close(); // reset the module-singleton store: pending → null
  });
  afterEach(() => {
    pageBuilder.close();
  });

  it('applies the draft from a well-formed same-origin message sent by the parent frame', () => {
    const win = makeTarget();
    const teardown = initPagePreviewBridge(win.target);
    expect(win.listenerCount()).toBe(1);
    expect(pageBuilder.pending).toBeNull();

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: {
        type: PAGE_PREVIEW_MESSAGE_TYPE,
        page: makePage({ title: 'live' }),
      },
    });

    expect(pageBuilder.pending?.title).toBe('live');
    expect(pageBuilder.isOpen).toBe(true);
    // A preview frame never owns a persisted pageId.
    expect(pageBuilder.pageId).toBeNull();
    teardown();
  });

  it('is INERT on a standalone (non-embedded) page — adds no listener', () => {
    const win = makeTarget();
    win.makeStandalone(); // window.parent === window
    const teardown = initPagePreviewBridge(win.target);

    expect(win.listenerCount()).toBe(0);
    expect(pageBuilder.pending).toBeNull();
    expect(() => teardown()).not.toThrow();
  });

  it('ignores a message from a DIFFERENT origin (cross-origin)', () => {
    const win = makeTarget();
    const teardown = initPagePreviewBridge(win.target);

    win.dispatch({
      source: win.parent,
      origin: 'https://evil.example',
      data: { type: PAGE_PREVIEW_MESSAGE_TYPE, page: makePage() },
    });

    expect(pageBuilder.pending).toBeNull();
    teardown();
  });

  it('ignores a message whose source is NOT the parent frame', () => {
    const win = makeTarget();
    const teardown = initPagePreviewBridge(win.target);

    win.dispatch({
      source: {} as Window,
      origin: ORIGIN,
      data: { type: PAGE_PREVIEW_MESSAGE_TYPE, page: makePage() },
    });

    expect(pageBuilder.pending).toBeNull();
    teardown();
  });

  it('ignores a message with the wrong type', () => {
    const win = makeTarget();
    const teardown = initPagePreviewBridge(win.target);

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: { type: 'codex:brand-preview:v1', page: makePage() },
    });

    expect(pageBuilder.pending).toBeNull();
    teardown();
  });

  it('ignores a message with no page / non-object payload', () => {
    const win = makeTarget();
    const teardown = initPagePreviewBridge(win.target);

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: { type: PAGE_PREVIEW_MESSAGE_TYPE }, // absent page
    });
    win.dispatch({ source: win.parent, origin: ORIGIN, data: 'not-an-object' });
    win.dispatch({ source: win.parent, origin: ORIGIN, data: null });

    expect(pageBuilder.pending).toBeNull();
    teardown();
  });

  it('teardown removes the message listener', () => {
    const win = makeTarget();
    const teardown = initPagePreviewBridge(win.target);
    expect(win.listenerCount()).toBe(1);

    teardown();
    expect(win.listenerCount()).toBe(0);

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: {
        type: PAGE_PREVIEW_MESSAGE_TYPE,
        page: makePage({ title: 'late' }),
      },
    });
    expect(pageBuilder.pending).toBeNull();
  });
});
