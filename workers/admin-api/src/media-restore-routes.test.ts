/**
 * Support's media restore (Codex-6sbn1, owner round 2 decision 4): a
 * platform-owner-only route, no screen. A creator's media delete keeps the
 * files 30 days, and support brings an item back by its id.
 *
 * What this file pins:
 *   - the policy matrix: anonymous 401, a creator 403, the platform owner
 *     200; it declares `platform_owner`, no org policy, `cache: 'fresh'` and
 *     the `strict` write limit;
 *   - the id is validated before the service is asked;
 *   - the service's refusal (the purge has the files) reaches the client.
 *
 * Harness as support-routes.test.ts: a procedure() shim that applies the
 * route's DECLARED policy, so a 403 here proves the route asks for the
 * platform owner.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Policy {
  auth?: string;
  cache?: string;
  rateLimit?: string;
}

interface ProcedureConfig {
  policy?: Policy;
  input?: { params?: unknown };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

const state = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
  services: {} as Record<string, unknown>,
  policy: undefined as Policy | undefined,
}));

vi.mock('@codex/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/security')>();
  return {
    ...actual,
    rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
  };
});

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: { param: () => Record<string, string> };
        json: (body: unknown, status?: number) => Response;
      }) => {
        state.policy = config.policy;
        const fail = (status: number, code: string) =>
          c.json({ error: { code, message: code } }, status);

        const auth = config.policy?.auth ?? 'required';
        if (!state.user) return fail(401, 'UNAUTHORIZED');
        if (auth === 'platform_owner' && state.user.role !== 'platform_owner') {
          return fail(403, 'FORBIDDEN');
        }
        const schema = config.input?.params as {
          safeParse: (v: unknown) => { success: boolean; data?: unknown };
        };
        const parsed = schema.safeParse(c.req.param());
        if (!parsed.success) return fail(400, 'VALIDATION_ERROR');

        try {
          const result = await config.handler({
            user: state.user,
            input: { params: parsed.data },
            services: state.services,
            obs: undefined,
          });
          return c.json({ data: result }, 200);
        } catch (error) {
          const { statusCode = 500, code = 'INTERNAL_ERROR' } = error as {
            statusCode?: number;
            code?: string;
          };
          return fail(statusCode, code);
        }
      };
    },
  };
});

import app from './index';

const MEDIA_ID = '823e4567-e89b-12d3-a456-426614174007';
const PLATFORM_OWNER = { id: 'support_user', role: 'platform_owner' };

let media: { restore: ReturnType<typeof vi.fn> };

beforeEach(() => {
  media = {
    restore: vi.fn().mockResolvedValue({ id: MEDIA_ID, deletedAt: null }),
  };
  state.user = PLATFORM_OWNER;
  state.services = { media };
  state.policy = undefined;
});

function restore(id = MEDIA_ID) {
  return app.request(
    `http://localhost/api/admin/media/${id}/restore`,
    { method: 'POST' },
    { ENVIRONMENT: 'test', CACHE_KV: {} },
    {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext
  );
}

describe('POST /api/admin/media/:id/restore', () => {
  it('anonymous 401, creator 403, platform owner 200', async () => {
    state.user = null;
    expect((await restore()).status).toBe(401);
    state.user = { id: 'creator_user', role: 'creator' };
    expect((await restore()).status).toBe(403);
    expect(media.restore).not.toHaveBeenCalled();

    state.user = PLATFORM_OWNER;
    const res = await restore();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: MEDIA_ID, deletedAt: null },
    });
    expect(media.restore).toHaveBeenCalledWith(MEDIA_ID);
  });

  it('declares platform_owner, no org policy, cache fresh and the strict limit', async () => {
    await restore();
    expect(state.policy).toEqual({
      auth: 'platform_owner',
      cache: 'fresh',
      rateLimit: 'strict',
    });
  });

  it('validates the id before asking the service', async () => {
    expect((await restore('not-a-uuid')).status).toBe(400);
    expect(media.restore).not.toHaveBeenCalled();
  });

  it('passes the refusal on once the files are gone', async () => {
    // ConflictError's shape, as the shim maps it.
    media.restore.mockRejectedValue(
      Object.assign(new Error('its files are gone'), {
        statusCode: 409,
        code: 'CONFLICT',
      })
    );
    const res = await restore();
    expect(res.status).toBe(409);
  });
});
