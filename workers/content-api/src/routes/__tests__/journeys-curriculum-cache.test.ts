/**
 * `PUT /api/journeys/studio/journeys/:pageId/curriculum` bumps the CONTENT
 * caches, not just the portals' (Codex-u3vil; Codex-8swlj review r2).
 *
 * The save sets `courseOnly` on the practices it links and clears it on those
 * it drops, and every public content read leaves a course-only practice out:
 * the catalogue slots, the creators list, and the topic list with its
 * per-topic counts. So the save must bump the org's content version
 * (`bumpOrgContentVersion`, which bumps the journeys version with it), or a
 * topic chip goes on advertising pieces a tap no longer lists, for the TTL.
 *
 * SHAPE. `procedure()` is shimmed as in journey-insights-routes.test.ts (the
 * real policy phases need a Neon membership lookup); the service and both
 * cache bumps are stubbed, so the assertion is which bump the route makes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  policy?: { auth?: string; requireOrgManagement?: boolean };
  handler: (ctx: unknown) => Promise<unknown>;
}

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: {
          param: () => Record<string, string>;
          json: () => Promise<unknown>;
        };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        const ctx = {
          user: { id: 'user_1' },
          input: { params: c.req.param(), body: await c.req.json() },
          services: c.get('__testServices'),
          organizationId: ORG_ID,
          organizationRole: 'owner',
          env: { CACHE_KV: {} },
          executionCtx: { waitUntil: () => {} },
          obs: undefined,
        };
        return c.json({ data: await config.handler(ctx) }, 200);
      };
    },
  };
});

const bumpOrgContentVersion = vi.hoisted(() => vi.fn());
vi.mock('../content-invalidation', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../content-invalidation')>();
  return { ...actual, bumpOrgContentVersion };
});
const bumpOrgJourneysVersion = vi.hoisted(() => vi.fn());
vi.mock('../journeys-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../journeys-cache')>();
  return { ...actual, bumpOrgJourneysVersion };
});

// Below the mocks on purpose: biome's organizeImports never moves an import
// across a statement, so the real routes resolve the mocked modules.
import { InternalServiceError } from '@codex/service-errors';
import { Hono } from 'hono';
import journeys from '../journeys';

const ORG_ID = '32300000-0000-4000-8000-000000000002';
const PAGE_ID = '1a000000-0000-4000-8000-0000000000aa';
const COURSE_ID = '2c000000-0000-4000-8000-000000000001';

function buildApp() {
  const services = {
    courseJourney: {
      resolveCourseIdForPage: vi.fn().mockResolvedValue(COURSE_ID),
      saveCurriculum: vi.fn().mockResolvedValue({ stages: [] }),
    },
  };
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('__testServices', services);
    await next();
  });
  app.route('/api/journeys', journeys);
  return { app, services };
}

describe('PUT /api/journeys/studio/journeys/:pageId/curriculum', () => {
  beforeEach(() => {
    bumpOrgContentVersion.mockReset();
    bumpOrgJourneysVersion.mockReset();
  });

  it('bumps the org content version after the save, which covers the topic list', async () => {
    const { app, services } = buildApp();
    const res = await app.request(
      `http://content-api.test/api/journeys/studio/journeys/${PAGE_ID}/curriculum?organizationId=${ORG_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: [] }),
      }
    );

    expect(res.status).toBe(200);
    expect(services.courseJourney.saveCurriculum).toHaveBeenCalledWith(
      ORG_ID,
      COURSE_ID,
      { stages: [] }
    );
    expect(bumpOrgContentVersion).toHaveBeenCalledTimes(1);
    expect(bumpOrgContentVersion.mock.calls[0]?.[2]).toBe(ORG_ID);
    // The content bump carries the journeys bump; a second one is redundant.
    expect(bumpOrgJourneysVersion).not.toHaveBeenCalled();
  });

  // Review r3: the save commits, then reads the curriculum back. A read-back
  // that fails reports the save as failed AFTER `courseOnly` has flipped, so
  // the bump must run on the rejection too (Codex-kk9nv.16).
  it('still bumps when the save rejects after its write, and keeps the save error', async () => {
    const { app, services } = buildApp();
    const failure = new InternalServiceError('read-back failed');
    services.courseJourney.saveCurriculum.mockRejectedValueOnce(failure);
    let thrown: unknown;
    app.onError((error, c) => {
      thrown = error;
      return c.json({ error: 'failed' }, 500);
    });
    const res = await app.request(
      `http://content-api.test/api/journeys/studio/journeys/${PAGE_ID}/curriculum?organizationId=${ORG_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: [] }),
      }
    );

    expect(res.status).toBe(500);
    expect(thrown).toBe(failure);
    expect(bumpOrgContentVersion).toHaveBeenCalledTimes(1);
    expect(bumpOrgContentVersion.mock.calls[0]?.[2]).toBe(ORG_ID);
  });

  it('bumps nothing when the page resolves to no course, since nothing was written', async () => {
    const { app, services } = buildApp();
    services.courseJourney.resolveCourseIdForPage.mockRejectedValueOnce(
      new InternalServiceError('no course')
    );
    app.onError((_error, c) => c.json({ error: 'failed' }, 500));
    const res = await app.request(
      `http://content-api.test/api/journeys/studio/journeys/${PAGE_ID}/curriculum?organizationId=${ORG_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages: [] }),
      }
    );

    expect(res.status).toBe(500);
    expect(services.courseJourney.saveCurriculum).not.toHaveBeenCalled();
    expect(bumpOrgContentVersion).not.toHaveBeenCalled();
  });
});
