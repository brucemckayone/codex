/**
 * Brand preview bridge tests (Codex-cijzb · WP-1.4)
 *
 * This is a security + correctness boundary, so it is tested as one:
 *   - SENDER: a pending change posts a debounced, versioned message with the
 *     correct vars and an EXPLICIT targetOrigin (never '*'); rapid edits
 *     coalesce; a (re)loaded frame is re-synced; a CSS-var edit never reloads.
 *   - APPLIER: a well-formed same-origin message from the parent frame applies
 *     the vars (store pending); every ill-formed / cross-origin / non-parent /
 *     wrong-type / standalone case is a proven no-op (each seeds a real rejected
 *     message and asserts nothing applied — the tests can fail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultOptions } from '$lib/org-hero/hero-config';
import { brandEditor } from './brand-editor-store.svelte';
import {
  BRAND_PREVIEW_MESSAGE_TYPE,
  BRAND_PREVIEW_RESOLVED_TYPE,
  type BrandPreviewMessage,
  type BrandPreviewResolved,
  createBrandPreviewSender,
  initBrandPreviewBridge,
  reportPreviewResolved,
} from './brand-preview-bridge';
import type { BrandEditorState } from './types';

const ORIGIN = 'https://acme.example';

function makeState(
  overrides: Partial<BrandEditorState> = {}
): BrandEditorState {
  return {
    primaryColor: '#3B82F6',
    secondaryColor: null,
    accentColor: null,
    backgroundColor: null,
    fontBody: null,
    fontHeading: null,
    radius: 0.5,
    density: 1,
    logoUrl: null,
    tokenOverrides: {},
    darkOverrides: null,
    darkTokenOverrides: null,
    heroLayout: 'default',
    ...overrides,
  };
}

// ── Fake preview frame ───────────────────────────────────────────────────────
// Records postMessage calls to its contentWindow and exposes reload / src spies
// so the "no per-edit reload" test can prove the applier path never navigates.

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
// Fully controllable: message listeners are captured so we can dispatch
// synthetic MessageEvents with an arbitrary source/origin/data.

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
  // Default: embedded (parent is a distinct window).
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

describe('createBrandPreviewSender (studio → iframe)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts a versioned message with the vars and an explicit targetOrigin after debounce', () => {
    const sender = createBrandPreviewSender({ debounceMs: 50 });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN); // latest is null → no immediate post
    expect(frame.posts).toHaveLength(0);

    sender.send(makeState({ primaryColor: '#ff0000' }));
    expect(frame.posts).toHaveLength(0); // debounced — not yet
    vi.advanceTimersByTime(50);

    expect(frame.posts).toHaveLength(1);
    const { message, targetOrigin } = frame.posts[0];
    expect(targetOrigin).toBe(ORIGIN);
    expect(targetOrigin).not.toBe('*'); // NEVER wildcard
    const msg = message as BrandPreviewMessage;
    expect(msg.type).toBe(BRAND_PREVIEW_MESSAGE_TYPE);
    expect(msg.vars.primaryColor).toBe('#ff0000');
    sender.destroy();
  });

  it('coalesces rapid edits into a single post (latest wins)', () => {
    const sender = createBrandPreviewSender({ debounceMs: 50 });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);

    sender.send(makeState({ primaryColor: '#111111' }));
    sender.send(makeState({ primaryColor: '#222222' }));
    sender.send(makeState({ primaryColor: '#333333' }));
    expect(frame.posts).toHaveLength(0);
    vi.advanceTimersByTime(50);

    expect(frame.posts).toHaveLength(1);
    expect(
      (frame.posts[0].message as BrandPreviewMessage).vars.primaryColor
    ).toBe('#333333');
    sender.destroy();
  });

  it('re-sends the latest state to a frame that (re)loads', () => {
    const sender = createBrandPreviewSender({ debounceMs: 50 });
    sender.send(makeState({ primaryColor: '#abcdef' }));
    vi.advanceTimersByTime(50); // latest captured; no frames registered yet

    const frame = makeFrame();
    sender.register(frame.element, ORIGIN); // immediate re-send on load
    expect(frame.posts).toHaveLength(1);
    expect(
      (frame.posts[0].message as BrandPreviewMessage).vars.primaryColor
    ).toBe('#abcdef');
    expect(frame.posts[0].targetOrigin).toBe(ORIGIN);
    sender.destroy();
  });

  it('does NOT reload or reassign src on a CSS-var edit (no per-edit reload)', () => {
    const sender = createBrandPreviewSender({ debounceMs: 50 });
    const frame = makeFrame();
    const srcBefore = frame.src;
    sender.register(frame.element, ORIGIN);

    sender.send(makeState({ primaryColor: '#0f0f0f' }));
    vi.advanceTimersByTime(50);

    expect(frame.posts).toHaveLength(1); // applied via message …
    expect(frame.reload).not.toHaveBeenCalled(); // … not via reload
    expect(frame.src).toBe(srcBefore); // … not via src swap
    sender.destroy();
  });

  it('prunes a disconnected frame without throwing', () => {
    const sender = createBrandPreviewSender({ debounceMs: 10 });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);
    frame.setConnected(false); // split frame unmounted

    sender.send(makeState());
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(frame.posts).toHaveLength(0);
    sender.destroy();
  });
});

describe('initBrandPreviewBridge (iframe applier)', () => {
  beforeEach(() => {
    brandEditor.close(); // reset the module-singleton store: pending → null
  });
  afterEach(() => {
    brandEditor.close();
  });

  it('applies vars from a well-formed same-origin message sent by the parent frame', () => {
    const win = makeTarget();
    const teardown = initBrandPreviewBridge(win.target);
    expect(win.listenerCount()).toBe(1);
    expect(brandEditor.pending).toBeNull();

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: {
        type: BRAND_PREVIEW_MESSAGE_TYPE,
        vars: makeState({ primaryColor: '#123456' }),
      },
    });

    // Applied through the store → drives the WP-1.1 injection seam.
    expect(brandEditor.pending?.primaryColor).toBe('#123456');
    expect(brandEditor.isOpen).toBe(true);
    teardown();
  });

  it('is INERT on a standalone (non-embedded) page — adds no listener', () => {
    const win = makeTarget();
    win.makeStandalone(); // window.parent === window
    const teardown = initBrandPreviewBridge(win.target);

    expect(win.listenerCount()).toBe(0); // no listener attached at all
    // Even if a message somehow arrived, nothing could apply it.
    expect(brandEditor.pending).toBeNull();
    expect(() => teardown()).not.toThrow(); // no-op teardown
  });

  it('ignores a message from a DIFFERENT origin (cross-origin)', () => {
    const win = makeTarget();
    const teardown = initBrandPreviewBridge(win.target);

    win.dispatch({
      source: win.parent,
      origin: 'https://evil.example', // wrong origin
      data: {
        type: BRAND_PREVIEW_MESSAGE_TYPE,
        vars: makeState({ primaryColor: '#deadbe' }),
      },
    });

    expect(brandEditor.pending).toBeNull();
    teardown();
  });

  it('ignores a message whose source is NOT the parent frame', () => {
    const win = makeTarget();
    const teardown = initBrandPreviewBridge(win.target);

    win.dispatch({
      source: {} as Window, // not window.parent
      origin: ORIGIN,
      data: {
        type: BRAND_PREVIEW_MESSAGE_TYPE,
        vars: makeState({ primaryColor: '#deadbe' }),
      },
    });

    expect(brandEditor.pending).toBeNull();
    teardown();
  });

  it('ignores a message with the wrong type', () => {
    const win = makeTarget();
    const teardown = initBrandPreviewBridge(win.target);

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: { type: 'codex:something-else', vars: makeState() },
    });

    expect(brandEditor.pending).toBeNull();
    teardown();
  });

  it('ignores a message with no type / non-object payload', () => {
    const win = makeTarget();
    const teardown = initBrandPreviewBridge(win.target);

    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: { vars: makeState() }, // absent type
    });
    win.dispatch({ source: win.parent, origin: ORIGIN, data: 'not-an-object' });
    win.dispatch({ source: win.parent, origin: ORIGIN, data: null });

    expect(brandEditor.pending).toBeNull();
    teardown();
  });

  it('teardown removes the message listener', () => {
    const win = makeTarget();
    const teardown = initBrandPreviewBridge(win.target);
    expect(win.listenerCount()).toBe(1);

    teardown();
    expect(win.listenerCount()).toBe(0);

    // A post-teardown message must not apply.
    win.dispatch({
      source: win.parent,
      origin: ORIGIN,
      data: {
        type: BRAND_PREVIEW_MESSAGE_TYPE,
        vars: makeState({ primaryColor: '#654321' }),
      },
    });
    expect(brandEditor.pending).toBeNull();
  });
});

// ── The frame's report of what its hero resolved to ─────────────────────────

const RESOLVED: BrandPreviewResolved = {
  options: defaultOptions('consume', {
    hasShader: true,
    hasLogo: true,
    hasFilm: false,
    hasFilmLoop: false,
    hasFeatured: false,
    hasLatest: true,
    hasFeaturedImage: false,
    hasLatestImage: true,
    hasFacts: true,
    hasDescription: true,
    canJoin: false,
    hideTitle: false,
    hasReel: true,
  }),
  kind: 'listen',
  chosen: { purpose: 'consume', options: { lead: 'name' } },
};

/** A studio window: records its message listeners so a test can deliver. */
function makeStudio() {
  const listeners = new Set<(event: MessageEvent) => void>();
  return {
    target: {
      addEventListener: (type: string, cb: (event: MessageEvent) => void) => {
        if (type === 'message') listeners.add(cb);
      },
      removeEventListener: (
        type: string,
        cb: (event: MessageEvent) => void
      ) => {
        if (type === 'message') listeners.delete(cb);
      },
    } as Pick<Window, 'addEventListener' | 'removeEventListener'>,
    deliver(event: Partial<MessageEvent>) {
      for (const cb of listeners) cb(event as MessageEvent);
    },
    count: () => listeners.size,
  };
}

