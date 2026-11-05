/**
 * The studio upload queue (Codex-a6ofh.1.2; mockup media.html M4).
 *
 * The flow moved here from MediaUpload.svelte, where it had no unit tests, so
 * this pins both what it always did (two at a time, the worker fallback, the
 * >90 MB refusal, Try again deleting the failed row) and what is new: cancel
 * at every point it can land, rename at every point, the unload guard, and the
 * time-left estimate. Each fake transfer is held open so a test can act at an
 * exact point in the flow.
 */
import { FILE_SIZES } from '@codex/constants';
import { describe, expect, it, vi } from 'vitest';
import {
  estimateSecondsLeft,
  titleFromFileName,
  UploadCancelled,
  UploadQueue,
  type UploadQueueDeps,
  type UploadRequest,
} from './upload-queue.svelte';

// The module also builds the real singleton; these stand in for its wiring.
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
  },
}));
vi.mock('$lib/observability', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What createMedia resolves to. */
type Created = { id: string; presignedUrl: string | null };

function video(name = 'workshop.mov', size = 1024): File {
  const file = new File(['x'], name, { type: 'video/quicktime' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

interface HeldTransfer {
  request: UploadRequest;
  resolve: () => void;
  reject: (error: Error) => void;
  aborted: boolean;
}

function harness(
  overrides: Partial<UploadQueueDeps> = {},
  presignedUrl: string | null = 'https://r2.example/put'
) {
  const transfers: HeldTransfer[] = [];
  const release = vi.fn();
  let ids = 0;
  let keys = 0;
  let clock = 1_000_000;
  const deps: UploadQueueDeps = {
    createMedia: vi.fn(async () => ({ id: `media-${++ids}`, presignedUrl })),
    completeUpload: vi.fn(async () => ({})),
    deleteMedia: vi.fn(async () => ({})),
    readUsage: vi.fn(async () => ({ fingerprint: 'fp-1' })),
    renameMedia: vi.fn(async () => ({})),
    send: vi.fn((request: UploadRequest) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const done = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const held: HeldTransfer = { request, resolve, reject, aborted: false };
      transfers.push(held);
      return {
        done,
        abort: () => {
          held.aborted = true;
          reject(new UploadCancelled());
        },
      };
    }),
    measureDuration: vi.fn(async () => 61),
    live: { beginUpload: vi.fn(), reportUpload: vi.fn(), endUpload: vi.fn() },
    guard: vi.fn(() => release),
    now: () => clock,
    makeKey: () => `row-${++keys}`,
    ...overrides,
  };
  return {
    queue: new UploadQueue(deps),
    deps,
    transfers,
    release,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('UploadQueue: adding files', () => {
  it('queues a supported file under its name without the extension', () => {
    const { queue } = harness({
      createMedia: vi.fn(() => new Promise<Created>(() => {})),
    });
    queue.add([video('Members workshop.mov')]);
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      title: 'Members workshop',
      mediaType: 'video',
      key: 'row-1',
    });
  });

  it('turns an unsupported or empty file into a rejection, not a row', () => {
    const { queue } = harness();
    const mkv = new File(['x'], 'clip-final.mkv', { type: 'video/x-matroska' });
    const empty = video('empty.mov', 0);
    queue.add([mkv, empty]);
    expect(queue.items).toHaveLength(0);
    expect(queue.rejections.map((r) => [r.name, r.reason])).toEqual([
      ['clip-final.mkv', 'type'],
      ['empty.mov', 'empty'],
    ]);
  });

  // The media picker follows the row it queued (Codex-a6ofh.1.8).
  it("returns the queued rows' keys, and none for a rejected file", () => {
    const { queue } = harness({
      createMedia: vi.fn(() => new Promise<Created>(() => {})),
    });
    const mkv = new File(['x'], 'clip.mkv', { type: 'video/x-matroska' });
    const keys = queue.add([video('a.mov'), mkv, video('b.mov')]);
    expect(keys).toEqual(queue.items.map((item) => item.key));
    expect(keys).toHaveLength(2);
    expect(queue.rejections.map((r) => r.key)).not.toContain(keys[0]);
  });

  it('runs two at a time and starts the next when one finishes', async () => {
    const { queue, deps, transfers } = harness();
    queue.add([video('a.mov'), video('b.mov'), video('c.mov')]);
    await flush();
    expect(deps.createMedia).toHaveBeenCalledTimes(2);
    expect(queue.items.map((i) => i.status)).toEqual([
      'uploading',
      'uploading',
      'queued',
    ]);

    transfers[0]?.resolve();
    await flush();
    expect(deps.createMedia).toHaveBeenCalledTimes(3);
  });
});

describe('UploadQueue: the upload flow', () => {
  it('creates the row, PUTs to the presigned URL, then completes with the measured runtime', async () => {
    const { queue, deps, transfers } = harness();
    const done = vi.fn();
    queue.onComplete(done);
    queue.add([video('talk.mov', 4096)]);
    await flush();

    expect(deps.createMedia).toHaveBeenCalledWith({
      title: 'talk',
      mediaType: 'video',
      mimeType: 'video/quicktime',
      fileSizeBytes: 4096,
    });
    expect(transfers[0]?.request).toMatchObject({
      url: 'https://r2.example/put',
      method: 'PUT',
      mimeType: 'video/quicktime',
    });
    expect(deps.live.beginUpload).toHaveBeenCalledWith('media-1');

    transfers[0]?.request.onProgress(40);
    expect(queue.items[0]?.progress).toBe(40);
    expect(deps.live.reportUpload).toHaveBeenCalledWith('media-1', 40);

    transfers[0]?.resolve();
    await flush();
    expect(deps.completeUpload).toHaveBeenCalledWith({
      id: 'media-1',
      durationSeconds: 61,
    });
    expect(queue.items[0]).toMatchObject({ status: 'done', progress: 100 });
    expect(deps.live.endUpload).toHaveBeenCalledWith('media-1');
    expect(done).toHaveBeenCalledWith('media-1');
  });

  it('omits the runtime when it cannot be measured', async () => {
    const { queue, deps, transfers } = harness({
      measureDuration: vi.fn(async () => null),
    });
    queue.add([video()]);
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(deps.completeUpload).toHaveBeenCalledWith({ id: 'media-1' });
  });

  it('falls back to the worker when the presigned PUT fails for a file it can take', async () => {
    const { queue, transfers } = harness();
    queue.add([video('small.mov', 1024)]);
    await flush();
    transfers[0]?.reject(new Error('CORS'));
    await flush();
    expect(transfers[1]?.request).toMatchObject({
      url: '/api/media/media-1/upload',
      method: 'POST',
      withCredentials: true,
      label: 'Worker upload',
    });
    transfers[1]?.resolve();
    await flush();
    expect(queue.items[0]?.status).toBe('done');
  });

  it('fails as "direct" when the presigned PUT fails for a file too big for the worker', async () => {
    const { queue, deps, transfers } = harness();
    queue.add([video('huge.mov', FILE_SIZES.WORKER_UPLOAD_MAX_BYTES + 1)]);
    await flush();
    transfers[0]?.reject(new Error('network'));
    await flush();
    expect(transfers).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      status: 'error',
      failure: 'direct',
    });
    expect(deps.completeUpload).not.toHaveBeenCalled();
  });

  it('with no presigned URL, sends a small file through the worker and refuses a big one', async () => {
    const small = harness({}, null);
    small.queue.add([video('small.mov', 1024)]);
    await flush();
    expect(small.transfers[0]?.request.method).toBe('POST');

    const big = harness({}, null);
    big.queue.add([video('huge.mov', FILE_SIZES.WORKER_UPLOAD_MAX_BYTES + 1)]);
    await flush();
    expect(big.transfers).toHaveLength(0);
    expect(big.queue.items[0]).toMatchObject({
      status: 'error',
      failure: 'direct',
    });
  });

  it('fails as "upload" when completeUpload is refused', async () => {
    const { queue, transfers } = harness({
      completeUpload: vi.fn(async () => {
        throw new Error('500');
      }),
    });
    queue.add([video()]);
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(queue.items[0]).toMatchObject({
      status: 'error',
      failure: 'upload',
    });
  });
});

describe('UploadQueue: cancel', () => {
  it('drops a queued row without ever creating it', async () => {
    const { queue, deps } = harness();
    queue.add([video('a.mov'), video('b.mov'), video('c.mov')]);
    await flush();
    queue.cancel('row-3');
    expect(queue.items.map((i) => i.key)).toEqual(['row-1', 'row-2']);
    expect(deps.createMedia).toHaveBeenCalledTimes(2);
    expect(deps.deleteMedia).not.toHaveBeenCalled();
  });

  // The picker attaches the id the moment createMedia returns it, so a draft
  // may have saved it; a delete without the fingerprint is then refused (409).
  it('deletes a half-made row with a fresh usage fingerprint: a draft may already use it', async () => {
    const { queue, deps } = harness();
    queue.add([video('a.mov')]);
    await flush();
    queue.cancel('row-1');
    await flush();
    expect(deps.readUsage).toHaveBeenCalledWith('media-1');
    expect(deps.deleteMedia).toHaveBeenCalledWith({
      id: 'media-1',
      usage: 'fp-1',
    });
  });

  it('holds the unload guard until a let-go row is really deleted', async () => {
    let finishDelete!: () => void;
    const { queue, release } = harness({
      deleteMedia: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            finishDelete = () => resolve({});
          })
      ),
    });
    queue.add([video('a.mov')]);
    await flush();
    queue.cancel('row-1');
    await flush();
    // The row has left the tray, but its delete is still on its way.
    expect(queue.items).toHaveLength(0);
    expect(queue.pending).toBe(true);
    expect(release).not.toHaveBeenCalled();
    finishDelete();
    await flush();
    expect(queue.pending).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('removing a failed row holds the guard until its delete settles, even one refused', async () => {
    let refuseDelete!: () => void;
    const { queue, deps, transfers, release } = harness({
      completeUpload: vi.fn().mockRejectedValue(new Error('500')),
      deleteMedia: vi.fn(
        () =>
          new Promise<unknown>((_, reject) => {
            refuseDelete = () => reject(new Error('503'));
          })
      ),
    });
    queue.add([video('a.mov')]);
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(queue.items[0]?.status).toBe('error');
    const holds = (deps.guard as ReturnType<typeof vi.fn>).mock.calls.length;
    const released = release.mock.calls.length;
    expect(queue.pending).toBe(false);

    queue.remove('row-1');
    await flush();
    // remove() itself takes the guard: nothing else would.
    expect(queue.items).toHaveLength(0);
    expect(queue.pending).toBe(true);
    expect(deps.guard).toHaveBeenCalledTimes(holds + 1);
    expect(release).toHaveBeenCalledTimes(released);

    refuseDelete();
    await flush();
    expect(queue.pending).toBe(false);
    expect(release).toHaveBeenCalledTimes(released + 1);
  });

  it('a discard that straddles a user switch deletes nothing as the new user', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    error.mockClear(); // the module's logger mock keeps earlier tests' calls
    let finishRead!: () => void;
    const { queue, deps } = harness({
      readUsage: vi.fn(
        () =>
          new Promise<{ fingerprint: string }>((resolve) => {
            finishRead = () => resolve({ fingerprint: 'fp-1' });
          })
      ),
    });
    queue.add([video('a.mov')]);
    await flush();
    queue.cancel('row-1');
    await flush();
    expect(deps.readUsage).toHaveBeenCalledWith('media-1');

    queue.reset();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    warn.mockClear();
    finishRead();
    await flush();
    // The row is the last user's: left for the hourly check, and no alarm.
    expect(deps.deleteMedia).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Media upload: a user switch left a discard to the hourly check',
      { mediaId: 'media-1', stage: 'skipped' }
    );
    expect(queue.pending).toBe(false);
    error.mockRestore();
    warn.mockRestore();
  });

  it('a delete that fails after a user switch is a warning with its reason, not an error', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    let refuseDelete!: () => void;
    const { queue, deps } = harness({
      deleteMedia: vi.fn(
        () =>
          new Promise<unknown>((_, reject) => {
            refuseDelete = () => reject(new Error('401'));
          })
      ),
    });
    queue.add([video('a.mov')]);
    await flush();
    queue.cancel('row-1');
    await flush();
    expect(deps.deleteMedia).toHaveBeenCalledTimes(1);

    queue.reset();
    error.mockClear();
    warn.mockClear();
    refuseDelete();
    await flush();
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'Media upload: a user switch left a discard to the hourly check',
      { mediaId: 'media-1', stage: 'failed', error: '401' }
    );
    expect(queue.pending).toBe(false);
    error.mockRestore();
    warn.mockRestore();
  });

  it('a usage read that fails deletes nothing, and is logged as the error it is', async () => {
    const { logger } = await import('$lib/observability');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { queue, deps } = harness({
      readUsage: vi.fn(async () => {
        throw new Error('usage down');
      }),
    });
    queue.add([video('a.mov')]);
    await flush();
    queue.cancel('row-1');
    await flush();
    expect(deps.deleteMedia).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'Media upload: could not remove the abandoned attempt',
      expect.objectContaining({ mediaId: 'media-1', error: 'usage down' })
    );
    error.mockRestore();
  });

  it('aborts an uploading row, deletes its half-made media row, and frees the slot', async () => {
    const { queue, deps, transfers } = harness();
    queue.add([video('a.mov'), video('b.mov'), video('c.mov')]);
    await flush();
    queue.cancel('row-1');
    await flush();

    expect(transfers[0]?.aborted).toBe(true);
    expect(deps.deleteMedia).toHaveBeenCalledWith({
      id: 'media-1',
      usage: 'fp-1',
    });
    expect(queue.items.map((i) => i.key)).toEqual(['row-2', 'row-3']);
    // The aborted transfer is not a failure, and the third file started.
    expect(queue.items.some((i) => i.status === 'error')).toBe(false);
    expect(deps.createMedia).toHaveBeenCalledTimes(3);
  });

  it('deletes the media row a cancel overtook while createMedia was running', async () => {
    let finishCreate!: (value: Created) => void;
    const { queue, deps } = harness({
      createMedia: vi.fn(
        () =>
          new Promise<Created>((resolve) => {
            finishCreate = resolve;
          })
      ),
    });
    queue.add([video()]);
    await flush();
    queue.cancel('row-1');
    expect(queue.items).toHaveLength(0);

    finishCreate({ id: 'media-late', presignedUrl: 'https://r2.example/put' });
    await flush();
    expect(deps.deleteMedia).toHaveBeenCalledWith({
      id: 'media-late',
      usage: 'fp-1',
    });
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('does not start the worker fallback for a row cancelled as its PUT failed', async () => {
    const { queue, deps, transfers } = harness();
    queue.add([video('small.mov', 1024)]);
    await flush();
    // The cancel and the PUT's failure land together.
    queue.cancel('row-1');
    transfers[0]?.reject(new Error('network'));
    await flush();
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('is not offered once the upload is completing', async () => {
    let finishComplete!: () => void;
    const { queue, deps, transfers } = harness({
      completeUpload: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            finishComplete = () => resolve({});
          })
      ),
    });
    queue.add([video()]);
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(queue.items[0]?.status).toBe('completing');

    queue.cancel('row-1');
    expect(queue.items).toHaveLength(1);
    expect(deps.deleteMedia).not.toHaveBeenCalled();
    finishComplete();
    await flush();
    expect(queue.items[0]?.status).toBe('done');
  });
});

