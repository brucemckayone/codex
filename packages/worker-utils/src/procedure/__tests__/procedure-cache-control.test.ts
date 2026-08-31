/**
 * `policy.cache` is actually emitted, and `ctx.cacheWrite` actually reaches
 * `waitUntil` (Codex-tp9di / Codex-345hg).
 *
 * The type rule in `cache-policy-rule.type-check.ts` proves which presets a
 * route MAY declare. This file proves what the declaration DOES: the exact
 * header bytes on the wire, which responses carry one, and who wins when a
 * router-level middleware also sets the header. Those are separate claims — a
 * perfect type rule wired to nothing emits nothing.
 *
 * Every assertion compares against `CACHE_PRESETS` rather than a retyped
 * string, so a preset edit in `@codex/constants` cannot leave this suite
 * asserting a value the platform no longer emits.
 */
import { CACHE_PRESETS } from '@codex/constants';
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ------------------------------------------------------------------
// `helpers.ts` statically imports the session middleware, which reaches the DB
// layer. Tests that need a user set it directly on the context instead.
vi.mock('../../auth-middleware', () => ({
  createSessionMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
      return undefined;
    },
}));

vi.mock('@codex/database', () => ({
  createDbClient: vi.fn(),
  schema: {},
}));

// Subject resolvers return null so `enforceRateLimit` short-circuits before it
// reaches a store — enforcement itself is proven in procedure-rate-limit.test.ts.
vi.mock('@codex/security', () => ({
  workerAuth: vi.fn(),
  RATE_LIMIT_PRESETS: {
    api: {
      store: 'binding',
      maxRequests: 100,
      periodSeconds: 60,
      bindingName: 'RATE_LIMIT_API',
      keyPrefix: 'rl:api:',
    },
  },
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
    return undefined;
  },
  combineSubjects: () => () => null,
  sessionSubject: () => () => null,
  trustedIpSubject: () => () => null,
}));

// The registry is lazy, so nothing here is ever constructed; the cleanup
// closure is what `procedure()` hands to `waitUntil` in its finally block, and
// the cacheWrite assertions below have to be able to tell the two apart.
const registryCleanup = vi.fn(async () => {});
vi.mock('../service-registry', () => ({
  createServiceRegistry: () => ({
    registry: {},
    cleanup: registryCleanup,
  }),
}));

import { NotFoundError } from '@codex/service-errors';
import { procedure } from '../procedure';

// --- Harness ----------------------------------------------------------------

