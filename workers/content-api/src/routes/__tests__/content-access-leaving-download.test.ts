/**
 * An owner's copy of a leaving piece (Codex-a6ofh.6.5, design §7):
 * `GET /api/access/content/:id/download` and `GET /api/access/content/print`.
 *
 * SHAPE. Real `procedure()` and Hono routing; only `ContentAccessService` is
 * stubbed (no Neon), so the assertions are the session gate, the `strict`
 * preset, the log line, the envelope and the header. Who owns a piece, and
 * every refusal's one 404, are pinned in @codex/access
 * leaving-download.integration.test.ts.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { ContentNotFoundError } from '@codex/access';
import { CACHE_PRESETS } from '@codex/constants';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Its own user id: the limiter counts per user, and `singleWorker` shares one
// limiter across files.
const USER = {
  id: 'leavingdownloadroute1',
  email: 'owner@test.com',
  role: 'customer',
};
const CONTENT_ID = '6f000000-0000-4000-8000-0000000000a5';
const ORG_ID = '8b000000-0000-4000-8000-0000000000a5';

const accessSpies = {
  getLeavingDownload: vi.fn(),
  getLeavingPrint: vi.fn(),
};

vi.mock('@codex/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/access')>();
  return {
    ...actual,
    ContentAccessService: vi.fn(() => accessSpies),
  };
});

// Below the mock on purpose: biome's organizeImports never moves an import
// across a statement, so this stays after `vi.mock` and the real service
// registry resolves the mocked class.
import contentAccess from '../content-access';

/** A rate-limit binding that answers `success` and records each key. */
function limiter(success: boolean) {
  return { limit: vi.fn(async (_opts: { key: string }) => ({ success })) };
}

function fakeObs() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function get(
  path: string,
  {
    signedIn = true,
    obs,
    strict = limiter(true),
    api = limiter(true),
  }: {
    signedIn?: boolean;
    obs?: ReturnType<typeof fakeObs>;
    strict?: ReturnType<typeof limiter>;
    api?: ReturnType<typeof limiter>;
  } = {}
): Promise<Response> {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    if (obs) c.set('obs', obs);
    if (signedIn) {
      c.set('user', USER);
      c.set('session', { id: 'sess_leaving', userId: USER.id });
    }
    await next();
  });
  app.route('/api/access', contentAccess);
  const testEnv = {
    ...env,
    ENVIRONMENT: 'development',
    R2_PUBLIC_URL_BASE: 'https://cdn.test',
    RATE_LIMIT_STRICT: strict,
    RATE_LIMIT_API: api,
  } as unknown as typeof env;
  const ec = createExecutionContext();
  const res = await app.fetch(
    new Request(`http://content-api.test${path}`),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const download = {
  url: 'https://r2.test/creator/originals/m/video.mp4?X-Amz-Signature=s',
  filename: 'breathing.mp4',
  sizeBytes: 1_500_000_000,
  expiresAt: '2026-11-20T12:15:00.000Z',
};

describe('GET /api/access/content/:id/download (Codex-a6ofh.6.5)', () => {
  const path = `/api/access/content/${CONTENT_ID}/download`;

  beforeEach(() => {
    accessSpies.getLeavingDownload.mockReset();
    accessSpies.getLeavingDownload.mockResolvedValue(download);
  });

  it('hands the session’s user and the id to the service, never cached', async () => {
    const res = await get(path);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: download });
    expect(accessSpies.getLeavingDownload).toHaveBeenCalledWith(
      USER.id,
      CONTENT_ID
    );
    // The link is a credential.
    expect(res.headers.get('Cache-Control')).toBe(CACHE_PRESETS.fresh);
  });

  it('needs a session', async () => {
    const res = await get(path, { signedIn: false });

    expect(res.status).toBe(401);
    expect(accessSpies.getLeavingDownload).not.toHaveBeenCalled();
  });

  it('is capped by the strict preset, not the api one', async () => {
    const strict = limiter(false);
    const api = limiter(true);
    const res = await get(path, { strict, api });

    expect(res.status).toBe(429);
    expect(strict.limit).toHaveBeenCalledTimes(1);
    expect(api.limit).not.toHaveBeenCalled();
    expect(accessSpies.getLeavingDownload).not.toHaveBeenCalled();

    // And the api preset refusing does not stop it.
    const open = await get(path, {
      strict: limiter(true),
      api: limiter(false),
    });
    expect(open.status).toBe(200);
  });

  it('logs the piece and the size only, never who took it', async () => {
    const obs = fakeObs();
    await get(path, { obs });

    const lines = obs.info.mock.calls.filter(
      ([message]) => message === 'content.leaving_download'
    );
    expect(lines).toEqual([
      [
        'content.leaving_download',
        { contentId: CONTENT_ID, sizeBytes: 1_500_000_000 },
      ],
    ]);
  });

  it('logs no size when the original has none recorded', async () => {
    accessSpies.getLeavingDownload.mockResolvedValue({
      ...download,
      sizeBytes: null,
    });
    const obs = fakeObs();
    const res = await get(path, { obs });

    expect(res.status).toBe(200);
    expect(obs.info).toHaveBeenCalledWith('content.leaving_download', {
      contentId: CONTENT_ID,
      sizeBytes: null,
    });
  });

  it('answers a refusal as the 404 envelope and logs no download', async () => {
    accessSpies.getLeavingDownload.mockRejectedValue(
      new ContentNotFoundError(CONTENT_ID)
    );
    const obs = fakeObs();
    const res = await get(path, { obs });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: { code: 'NOT_FOUND', details: { code: 'CONTENT_NOT_FOUND' } },
    });
    expect(
      obs.info.mock.calls.some(([m]) => m === 'content.leaving_download')
    ).toBe(false);
  });

  it('refuses an id that is not a uuid with a 400 and never asks the service', async () => {
    const res = await get('/api/access/content/not-a-uuid/download');

    expect(res.status).toBe(400);
    expect(accessSpies.getLeavingDownload).not.toHaveBeenCalled();
  });
});

describe('GET /api/access/content/print (Codex-a6ofh.6.5)', () => {
  const print = {
    contentId: CONTENT_ID,
    title: 'Writing a design system',
    creatorName: 'Alex',
    body: { contentBody: 'The essay.', contentBodyJson: null },
  };

  beforeEach(() => {
    accessSpies.getLeavingPrint.mockReset();
    accessSpies.getLeavingPrint.mockResolvedValue(print);
  });

  it('hands the service the detail URL’s key, never cached', async () => {
    const res = await get(
      `/api/access/content/print?orgId=${ORG_ID}&slug=breathing`
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: print });
    expect(accessSpies.getLeavingPrint).toHaveBeenCalledWith(USER.id, {
      orgId: ORG_ID,
      slug: 'breathing',
    });
    // It carries a paid body.
    expect(res.headers.get('Cache-Control')).toBe(CACHE_PRESETS.fresh);
  });

  it('needs a session', async () => {
    const res = await get(
      `/api/access/content/print?orgId=${ORG_ID}&slug=breathing`,
      { signedIn: false }
    );
    expect(res.status).toBe(401);
    expect(accessSpies.getLeavingPrint).not.toHaveBeenCalled();
  });

  it('refuses a key with no org or creator with a 400', async () => {
    const res = await get('/api/access/content/print?slug=breathing');
    expect(res.status).toBe(400);
    expect(accessSpies.getLeavingPrint).not.toHaveBeenCalled();
  });
});
