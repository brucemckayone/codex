/**
 * `createErrorHandler` — internal-detail disclosure on uncaught errors.
 *
 * Regression guard for the production leak: the handler used to branch on the
 * `environment` argument threaded through `createWorker(config)`. That call
 * happens at module scope, where Cloudflare's `env` does not exist yet, so no
 * worker could supply it — and none of the nine did. `environment` was always
 * `undefined`, `=== 'production'` was never true, and every deployed worker
 * answered uncaught errors with `err.message` plus five stack frames, against
 * the root CLAUDE.md rule "NEVER expose internal error details ... in API
 * responses".
 *
 * These tests drive the real `createWorker` -> `app.onError` path rather than
 * calling the handler directly, because the defect was in the wiring, not in
 * the function body. A unit test of `createErrorHandler('production')` passed
 * throughout.
 */

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createErrorHandler } from '../middleware';
import { createWorker } from '../worker-factory';

const SECRET = 'connect ECONNREFUSED 10.0.0.7:5432 — postgres://user:pw@db/x';

/** A worker whose /boom route throws, exercising the real onError path. */
function boomWorker() {
  const app = createWorker({
    serviceName: 'test-worker',
    enableGlobalAuth: false,
  });
  app.get('/boom', () => {
    throw new Error(SECRET);
  });
  return app;
}

async function boomBody(environment?: string) {
  const env = environment === undefined ? {} : { ENVIRONMENT: environment };
  const res = await boomWorker().request('/boom', {}, env);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('createErrorHandler — deployed environments must not disclose details', () => {
  // 'production' is the value all nine wrangler configs set for env.production.
  // 'staging' and 'dev' are set by apps/web and are equally internet-facing.
  // undefined covers a worker with no ENVIRONMENT binding at all.
  for (const environment of ['production', 'staging', 'dev', undefined]) {
    const label = environment ?? '(ENVIRONMENT unset)';

    it(`returns an opaque 500 in ${label}`, async () => {
      const { status, body } = await boomBody(environment);

      expect(status).toBe(500);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('An unexpected error occurred');
    });

    it(`omits the stack entirely in ${label}`, async () => {
      const { body } = await boomBody(environment);

      // Absent, not merely falsy — an empty array would still be a disclosure
      // channel and would still tell a caller the shape of the internals.
      expect(body.error).not.toHaveProperty('stack');
    });

    it(`does not echo the thrown message in ${label}`, async () => {
      const { body } = await boomBody(environment);

      // The thrown message here carries a host, a port and a connection
      // string, which is the realistic shape of what leaked.
      expect(JSON.stringify(body)).not.toContain(SECRET);
      expect(JSON.stringify(body)).not.toContain('postgres://');
      expect(JSON.stringify(body)).not.toContain('10.0.0.7');
    });
  }
});

describe('createErrorHandler — local environments keep their diagnostics', () => {
  for (const environment of ['development', 'test']) {
    it(`includes the message and a bounded stack in ${environment}`, async () => {
      const { status, body } = await boomBody(environment);

      expect(status).toBe(500);
      expect(body.error.message).toBe(SECRET);
      expect(Array.isArray(body.error.stack)).toBe(true);
      expect(body.error.stack.length).toBeLessThanOrEqual(5);
    });
  }
});

describe('createErrorHandler — explicit argument still wins', () => {
  it('honours an explicitly passed environment over the binding', async () => {
    // Kept so a caller that CAN supply the environment (a test, or a future
    // non-module-scope construction) is not silently ignored.
    const app = new Hono();
    app.onError(createErrorHandler('development'));
    app.get('/boom', () => {
      throw new Error(SECRET);
    });

    const res = await app.request('/boom', {}, { ENVIRONMENT: 'production' });
    const body = (await res.json()) as Record<string, any>;

    expect(body.error.message).toBe(SECRET);
  });

  it('treats an explicit production argument as opaque', async () => {
    const app = new Hono();
    app.onError(createErrorHandler('production'));
    app.get('/boom', () => {
      throw new Error(SECRET);
    });

    const res = await app.request('/boom', {}, { ENVIRONMENT: 'development' });
    const body = (await res.json()) as Record<string, any>;

    expect(body.error.message).toBe('An unexpected error occurred');
    expect(body.error).not.toHaveProperty('stack');
  });
});
