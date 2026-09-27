import type { PageBuilderState } from '@codex/shared-types';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockField } from '$lib/page-builder/kit';
import { pageBuilder } from '$lib/page-builder/page-builder-store.svelte';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';
import ImageField from './ImageField.svelte';

/**
 * `$app/server` cannot resolve in jsdom, so the remote module is mocked with
 * just the `.for()` instance surface ImageField touches. `submit` plays the
 * server: each test sets what the NEXT submission resolves to.
 */
const remote = vi.hoisted(() => ({
  next: {
    result: undefined as unknown,
    issues: undefined as { message: string }[] | undefined,
  },
  result: undefined as unknown,
  issues: undefined as { message: string }[] | undefined,
  keys: [] as string[],
}));

vi.mock('$lib/remote/page-images.remote', () => {
  const instance = {
    get result() {
      return remote.result;
    },
    pending: 0,
    fields: {
      pageId: {
        as: (type: string, value: string) => ({ type, name: 'pageId', value }),
      },
      image: {
        as: (type: string) => ({ type, name: 'image' }),
        issues: () => remote.issues,
      },
    },
    enhance: (
      callback: (opts: {
        form: HTMLFormElement;
        submit: () => Promise<void>;
      }) => Promise<void>
    ) => ({
      method: 'POST',
      onsubmit: (event: SubmitEvent) => {
        event.preventDefault();
        void callback({
          form: event.currentTarget as HTMLFormElement,
          submit: async () => {
            remote.result = remote.next.result;
            remote.issues = remote.next.issues;
          },
        });
      },
    }),
  };
  return {
    uploadPageImageForm: {
      for: (key: string) => {
        remote.keys.push(key);
        return instance;
      },
    },
  };
});

const PAGE_ID = '00000000-0000-4000-8000-0000000000b1';
const CDN = 'https://cdn.test';
const KEY = `landing-pages/${PAGE_ID}/images/one`;
const FIELD: BlockField = { key: 'image', label: 'Image', control: 'image' };

let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  remote.next = { result: undefined, issues: undefined };
  remote.result = undefined;
  remote.issues = undefined;
  remote.keys = [];
  pageBuilder.open(PAGE_ID, {
    pageType: 'course',
    slug: 'quiet-hours',
    title: 'Quiet Hours',
    status: 'draft',
    subjectType: 'course',
    subjectId: 'course-1',
    brandOverrides: null,
    design: { style: 'bold' },
    sections: [],
  } as PageBuilderState);
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  pageBuilder.close();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

/** Mount with a parent that writes `onChange` back, as the inspector does. */
function render(
  initial: unknown,
  options: { decorative?: boolean; mediaBaseUrl?: string | null } = {}
) {
  const state = $state({ value: initial });
  const writes: unknown[] = [];
  app = mount(ImageField, {
    target: document.body,
    props: {
      field: FIELD,
      get value() {
        return state.value;
      },
      onChange: (next: unknown) => {
        writes.push(next);
        state.value = next;
      },
      mediaBaseUrl:
        options.mediaBaseUrl === undefined ? CDN : options.mediaBaseUrl,
      decorative: options.decorative ?? false,
    },
  });
  flushSync();
  return { writes, state };
}

const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  );
const altInput = () =>
  document.body.querySelector<HTMLInputElement>('input[type="text"]');

async function submit(): Promise<void> {
  document.body
    .querySelector('form')
    ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  await Promise.resolve();
  flushSync();
}

