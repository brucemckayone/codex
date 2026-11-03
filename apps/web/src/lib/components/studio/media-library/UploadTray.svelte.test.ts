/**
 * The upload tray (Codex-a6ofh.1.2; mockup media.html M4b), drawn from a REAL
 * UploadQueue built on fakes and swapped in for the module's singleton, so
 * each test drives the store through a state and reads what the tray shows:
 * time left and Cancel while uploading, "Finishing upload" (never
 * "Processing") while completing, "Processing" with the next steps once the
 * bytes are up, the failure line with Try again, and Not-supported files.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { formatFileSize } from '$lib/utils/format';
import {
  flushSync,
  mount,
  unmount,
} from '$tests/utils/component-test-utils.svelte';

const held = vi.hoisted(() => ({
  transfers: [] as Array<{ resolve: () => void; reject: (e: Error) => void }>,
  completes: [] as Array<() => void>,
  clock: 1_000_000,
  renames: [] as Array<[string, string]>,
  /** The media page's live states, as the status socket would push them. */
  live: new Map<string, { lifecycle: string }>(),
}));

vi.mock('$lib/remote/media.remote', () => ({
  createMedia: vi.fn(),
  completeUpload: vi.fn(),
  deleteMedia: vi.fn(),
  updateMedia: vi.fn(),
}));
vi.mock('$lib/client/media-status.svelte', () => ({
  mediaStatus: {
    beginUpload: vi.fn(),
    reportUpload: vi.fn(),
    endUpload: vi.fn(),
    items: held.live,
  },
}));
vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('$lib/client/upload-queue.svelte', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$lib/client/upload-queue.svelte')>();
  let ids = 0;
  let keys = 0;
  const queue = new actual.UploadQueue({
    createMedia: async () => ({
      id: `media-${++ids}`,
      presignedUrl: 'https://r2.example/put',
    }),
    completeUpload: () =>
      new Promise<unknown>((resolve) => {
        held.completes.push(() => resolve({}));
      }),
    deleteMedia: async () => ({}),
    renameMedia: async (id, title) => {
      held.renames.push([id, title]);
    },
    send: (request) => {
      let resolve!: () => void;
      let reject!: (e: Error) => void;
      const done = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      held.transfers.push({ resolve, reject });
      // Report progress straight away, so the row has a % to show.
      queueMicrotask(() => request.onProgress(25));
      return { done, abort: () => reject(new actual.UploadCancelled()) };
    },
    measureDuration: async () => null,
    live: {
      beginUpload: () => {},
      reportUpload: () => {},
      endUpload: () => {},
    },
    guard: () => () => {},
    now: () => held.clock,
    makeKey: () => `row-${++keys}`,
  });
  return { ...actual, uploadQueue: queue };
});

const { uploadQueue } = await import('$lib/client/upload-queue.svelte');
const UploadTray = (await import('./UploadTray.svelte')).default;

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};

