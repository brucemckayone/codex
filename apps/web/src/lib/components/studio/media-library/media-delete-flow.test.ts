/**
 * The delete dialog's states (Codex-6sbn1; mockups delete-blocked,
 * delete-drafts, delete-unused, failures). The two rules that matter most: a
 * usage read that is pending or failed never enables Delete, and a 409 from
 * the worker re-reads the uses instead of deleting or going quiet.
 */
import type { MediaUsage, MediaUse } from '@codex/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  type MediaDeleteDeps,
  MediaDeleteFlow,
} from './media-delete-flow.svelte';

const MEDIA_ID = '6b000000-0000-4000-8000-000000000001';

const target = {
  id: MEDIA_ID,
  title: 'Winter Light (rough cut)',
  mediaType: 'video',
  durationSeconds: 1324,
  fileSizeBytes: 1_200_000_000,
};

function film(title: string, live: boolean, contentId: string): MediaUse {
  return {
    kind: 'film',
    slot: 'media',
    live,
    liveReason: live ? 'published' : null,
    title,
    orgName: 'Hollow Oak Films',
    link: { to: 'content', contentId, orgSlug: 'hollow-oak' },
  };
}

function usage(uses: MediaUse[], fingerprint = 'fp-1', hidden = 0): MediaUsage {
  const live = uses.filter((use) => use.live).length;
  return {
    total: uses.length + hidden,
    live,
    drafts: uses.length - live + hidden,
    hidden,
    uses,
    fingerprint,
  };
}

