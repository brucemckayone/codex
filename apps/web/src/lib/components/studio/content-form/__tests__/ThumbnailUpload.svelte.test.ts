import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from '$lib/components/ui/Toast/toast-store';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ThumbnailUpload from '../ThumbnailUpload.svelte';
import {
  currentResult,
  emitResult,
  resetResult,
  seedStaleResult,
} from './upload-thumbnail-form-mock.svelte';

/**
 * ThumbnailUpload — stale-result regression tests. (Codex-1g5lh.11)
 *
 * A SvelteKit remote `form()` is a MODULE-LEVEL singleton whose `.result`
 * survives unmount and navigation. The component's result-watcher `$effect`
 * originally read that result unconditionally on mount, so arriving at
 * /studio/content/new straight after a successful upload elsewhere replayed the
 * previous page's side effects: a "Thumbnail uploaded" toast nobody triggered,
 * plus a stale `thumbnailUrl` written into the brand-new draft.
 *
 * The fix seeds an identity ref with `untrack(() => uploadThumbnailForm.result)`
 * so a pre-existing result is already marked handled, and only a NEW result
 * object — one produced by a submission during this mount — fires the handler.
 *
 * These tests are DB-free: the remote module is mocked, so nothing reaches a
 * worker or Postgres.
 */

// `$app/server` cannot resolve in jsdom, so the remote module must be mocked.
//
// `result` is a GETTER delegating to the reactive store, not a value read here:
// this factory runs while ThumbnailUpload is being evaluated, so reading an
// imported binding eagerly would depend on the two imports above staying in a
// particular order — which an import sorter is free to change. The getter is
// only invoked during render, by which point every module is initialised.
// (Resolving the store with `await import()` inside the factory instead
// deadlocks the vitest module runner: the loader waits on the factory and the
// factory waits on the loader.)
//
// These two exports are exactly what ThumbnailUpload.svelte imports from
// content.remote today. If the component grows another import from that module,
// this factory must grow with it — otherwise the new binding arrives as
// `undefined` and fails at mount rather than at compile time.
vi.mock('$lib/remote/content.remote', () => ({
  uploadThumbnailForm: {
    method: 'POST',
    action: '?/uploadThumbnail',
    get result() {
      return currentResult();
    },
  },
  deleteThumbnailCommand: vi.fn(async () => undefined),
}));

/**
 * Minimal reactive stand-in for the `form()` field API ThumbnailUpload touches.
 * `value()` must be reactive so a `set()` is observable through the rendered
 * output, not just through the call log.
 */
function createFormFake() {
  const field = $state({ thumbnailUrl: '' });
  const setCalls: string[] = [];

  return {
    setCalls,
    currentValue: () => field.thumbnailUrl,
    form: {
      fields: {
        thumbnailUrl: {
          value: () => field.thumbnailUrl,
          set: (next: string) => {
            setCalls.push(next);
            field.thumbnailUrl = next;
          },
          as: () => ({
            type: 'text',
            name: 'thumbnailUrl',
            value: field.thumbnailUrl,
          }),
          issues: () => [],
        },
      },
    },
  };
}

