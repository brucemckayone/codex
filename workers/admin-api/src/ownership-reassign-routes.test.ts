/**
 * Support owner reassign busts what organization-api's accept path busts
 * (Codex-2hxff.44): POST /api/admin/organizations/:orgId/owner.
 *
 * What this file pins, for both the new and the previous owner:
 *   - the membership entry the policy reads is DELETED (the reader has no
 *     version check, so a bump would be dead);
 *   - the org's slug-keyed public caches are invalidated — the inline copy
 *     this route used to carry skipped them;
 *   - the user's library is invalidated.
 * The fan-out is the shared `invalidateMemberCaches` from
 * `@codex/worker-utils`, run for real against a KV double; its failed-delete
 * logging is pinned where it lives (worker-utils membership-cache-fanout).
 *
 * Harness: support-routes.test.ts's procedure() shim, cut down to input
 * parsing. This file pins the fan-out, not the policy: the route's 401 is
 * pinned through SELF in index.test.ts. `createDbClient` returns a stub that
 * resolves the org's slug; the worker depends on `@codex/database` directly,
 * so the mock reaches the copy worker-utils imports.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  input?: { params?: unknown; body?: unknown };
  handler: (ctx: unknown) => Promise<unknown>;
  successStatus?: number;
}

type SafeParse = (v: unknown) => { success: boolean; data?: unknown };

const state = vi.hoisted(() => ({
  user: { id: 'support_user', role: 'platform_owner' },
  services: {} as Record<string, unknown>,
}));

const dbStub = vi.hoisted(() => ({
  query: { organizations: { findFirst: vi.fn() } },
}));

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: vi.fn(() => dbStub) };
});

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
        req: {
          param: () => Record<string, string>;
          json: () => Promise<unknown>;
        };
        env: unknown;
        executionCtx: unknown;
        json: (body: unknown, status?: number) => Response;
      }) => {
        const fail = (status: number, code: string) =>
          c.json({ error: { code, message: code } }, status);

        const parse = (schema: unknown, raw: unknown) =>
          (schema as { safeParse: SafeParse }).safeParse(raw);
        const input: Record<string, unknown> = {};
        for (const [part, read] of [
          ['params', () => c.req.param()],
          ['body', () => c.req.json()],
        ] as const) {
          const schema = config.input?.[part];
          if (!schema) continue;
          const parsed = parse(schema, await read());
          if (!parsed.success) return fail(400, 'VALIDATION_ERROR');
          input[part] = parsed.data;
        }

        const ctx = {
          user: state.user,
          input,
          services: state.services,
          env: c.env,
          executionCtx: c.executionCtx,
          obs: undefined,
        };
        try {
          const result = await config.handler(ctx);
          return c.json({ data: result }, config.successStatus ?? 200);
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

import { membershipCacheKey } from '@codex/worker-utils';
import app from './index';

const ORG_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const NEW_OWNER = 'user_new_owner';
const OLD_OWNER = 'user_old_owner';

function makeKv() {
  const deletes: string[] = [];
  const puts: string[] = [];
  const kv = {
    get: vi.fn(async () => null),
    put: vi.fn(async (key: string) => {
      puts.push(key);
    }),
    delete: vi.fn(async (key: string) => {
      deletes.push(key);
    }),
  };
  return { kv, deletes, puts };
}

let reassignOwner: ReturnType<typeof vi.fn>;
let kvDouble: ReturnType<typeof makeKv>;
let pending: Promise<unknown>[];

beforeEach(() => {
  reassignOwner = vi.fn().mockResolvedValue({
    ownerUserId: NEW_OWNER,
    previousOwnerUserId: OLD_OWNER,
    heldPayoutsReleased: 0,
  });
  state.services = { organization: { reassignOwner } };
  dbStub.query.organizations.findFirst.mockReset();
  dbStub.query.organizations.findFirst.mockResolvedValue({ slug: 'acme' });
  kvDouble = makeKv();
  pending = [];
});

async function reassign() {
  const response = await app.request(
    `http://localhost/api/admin/organizations/${ORG_ID}/owner`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: NEW_OWNER, reason: 'owner unreachable' }),
    },
    { ENVIRONMENT: 'test', CACHE_KV: kvDouble.kv },
    {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext
  );
  // Settle every waitUntil task, including ones scheduled by other tasks.
  while (pending.length > 0) {
    await Promise.all(pending.splice(0));
  }
  return response;
}

describe('POST /api/admin/organizations/:orgId/owner — cache fan-out', () => {
  it("busts both owners' membership entries, the org-slug caches and both libraries", async () => {
    const response = await reassign();

    expect(response.status).toBe(200);
    expect(reassignOwner).toHaveBeenCalledWith(ORG_ID, NEW_OWNER);
    expect([...kvDouble.deletes].sort()).toEqual(
      [
        membershipCacheKey(ORG_ID, NEW_OWNER),
        membershipCacheKey(ORG_ID, OLD_OWNER),
      ].sort()
    );
    // The org-slug invalidation organization-api's accept path runs: the
    // slug is resolved from the org id, then its keys are bumped.
    expect(dbStub.query.organizations.findFirst).toHaveBeenCalled();
    expect([...new Set(kvDouble.puts)].sort()).toEqual([
      'cache:version:acme',
      'cache:version:org:acme:creators',
      `cache:version:user:${NEW_OWNER}:library`,
      `cache:version:user:${OLD_OWNER}:library`,
    ]);
  });

  it('with no previous owner, busts only the new owner', async () => {
    reassignOwner.mockResolvedValue({
      ownerUserId: NEW_OWNER,
      previousOwnerUserId: null,
      heldPayoutsReleased: 0,
    });

    const response = await reassign();

    expect(response.status).toBe(200);
    expect(kvDouble.deletes).toEqual([membershipCacheKey(ORG_ID, NEW_OWNER)]);
    expect(kvDouble.puts).not.toContain(
      `cache:version:user:${OLD_OWNER}:library`
    );
  });
});