describe('the resolved report (iframe → studio)', () => {
  const report = { type: BRAND_PREVIEW_RESOLVED_TYPE, resolved: RESOLVED };

  it('hears a report from a tracked frame, at its origin', () => {
    const studio = makeStudio();
    const sender = createBrandPreviewSender({ target: studio.target });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);
    const heard: Array<BrandPreviewResolved | null> = [];
    sender.onResolved((r) => heard.push(r));
    studio.deliver({
      source: frame.element.contentWindow,
      origin: ORIGIN,
      data: report,
    });
    expect(heard).toEqual([RESOLVED]);
    sender.destroy();
  });

  it('hears a withdrawal (null) from a tracked frame, as the landing leaves', () => {
    const studio = makeStudio();
    const sender = createBrandPreviewSender({ target: studio.target });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);
    const heard: Array<BrandPreviewResolved | null> = [];
    sender.onResolved((r) => heard.push(r));
    const gone = { type: BRAND_PREVIEW_RESOLVED_TYPE, resolved: null };
    studio.deliver({
      source: frame.element.contentWindow,
      origin: ORIGIN,
      data: report,
    });
    studio.deliver({
      source: frame.element.contentWindow,
      origin: ORIGIN,
      data: gone,
    });
    // From anyone else it is ignored, like any report.
    studio.deliver({ source: {} as Window, origin: ORIGIN, data: gone });
    expect(heard).toEqual([RESOLVED, null]);
    sender.destroy();
  });

  it('ignores a report from another window, another origin, or of the wrong shape', () => {
    const studio = makeStudio();
    const sender = createBrandPreviewSender({ target: studio.target });
    const frame = makeFrame();
    sender.register(frame.element, ORIGIN);
    const heard: unknown[] = [];
    sender.onResolved((r) => heard.push(r));
    const own = frame.element.contentWindow;
    studio.deliver({ source: {} as Window, origin: ORIGIN, data: report });
    studio.deliver({
      source: own,
      origin: 'https://evil.example',
      data: report,
    });
    studio.deliver({
      source: own,
      origin: ORIGIN,
      data: { ...report, type: BRAND_PREVIEW_MESSAGE_TYPE },
    });
    studio.deliver({
      source: own,
      origin: ORIGIN,
      data: {
        type: BRAND_PREVIEW_RESOLVED_TYPE,
        resolved: { options: RESOLVED.options, kind: 'dance' },
      },
    });
    // No `chosen`: not a report the editor can judge as current.
    studio.deliver({
      source: own,
      origin: ORIGIN,
      data: {
        type: BRAND_PREVIEW_RESOLVED_TYPE,
        resolved: { options: RESOLVED.options, kind: 'listen' },
      },
    });
    studio.deliver({
      source: own,
      origin: ORIGIN,
      data: {
        type: BRAND_PREVIEW_RESOLVED_TYPE,
        resolved: { ...RESOLVED, chosen: { purpose: 7, options: {} } },
      },
    });
    expect(heard).toEqual([]);
    sender.destroy();
  });

  it('stops listening on teardown and on destroy', () => {
    const studio = makeStudio();
    const sender = createBrandPreviewSender({ target: studio.target });
    const teardown = sender.onResolved(() => {});
    sender.onResolved(() => {});
    expect(studio.count()).toBe(2);
    teardown();
    expect(studio.count()).toBe(1);
    sender.destroy();
    expect(studio.count()).toBe(0);
  });

  describe('reportPreviewResolved (the framed landing)', () => {
    beforeEach(() => brandEditor.close());
    afterEach(() => brandEditor.close());

    /** A framed page whose parent records what it is sent. */
    function framed() {
      const posts: Array<{ message: unknown; targetOrigin: string }> = [];
      const parent = {
        postMessage: (message: unknown, targetOrigin: string) =>
          posts.push({ message, targetOrigin }),
      } as unknown as Window;
      const target = {
        location: { origin: ORIGIN },
        parent,
      } as unknown as Window;
      return { target, posts };
    }

    it('posts the report to its parent at its own origin, once per change', () => {
      const page = framed();
      brandEditor.applyPreviewVars(makeState());
      reportPreviewResolved(RESOLVED, page.target);
      reportPreviewResolved(RESOLVED, page.target);
      expect(page.posts).toEqual([{ message: report, targetOrigin: ORIGIN }]);
      reportPreviewResolved({ ...RESOLVED, kind: 'read' }, page.target);
      expect(page.posts).toHaveLength(2);
    });

    it('withdraws its report with null, once, and reports afresh after', () => {
      const page = framed();
      brandEditor.applyPreviewVars(makeState());
      reportPreviewResolved(RESOLVED, page.target);
      reportPreviewResolved(null, page.target);
      reportPreviewResolved(null, page.target);
      reportPreviewResolved(RESOLVED, page.target);
      expect(page.posts.map((post) => post.message)).toEqual([
        report,
        { type: BRAND_PREVIEW_RESOLVED_TYPE, resolved: null },
        report,
      ]);
    });

    it('stays silent standalone, and in a frame that is not showing edits', () => {
      const page = framed();
      reportPreviewResolved(RESOLVED, page.target); // store closed: not a preview
      const standalone = {
        location: { origin: ORIGIN },
      } as unknown as Window & { parent: Window };
      standalone.parent = standalone;
      brandEditor.applyPreviewVars(makeState());
      reportPreviewResolved(RESOLVED, standalone);
      expect(page.posts).toEqual([]);
    });
  });
});
