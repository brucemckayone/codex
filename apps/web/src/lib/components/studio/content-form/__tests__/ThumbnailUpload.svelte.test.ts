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
          // Deliberately THROWS (Codex-1g5lh.3). ThumbnailUpload must never
          // bind `thumbnailUrl` as a free-text input again: an arbitrary
          // creator-supplied URL bypasses the R2 + image-processing pipeline and
          // makes every viewer's browser fetch a third-party host. If a future
          // change re-adds `form.fields.thumbnailUrl.as(...)`, this fails loudly
          // here rather than shipping the hole back in.
          as: () => {
            throw new Error(
              'thumbnailUrl must not be bound as a free-text input (Codex-1g5lh.3)'
            );
          },
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

/**
 * No free-text URL escape hatch. (Codex-1g5lh.3)
 *
 * The form used to offer "Enter URL" / "Enter URL instead" beside the uploader,
 * writing an arbitrary creator-supplied string straight into `thumbnailUrl`.
 * That bypasses the R2 + `@codex/image-processing` pipeline every other image in
 * the product goes through, and makes every viewer's browser fetch a
 * third-party host — handing it their IP and referrer.
 *
 * `thumbnailUrl` itself is NOT gone: it still carries values the PLATFORM
 * produced (an upload result, or a media auto-extract). These tests pin the
 * distinction, so the field keeps working while the free-text path stays shut.
 *
 * SCOPE, stated plainly: this is the CLIENT half. The server still accepts any
 * http(s) URL for this field (`content-schemas.ts` -> `urlSchema`), so a direct
 * API call can still set one. Closing that is tracked separately — do not read
 * these tests as proof the hole is shut end to end.
 */
describe('ThumbnailUpload — no free-text URL escape hatch (Codex-1g5lh.3)', () => {
  let component: ReturnType<typeof mount> | null = null;

  beforeEach(() => {
    resetResult();
    const stubToast = {} as ReturnType<typeof toast.success>;
    vi.spyOn(toast, 'success').mockReturnValue(stubToast);
    vi.spyOn(toast, 'error').mockReturnValue(stubToast);
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

  function mountWith(
    fake: ReturnType<typeof createFormFake>,
    contentId: string | null,
    mediaThumbnailUrl: string | null = null
  ) {
    component = mount(ThumbnailUpload, {
      target: document.body,
      // biome-ignore lint/suspicious/noExplicitAny: narrow test double for the form() field API
      props: { form: fake.form as any, contentId, mediaThumbnailUrl },
    });
    flushSync();
  }

  /**
   * Every input that could carry a typed URL. `type` defaults to "text" when
   * absent, so a bare <input> counts — checking only [type="url"] would miss
   * the exact shape this bead removed, which was a plain text field.
   */
  function typeableInputs() {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>('input')
    ).filter((el) => {
      const t = (el.getAttribute('type') ?? 'text').toLowerCase();
      return t !== 'hidden' && t !== 'file';
    });
  }

  test('create mode offers no typeable input and no URL affordance', () => {
    const fake = createFormFake();
    mountWith(fake, null);

    expect(typeableInputs()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/enter url/i);
  });

  test('edit mode offers no typeable input and no URL affordance', () => {
    // Edit mode is where the drop zone renders; its action row used to carry
    // "Enter URL instead" right next to the media button.
    const fake = createFormFake();
    mountWith(fake, 'content-1');

    expect(document.querySelector('.drop-zone')).not.toBeNull();
    expect(typeableInputs()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/enter url/i);
  });

  test('an existing thumbnail in create mode exposes Remove but no Change', () => {
    // "Change" had two implementations: a file picker in edit mode, and a URL
    // panel in create mode. Only the file picker survived, so create mode must
    // not offer a Change it cannot honour.
    const fake = createFormFake();
    fake.form.fields.thumbnailUrl.set('/uploads/existing/md.webp');
    mountWith(fake, null);

    const labels = Array.from(document.querySelectorAll('.overlay-btn')).map(
      (el) => el.textContent?.trim()
    );

    expect(labels).toContain('Remove');
    expect(labels).not.toContain('Change');
    expect(typeableInputs()).toEqual([]);
  });

  test('an existing thumbnail in EDIT mode still exposes Change (control)', () => {
    // Control for the test above: proves Change vanished because of the mode,
    // not because the removal deleted the file-picker path too.
    const fake = createFormFake();
    fake.form.fields.thumbnailUrl.set('/uploads/existing/md.webp');
    mountWith(fake, 'content-1');

    const labels = Array.from(document.querySelectorAll('.overlay-btn')).map(
      (el) => el.textContent?.trim()
    );

    expect(labels).toContain('Change');
    expect(labels).toContain('Remove');
  });

  test('the platform-produced value still submits, via the hidden input', () => {
    // The hidden input used to be suppressed while the URL panel was open. It is
    // now unconditional, and it is the ONLY way the value reaches the form.
    const fake = createFormFake();
    fake.form.fields.thumbnailUrl.set('/uploads/from-r2/md.webp');
    mountWith(fake, 'content-1');

    const hidden = document.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="thumbnailUrl"]'
    );
    expect(hidden).not.toBeNull();
    expect(hidden!.value).toBe('/uploads/from-r2/md.webp');
  });

  test('media auto-extract remains the one create-mode way to set a thumbnail', () => {
    // The constructive half: removing the URL field must not leave create mode
    // with no option at all when media has already yielded a poster frame.
    const fake = createFormFake();
    mountWith(fake, null, '/media/extracted/poster.webp');

    expect(document.body.textContent).toMatch(/use media thumbnail/i);
    expect(typeableInputs()).toEqual([]);
  });
});