describe('UploadQueue: try again and remove', () => {
  it('Try again deletes the failed row and uploads as a new media item', async () => {
    const { queue, deps, transfers } = harness({
      completeUpload: vi
        .fn()
        .mockRejectedValueOnce(new Error('500'))
        .mockResolvedValue({}),
    });
    queue.add([video()]);
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(queue.items[0]?.status).toBe('error');

    queue.retry('row-1');
    // The delete waits for a fresh usage read (a draft may use the row).
    await flush();
    expect(deps.deleteMedia).toHaveBeenCalledWith({
      id: 'media-1',
      usage: 'fp-1',
    });
    expect(deps.createMedia).toHaveBeenCalledTimes(2);
    transfers[1]?.resolve();
    await flush();
    expect(queue.items[0]).toMatchObject({ status: 'done', id: 'media-2' });
  });

  it('removing a failed row deletes its media row; removing a done one does not', async () => {
    const { queue, deps, transfers } = harness({
      completeUpload: vi
        .fn()
        .mockRejectedValueOnce(new Error('500'))
        .mockResolvedValue({}),
    });
    queue.add([video('a.mov'), video('b.mov')]);
    await flush();
    transfers[0]?.resolve();
    transfers[1]?.resolve();
    await flush();
    expect(queue.items.map((i) => i.status)).toEqual(['error', 'done']);

    queue.remove('row-2');
    await flush();
    expect(deps.deleteMedia).not.toHaveBeenCalled();
    queue.remove('row-1');
    await flush();
    expect(deps.deleteMedia).toHaveBeenCalledWith({
      id: 'media-1',
      usage: 'fp-1',
    });
    expect(queue.items).toHaveLength(0);
  });

  it('does not remove a row that is still uploading', async () => {
    const { queue } = harness();
    queue.add([video()]);
    await flush();
    queue.remove('row-1');
    expect(queue.items).toHaveLength(1);
  });
});