function video(name = 'Members workshop.mov', size = 3_100_000_000): File {
  const file = new File(['x'], name, { type: 'video/quicktime' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

let component: ReturnType<typeof mount> | null = null;

function render() {
  component = mount(UploadTray, { target: document.body, props: {} });
  flushSync();
}

const row = () => document.querySelector<HTMLLIElement>('.queue-item');
const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

afterEach(async () => {
  // Settle and clear the shared queue between tests.
  for (const item of [...uploadQueue.items]) {
    if (item.status === 'queued' || item.status === 'uploading') {
      uploadQueue.cancel(item.key);
    }
  }
  for (const complete of held.completes.splice(0)) complete();
  await flush();
  for (const item of [...uploadQueue.items]) uploadQueue.remove(item.key);
  for (const r of [...uploadQueue.rejections])
    uploadQueue.dismissRejection(r.key);
  held.transfers.length = 0;
  held.renames.length = 0;
  held.live.clear();
  if (component) unmount(component);
  component = null;
  document.body.innerHTML = '';
});

describe('UploadTray', () => {
  test('draws nothing with an empty queue', () => {
    render();
    expect(document.querySelector('.upload-dock')).toBeNull();
  });

  test('uploading: the title, the size, the % with time left, and Cancel', async () => {
    render();
    uploadQueue.add([video()]);
    await flush();
    held.clock += 60_000;
    // The next progress report re-reads the clock: 60 s for 30% leaves 140 s.
    const uploading = uploadQueue.items[0];
    if (!uploading) throw new Error('no row');
    uploading.progress = 30;
    await flush();

    const title = row()?.querySelector<HTMLInputElement>(
      'input.queue-item-title'
    );
    expect(title?.value).toBe('Members workshop');
    expect(text(row()?.querySelector('.queue-item-meta'))).toBe(
      `${formatFileSize(3_100_000_000)} 30% · about 3 min left`
    );
    expect(
      row()
        ?.querySelector('[role="progressbar"]')
        ?.getAttribute('aria-valuenow')
    ).toBe('30');

    const cancel = [...(row()?.querySelectorAll('button') ?? [])].find(
      (b) => text(b) === 'Cancel'
    );
    cancel?.click();
    await flush();
    expect(row()).toBeNull();
  });

  test('completing reads "Finishing upload", never "Processing"', async () => {
    render();
    uploadQueue.add([video()]);
    await flush();
    held.transfers[0]?.resolve();
    await flush();
    expect(text(row()?.querySelector('.queue-item-status'))).toBe(
      'Finishing upload'
    );
    // No Cancel once completing: completeUpload is already under way.
    expect(
      [...(row()?.querySelectorAll('button') ?? [])].some(
        (b) => text(b) === 'Cancel'
      )
    ).toBe(false);
  });

  /** Upload one file through to done; returns its media id. */
  async function uploadOne(name = 'Interview: Priya.m4a'): Promise<string> {
    uploadQueue.add([video(name, 2_000)]);
    await flush();
    held.transfers.at(-1)?.resolve();
    await flush();
    held.completes.shift()?.();
    await flush();
    const id = uploadQueue.items.at(-1)?.id;
    if (!id) throw new Error('no media id');
    return id;
  }

  test('uploaded, with no live state here: "Uploaded" (always true), and the next steps', async () => {
    render();
    const mediaId = await uploadOne();

    expect(text(row()?.querySelector('.queue-item-status'))).toBe('Uploaded');
    const links = [
      ...(row()?.querySelectorAll<HTMLAnchorElement>('.queue-item-next a') ??
        []),
    ];
    expect(links.map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['Create content from this', `/studio/content/new?media=${mediaId}`],
      ['View', '/studio/media'],
    ]);
    expect(text(document.querySelector('.dock-summary'))).toBe(
      '0 active 1 done'
    );
  });

  test.each([
    ['transcoding', 'Processing', true],
    ['ready', 'Ready', true],
    // Failed processing: nothing could play it, so no "Create content".
    ['failed', 'Failed', false],
  ])('uploaded, with the live state %s: "%s"', async (lifecycle, label, offersContent) => {
    // The media page has the socket open and knows the item's state by the
    // time the row renders as done.
    const stop = uploadQueue.onComplete((id) =>
      held.live.set(id, { lifecycle })
    );
    render();
    await uploadOne();
    stop();

    expect(text(row()?.querySelector('.queue-item-status'))).toBe(label);
    const linkTexts = [
      ...(row()?.querySelectorAll('.queue-item-next a') ?? []),
    ].map(text);
    expect(linkTexts.includes('Create content from this')).toBe(offersContent);
    expect(linkTexts).toContain('View');
  });

  test('failed: the failure line and Try again, and the summary counts it', async () => {
    render();
    uploadQueue.add([video('small.mov', 1024)]);
    await flush();
    // Presigned PUT fails, then the worker fallback fails too.
    held.transfers[0]?.reject(new Error('CORS'));
    await flush();
    held.transfers[1]?.reject(new Error('500'));
    await flush();

    expect(row()?.dataset.status).toBe('error');
    expect(text(row()?.querySelector('.queue-item-error [role="alert"]'))).toBe(
      'Upload failed. Please try again.'
    );
    const tryAgain = [...(row()?.querySelectorAll('button') ?? [])].find(
      (b) => text(b) === 'Try again'
    );
    expect(tryAgain?.getAttribute('aria-label')).toBe(
      'Try uploading small again'
    );
    expect(text(document.querySelector('.dock-summary'))).toBe(
      '0 active 0 done 1 failed'
    );
  });

  test('a file the platform does not take is listed by name and reason, and can be dismissed', async () => {
    render();
    uploadQueue.add([
      new File(['x'], 'clip-final.mkv', { type: 'video/x-matroska' }),
    ]);
    await flush();
    const rejection = document.querySelector('.rejection-item');
    expect(text(rejection?.querySelector('.rejection-name'))).toBe(
      'clip-final.mkv'
    );
    expect(text(rejection?.querySelector('[role="alert"]'))).toContain(
      'not a supported file type'
    );

    rejection?.querySelector<HTMLButtonElement>('button')?.click();
    await flush();
    expect(document.querySelector('.rejection-item')).toBeNull();
  });

  test('editing the title saves it on blur; a blank title is put back', async () => {
    render();
    uploadQueue.add([video()]);
    await flush();
    const title = row()?.querySelector<HTMLInputElement>(
      'input.queue-item-title'
    );
    if (!title) throw new Error('no title field');

    title.value = 'Members workshop: part 1';
    title.dispatchEvent(new FocusEvent('blur'));
    await flush();
    const mediaId = uploadQueue.items[0]?.id;
    expect(held.renames).toEqual([[mediaId, 'Members workshop: part 1']]);

    title.value = '   ';
    title.dispatchEvent(new FocusEvent('blur'));
    await flush();
    expect(title.value).toBe('Members workshop: part 1');
    expect(held.renames).toHaveLength(1);
  });
});
