import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BrandEditorState } from '$lib/brand-editor';
import {
  BRAND_PREVIEW_MESSAGE_TYPE,
  createBrandPreviewSender,
} from '$lib/brand-editor';
import type { PreviewFrameLoad } from './preview-canvas';
import { createPreviewWiring } from './preview-wiring';

/**
 * The WP-1.4 preview seam. createPreviewWiring binds a REAL
 * createBrandPreviewSender to the two operations the /studio/brand route drives:
 * registerFrame (on iframe load) and pushSnapshot (on every edit). These tests
 * drive a pending snapshot through the wiring and assert the framed window's
 * postMessage received it with the explicit same-origin targetOrigin (never
 * '*'). A dropped register/send call breaks them — the reason the seam was
 * lifted out of an untestable `.svelte` $effect (WP-1.8).
 */

const ORIGIN = 'https://acme.example';

function makePending(primaryColor = '#3B82F6'): BrandEditorState {
  return {
    primaryColor,
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
  };
}

// Minimal iframe stub — the sender's post path only reads `isConnected` and
// `contentWindow.postMessage`.
function makeFrame(): {
  element: HTMLIFrameElement;
  postMessage: ReturnType<typeof vi.fn>;
} {
  const postMessage = vi.fn();
  const element = {
    isConnected: true,
    contentWindow: { postMessage },
  } as unknown as HTMLIFrameElement;
  return { element, postMessage };
}

function frameLoad(
  element: HTMLIFrameElement,
  origin = ORIGIN
): PreviewFrameLoad {
  return {
    window: element.contentWindow as Window,
    element,
    origin,
    route: 'landing',
    theme: 'light',
  };
}

describe('createPreviewWiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('pushSnapshot broadcasts the pending vars to a registered frame with an explicit targetOrigin', () => {
    const sender = createBrandPreviewSender();
    const wiring = createPreviewWiring(sender);
    const { element, postMessage } = makeFrame();

    wiring.registerFrame(frameLoad(element));
    const pending = makePending('#123456');
    wiring.pushSnapshot(pending);

    // send() debounces (~50ms) — nothing is posted until the timer fires.
    expect(postMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = postMessage.mock.calls[0];
    expect(message).toEqual({
      type: BRAND_PREVIEW_MESSAGE_TYPE,
      vars: pending,
    });
    expect(targetOrigin).toBe(ORIGIN); // explicit origin, never '*'

    sender.destroy();
  });

  test('pushSnapshot reaches every registered frame (multi-frame split view)', () => {
    const sender = createBrandPreviewSender();
    const wiring = createPreviewWiring(sender);
    const a = makeFrame();
    const b = makeFrame();

    wiring.registerFrame(frameLoad(a.element, 'https://a.example'));
    wiring.registerFrame(frameLoad(b.element, 'https://b.example'));
    wiring.pushSnapshot(makePending());
    vi.advanceTimersByTime(60);

    expect(a.postMessage).toHaveBeenCalledTimes(1);
    expect(b.postMessage).toHaveBeenCalledTimes(1);
    // Each frame is posted to its OWN explicit origin.
    expect(a.postMessage.mock.calls[0][1]).toBe('https://a.example');
    expect(b.postMessage.mock.calls[0][1]).toBe('https://b.example');

    sender.destroy();
  });
});
