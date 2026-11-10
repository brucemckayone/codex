/**
 * POST /internal/content/media-ready (Codex-a6ofh.2.8): media-api's call
 * when a file changed. Only a worker holding the shared secret may make it;
 * what it settles is the service's to decide (its own DB tests). This file
 * pins the route's half: the signature gate, the cache bumps a go-live and
 * a file going ready need, and which creator gets which email. It answers
 * 204 at once and settles in `ctx.background`, so every effect is checked
 * after the execution context drains.
 *
 * Real `procedure()` (so the real HMAC check), real Hono routing, real
 * Miniflare `CACHE_KV` drained with `waitOnExecutionContext`. Stubbed: the
 * service, the org slug lookup, the per-user library fan-out, and the email
 * hop to notifications-api.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { HEADERS } from '@codex/constants';
import type {
  ScheduleSettlement,
  SettledDraft,
  SettleOptions,
} from '@codex/content';
import { ObservabilityClient } from '@codex/observability';
import { generateWorkerSignature } from '@codex/security';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contentSpies = {
  settleScheduledForMedia: vi.fn(),
  setCache: vi.fn(),
};

const { invalidateContentAccess, sendEmailToWorker } = vi.hoisted(() => ({
  invalidateContentAccess: vi.fn(async () => undefined),
  sendEmailToWorker: vi.fn(),
}));

vi.mock('@codex/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/content')>();
  return {
    ...actual,
    ContentService: vi.fn(() => contentSpies),
    invalidateContentAccess,
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

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return { ...actual, sendEmailToWorker };
});

// Below the mocks on purpose: biome's organizeImports never moves an import
// across a statement, so the registry resolves the mocked classes.
import { CONTENT_MEDIA_READY_ROUTE } from '@codex/worker-utils';
import internal from '../internal';

// Links are built from the environment name: development is lvh.me:3000.
const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
} as unknown as typeof env;

const MEDIA_ID = '4d000000-0000-4000-8000-000000000001';

let seq = 0;
function draft(overrides: Partial<SettledDraft> = {}): SettledDraft {
  seq += 1;
  const n = String(seq).padStart(3, '0');
  return {
    id: `2d000000-0000-4000-8000-000000000${n}`,
    title: 'Morning Flow',
    slug: 'morning-flow',
    contentType: 'video',
    organizationId: `3d111111-1111-4111-8111-111111111${n}`,
    organizationSlug: 'yoga-studio',
    creator: {
      id: 'creator-1',
      name: 'Sam',
      email: 'sam@example.test',
      username: 'sam',
    },
    ...overrides,
  };
}

const settlement = (
  overrides: Partial<ScheduleSettlement> = {}
): ScheduleSettlement => ({
  wentLive: [],
  stopped: [],
  retryLater: 0,
  more: false,
  liveOrgIds: [],
  ...overrides,
});

/**
 * The service's settle as the route meets it: each draft handed to
 * `onSettled` as its write commits, then the summary.
 */
const settles =
  (overrides: Partial<ScheduleSettlement> = {}) =>
  async (_mediaItemId: string, options?: SettleOptions) => {
    const settled = settlement(overrides);
    for (const draft of settled.wentLive) {
      options?.onSettled?.({ kind: 'live', draft });
    }
    for (const draft of settled.stopped) {
      options?.onSettled?.({ kind: 'stopped', draft });
    }
    return settled;
  };

function cacheKv(): NonNullable<typeof env.CACHE_KV> {
  const kv = env.CACHE_KV;
  if (!kv) throw new Error('CACHE_KV must be bound for this suite');
  return kv;
}
const orgContentVersion = (orgId: string) =>
  cacheKv().get(`cache:version:org:${orgId}:content`);

/**
 * The secret `.dev.vars.test` gives the worker. Thrown for when unset, so the
 * signed cases can't pass against a gate that refuses everything for want
 * of one.
 */
function sharedSecret(): string {
  const secret = (env as unknown as { WORKER_SHARED_SECRET?: unknown })
    .WORKER_SHARED_SECRET;
  if (typeof secret !== 'string' || secret === '') {
    throw new Error('WORKER_SHARED_SECRET must be set for this suite');
  }
  return secret;
}

const obs = new ObservabilityClient('content-api-test', 'test');

