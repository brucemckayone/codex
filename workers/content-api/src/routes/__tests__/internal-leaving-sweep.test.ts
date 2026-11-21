/**
 * POST /internal/content/leaving-sweep (Codex-a6ofh.6.4): media-api's hourly
 * call for one tick of the leaving notice. Only a worker holding the shared
 * secret, with a fresh signature, may make it, and its body is empty. What
 * a tick sends is the service's to decide (its own DB suite); this file pins
 * the route's half: the gate, the order (emails, reminders, the day-30
 * deletes, logged before anything else can cut the tick off), each deleted
 * piece's cover, every owner's library and the one bulk refresh of the rest,
 * and the report it answers with.
 *
 * Real `procedure()` (so the real HMAC check), real Hono routing, real
 * Miniflare `CACHE_KV`. Stubbed: both services, the cover cleanup, the org
 * slug lookup and the per-user library fan-out.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import {
  HEADERS,
  LEAVING_SWEEP_PIECES_PER_TICK,
  LEAVING_SWEEP_ROUTE_DEADLINE_MS,
} from '@codex/constants';
import type { CompletedLeave, LeavingNoticeTally } from '@codex/content';
import { ObservabilityClient } from '@codex/observability';
import { generateWorkerSignature } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentSpies = {
  completeLeaving: vi.fn(),
  setCache: vi.fn(),
};
const sweepSpies = {
  sendDue: vi.fn(),
  addReminders: vi.fn(),
  bumpOwnersOf: vi.fn(),
};

const { invalidateContentAccessMany, cleanupContentThumbnailOnDelete } =
  vi.hoisted(() => ({
    invalidateContentAccessMany: vi.fn(async () => undefined),
    cleanupContentThumbnailOnDelete: vi.fn(async () => undefined),
  }));

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
    ContentLeavingNoticeService: vi.fn(() => sweepSpies),
    invalidateContentAccessMany,
  };
});

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return {
    ...actual,
    createDbClient: vi.fn(() => ({
      query: {
        organizations: {
          findFirst: vi.fn(async () => ({ slug: 'some-org' })),
        },
      },
    })),
  };
});

vi.mock('../content-cleanup', () => ({ cleanupContentThumbnailOnDelete }));

// Below the mocks on purpose: biome's organizeImports never moves an import
// across a statement, so the registry resolves the mocked classes.
import { CONTENT_LEAVING_SWEEP_ROUTE } from '@codex/worker-utils';
import internal from '../internal';

const ORG_ID = '3d000000-0000-4000-8000-000000000001';

const tally = (overrides: Partial<LeavingNoticeTally> = {}) => ({
  claimed: 0,
  sent: 0,
  failed: 0,
  unknown: 0,
  abandoned: 0,
  cancelled: 0,
  givenBack: 0,
  notRecorded: 0,
  errors: 0,
  librariesBumped: 0,
  more: false,
  ...overrides,
});

function cacheKv(): NonNullable<typeof env.CACHE_KV> {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV must be bound for this suite');
  return kv;
}

/** The secret `.dev.vars.test` gives the worker. */
function sharedSecret(): string {
  const secret = (env as unknown as { WORKER_SHARED_SECRET?: unknown })
    .WORKER_SHARED_SECRET;
  if (typeof secret !== 'string' || secret === '') {
    throw new Error('WORKER_SHARED_SECRET must be set for this suite');
  }
  return secret;
}

const obs = new ObservabilityClient('content-api-test', 'test');

type Sign = 'valid' | 'none' | 'wrong' | 'stale';

