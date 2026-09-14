/**
 * A DECLARED `input.body` must not silently become a MANDATORY body
 * (Codex-bk37r).
 *
 * THE BUG THIS PINS. `validateInput` used `await c.req.json()`, which throws
 * for an ABSENT body exactly as it does for malformed JSON — and that throw
 * happens a layer ABOVE Zod. So the moment a route declared `input.body`, a
 * JSON body was required no matter what the schema said: an all-optional
 * object, a `.default()`, a `.catch({})` — none of them could be reached.
 *
 * It shipped as a 400 on `POST /api/media/:id/upload-complete`, whose schema is
 * `z.object({ durationSeconds: …optional() }).catch({})` and whose prior
 * contract took no body at all. That route finalizes a creator's upload and
 * dispatches transcoding, and it is deliberately idempotent so a failed
 * transcode can be re-triggered — so a body-less retry 400'd too. E2E API
 * caught it on main and dev; the route's own unit test did not, because it
 * always sent a body. The no-body path had no coverage anywhere.
 *
 * WHAT IS ASSERTED. The three inputs (absent / malformed / valid) against both
 * an all-optional and a required schema. The required-schema-plus-no-body case
 * is the one that stops the fix from becoming a hole: absence must still be
 * rejected when the schema demands fields — and rejected with the FIELD error,
 * not a misleading "must be valid JSON".
 */
import type { HonoEnv } from '@codex/shared-types';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// --- Mocks ------------------------------------------------------------------
// `helpers.ts` statically imports the session middleware, which reaches the DB
// layer. These routes are `auth: 'none'`, so nothing needs a real session.
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

vi.mock('../service-registry', () => ({
  createServiceRegistry: () => ({
    registry: {},
    cleanup: vi.fn(async () => {}),
  }),
}));

import { procedure } from '../procedure';

// --- Harness ----------------------------------------------------------------

/** Mirrors `uploadCompleteSchema`: every field optional, plus `.catch({})`. */
const allOptional = z
  .object({ durationSeconds: z.number().int().min(1).max(86400).optional() })
  .catch({});

const requiresField = z.object({ title: z.string().min(1) });

function makeApp(schema: z.ZodTypeAny) {
  const app = new Hono<HonoEnv>();
  app.post(
    '/',
    procedure({
      policy: { auth: 'none' },
      input: { body: schema },
      // Echoes what actually reached the handler, so a test can tell "the body
      // was absent" from "the body was dropped".
      handler: async (ctx) => ({ received: ctx.input.body ?? null }),
    })
  );
  return app;
}

/**
 * `body: undefined` sends NO body — distinct from `body: ''`, and distinct
 * again from a body of `'{}'`. That distinction is the whole subject here.
 */
async function post(
  app: Hono<HonoEnv>,
  body?: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, never> }> {
  const res = await app.fetch(
    new Request('https://api.example.com/', { method: 'POST', body, headers }),
    {} as HonoEnv['Bindings'],
    {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext
  );
  return { status: res.status, json: await res.json() };
}

// --- Tests ------------------------------------------------------------------

describe('a declared input.body does not make the body mandatory', () => {
  it('accepts NO body when every field is optional', async () => {
    // The exact shape that 400'd in production.
    const { status, json } = await post(makeApp(allOptional));
    expect(status).toBe(200);
    expect(json).toEqual({ data: { received: {} } });
  });

  it('accepts an empty-string body, and whitespace-only', async () => {
    // A client that sets `Content-Type: application/json` and sends nothing is
    // the common shape of this bug in the wild.
    for (const raw of ['', '   ', '\n']) {
      const { status } = await post(makeApp(allOptional), raw, {
        'Content-Type': 'application/json',
      });
      expect(status, JSON.stringify(raw)).toBe(200);
    }
  });

  it('still parses a real body and hands the values to the handler', async () => {
    // Guards against "fixed" by ignoring the body entirely.
    const { status, json } = await post(
      makeApp(allOptional),
      JSON.stringify({ durationSeconds: 137 }),
      { 'Content-Type': 'application/json' }
    );
    expect(status).toBe(200);
    expect(json).toEqual({ data: { received: { durationSeconds: 137 } } });
  });

  it('still rejects MALFORMED json with 400 INVALID_JSON', async () => {
    // Absence is legal; nonsense is not. Collapsing these two was the bug.
    const { status, json } = await post(makeApp(allOptional), '{"a":', {
      'Content-Type': 'application/json',
    });
    expect(status).toBe(400);
    // The envelope as `mapErrorToResponse` actually emits it: the top-level
    // code is VALIDATION_ERROR and `INVALID_JSON` is the DETAIL. Asserted in
    // that shape on purpose — a test that invents `error.code: 'INVALID_JSON'`
    // passes only until someone reads the real response.
    expect(json).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request body must be valid JSON',
        details: { code: 'INVALID_JSON' },
      },
    });
  });

  it('degrades a hostile VALUE to {} via the schema .catch, not a 400', async () => {
    // `.catch({})` was unreachable before: the throw fired first.
    const { status, json } = await post(
      makeApp(allOptional),
      JSON.stringify({ durationSeconds: 'twelve' }),
      { 'Content-Type': 'application/json' }
    );
    expect(status).toBe(200);
    expect(json).toEqual({ data: { received: {} } });
  });
});

describe('absence is still rejected when the schema demands a field', () => {
  it('400s on NO body, and names the FIELD rather than blaming the JSON', async () => {
    // The load-bearing case: the fix must not turn every required body
    // optional. And the message matters — "must be valid JSON" sent callers
    // hunting a serialisation bug that did not exist.
    const { status, json } = await post(makeApp(requiresField));
    expect(status).toBe(400);
    expect(JSON.stringify(json)).not.toContain('INVALID_JSON');
    expect(JSON.stringify(json).toLowerCase()).toContain('title');
  });

  it('400s on an empty object for the same reason', async () => {
    const { status, json } = await post(makeApp(requiresField), '{}', {
      'Content-Type': 'application/json',
    });
    expect(status).toBe(400);
    expect(JSON.stringify(json).toLowerCase()).toContain('title');
  });

  it('accepts a body that satisfies the schema', async () => {
    const { status, json } = await post(
      makeApp(requiresField),
      JSON.stringify({ title: 'ok' }),
      { 'Content-Type': 'application/json' }
    );
    expect(status).toBe(200);
    expect(json).toEqual({ data: { received: { title: 'ok' } } });
  });
});