describe('UploadQueue: rename', () => {
  it('a rename before the row is created goes into createMedia', async () => {
    const { queue, deps } = harness();
    queue.add([video('a.mov'), video('b.mov'), video('c.mov')]);
    queue.rename('row-3', 'Interview: Priya');
    await flush();
    const firstTwo = (deps.createMedia as ReturnType<typeof vi.fn>).mock.calls;
    expect(firstTwo).toHaveLength(2);
    // Free a slot so the third is created.
    queue.cancel('row-1');
    await flush();
    expect(deps.createMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Interview: Priya' })
    );
    expect(deps.renameMedia).not.toHaveBeenCalled();
  });

  it('a rename while createMedia runs is saved once it returns', async () => {
    let finishCreate!: (value: Created) => void;
    const { queue, deps } = harness({
      createMedia: vi.fn(
        () =>
          new Promise<Created>((resolve) => {
            finishCreate = resolve;
          })
      ),
    });
    queue.add([video('raw.mov')]);
    await flush();
    queue.rename('row-1', 'Edited title');
    expect(deps.renameMedia).not.toHaveBeenCalled();

    finishCreate({ id: 'media-9', presignedUrl: 'https://r2.example/put' });
    await flush();
    expect(deps.renameMedia).toHaveBeenCalledWith('media-9', 'Edited title');
  });

  it('a rename after the row exists is saved with updateMedia', async () => {
    const { queue, deps } = harness();
    queue.add([video()]);
    await flush();
    queue.rename('row-1', '  Members workshop  ');
    await flush();
    expect(deps.renameMedia).toHaveBeenCalledWith(
      'media-1',
      'Members workshop'
    );
    expect(queue.items[0]?.title).toBe('Members workshop');
  });

  it('a refused rename puts the saved title back and says so', async () => {
    const { queue } = harness({
      renameMedia: vi.fn(async () => {
        throw new Error('400');
      }),
    });
    queue.add([video('raw.mov')]);
    await flush();
    queue.rename('row-1', 'Better title');
    await flush();
    expect(queue.items[0]).toMatchObject({ title: 'raw', renameFailed: true });
  });

  it('a rename made while a save is out is sent after it, so the last title wins', async () => {
    const calls: string[] = [];
    let releaseFirst!: () => void;
    const { queue } = harness({
      renameMedia: vi.fn((_id: string, title: string) => {
        calls.push(`start ${title}`);
        if (title === 'First') {
          return new Promise<unknown>((resolve) => {
            releaseFirst = () => {
              calls.push('end First');
              resolve({});
            };
          });
        }
        calls.push(`end ${title}`);
        return Promise.resolve({});
      }),
    });
    queue.add([video()]);
    await flush();
    queue.rename('row-1', 'First');
    await flush();
    queue.rename('row-1', 'Second');
    await flush();
    // Never two at once: Second waits for First.
    expect(calls).toEqual(['start First']);
    releaseFirst();
    await flush();
    expect(calls).toEqual([
      'start First',
      'end First',
      'start Second',
      'end Second',
    ]);
  });

  it('renames in quick succession collapse into one save of the latest title', async () => {
    const { queue, deps } = harness();
    queue.add([video()]);
    await flush();
    queue.rename('row-1', 'Draft one');
    queue.rename('row-1', 'Draft two');
    await flush();
    expect(deps.renameMedia).toHaveBeenCalledTimes(1);
    expect(deps.renameMedia).toHaveBeenCalledWith('media-1', 'Draft two');
  });

  it('ignores a blank rename and caps a long one at 255 characters', async () => {
    const { queue, deps } = harness();
    queue.add([video('raw.mov')]);
    await flush();
    queue.rename('row-1', '   ');
    expect(queue.items[0]?.title).toBe('raw');
    queue.rename('row-1', 'x'.repeat(300));
    expect(queue.items[0]?.title).toHaveLength(255);
    await flush();
    expect(deps.renameMedia).toHaveBeenCalledTimes(1);
  });
});