/** The response, once everything the call set off has run. */
async function call(body: unknown, sign: Sign = 'valid'): Promise<Response> {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('obs', obs);
    await next();
  });
  app.route('/', internal);
  const payload = JSON.stringify(body);
  // Ten minutes old: past the five a signature lives.
  const timestamp =
    Math.floor(Date.now() / 1000) - (sign === 'stale' ? 600 : 0);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sign !== 'none') {
    headers[HEADERS.WORKER_SIGNATURE] = await generateWorkerSignature(
      payload,
      sign === 'wrong' ? 'not-the-shared-secret' : sharedSecret(),
      timestamp
    );
    headers[HEADERS.WORKER_TIMESTAMP] = String(timestamp);
  }
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test${CONTENT_LEAVING_SWEEP_ROUTE}`, {
      method: 'POST',
      headers,
      body: payload,
    }),
    { ...env, ENVIRONMENT: 'development' } as unknown as typeof env,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

describe('POST /internal/content/leaving-sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sweepSpies.sendDue.mockResolvedValue(tally());
    sweepSpies.addReminders.mockResolvedValue(0);
    sweepSpies.bumpOwnersOf.mockResolvedValue(0);
    contentSpies.completeLeaving.mockResolvedValue([]);
    cleanupContentThumbnailOnDelete.mockImplementation(async () => undefined);
  });

  it.each([
    ['no signature', 'none'],
    ['the wrong secret', 'wrong'],
    ['a stale signature', 'stale'],
  ] as const)('refuses a call with %s, and runs nothing', async (_case, sign) => {
    const res = await call({}, sign);

    expect(res.status).toBe(401);
    expect(sweepSpies.sendDue).not.toHaveBeenCalled();
    expect(contentSpies.completeLeaving).not.toHaveBeenCalled();
  });

  it('refuses a body with anything in it', async () => {
    const res = await call({ force: true });

    expect(res.status).toBe(400);
    expect(sweepSpies.sendDue).not.toHaveBeenCalled();
  });

  it('runs the emails, the reminders, then the day-30 deletes, and answers the report', async () => {
    sweepSpies.sendDue.mockResolvedValue(
      tally({ claimed: 3, sent: 2, failed: 1, librariesBumped: 1 })
    );
    sweepSpies.addReminders.mockResolvedValue(4);
    const completed: CompletedLeave[] = [
      {
        id: '2d000000-0000-4000-8000-000000000001',
        organizationId: ORG_ID,
        creatorId: 'creator-1',
      },
      {
        id: '2d000000-0000-4000-8000-000000000002',
        organizationId: null,
        creatorId: 'creator-2',
      },
    ];
    contentSpies.completeLeaving.mockResolvedValue(completed);
    sweepSpies.bumpOwnersOf.mockResolvedValue(700);
    const info = vi.spyOn(obs, 'info');
    const logOrder: number[] = [];
    cleanupContentThumbnailOnDelete.mockImplementation(async () => {
      logOrder.push(info.mock.calls.length);
    });

    const before = Date.now();
    const res = await call({});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        // The claim's bump and day 30's 700 owners.
        ...tally({ claimed: 3, sent: 2, failed: 1, librariesBumped: 701 }),
        remindersAdded: 4,
        completed: 2,
      },
    });
    // The deleted pieces are named before the covers: a tick cut off in the
    // cleanup still says which pieces' files it left.
    const named = info.mock.calls.findIndex(([message]) =>
      String(message).includes('pieces deleted on their day')
    );
    expect(named).toBeGreaterThanOrEqual(0);
    expect(info.mock.calls[named]?.[1]).toEqual({
      completedIds: completed.map((piece) => piece.id),
    });
    expect(logOrder[0]).toBeGreaterThan(named);
    const [sent] = sweepSpies.sendDue.mock.invocationCallOrder;
    const [reminded] = sweepSpies.addReminders.mock.invocationCallOrder;
    const [deleted] = contentSpies.completeLeaving.mock.invocationCallOrder;
    expect(sent).toBeLessThan(reminded ?? 0);
    expect(reminded).toBeLessThan(deleted ?? 0);
    expect(contentSpies.completeLeaving).toHaveBeenCalledWith(
      LEAVING_SWEEP_PIECES_PER_TICK
    );
    // Each deleted piece's cover, by its creator.
    expect(
      cleanupContentThumbnailOnDelete.mock.calls.map((args) => args.slice(1, 3))
    ).toEqual([
      [completed[0]?.id, 'creator-1'],
      [completed[1]?.id, 'creator-2'],
    ]);
    // Every owner's library, uncapped, by the sweep, stopping in time to
    // answer.
    expect(sweepSpies.bumpOwnersOf).toHaveBeenCalledWith(
      completed.map((piece) => piece.id),
      { until: expect.any(Number) }
    );
    // The route's whole time from its start, never less.
    const until = sweepSpies.bumpOwnersOf.mock.calls[0]?.[1]?.until ?? 0;
    expect(until).toBeGreaterThanOrEqual(
      before + LEAVING_SWEEP_ROUTE_DEADLINE_MS
    );
    expect(until).toBeLessThanOrEqual(
      Date.now() + LEAVING_SWEEP_ROUTE_DEADLINE_MS
    );
    // One refresh for all of them: their org's lists, and the rest of their
    // people (the owners are the sweep's, so no key is written twice).
    expect(
      await cacheKv().get(`cache:version:org:${ORG_ID}:content`)
    ).not.toBeNull();
    expect(invalidateContentAccessMany).toHaveBeenCalledTimes(1);
    expect(invalidateContentAccessMany).toHaveBeenCalledWith(
      expect.objectContaining({
        pieces: completed,
        reason: 'content_deleted',
        catalogue: false,
        holders: false,
      })
    );
  });

  it('a quiet tick refreshes nothing', async () => {
    const res = await call({});

    expect(res.status).toBe(200);
    expect(cleanupContentThumbnailOnDelete).not.toHaveBeenCalled();
    expect(invalidateContentAccessMany).not.toHaveBeenCalled();
    expect(sweepSpies.bumpOwnersOf).toHaveBeenCalledWith([], {
      until: expect.any(Number),
    });
  });

  it("a tick cut off during the owners' bumps has already scheduled the rest of the refresh", async () => {
    contentSpies.completeLeaving.mockResolvedValue([
      {
        id: '2d000000-0000-4000-8000-000000000003',
        organizationId: ORG_ID,
        creatorId: 'creator-1',
      },
    ]);
    // media-api gave up: the request is torn down mid-bump.
    sweepSpies.bumpOwnersOf.mockRejectedValue(new Error('cut off'));

    const res = await call({});

    expect(res.status).toBe(500);
    expect(invalidateContentAccessMany).toHaveBeenCalledTimes(1);
    expect(invalidateContentAccessMany).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'content_deleted', holders: false })
    );
  });

  it('a step that throws fails the tick, and the steps after it wait for the next', async () => {
    sweepSpies.sendDue.mockRejectedValue(new Error('database unavailable'));

    const res = await call({});

    expect(res.status).toBe(500);
    expect(sweepSpies.addReminders).not.toHaveBeenCalled();
    expect(contentSpies.completeLeaving).not.toHaveBeenCalled();
  });
});