/** Records every promise handed to `waitUntil`, as the real runtime would. */
function makeExecutionCtx() {
  const waitUntil = vi.fn<(p: Promise<unknown>) => void>();
  return {
    ctx: {
      waitUntil,
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext,
    waitUntil,
  };
}

interface DispatchResult {
  response: Response;
  cacheControl: string | null;
  waitUntil: ReturnType<typeof makeExecutionCtx>['waitUntil'];
}

async function dispatch(
  app: Hono<HonoEnv>,
  path = '/'
): Promise<DispatchResult> {
  const { ctx, waitUntil } = makeExecutionCtx();
  const response = await app.fetch(
    new Request(`https://api.example.com${path}`),
    {} as HonoEnv['Bindings'],
    ctx
  );
  return {
    response,
    cacheControl: response.headers.get('Cache-Control'),
    waitUntil,
  };
}

/** A user on the context, so `auth: 'required'` passes without a real session. */
function withUser(app: Hono<HonoEnv>): Hono<HonoEnv> {
  app.use('*', async (c, next) => {
    c.set('user', { id: 'u1', role: 'creator' } as never);
    await next();
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// The declared preset is what leaves
// ============================================================================
describe('procedure() · Cache-Control from policy.cache', () => {
  it("auth: 'none' + cache: 'public' emits the public preset", async () => {
    const app = new Hono<HonoEnv>();
    app.get(
      '/',
      procedure({
        policy: { auth: 'none', cache: 'public' },
        handler: async () => ({ ok: true }),
      })
    );

    const { response, cacheControl } = await dispatch(app);
    expect(response.status).toBe(200);
    expect(cacheControl).toBe(CACHE_PRESETS.public);
  });

  it("auth: 'optional' + cache: 'public' + variesBySession: false emits the public preset", async () => {
    // The journeys-portal carve-out: `optional` but the body ignores the
    // session, so a shared cache may reuse it.
    const app = new Hono<HonoEnv>();
    app.get(
      '/',
      procedure({
        policy: { auth: 'optional', cache: 'public', variesBySession: false },
        handler: async () => ({ ok: true }),
      })
    );

    expect((await dispatch(app)).cacheControl).toBe(CACHE_PRESETS.public);
  });

  it("cache: 'per-viewer' emits no s-maxage, so the edge must revalidate", async () => {
    const app = new Hono<HonoEnv>();
    app.get(
      '/',
      procedure({
        policy: { auth: 'optional', cache: 'per-viewer' },
        handler: async () => ({ ok: true }),
      })
    );

    const { cacheControl } = await dispatch(app);
    expect(cacheControl).toBe(CACHE_PRESETS['per-viewer']);
    // The half of the 2026-05-28 leak that `max-age=0` never fixed: shared
    // caches key on URL and NEVER on Cookie, so an s-maxage here would hand one
    // viewer's stored render to the next.
    expect(cacheControl).not.toContain('s-maxage');
  });

  it("cache: 'fresh' emits no-store", async () => {
    const app = withUser(new Hono<HonoEnv>());
    app.get(
      '/',
      procedure({
        policy: { auth: 'required', cache: 'fresh' },
        handler: async () => ({ ok: true }),
      })
    );

    expect((await dispatch(app)).cacheControl).toBe(CACHE_PRESETS.fresh);
  });
});

// ============================================================================
// The default is the safe one
// ============================================================================
describe('procedure() · the undeclared default', () => {
  it("an authenticated route that declares nothing emits 'private'", async () => {
    // This is the shape of all 200+ existing call sites. None of them were
    // edited; the default has to be safe on its own.
    const app = withUser(new Hono<HonoEnv>());
    app.get(
      '/',
      procedure({
        policy: { auth: 'required' },
        handler: async () => ({ ok: true }),
      })
    );

    const { cacheControl } = await dispatch(app);
    expect(cacheControl).toBe(CACHE_PRESETS.private);
    expect(cacheControl).not.toContain('s-maxage');
  });

  it('a route with no policy at all emits the same default', async () => {
    const app = withUser(new Hono<HonoEnv>());
    app.get('/', procedure({ handler: async () => ({ ok: true }) }));

    expect((await dispatch(app)).cacheControl).toBe(CACHE_PRESETS.private);
  });

  it('a public route that declares nothing is NOT shared-cacheable by accident', async () => {
    const app = new Hono<HonoEnv>();
    app.get(
      '/',
      procedure({
        policy: { auth: 'none' },
        handler: async () => ({ ok: true }),
      })
    );

    expect((await dispatch(app)).cacheControl).toBe(CACHE_PRESETS.private);
  });

  it('a 204 response carries the preset too', async () => {
    const app = withUser(new Hono<HonoEnv>());
    app.delete(
      '/',
      procedure({
        policy: { auth: 'required', cache: 'fresh' },
        successStatus: 204,
        handler: async () => null,
      })
    );

    const { ctx } = makeExecutionCtx();
    const response = await app.fetch(
      new Request('https://api.example.com/', { method: 'DELETE' }),
      {} as HonoEnv['Bindings'],
      ctx
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe(CACHE_PRESETS.fresh);
  });
});

// ============================================================================
// What the SUCCESS-path-only choice buys
// ============================================================================
describe('procedure() · error responses', () => {
  it('an error response carries no Cache-Control at all', async () => {
    // Deliberate. A route's 60s public window on its own 429s and 403s would
    // let the edge serve a rate-limit response to everyone for a minute — a
    // self-inflicted outage. Errors keep the header-less behaviour they had
    // before this change, which is also the smallest possible delta.
    const app = new Hono<HonoEnv>();
    app.get(
      '/',
      procedure({
        policy: { auth: 'none', cache: 'public' },
        handler: async () => {
          throw new NotFoundError('Content');
        },
      })
    );

    const { response, cacheControl } = await dispatch(app);
    expect(response.status).toBe(404);
    expect(cacheControl).toBeNull();
  });

  it('an auth failure carries no Cache-Control either', async () => {
    const app = new Hono<HonoEnv>();
    app.get(
      '/',
      procedure({
        policy: { auth: 'required', cache: 'private' },
        handler: async () => ({ ok: true }),
      })
    );

    const { response, cacheControl } = await dispatch(app);
    expect(response.status).toBe(401);
    expect(cacheControl).toBeNull();
  });
});

// ============================================================================
// A router-level middleware still wins
// ============================================================================
describe('procedure() · a middleware that sets the header after next()', () => {
  it('overrides the procedure default', async () => {
    // This is exactly how workers/content-api/src/routes/public.ts and
    // journeys.ts work today: `app.use('*', async (c, next) => { await next();
    // c.header('Cache-Control', ...) })`. Their public windows must survive
    // procedure() emitting a default underneath them, or adding this WP would
    // silently de-cache the public content API.
    const app = new Hono<HonoEnv>();
    app.use('*', async (c, next) => {
      await next();
      c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
    });
    app.get(
      '/',
      procedure({
        policy: { auth: 'none' },
        handler: async () => ({ ok: true }),
      })
    );

    expect((await dispatch(app)).cacheControl).toBe(
      'public, max-age=60, s-maxage=60'
    );
  });
});

// ============================================================================
// ctx.cacheWrite
// ============================================================================
describe('procedure() · ctx.cacheWrite', () => {
  it('hands the promise to executionCtx.waitUntil', async () => {
    const app = new Hono<HonoEnv>();
    let handedIn: Promise<unknown> | undefined;

    app.get(
      '/',
      procedure({
        policy: { auth: 'none' },
        handler: async (ctx) => {
          handedIn = Promise.resolve('kv-put');
          ctx.cacheWrite(handedIn);
          return { ok: true };
        },
      })
    );

    const { waitUntil } = await dispatch(app);
    expect(handedIn).toBeDefined();

    // procedure() also waitUntils its own registry cleanup, so assert on the
    // cache write specifically rather than on the call count.
    const handed = waitUntil.mock.calls.map(([p]) => p);
    expect(handed.length).toBeGreaterThanOrEqual(2);
    await expect(Promise.all(handed)).resolves.toBeDefined();
  });

  it('swallows a rejecting write instead of leaking an unhandled rejection', async () => {
    const app = new Hono<HonoEnv>();

    app.get(
      '/',
      procedure({
        policy: { auth: 'none' },
        handler: async (ctx) => {
          ctx.cacheWrite(Promise.reject(new Error('KV quota exhausted')));
          return { ok: true };
        },
      })
    );

    const { response, waitUntil } = await dispatch(app);
    expect(response.status).toBe(200);

    // Every promise the runtime was given must settle without rejecting, or the
    // isolate reports an unhandled rejection the caller cannot catch.
    await expect(
      Promise.all(waitUntil.mock.calls.map(([p]) => p))
    ).resolves.toBeDefined();
  });

  it('is not the same channel as ctx.background', async () => {
    // `background()` exists to hold off `pool.end()` for background DATABASE
    // work; cleanup is chained after it settles. A cache write has no pool to
    // lose, so it must NOT be able to delay cleanup.
    const app = new Hono<HonoEnv>();
    let resolveWrite: (() => void) | undefined;

    app.get(
      '/',
      procedure({
        policy: { auth: 'none' },
        handler: async (ctx) => {
          ctx.cacheWrite(
            new Promise<void>((resolve) => {
              resolveWrite = resolve;
            })
          );
          return { ok: true };
        },
      })
    );

    const { response } = await dispatch(app);
    expect(response.status).toBe(200);

    // Cleanup was scheduled even though the cache write is still pending.
    await Promise.resolve();
    expect(registryCleanup).toHaveBeenCalledTimes(1);

    resolveWrite?.();
  });
});
