/**
 * `GET /api/access/content/withdrawn` opens an item withdrawn from sale for a
 * reader who still has it, by its detail URL's key (Codex-ov2ii).
 *
 * SHAPE. Real `procedure()` resolver and Hono routing; only
 * `ContentAccessService` is stubbed (no Neon), so the assertions are the key
 * the route hands the service, the envelope, the header, and the query rule.
 * The decision and the lookup are pinned in @codex/access.
 */

import { createExecutionContext, env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER = {
  id: '7a1d0f2e-3b4c-4d5e-8f60-112233445566',
  email: 'reader@test.com',
  role: 'customer',
};

const ORG_ID = '6f1c1d52-6d0e-4c43-9a52-6a3f8c2f7b11';

const accessSpies = {
  getWithdrawnContent: vi.fn(),
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

const testEnv = {
  ...env,
  ENVIRONMENT: 'development',
  R2_PUBLIC_URL_BASE: 'https://cdn.test',
} as unknown as typeof env;

function buildApp() {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', USER);
    c.set('session', { id: 'sess_test', userId: USER.id });
    await next();
  });
  app.route('/api/access', contentAccess);
  return app;
}

async function withdrawn(query: string): Promise<Response> {
  return buildApp().fetch(
    new Request(`http://content-api.test/api/access/content/withdrawn${query}`),
    testEnv,
    createExecutionContext()
  );
}

// Wider than the service selects on purpose: the route builds the item from
// named fields (`toPublicItem`), so internal columns stay off the wire even
// if the select ever widens (Codex-ve5eh, Codex-567de).
const held = {
  content: {
    id: 'content_123',
    slug: 'breathing',
    contentBody: null,
    mediaItem: {
      durationSeconds: 300,
      thumbnailKey: 'creator/thumbs/media_1/md.webp',
      hlsPreviewKey: 'creator/hls/media_1/preview/preview.m3u8',
      r2Key: 'creator/originals/media_1/source.mov',
      runpodJobId: 'job_1',
    },
    organization: {
      id: ORG_ID,
      name: 'Studio Alpha',
      slug: 'studio-alpha',
      logoUrl: null,
      deletedAt: null,
      primaryConnectAccountUserId: 'payee_1',
    },
    creator: { id: 'a62da3ad5c94736a', name: 'Alex' },
  },
  held: { by: 'purchase', until: null },
};

describe('GET /api/access/content/withdrawn (Codex-ov2ii)', () => {
  beforeEach(() => {
    accessSpies.getWithdrawnContent.mockReset();
    accessSpies.getWithdrawnContent.mockResolvedValue(held);
  });

  it('hands the service the org key and wraps the answer, never cached', async () => {
    const res = await withdrawn(`?orgId=${ORG_ID}&slug=breathing`);

    expect(res.status).toBe(200);
    // The public list's item: R2 keys resolved to CDN URLs, and only the
    // public media and org fields, never a key, a job id or the payee.
    expect(await res.json()).toEqual({
      data: {
        held: held.held,
        content: {
          id: 'content_123',
          slug: 'breathing',
          contentBody: null,
          mediaItem: {
            durationSeconds: 300,
            thumbnailUrl: 'https://cdn.test/creator/thumbs/media_1/md.webp',
            hlsPreviewUrl:
              'https://cdn.test/creator/hls/media_1/preview/preview.m3u8',
          },
          organization: {
            id: ORG_ID,
            name: 'Studio Alpha',
            slug: 'studio-alpha',
            logoUrl: null,
          },
          creator: { id: 'a62da3ad5c94736a', name: 'Alex' },
        },
      },
    });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(accessSpies.getWithdrawnContent).toHaveBeenCalledWith(USER.id, {
      orgId: ORG_ID,
      slug: 'breathing',
    });
  });

  it('takes a personal piece by its creator', async () => {
    const res = await withdrawn('?creatorId=a62da3ad5c94736a&slug=breathing');

    expect(res.status).toBe(200);
    expect(accessSpies.getWithdrawnContent).toHaveBeenCalledWith(USER.id, {
      creatorId: 'a62da3ad5c94736a',
      slug: 'breathing',
    });
  });

  it.each([
    ['both keys', `?orgId=${ORG_ID}&creatorId=a62da3ad5c94736a&slug=breathing`],
    ['neither key', '?slug=breathing'],
    ['no slug', `?orgId=${ORG_ID}`],
    ['an empty slug', `?orgId=${ORG_ID}&slug=`],
    ['a malformed org id', '?orgId=not-a-uuid&slug=breathing'],
  ])('refuses %s with a 400 and never asks the service', async (_label, q) => {
    const res = await withdrawn(q);

    expect(res.status).toBe(400);
    expect(accessSpies.getWithdrawnContent).not.toHaveBeenCalled();
  });
});
