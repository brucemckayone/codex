/**
 * GET /checkout/course-subscription/verify (Codex-o4jvw) — route → service
 * contract. The journey success page polls it to learn whether a course-plan
 * payment was a second subscription, which is being cancelled and refunded.
 *
 * Harness as in `subscriptions-read-routes.test.ts`: a pass-through
 * `procedure` mock enforcing the auth gate and query schema, invoking the real
 * handler, and mapping errors through the real `mapErrorToResponse`.
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  policy?: { auth?: string };
  input?: { query?: { safeParse: (v: unknown) => unknown } };
  handler: (ctx: unknown) => Promise<unknown>;
}

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      return async (c: {
        req: { query: () => Record<string, string> };
        get: (key: string) => unknown;
        json: (body: unknown, status?: number) => unknown;
      }) => {
        const user = c.get('__testUser') as { id: string } | null;
        if (config.policy?.auth === 'required' && !user) {
          return c.json(
            {
              error: {
                code: 'UNAUTHORIZED',
                message: 'Authentication required',
              },
            },
            401
          );
        }
        let query: unknown = {};
        if (config.input?.query) {
          const parsed = (
            config.input.query as unknown as {
              safeParse: (v: unknown) => { success: boolean; data?: unknown };
            }
          ).safeParse(c.req.query());
          if (!parsed.success) {
            return c.json(
              { error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
              400
            );
          }
          query = parsed.data;
        }
        try {
          const result = await config.handler({
            user,
            input: { query },
            services: c.get('__testServices'),
          });
          return c.json({ data: result }, 200);
        } catch (error) {
          const { statusCode, response } = mapErrorToResponse(error, {
            logError: false,
          });
          return c.json(response, statusCode as 403 | 500);
        }
      };
    },
  };
});

import { ForbiddenError } from '@codex/service-errors';
import { Hono } from 'hono';
import checkout from '../checkout';

const DUPLICATE = {
  sessionStatus: 'complete',
  subscription: {
    id: 'course-sub-dup',
    courseId: '408f94d0-5442-43d3-a56a-3491110962eb',
    courseTitle: 'Rootwork',
    startedAt: '2026-10-22T10:00:00.000Z',
    duplicateOf: { id: 'course-sub-kept' },
  },
};

function buildApp(user: { id: string } | null = { id: 'user_1' }) {
  const verifyCheckoutSession = vi.fn().mockResolvedValue(DUPLICATE);
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('__testUser', user);
    c.set('__testServices', { courseSubscription: { verifyCheckoutSession } });
    await next();
  });
  app.route('/checkout', checkout as unknown as Hono);
  return { app, verifyCheckoutSession };
}

const PATH = '/checkout/course-subscription/verify';

describe('GET /checkout/course-subscription/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the service's result, duplicateOf included, for the caller's session", async () => {
    const { app, verifyCheckoutSession } = buildApp({ id: 'user_pos' });

    const res = await app.request(`${PATH}?session_id=cs_test_1`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: DUPLICATE });
    expect(verifyCheckoutSession).toHaveBeenCalledWith('cs_test_1', 'user_pos');
  });

  it('401 without a session; the service is not called', async () => {
    const { app, verifyCheckoutSession } = buildApp(null);

    const res = await app.request(`${PATH}?session_id=cs_test_1`);

    expect(res.status).toBe(401);
    expect(verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it('400 without a session_id; the service is not called', async () => {
    const { app, verifyCheckoutSession } = buildApp();

    const res = await app.request(PATH);

    expect(res.status).toBe(400);
    expect(verifyCheckoutSession).not.toHaveBeenCalled();
  });

  it("403 for someone else's session", async () => {
    const { app, verifyCheckoutSession } = buildApp();
    verifyCheckoutSession.mockRejectedValueOnce(
      new ForbiddenError(
        'Checkout session does not belong to authenticated user'
      )
    );

    const res = await app.request(`${PATH}?session_id=cs_other`);

    expect(res.status).toBe(403);
  });
});
