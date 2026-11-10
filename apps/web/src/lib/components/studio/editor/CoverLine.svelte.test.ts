/**
 * The cover line (Codex-a6ofh.2.3): a draft's cover is uploaded onto its row
 * and removed with the delete. A piece that has been live keeps its cover for
 * Update (Codex-a6ofh.2.5): a new one is staged, never uploaded onto the row,
 * and removing one only clears it here, for Update to send.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as m from '$paraglide/messages';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import CoverLine from './CoverLine.svelte';

const CONTENT_ID = '7c000000-0000-4000-8000-000000000001';
const SAVED = 'https://cdn.test/saved/lg.webp';
const NEW = 'https://cdn.test/new/lg.webp';

/**
 * A remote form as kit hands it over: `enhance` gives the attributes the
 * form spreads, whose submit runs the callback; `submit` lands `answer`.
 */
function fakeForm() {
  const form = {
    result: undefined as unknown,
    answer: { success: true, thumbnailUrl: NEW } as unknown,
    submitted: 0,
    /** Set to hold the answer until it settles. */
    held: null as Promise<void> | null,
    for: vi.fn((_key: string) => form),
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
          const target = event.currentTarget as HTMLFormElement;
          void callback({
            form: target,
            submit: async () => {
              form.submitted += 1;
              if (form.held) await form.held;
              form.result = form.answer;
            },
          });
        },
      };
    },
  };
  return form;
}

const remotes = vi.hoisted(() => ({
  deleteThumbnailCommand: vi.fn(async () => {}),
}));
const forms = vi.hoisted(() => ({
  upload: null as ReturnType<typeof fakeForm> | null,
  stage: null as ReturnType<typeof fakeForm> | null,
}));
vi.mock('$lib/remote/content.remote', () => ({
  ...remotes,
  get uploadThumbnailForm() {
    return forms.upload;
  },
  get stageThumbnailForm() {
    return forms.stage;
  },
}));
// The photo goes as picked: shrinking is its own module's to test.
vi.mock('$lib/utils/shrink-photo', () => ({
  shrinkPhotoInput: async (input: HTMLInputElement) => input.files?.[0],
}));

let component: ReturnType<typeof mount> | null = null;
/** What a staging host was handed, in order. */
let handed: (string | null)[] = [];

function render(props: { staged?: boolean; thumbnailUrl?: string | null }) {
  forms.upload = fakeForm();
  forms.stage = fakeForm();
  handed = [];
  const target = document.createElement('div');
  document.body.appendChild(target);
  // A staging host holds the cover, and shows what it was handed.
  const host = $state({ thumbnailUrl: props.thumbnailUrl ?? null });
  const onstaged = props.staged
    ? (next: string | null) => {
        handed.push(next);
        host.thumbnailUrl = next;
      }
    : undefined;
  component = mount(CoverLine, {
    target,
    props: {
      contentId: CONTENT_ID,
      contentType: 'written',
      get thumbnailUrl() {
        return host.thumbnailUrl;
      },
      onstaged,
    },
  });
  flushSync();
}

afterEach(() => {
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const coverSrc = () =>
  document.querySelector<HTMLImageElement>('.cover-image')?.getAttribute('src');

const buttonNamed = (name: string) =>
  [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name
  );

/** Pick a photo in the hidden input, as the browser's picker does. */
async function pickPhoto() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no file input');
  const photo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'p.png', {
    type: 'image/png',
  });
  Object.defineProperty(input, 'files', { value: [photo], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  // The pick's await, kit's submit, then the answer's render.
  await vi.waitFor(() => expect(coverSrc()).toBe(NEW));
}

describe('a piece that has been live (staged)', () => {
  test('a picked cover is staged, never uploaded onto the row, and handed to the host', async () => {
    render({ staged: true, thumbnailUrl: SAVED });

    await pickPhoto();

    expect(forms.stage?.submitted).toBe(1);
    expect(forms.upload?.submitted).toBe(0);
    expect(forms.stage?.for).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${CONTENT_ID}:`))
    );
    expect(handed).toEqual([NEW]);
  });

  test('two lines on one piece each take a form of their own: kit lets one instance into a single <form>', () => {
    render({ staged: true, thumbnailUrl: SAVED });
    const second = document.createElement('div');
    document.body.appendChild(second);
    const other = mount(CoverLine, {
      target: second,
      props: {
        contentId: CONTENT_ID,
        contentType: 'written',
        thumbnailUrl: SAVED,
        onstaged: () => {},
      },
    });
    flushSync();

    const keys = new Set(
      (forms.stage?.for.mock.calls ?? []).map(([key]) => key)
    );
    unmount(other);
    expect(keys.size).toBe(2);
  });

  test('removing the cover hands the host none, without the delete', () => {
    render({ staged: true, thumbnailUrl: SAVED });

    buttonNamed(m.studio_editor_cover_remove())?.click();
    flushSync();

    expect(handed).toEqual([null]);
    expect(remotes.deleteThumbnailCommand).not.toHaveBeenCalled();
    expect(coverSrc()).toBeUndefined();
    expect(buttonNamed(m.studio_editor_cover_add_article())).toBeDefined();
  });
});

describe('its host', () => {
  test('is told nothing is on its way any more when the line goes mid-upload', async () => {
    forms.upload = fakeForm();
    forms.stage = fakeForm();
    forms.upload.held = new Promise(() => {});
    const onbusy = vi.fn();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const line = mount(CoverLine, {
      target,
      props: {
        contentId: CONTENT_ID,
        contentType: 'written',
        thumbnailUrl: null,
        onbusy,
      },
    });
    flushSync();
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    Object.defineProperty(input, 'files', {
      value: [new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })],
      configurable: true,
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() =>
      expect(onbusy).toHaveBeenLastCalledWith(true, false)
    );

    unmount(line);

    expect(onbusy).toHaveBeenLastCalledWith(false, false);
  });
});

describe('a draft', () => {
  test('a picked cover is uploaded onto the row', async () => {
    render({ thumbnailUrl: SAVED });

    await pickPhoto();

    expect(forms.upload?.submitted).toBe(1);
    expect(forms.stage?.submitted).toBe(0);
  });

  test('removing the cover deletes it', async () => {
    render({ thumbnailUrl: SAVED });

    buttonNamed(m.studio_editor_cover_remove())?.click();

    await vi.waitFor(() =>
      expect(remotes.deleteThumbnailCommand).toHaveBeenCalledWith(CONTENT_ID)
    );
    await vi.waitFor(() => expect(coverSrc()).toBeUndefined());
  });
});