describe('UploadQueue: the unload guard', () => {
  it('holds one guard while anything is pending and releases it when all settle', async () => {
    const { queue, deps, transfers, release } = harness();
    queue.add([video('a.mov')]);
    queue.add([video('b.mov')]);
    expect(deps.guard).toHaveBeenCalledTimes(1);

    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(release).not.toHaveBeenCalled();

    transfers[1]?.resolve();
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
    // The guard's own question tracks the queue, not a snapshot.
    const shouldBlock = (deps.guard as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(shouldBlock?.()).toBe(false);
  });

  it('releases the guard when the last pending row is cancelled', async () => {
    const { queue, release } = harness();
    queue.add([video()]);
    await flush();
    queue.cancel('row-1');
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('time left and titles', () => {
  it('estimates from the rate so far, and only once there is enough to go on', () => {
    expect(estimateSecondsLeft(null, 10_000, 50)).toBeNull();
    expect(estimateSecondsLeft(0, 10_000, 2)).toBeNull();
    expect(estimateSecondsLeft(0, 1_000, 50)).toBeNull();
    expect(estimateSecondsLeft(0, 10_000, 100)).toBeNull();
    // 10 s for 25% leaves 30 s.
    expect(estimateSecondsLeft(0, 10_000, 25)).toBe(30);
  });

  it('reads secondsLeft only for an uploading row', async () => {
    const { queue, transfers, tick } = harness();
    queue.add([video()]);
    await flush();
    tick(60_000);
    transfers[0]?.request.onProgress(20);
    // 60 s for 20% leaves 240 s.
    expect(queue.secondsLeft(queue.items[0]!)).toBe(240);
    transfers[0]?.resolve();
    await flush();
    expect(queue.secondsLeft(queue.items[0]!)).toBeNull();
  });

  it('titles a file by its name without the extension', () => {
    expect(titleFromFileName('Interview: Priya.m4a')).toBe('Interview: Priya');
    expect(titleFromFileName('clip.final.mp4')).toBe('clip.final');
    expect(titleFromFileName('.mp4')).toBe('.mp4');
    expect(titleFromFileName(`${'x'.repeat(300)}.mp4`)).toHaveLength(255);
  });
});

// ── Review findings (codex-review, silent-failure-hunter) ─────────────────

describe('UploadQueue: failures the review found', () => {
  it('an abort the creator did not make is a failure, not a row stuck uploading', async () => {
    const { queue, deps, transfers } = harness();
    queue.add([video('a.mov'), video('b.mov'), video('c.mov')]);
    await flush();
    // The browser drops the request: an abort that cancel() never asked for.
    transfers[0]?.reject(new UploadCancelled());
    await flush();
    expect(queue.items[0]).toMatchObject({
      status: 'error',
      failure: 'upload',
    });
    // Its slot was freed: the third file started.
    expect(deps.createMedia).toHaveBeenCalledTimes(3);
  });

  it('a completion listener that throws leaves the upload done, and the others still hear', async () => {
    const { queue, transfers } = harness();
    const second = vi.fn();
    queue.onComplete(() => {
      throw new Error('listener broke');
    });
    queue.onComplete(second);
    queue.add([video()]);
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(queue.items[0]?.status).toBe('done');
    expect(second).toHaveBeenCalledWith('media-1');
  });

  it('a rename refused for a media item a Try again replaced does not roll the new title back', async () => {
    let refuseFirst!: () => void;
    const { queue, transfers } = harness({
      completeUpload: vi
        .fn()
        .mockRejectedValueOnce(new Error('500'))
        .mockResolvedValue({}),
      renameMedia: vi.fn((id: string) =>
        id === 'media-1'
          ? new Promise<unknown>((_resolve, reject) => {
              refuseFirst = () => reject(new Error('404: deleted by retry'));
            })
          : Promise.resolve({})
      ),
    });
    queue.add([video('raw.mov')]);
    await flush();
    queue.rename('row-1', 'Kept title');
    await flush();
    transfers[0]?.resolve();
    await flush();
    expect(queue.items[0]?.status).toBe('error');

    queue.retry('row-1');
    await flush();
    // The old item's save now fails: it was deleted by the retry.
    refuseFirst();
    await flush();
    expect(queue.items[0]).toMatchObject({
      title: 'Kept title',
      renameFailed: false,
    });
  });

  it('holds the unload guard while a row cancelled during createMedia is still being cleaned up', async () => {
    let finishCreate!: (value: Created) => void;
    let finishDelete!: () => void;
    const { queue, release } = harness({
      createMedia: vi.fn(
        () =>
          new Promise<Created>((resolve) => {
            finishCreate = resolve;
          })
      ),
      deleteMedia: vi.fn(
        () =>
          new Promise<unknown>((resolve) => {
            finishDelete = () => resolve({});
          })
      ),
    });
    queue.add([video()]);
    await flush();
    queue.cancel('row-1');
    expect(queue.items).toHaveLength(0);
    // createMedia has not returned: its row is still being made.
    expect(release).not.toHaveBeenCalled();

    finishCreate({ id: 'media-late', presignedUrl: 'https://r2.example/put' });
    await flush();
    expect(release).not.toHaveBeenCalled();
    finishDelete();
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reset empties the queue for a new user, aborts transfers, and leaves the old rows alone', async () => {
    let finishCreate!: (value: Created) => void;
    const { queue, deps, transfers, release } = harness({
      createMedia: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'media-1',
          presignedUrl: 'https://r2.example/put',
        })
        .mockImplementationOnce(
          () =>
            new Promise<Created>((resolve) => {
              finishCreate = resolve;
            })
        ),
    });
    queue.add([video('a.mov'), video('b.mov')]);
    await flush();
    queue.add([new File(['x'], 'clip.mkv', { type: 'video/x-matroska' })]);

    queue.reset();
    expect(queue.items).toHaveLength(0);
    expect(queue.rejections).toHaveLength(0);
    expect(transfers[0]?.aborted).toBe(true);

    // The second row's createMedia returns after the switch: not deleted as
    // the new user, who doesn't own it.
    finishCreate({ id: 'media-2', presignedUrl: 'https://r2.example/put' });
    await flush();
    expect(deps.deleteMedia).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