describe('ThumbnailUpload — stale form() result on a fresh mount', () => {
  let component: ReturnType<typeof mount> | null = null;
  let successSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetResult();
    // Spy on the REAL toast object rather than mocking the module: the
    // `$lib/components/ui` barrel re-exports toast-store, so a hand-written
    // module mock would have to reproduce `toaster` too or break Button's
    // import. Property-level spies avoid that whole class of breakage.
    //
    // The implementation is stubbed out (rather than calling through to Melt's
    // addToast) so these tests assert on intent, not on the toaster's internal
    // store. Melt returns a `Toast<ToastData>`; nothing here reads it.
    const stubToast = {} as ReturnType<typeof toast.success>;
    successSpy = vi.spyOn(toast, 'success').mockReturnValue(stubToast);
    errorSpy = vi.spyOn(toast, 'error').mockReturnValue(stubToast);
  });

  afterEach(() => {
    if (component) {
      unmount(component);
      component = null;
    }
    vi.restoreAllMocks();
    resetResult();
    document.body.innerHTML = '';
  });

  function mountFresh(
    fake: ReturnType<typeof createFormFake>,
    contentId: string | null
  ) {
    component = mount(ThumbnailUpload, {
      target: document.body,
      // biome-ignore lint/suspicious/noExplicitAny: narrow test double for the form() field API
      props: { form: fake.form as any, contentId },
    });
    flushSync();
  }

  test('a pre-existing SUCCESSFUL result fires no toast on a fresh create-mode mount', () => {
    // The exact repro: an upload succeeded on the previous page, then the user
    // navigates to /studio/content/new (create mode → contentId is null).
    seedStaleResult({ success: true, thumbnailUrl: '/stale/previous.webp' });

    const fake = createFormFake();
    mountFresh(fake, null);

    expect(successSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('a pre-existing SUCCESSFUL result does not write a stale thumbnail into the new draft', () => {
    seedStaleResult({ success: true, thumbnailUrl: '/stale/previous.webp' });

    const fake = createFormFake();
    mountFresh(fake, null);

    expect(fake.setCalls).toEqual([]);
    expect(fake.currentValue()).toBe('');
    // No preview image, because no thumbnail was adopted.
    expect(document.querySelector('img.thumbnail-image')).toBeNull();
  });

  test('a pre-existing FAILED result fires no error toast on a fresh mount', () => {
    // The success branch is not the only replayable one — a stale failure would
    // greet the user with an error toast for an upload they never started.
    seedStaleResult({ success: false, error: 'Upload failed' });

    const fake = createFormFake();
    mountFresh(fake, null);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
  });

  test('a result produced AFTER mount does fire the success toast', () => {
    const fake = createFormFake();
    mountFresh(fake, 'content-1');

    expect(successSpy).not.toHaveBeenCalled();

    // A submission during THIS mount resolves.
    emitResult({ success: true, thumbnailUrl: '/fresh/uploaded.webp' });
    flushSync();

    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(fake.setCalls).toEqual(['/fresh/uploaded.webp']);
  });

  test('the success toast text tracks the paraglide message', () => {
    // NOTE ON WHAT THIS DOES AND DOES NOT PROVE. The new key's value is the
    // same text the old hardcoded literal used, so this assertion also passes
    // against the pre-fix code — it is NOT a falsifying test for the i18n swap
    // itself. Its job is drift protection: if the message is ever reworded or
    // the component regresses to a literal, the two sides diverge and this
    // fails. The i18n change proper is evidenced by the key existing in
    // `messages/en.json` and the generated paraglide output.
    const fake = createFormFake();
    mountFresh(fake, 'content-1');

    emitResult({ success: true, thumbnailUrl: '/fresh/uploaded.webp' });
    flushSync();

    expect(successSpy).toHaveBeenCalledWith(
      m.studio_content_form_thumbnail_uploaded()
    );
  });

  test('a result produced after mount fires exactly once, not on every re-render', () => {
    const fake = createFormFake();
    mountFresh(fake, 'content-1');

    emitResult({ success: true, thumbnailUrl: '/fresh/uploaded.webp' });
    flushSync();
    // Re-render without a new result — the identity guard must hold.
    flushSync();

    expect(successSpy).toHaveBeenCalledTimes(1);
  });

  test('an error result produced after mount does fire the error toast', () => {
    const fake = createFormFake();
    mountFresh(fake, 'content-1');

    emitResult({ success: false, error: 'Thumbnail too large' });
    flushSync();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Thumbnail too large');
    expect(successSpy).not.toHaveBeenCalled();
  });

  test('a stale result then a NEW result: only the new one fires', () => {
    // Guards the seed from over-suppressing: marking the pre-existing result
    // handled must not deafen the component to genuine later submissions.
    seedStaleResult({ success: true, thumbnailUrl: '/stale/previous.webp' });

    const fake = createFormFake();
    mountFresh(fake, 'content-1');
    expect(successSpy).not.toHaveBeenCalled();

    emitResult({ success: true, thumbnailUrl: '/fresh/uploaded.webp' });
    flushSync();

    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(fake.setCalls).toEqual(['/fresh/uploaded.webp']);
  });
});