/** A rejection shaped as kit's HttpError for a forwarded 4xx. */
function httpError(status: number, code: string) {
  return { status, body: { code, message: code } };
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flow(deps: Partial<MediaDeleteDeps> = {}) {
  const readUsage = vi.fn(deps.readUsage ?? (async () => usage([])));
  const remove = vi.fn(deps.remove ?? (async () => undefined));
  return {
    flow: new MediaDeleteFlow({ readUsage, remove }),
    readUsage,
    remove,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MediaDeleteFlow', () => {
  it('F1: while the read is pending, Delete stays off', async () => {
    const read = deferred<MediaUsage>();
    const { flow: f, readUsage } = flow({ readUsage: () => read.promise });
    f.open(target);
    expect(readUsage).toHaveBeenCalledWith(MEDIA_ID);
    expect(f.view).toBe('checking');
    expect(f.canDelete).toBe(false);
    expect(await f.confirm()).toBeNull();

    read.resolve(usage([]));
    await tick();
    expect(f.view).toBe('unused');
    expect(f.canDelete).toBe(true);
  });

  it('F2: a failed read never reads as "not in use"', async () => {
    const { flow: f, remove } = flow({
      readUsage: async () => {
        throw httpError(500, 'INTERNAL_ERROR');
      },
    });
    f.open(target);
    await tick();
    expect(f.view).toBe('check-failed');
    expect(f.check).toEqual({ state: 'failed', rateLimited: false });
    expect(f.canDelete).toBe(false);
    expect(await f.confirm()).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('F2: a 429 says wait a minute', async () => {
    const { flow: f } = flow({
      readUsage: async () => {
        throw httpError(429, 'RATE_LIMIT_EXCEEDED');
      },
    });
    f.open(target);
    await tick();
    expect(f.check).toEqual({ state: 'failed', rateLimited: true });
  });

  it('B1: something published uses it, so Delete stays off', async () => {
    const { flow: f } = flow({
      readUsage: async () =>
        usage([
          film('The Long Field', true, 'c1'),
          film('Extended', false, 'c2'),
        ]),
    });
    f.open(target);
    await tick();
    expect(f.view).toBe('blocked');
    expect(f.canDelete).toBe(false);
    expect(await f.confirm()).toBeNull();
  });

  it('W1: only drafts use it; the click sends the fingerprint the dialog showed', async () => {
    const drafts = usage([film('Winter Light', false, 'c3')], 'fp-drafts');
    const { flow: f, remove } = flow({ readUsage: async () => drafts });
    f.open(target);
    await tick();
    expect(f.view).toBe('drafts');
    expect(f.canDelete).toBe(true);

    const outcome = await f.confirm();
    expect(remove).toHaveBeenCalledWith({ id: MEDIA_ID, usage: 'fp-drafts' });
    expect(outcome).toEqual({
      kind: 'deleted',
      drafts: 1,
      firstDraft: drafts.uses[0],
    });
  });

  it('a re-read under way keeps the list and turns Delete off until it lands', async () => {
    const second = deferred<MediaUsage>();
    let calls = 0;
    const { flow: f } = flow({
      readUsage: () => {
        calls++;
        return calls === 1 ? Promise.resolve(usage([])) : second.promise;
      },
    });
    f.open(target);
    await tick();
    expect(f.canDelete).toBe(true);

    void f.recheck();
    expect(f.rechecking).toBe(true);
    expect(f.view).toBe('unused');
    expect(f.canDelete).toBe(false);

    second.resolve(usage([]));
    await tick();
    expect(f.rechecking).toBe(false);
    expect(f.canDelete).toBe(true);
  });

  it('R1: refused with MEDIA_IN_USE, it re-reads and names what was published', async () => {
    let calls = 0;
    const { flow: f, readUsage } = flow({
      readUsage: async () => {
        calls++;
        return calls === 1
          ? usage([film('Winter Light', false, 'c3')], 'fp-old')
          : usage([film('Winter Light', true, 'c3')], 'fp-new');
      },
      remove: async () => {
        throw httpError(409, 'MEDIA_IN_USE');
      },
    });
    f.open(target);
    await tick();

    const outcome = await f.confirm();
    expect(outcome).toEqual({ kind: 'refused' });
    expect(readUsage).toHaveBeenCalledTimes(2);
    expect(f.view).toBe('blocked');
    expect(f.canDelete).toBe(false);
    expect(f.notice).toEqual({ kind: 'now-live', title: 'Winter Light' });
  });

  it('R2: refused with MEDIA_USAGE_CHANGED for a new draft, it re-reads and Delete is back', async () => {
    let calls = 0;
    const { flow: f, remove } = flow({
      readUsage: async () => {
        calls++;
        return calls === 1
          ? usage([], 'fp-empty')
          : usage(
              [film('Sound on Location: Lesson 2', false, 'c4')],
              'fp-draft'
            );
      },
      remove: vi
        .fn()
        .mockRejectedValueOnce(httpError(409, 'MEDIA_USAGE_CHANGED'))
        .mockResolvedValueOnce(undefined),
    });
    f.open(target);
    await tick();

    expect(await f.confirm()).toEqual({ kind: 'refused' });
    expect(f.view).toBe('drafts');
    expect(f.notice).toEqual({ kind: 'new-draft' });
    expect(f.canDelete).toBe(true);

    // The second click carries the NEW read's fingerprint.
    await f.confirm();
    expect(remove).toHaveBeenLastCalledWith({
      id: MEDIA_ID,
      usage: 'fp-draft',
    });
  });

  it('F3: a failed delete says so, and nothing is deleted', async () => {
    const { flow: f } = flow({
      remove: async () => {
        throw httpError(500, 'INTERNAL_ERROR');
      },
    });
    f.open(target);
    await tick();

    expect(await f.confirm()).toEqual({ kind: 'failed', status: 500 });
    expect(f.notice).toEqual({ kind: 'failed', rateLimited: false });
    expect(f.view).toBe('unused');
    expect(f.canDelete).toBe(true);
  });

  it('F3: a network failure (no status) is a failure too', async () => {
    const { flow: f } = flow({
      remove: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    f.open(target);
    await tick();
    expect(await f.confirm()).toEqual({ kind: 'failed', status: undefined });
    expect(f.notice).toEqual({ kind: 'failed', rateLimited: false });
  });

  it('a 404 means another tab already deleted it', async () => {
    const { flow: f } = flow({
      remove: async () => {
        throw httpError(404, 'MEDIA_NOT_FOUND');
      },
    });
    f.open(target);
    await tick();
    expect(await f.confirm()).toEqual({ kind: 'gone' });
  });

  it("a read that lands after the dialog closed doesn't touch the next one", async () => {
    const first = deferred<MediaUsage>();
    let calls = 0;
    const { flow: f } = flow({
      readUsage: () => {
        calls++;
        return calls === 1 ? first.promise : Promise.resolve(usage([]));
      },
    });
    f.open(target);
    f.close();
    f.open({ ...target, id: '6b000000-0000-4000-8000-000000000002' });
    await tick();
    expect(f.view).toBe('unused');

    first.resolve(usage([film('Old', true, 'c9')]));
    await tick();
    expect(f.view).toBe('unused');
  });
});
