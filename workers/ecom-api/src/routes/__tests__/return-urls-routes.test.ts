/**
 * Return links in production (Codex-2hxff.79).
 *
 * `checkoutRedirectUrlSchema` accepts localhost, 127.0.0.1 and lvh.me, over
 * http or https, in every environment, because e2e returns to them. A
 * production ecom-api also refuses those hosts and plain http
 * (`refuseDevReturnUrls`, utils/return-urls.ts), before it asks Stripe for
 * anything, on every route that takes a link Stripe sends someone back to:
 * - checkouts: content, course, course plan, and organisation tier;
 * - the billing portal's return link;
 * - Connect onboarding's return and refresh links.
 * Development, test, dev and staging keep today's list. A missing or unknown
 * ENVIRONMENT counts as production.
 *
 * Harness: `procedure` is replaced by a recorder, and each route's handler is
 * called with its body parsed by the route's own schema, as `procedure` does.
 */

import { ValidationError } from '@codex/service-errors';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ProcedureConfig {
  input?: { body?: { parse: (v: unknown) => unknown } };
  handler: (ctx: unknown) => Promise<unknown>;
}

const configOf = vi.hoisted(() => new Map<unknown, ProcedureConfig>());

vi.mock('@codex/worker-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/worker-utils')>();
  return {
    ...actual,
    procedure: (config: ProcedureConfig) => {
      const route = () => undefined;
      configOf.set(route, config);
      return route;
    },
  };
});

import checkout from '../checkout';
import connect from '../connect';
import subscriptions from '../subscriptions';

const CONTENT_ID = '7d0c9a4e-2f53-4c0e-9a1d-3b2f6a8e5c11';
const COURSE_ID = '408f94d0-5442-43d3-a56a-3491110962eb';
const ORG_ID = 'b1ea37e2-e03a-4e2d-ae70-0ac369ee2dca';
const TIER_ID = 'c3f1a2b4-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const LIVE = 'https://of-blood-and-bones.revelations.studio';

const stripeSession = (id: string) =>
  vi.fn(async () => ({
    sessionUrl: `https://checkout.stripe.com/c/pay/${id}`,
    sessionId: id,
  }));

const services = {
  purchase: {
    createCheckoutSession: stripeSession('cs_1'),
    createCourseCheckoutSession: stripeSession('cs_2'),
    createPortalSession: vi.fn(async () => ({
      url: 'https://billing.stripe.com/p/session_1',
    })),
  },
  courseSubscription: { createCheckoutSession: stripeSession('cs_3') },
  subscription: { createCheckoutSession: stripeSession('cs_4') },
  connect: {
    createAccountForUser: vi.fn(async () => ({
      accountId: 'acct_1',
      onboardingUrl: 'https://connect.stripe.com/setup/s/acct_1',
    })),
  },
};