/** The response, before the background settle is drained (`drained`). */
async function send(
  body: unknown,
  sign: 'valid' | 'none' | 'wrong' = 'valid',
  bindings: typeof env = testEnv
): Promise<{ res: Response; drained: () => Promise<void> }> {
  const app = new Hono<HonoEnv>();
  // What createWorker's middleware gives every request: procedure() reads
  // its logger from here, so without it every log is a silent no-op.
  app.use('*', async (c, next) => {
    c.set('obs', obs);
    await next();
  });
  app.route('/', internal);
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = sign === 'wrong' ? 'not-the-shared-secret' : sharedSecret();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sign !== 'none') {
    headers[HEADERS.WORKER_SIGNATURE] = await generateWorkerSignature(
      payload,
      secret,
      timestamp
    );
    headers[HEADERS.WORKER_TIMESTAMP] = String(timestamp);
  }
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test${CONTENT_MEDIA_READY_ROUTE}`, {
      method: 'POST',
      headers,
      body: payload,
    }),
    bindings,
    ec
  );
  return { res, drained: () => waitOnExecutionContext(ec) };
}

/** The response, once everything the call set off has run. */
async function call(...args: Parameters<typeof send>): Promise<Response> {
  const { res, drained } = await send(...args);
  await drained();
  return res;
}

describe('POST /internal/content/media-ready', () => {
  const errorLog = vi.spyOn(obs, 'error');

  beforeEach(() => {
    vi.clearAllMocks();
    contentSpies.settleScheduledForMedia.mockResolvedValue(settlement());
  });

  it.each([
    ['no signature', 'none'],
    ['the wrong secret', 'wrong'],
  ] as const)('refuses a call with %s, and settles nothing', async (_case, sign) => {
    const res = await call({ mediaItemId: MEDIA_ID }, sign);

    expect(res.status).toBe(401);
    expect(contentSpies.settleScheduledForMedia).not.toHaveBeenCalled();
  });

  it('refuses a body that names no media item', async () => {
    const res = await call({ mediaItemId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(contentSpies.settleScheduledForMedia).not.toHaveBeenCalled();
  });

  // A caller that gives up waiting would otherwise cancel a settle part-way:
  // drafts live, and never announced (a later call no longer sees them).
  it('answers 204 before the settle ends, and announces it after', async () => {
    let finish = () => {};
    contentSpies.settleScheduledForMedia.mockImplementation(
      (mediaItemId: string, options?: SettleOptions) =>
        new Promise<ScheduleSettlement>((resolve) => {
          finish = () =>
            resolve(settles({ wentLive: [draft()] })(mediaItemId, options));
        })
    );

    const { res, drained } = await send({ mediaItemId: MEDIA_ID });

    expect(res.status).toBe(204);
    expect(contentSpies.settleScheduledForMedia).toHaveBeenCalledWith(
      MEDIA_ID,
      expect.anything()
    );
    expect(sendEmailToWorker).not.toHaveBeenCalled();
    finish();
    await drained();
    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
  });

  // Told as it commits: a settle cut off (or thrown) after a go-live has
  // still announced it, since a later call no longer sees it waiting.
  it('a go-live is announced as it commits, even if the settle then fails', async () => {
    const live = draft();
    contentSpies.settleScheduledForMedia.mockImplementation(
      async (_mediaItemId: string, options?: SettleOptions) => {
        options?.onSettled?.({ kind: 'live', draft: live });
        throw new Error('cut off');
      }
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
    expect(invalidateContentAccess).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: live.id })
    );
    expect(
      await orgContentVersion(live.organizationId as string)
    ).not.toBeNull();
    expect(errorLog).toHaveBeenCalledWith(
      'Publish when ready: settle failed',
      expect.objectContaining({ mediaItemId: MEDIA_ID })
    );
  });

  it('a settle that throws is logged at error, and tells no one', async () => {
    contentSpies.settleScheduledForMedia.mockRejectedValue(
      new Error('database unavailable')
    );

    const res = await call({ mediaItemId: MEDIA_ID });

    expect(res.status).toBe(204);
    expect(errorLog).toHaveBeenCalledWith(
      'Publish when ready: settle failed',
      expect.objectContaining({ mediaItemId: MEDIA_ID })
    );
    expect(sendEmailToWorker).not.toHaveBeenCalled();
  });

  it('refreshes what a go-live changes, and every org list showing the file (1szw2)', async () => {
    const live = draft();
    const elsewhere = '3d999999-9999-4999-8999-999999999001';
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({
        wentLive: [live],
        liveOrgIds: [live.organizationId as string, elsewhere],
      })
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(
      await orgContentVersion(live.organizationId as string)
    ).not.toBeNull();
    expect(await orgContentVersion(elsewhere)).not.toBeNull();
    // The library fan-out is for the piece that went live, once.
    expect(invalidateContentAccess).toHaveBeenCalledTimes(1);
    expect(invalidateContentAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        contentId: live.id,
        reason: 'content_published',
      })
    );
  });

  it('emails "is live" with the public page, on the org subdomain', async () => {
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({ wentLive: [draft()] })
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
    expect(sendEmailToWorker.mock.calls[0]?.[2]).toMatchObject({
      to: 'sam@example.test',
      templateName: 'content-live',
      category: 'transactional',
      userId: 'creator-1',
      data: {
        userName: 'Sam',
        contentTitle: 'Morning Flow',
        mediaKind: 'video',
        contentUrl: 'http://yoga-studio.lvh.me:3000/content/morning-flow',
      },
    });
  });

  it('a personal piece links to its creator page, or the studio without a handle', async () => {
    const personal = { organizationId: null, organizationSlug: null };
    const noHandle = draft({
      ...personal,
      creator: { ...draft().creator, username: null },
    });
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({ wentLive: [draft(personal), noHandle] })
    );

    await call({ mediaItemId: MEDIA_ID });

    const urls = sendEmailToWorker.mock.calls.map(
      (args) => (args[2] as { data: { contentUrl: string } }).data.contentUrl
    );
    expect(urls).toEqual([
      'http://creators.lvh.me:3000/@sam/content/morning-flow',
      `http://creators.lvh.me:3000/studio/content/${noHandle.id}/edit?step=publish`,
    ]);
  });

  // An org id with no slug: it moved to an org whose slug wasn't read. The
  // personal studio would open it out of its org, so no link, and say so.
  it('an org piece with no slug gets no email rather than a wrong link, and is logged', async () => {
    const moved = draft({ organizationSlug: null });
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({ wentLive: [moved] })
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      'Publish-when-ready email not sent: no link to give',
      expect.objectContaining({ contentId: moved.id })
    );
    // Its refresh does not depend on a link.
    expect(invalidateContentAccess).toHaveBeenCalledTimes(1);
  });

  it('an email that cannot be queued is logged, and costs the next nothing', async () => {
    const first = draft();
    const second = draft();
    sendEmailToWorker.mockImplementationOnce(() => {
      throw new Error('notifications URL refused');
    });
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({ wentLive: [first, second] })
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      'Publish-when-ready email not queued',
      expect.objectContaining({
        contentId: first.id,
        templateName: 'content-live',
      })
    );
    expect(invalidateContentAccess).toHaveBeenCalledTimes(2);
  });

  it(`emails "didn't go live" with the reason and the Publish step, never for a file the creator deleted`, async () => {
    const refused = draft();
    const deleted = draft();
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({
        stopped: [
          { ...refused, reason: 'CREATOR_CONNECT_REQUIRED' },
          { ...deleted, reason: 'MEDIA_DELETED' },
        ],
      })
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker).toHaveBeenCalledTimes(1);
    expect(sendEmailToWorker.mock.calls[0]?.[2]).toMatchObject({
      templateName: 'content-not-live',
      data: {
        reason: "it earns money, and your payouts aren't set up yet.",
        editUrl: `http://yoga-studio.lvh.me:3000/studio/content/${refused.id}/edit?step=publish`,
      },
    });
    // A refusal changed nothing public.
    expect(invalidateContentAccess).not.toHaveBeenCalled();
  });

  it('a failed audio file says so', async () => {
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({
        stopped: [
          {
            ...draft({ contentType: 'audio' }),
            reason: 'MEDIA_FAILED',
          },
        ],
      })
    );

    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker.mock.calls[0]?.[2]).toMatchObject({
      data: { reason: "its audio couldn't be processed." },
    });
  });

  // Links come from the environment's name: one this can't route sends no
  // email with a wrong link, says whom it didn't tell, and refreshes anyway.
  it('an environment it cannot route sends no email, logs who missed one, and refreshes anyway', async () => {
    const live = draft();
    contentSpies.settleScheduledForMedia.mockImplementation(
      settles({ wentLive: [live] })
    );

    const res = await call({ mediaItemId: MEDIA_ID }, 'valid', {
      ...testEnv,
      ENVIRONMENT: 'qa-box',
    } as unknown as typeof env);

    expect(res.status).toBe(204);
    expect(sendEmailToWorker).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      'Publish-when-ready email not sent: no link to give',
      expect.objectContaining({ contentId: live.id, environment: 'qa-box' })
    );
    // The go-live's own refresh does not depend on it.
    expect(invalidateContentAccess).toHaveBeenCalledTimes(1);
  });

  it('nothing settled: no email and no bump', async () => {
    await call({ mediaItemId: MEDIA_ID });

    expect(sendEmailToWorker).not.toHaveBeenCalled();
    expect(invalidateContentAccess).not.toHaveBeenCalled();
  });
});