describe('ImageField', () => {
  it('offers an upload for this page, images only, and says what it accepts', () => {
    render(undefined);
    expect(button('Upload image')?.disabled).toBe(false);
    expect(button('Remove')).toBeUndefined();
    const file =
      document.body.querySelector<HTMLInputElement>('input[type="file"]');
    expect(file?.getAttribute('accept')).toBe(
      'image/png,image/jpeg,image/webp,image/gif'
    );
    expect(file?.tabIndex).toBe(-1);
    expect(
      document.body.querySelector<HTMLInputElement>('input[name="pageId"]')
        ?.value
    ).toBe(PAGE_ID);
    expect(document.body.textContent).toContain(
      'SVG and other files are not accepted'
    );
    expect(document.body.textContent).toContain('No image yet');
  });

  it('writes the uploaded key and says it is done', async () => {
    const { writes } = render(undefined);
    remote.next.result = {
      outcome: 'uploaded',
      key: KEY,
      url: `${CDN}/${KEY}/md.webp`,
    };
    await submit();
    expect(writes).toEqual([{ key: KEY }]);
    expect(document.body.querySelector('[role="status"]')?.textContent).toBe(
      'Image uploaded.'
    );
    expect(
      document.body.querySelector('.image__thumb')?.getAttribute('src')
    ).toBe(`${CDN}/${KEY}/sm.webp`);
    expect(button('Replace')).toBeDefined();
  });

  it('keeps the description when the image is replaced', async () => {
    const { writes } = render({
      key: 'landing-pages/p/images/old',
      alt: 'A lake',
    });
    remote.next.result = {
      outcome: 'uploaded',
      key: KEY,
      url: '/preview.webp',
    };
    await submit();
    expect(writes).toEqual([{ key: KEY, alt: 'A lake' }]);
  });

  it('previews a fresh upload even with no CDN base to resolve against', async () => {
    render(undefined, { mediaBaseUrl: null });
    remote.next.result = {
      outcome: 'uploaded',
      key: KEY,
      url: '/preview.webp',
    };
    await submit();
    expect(
      document.body.querySelector('.image__thumb')?.getAttribute('src')
    ).toBe('/preview.webp');
  });

  it('says a stored image will not load, instead of calling it added', () => {
    render({ key: KEY });
    const thumb = document.body.querySelector('.image__thumb');
    expect(thumb).not.toBeNull();

    thumb?.dispatchEvent(new Event('error'));
    flushSync();

    const frame = document.body.querySelector('.image__frame');
    expect(frame?.textContent?.trim()).toBe(
      'This image could not be loaded. Replace it.'
    );
    expect(document.body.querySelector('.image__thumb')).toBeNull();
  });

  it('still calls an image with no preview available added', () => {
    render({ key: KEY }, { mediaBaseUrl: null });
    expect(
      document.body.querySelector('.image__frame')?.textContent?.trim()
    ).toBe('Image added');
  });

  it("shows the server's own words when it refuses the file, and writes nothing", async () => {
    const { writes } = render(undefined);
    remote.next.result = {
      outcome: 'failed',
      message: 'Use a JPG, PNG, WebP, or GIF image.',
    };
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'Use a JPG, PNG, WebP, or GIF image.'
    );
    expect(writes).toEqual([]);
  });

  it('reads a validation issue from the form when there is no result', async () => {
    render(undefined);
    remote.next.issues = [{ message: 'The image must be 5MB or smaller.' }];
    await submit();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'The image must be 5MB or smaller.'
    );
  });

  it('removes the reference', () => {
    const { writes } = render({ key: KEY });
    button('Remove')?.click();
    flushSync();
    expect(writes).toEqual([undefined]);
    expect(button('Upload image')).toBeDefined();
  });

  it('asks for a description, and stores it as typed', () => {
    const { writes } = render({ key: KEY });
    const hint = document.body.querySelector(
      '.image__alt .image__hint'
    )?.textContent;
    expect(hint).toContain('Describe the image for people who can’t see it.');
    expect(hint).toContain('screen readers skip this image');
    const input = altInput();
    input!.value = 'A lake at dawn ';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(writes).toEqual([{ key: KEY, alt: 'A lake at dawn ' }]);
    input!.value = '  ';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(writes.at(-1)).toEqual({ key: KEY });
  });

  describe('a decorative field', () => {
    it('needs no words: switched on, no description asked, nothing written on mount', () => {
      const { writes } = render({ key: KEY }, { decorative: true });
      expect(
        document.body
          .querySelector('[role="switch"]')
          ?.getAttribute('aria-checked')
      ).toBe('true');
      expect(altInput()).toBeNull();
      expect(writes).toEqual([]);
    });

    it('switched off, asks for the words and focuses them', async () => {
      render({ key: KEY }, { decorative: true });
      (
        document.body.querySelector('[role="switch"]') as HTMLButtonElement
      ).click();
      flushSync();
      await tick();
      expect(altInput()).not.toBeNull();
      expect(document.activeElement).toBe(altInput());
    });

    it('switched back on, drops the description', () => {
      const { writes } = render(
        { key: KEY, alt: 'A lake' },
        { decorative: true }
      );
      const toggle = document.body.querySelector(
        '[role="switch"]'
      ) as HTMLButtonElement;
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(altInput()?.value).toBe('A lake');
      toggle.click();
      flushSync();
      expect(writes).toEqual([{ key: KEY }]);
      expect(altInput()).toBeNull();
    });
  });

  it('gives each field its own form instance', () => {
    render(undefined);
    const first = remote.keys[0];
    unmount(app);
    app = null;
    render(undefined);
    expect(remote.keys).toHaveLength(2);
    expect(remote.keys[1]).not.toBe(first);
  });
});
