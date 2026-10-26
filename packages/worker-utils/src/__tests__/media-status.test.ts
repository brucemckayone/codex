/**
 * Reaching media-api's MediaStatusObject (Codex-l2c48.9): routing, delivery,
 * and that a lost publish is logged and never thrown.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ObservabilityClient } from '@codex/observability';
import type { MediaStatusChange } from '@codex/validation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DurableObjectMediaStatusFeed,
  deliverMediaStatusEvent,
  MEDIA_STATUS_INTERNAL_ROUTE,
  MEDIA_STATUS_OBJECT_PATHS,
  MEDIA_STATUS_SHARD_COUNT,
  mediaStatusShardOf,
  WorkerMediaStatusPublisher,
} from '../media-status';

const change: MediaStatusChange = {
  mediaId: '4d000000-0000-4000-8000-000000000001',
  creatorId: 'creatorA1',
  lifecycle: 'transcoding',
  errorCode: null,
  attempts: 1,
  jobId: 'job-1',
  at: 1_800_000_000_000,
};

/** A namespace whose every stub answers `status` and records the call. */
function fakeNamespace(status = 204) {
  const calls: { name: string; path: string; body: unknown }[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        calls.push({
          name,
          path: new URL(url).pathname,
          body: JSON.parse(String(init.body)),
        });
        return new Response(null, { status });
      },
    }),
  } as unknown as DurableObjectNamespace;
  return { namespace, calls };
}

function fakeObs() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as ObservabilityClient & {
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}

/** Collects what a publisher hands waitUntil, so a test can await it. */
function collector() {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    settled: () => Promise.all(pending),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mediaStatusShardOf', () => {
  it('is a shard in range, the same every time', () => {
    for (const id of ['a', 'creatorA1', 'x'.repeat(64)]) {
      const shard = mediaStatusShardOf(id);
      expect(shard).toBe(mediaStatusShardOf(id));
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(MEDIA_STATUS_SHARD_COUNT);
    }
  });
});

describe('deliverMediaStatusEvent', () => {
  it("posts a change to its creator's object", async () => {
    const { namespace, calls } = fakeNamespace();
    await deliverMediaStatusEvent(namespace, { event: 'changed', change });
    expect(calls).toEqual([
      {
        name: `media-status:${mediaStatusShardOf(change.creatorId)}`,
        path: MEDIA_STATUS_OBJECT_PATHS.publish,
        body: change,
      },
    ]);
  });

  it('posts a removal', async () => {
    const { namespace, calls } = fakeNamespace();
    await deliverMediaStatusEvent(namespace, {
      event: 'removed',
      mediaId: change.mediaId,
      creatorId: change.creatorId,
    });
    expect(calls[0]?.path).toBe(MEDIA_STATUS_OBJECT_PATHS.removed);
  });

  it('throws when the object refuses, for the caller to report', async () => {
    const { namespace } = fakeNamespace(500);
    await expect(
      deliverMediaStatusEvent(namespace, { event: 'changed', change })
    ).rejects.toThrow('media status object answered 500');
  });
});

describe('DurableObjectMediaStatusFeed', () => {
  it('logs a publish the object refused, and never throws', async () => {
    const { namespace } = fakeNamespace(500);
    const obs = fakeObs();
    const background = collector();
    const feed = new DurableObjectMediaStatusFeed(
      namespace,
      background.waitUntil,
      obs
    );

    expect(() => feed.changed(change)).not.toThrow();
    await background.settled();
    expect(obs.error).toHaveBeenCalledWith(
      'media_status.publish_failed',
      expect.objectContaining({ event: 'changed', mediaId: change.mediaId })
    );
  });

  it('answers false for a tick the object did not take', async () => {
    const { namespace } = fakeNamespace(500);
    const feed = new DurableObjectMediaStatusFeed(
      namespace,
      collector().waitUntil,
      fakeObs()
    );
    const tick = {
      mediaId: change.mediaId,
      jobId: 'job-1',
      step: 'encoding_variants' as const,
      progress: 40,
    };
    expect(await feed.progress(tick, change.creatorId)).toBe(false);
  });

  it('resyncs every shard, each with its own rows', async () => {
    const { namespace, calls } = fakeNamespace();
    const feed = new DurableObjectMediaStatusFeed(
      namespace,
      collector().waitUntil
    );
    await feed.resync({ rows: [change], asOf: change.at, complete: true });
    expect(calls).toHaveLength(MEDIA_STATUS_SHARD_COUNT);
    expect(
      calls.flatMap((call) => (call.body as { rows: unknown[] }).rows)
    ).toEqual([change]);
  });
});

describe('WorkerMediaStatusPublisher', () => {
  it("posts to media-api's internal route, signed", async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const background = collector();
    new WorkerMediaStatusPublisher(
      'https://media-api.test',
      'secret',
      background.waitUntil
    ).changed(change);
    await background.settled();

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`https://media-api.test${MEDIA_STATUS_INTERNAL_ROUTE}`);
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-Worker-Signature')).toBeTruthy();
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      event: 'changed',
      change,
    });
  });

  it('logs a publish media-api refused, and never throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503 })
    );
    const obs = fakeObs();
    const background = collector();
    const publisher = new WorkerMediaStatusPublisher(
      'https://media-api.test',
      'secret',
      background.waitUntil,
      obs
    );

    expect(() =>
      publisher.removed(change.mediaId, change.creatorId)
    ).not.toThrow();
    await background.settled();
    expect(obs.error).toHaveBeenCalledWith(
      'media_status.publish_failed',
      expect.objectContaining({ event: 'removed', mediaId: change.mediaId })
    );
  });
});

describe('the status object is addressed one way', () => {
  // statusObjectFor is the shard seam: a caller that picks an object itself
  // would miss a creator's items the day MEDIA_STATUS_SHARD_COUNT rises.
  const root = join(import.meta.dirname, '../../../..');
  const MODULE = 'packages/worker-utils/src/media-status.ts';

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      if (['node_modules', 'dist', '__tests__', '.wrangler'].includes(entry)) {
        return [];
      }
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
    });
  }

  const ADDRESSES =
    /MEDIA_STATUS\.(get|idFromName|newUniqueId|getByName)\(|['"`]media-status:/;

  it('sees the one module that may (the probe is calibrated)', () => {
    expect(ADDRESSES.test(readFileSync(join(root, MODULE), 'utf8'))).toBe(true);
  });

  it('only media-status.ts names an object of MEDIA_STATUS', () => {
    const offenders = ['packages', 'workers']
      .flatMap((top) =>
        readdirSync(join(root, top)).map((pkg) => join(root, top, pkg, 'src'))
      )
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap(sources)
      .filter((path) => relative(root, path) !== MODULE)
      .filter((path) => ADDRESSES.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