/** Each route's return links, and the Stripe call it must not make when refused. */
const ROUTES = [
  {
    route: 'POST /checkout/create',
    router: checkout,
    path: '/create',
    body: (origin: string) => ({
      contentId: CONTENT_ID,
      successUrl: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/content/rootwork`,
    }),
    fields: ['successUrl', 'cancelUrl'],
    stripeCall: services.purchase.createCheckoutSession,
  },
  {
    route: 'POST /checkout/course',
    router: checkout,
    path: '/course',
    body: (origin: string) => ({
      courseId: COURSE_ID,
      successUrl: `${origin}/journeys/rootwork/checkout/success?kind=purchase`,
      cancelUrl: `${origin}/journeys/rootwork/checkout`,
    }),
    fields: ['successUrl', 'cancelUrl'],
    stripeCall: services.purchase.createCourseCheckoutSession,
  },
  {
    route: 'POST /checkout/course-subscription',
    router: checkout,
    path: '/course-subscription',
    body: (origin: string) => ({
      courseId: COURSE_ID,
      billingInterval: 'month',
      successUrl: `${origin}/journeys/rootwork/checkout/success?kind=subscription`,
      cancelUrl: `${origin}/journeys/rootwork/checkout`,
    }),
    fields: ['successUrl', 'cancelUrl'],
    stripeCall: services.courseSubscription.createCheckoutSession,
  },
  {
    route: 'POST /checkout/portal-session',
    router: checkout,
    path: '/portal-session',
    body: (origin: string) => ({ returnUrl: `${origin}/account/payment` }),
    fields: ['returnUrl'],
    stripeCall: services.purchase.createPortalSession,
  },
  {
    route: 'POST /subscriptions/checkout',
    router: subscriptions,
    path: '/checkout',
    body: (origin: string) => ({
      organizationId: ORG_ID,
      tierId: TIER_ID,
      billingInterval: 'month',
      successUrl: `${origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/pricing`,
    }),
    fields: ['successUrl', 'cancelUrl'],
    stripeCall: services.subscription.createCheckoutSession,
  },
  {
    route: 'POST /connect/me/onboard',
    router: connect,
    path: '/me/onboard',
    body: (origin: string) => ({
      returnUrl: `${origin}/creators/studio/earnings?connect=success`,
      refreshUrl: `${origin}/creators/studio/earnings?connect=refresh`,
    }),
    fields: ['returnUrl', 'refreshUrl'],
    stripeCall: services.connect.createAccountForUser,
  },
] as const;

function configFor(router: Hono<never>, path: string): ProcedureConfig {
  const route = router.routes.find(
    (r) => r.method === 'POST' && r.path === path
  );
  const config = route && configOf.get(route.handler);
  if (!config) throw new Error(`no procedure for POST ${path}`);
  return config;
}

/** Call a route's handler as procedure would, in `environment`. */
function call(
  router: Hono<never>,
  path: string,
  body: unknown,
  environment: string | undefined
): Promise<unknown> {
  const config = configFor(router, path);
  return config.handler({
    user: { id: 'userBuyer1', email: 'buyer@example.com' },
    input: { body: config.input?.body?.parse(body) },
    env: { ENVIRONMENT: environment },
    services,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(ROUTES)('$route: return links (Codex-2hxff.79)', ({
  router: anyRouter,
  path,
  body,
  fields,
  stripeCall,
}) => {
  const router = anyRouter as unknown as Hono<never>;

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://of-blood-and-bones.lvh.me:3000',
    'https://of-blood-and-bones.lvh.me',
    'http://of-blood-and-bones.revelations.studio',
  ])('production refuses %s, before any Stripe call', async (origin) => {
    const refused = await call(router, path, body(origin), 'production').catch(
      (e: unknown) => e
    );

    expect(refused).toBeInstanceOf(ValidationError);
    expect((refused as ValidationError).context).toEqual({
      details: fields.map((field) => ({
        path: `body.${field}`,
        message: 'Redirect URL must be https, on a trusted domain',
      })),
    });
    expect(stripeCall).not.toHaveBeenCalled();
  });

  it('production accepts https on the platform', async () => {
    await call(router, path, body(LIVE), 'production');

    expect(stripeCall).toHaveBeenCalledOnce();
  });

  it.each([
    'development',
    'test',
    'dev',
    'staging',
  ])('%s keeps the development hosts', async (environment) => {
    await call(
      router,
      path,
      body('http://of-blood-and-bones.lvh.me:3000'),
      environment
    );

    expect(stripeCall).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    '',
    'Production',
  ])('an ENVIRONMENT of %j counts as production', async (environment) => {
    await expect(
      call(router, path, body('http://localhost:3000'), environment)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(stripeCall).not.toHaveBeenCalled();
  });
});

describe('a production checkout with one bad link names that field only', () => {
  it('a live success link and a localhost cancel link: only cancelUrl', async () => {
    const refused = (await call(
      checkout as unknown as Hono<never>,
      '/create',
      {
        contentId: CONTENT_ID,
        successUrl: `${LIVE}/checkout/success`,
        cancelUrl: 'http://localhost:3000/content/rootwork',
      },
      'production'
    ).catch((e: unknown) => e)) as ValidationError;

    expect(refused.context).toEqual({
      details: [
        {
          path: 'body.cancelUrl',
          message: 'Redirect URL must be https, on a trusted domain',
        },
      ],
    });
  });
});
