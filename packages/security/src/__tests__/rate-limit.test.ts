/**
 * Rate limiter — keying, substrate selection and fail-open behaviour.
 *
 * The centrepiece is the "different subjects land in different buckets"
 * negative control. No such test existed, which is why a limiter keyed on
 * `CF-Connecting-IP` shipped: on any surface reached by a worker-to-worker
 * fetch that header holds the CALLING worker's Cloudflare egress address, so
 * every user on the platform shared one 5-per-15-minutes budget
 * (Codex-kgrdp.16). Every request in the credential tests below deliberately
 * carries the SAME Cloudflare egress address that was measured in production.
 */

import {
  RATE_LIMIT_BINDING_PERIODS,
  RATE_LIMIT_FAIL_OPEN_SIGNAL,
} from '@codex/constants';
import type { Logger } from '@codex/observability';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  combineSubjects,
  credentialSubject,
  isCloudflareEgressIp,
  RATE_LIMIT_PRESETS,
  rateLimit,
  sessionSubject,
  trustedClientIp,
  trustedIpSubject,
} from '../rate-limit';
import {
  createBrokenRateLimitNamespace,
  createFakeRateLimitBinding,
  createFakeRateLimitNamespace,
} from './rate-limit-fakes';

/**
 * Measured in production 2026-08-27: 34% of all zone traffic and 78% of
 * traffic to the auth host came from this single address, inside Cloudflare's
 * own `2a06:98c0::/29` egress range.
 */
const WORKER_EGRESS_IP = '2a06:98c0:3600::103';

function createLoggerSpy() {
  const error =
    vi.fn<(message: string, meta?: Record<string, unknown>) => void>();
  const warn =
    vi.fn<(message: string, meta?: Record<string, unknown>) => void>();
  const info =
    vi.fn<(message: string, meta?: Record<string, unknown>) => void>();
  return { logger: { error, warn, info } satisfies Logger, error, warn, info };
}

/** POST a sign-in body from behind the worker egress address. */
function signIn(app: Hono, email: string, ip = WORKER_EGRESS_IP) {
  return app.request('/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, password: 'irrelevant' }),
  });
}

describe('rate limit — credential keying (Codex-kgrdp.16)', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use(
      '/sign-in',
      rateLimit({
        preset: 'auth',
        namespace: createFakeRateLimitNamespace(),
        subject: combineSubjects(credentialSubject(), trustedIpSubject()),
        obs: createLoggerSpy().logger,
      })
    );
    app.post('/sign-in', (c) => c.text('OK'));
  });

  it('NEGATIVE CONTROL: exhausting one credential leaves another untouched', async () => {
    const budget = RATE_LIMIT_PRESETS.auth.maxRequests;

    // Burn the whole budget for one account.
    for (let attempt = 0; attempt < budget; attempt++) {
      const res = await signIn(app, 'victim@example.com');
      expect(res.status).toBe(200);
    }
    const exhausted = await signIn(app, 'victim@example.com');
    expect(exhausted.status).toBe(429);

    // A different account, same transport address. If the key collapses onto
    // the IP — the shipped bug — this is a 429 and the test fails here.
    const other = await signIn(app, 'someone.else@example.com');
    expect(other.status).toBe(200);
  });

  it('normalises the credential so casing and padding cannot mint fresh buckets', async () => {
    const budget = RATE_LIMIT_PRESETS.auth.maxRequests;

    for (let attempt = 0; attempt < budget; attempt++) {
      expect((await signIn(app, 'victim@example.com')).status).toBe(200);
    }

    expect((await signIn(app, '  VICTIM@Example.COM ')).status).toBe(429);
  });

  it('leaves the request body readable downstream (BetterAuth reads c.req.raw)', async () => {
    const echo = new Hono();
    echo.use(
      '/sign-in',
      rateLimit({
        preset: 'auth',
        namespace: createFakeRateLimitNamespace(),
        subject: credentialSubject(),
        obs: createLoggerSpy().logger,
      })
    );
    echo.post('/sign-in', async (c) => {
      const body = (await c.req.raw.json()) as { email: string };
      return c.json({ seen: body.email });
    });

    const res = await signIn(echo, 'reader@example.com');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seen: 'reader@example.com' });
  });

  it('reads a form-encoded credential too', async () => {
    const budget = RATE_LIMIT_PRESETS.auth.maxRequests;
    const form = () =>
      app.request('/sign-in', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': WORKER_EGRESS_IP,
        },
        body: new URLSearchParams({ email: 'form@example.com' }).toString(),
      });

    for (let attempt = 0; attempt < budget; attempt++) {
      expect((await form()).status).toBe(200);
    }
    expect((await form()).status).toBe(429);
  });

  it('emits exact X-RateLimit-* headers on the Durable Object store', async () => {
    const res = await signIn(app, 'headers@example.com');

    expect(res.headers.get('X-RateLimit-Limit')).toBe(
      String(RATE_LIMIT_PRESETS.auth.maxRequests)
    );
    expect(res.headers.get('X-RateLimit-Remaining')).toBe(
      String(RATE_LIMIT_PRESETS.auth.maxRequests - 1)
    );
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('returns Retry-After and the 429 envelope the web app already handles', async () => {
    const budget = RATE_LIMIT_PRESETS.auth.maxRequests;
    for (let attempt = 0; attempt <= budget; attempt++) {
      await signIn(app, 'retry@example.com');
    }

    const res = await signIn(app, 'retry@example.com');
    expect(res.status).toBe(429);

    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(
      RATE_LIMIT_PRESETS.auth.windowMs / 1000
    );

    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('Too many requests');
    expect(typeof body.retryAfter).toBe('number');
  });
});

describe('rate limit — IP trust', () => {
  it('recognises Cloudflare egress addresses, including the measured one', () => {
    expect(isCloudflareEgressIp(WORKER_EGRESS_IP)).toBe(true);
    expect(isCloudflareEgressIp('2a06:98c0::1')).toBe(true);
    expect(isCloudflareEgressIp('104.26.1.1')).toBe(true);
    expect(isCloudflareEgressIp('172.64.0.1')).toBe(true);
    expect(isCloudflareEgressIp('::ffff:104.26.1.1')).toBe(true);
  });

  it('does not mistake ordinary addresses for Cloudflare', () => {
    expect(isCloudflareEgressIp('203.0.113.7')).toBe(false);
    expect(isCloudflareEgressIp('104.28.1.1')).toBe(false);
    expect(isCloudflareEgressIp('2a07:98c0::1')).toBe(false);
    expect(isCloudflareEgressIp('2001:db8::1')).toBe(false);
    expect(isCloudflareEgressIp('not-an-ip')).toBe(false);
  });

  it('withholds the IP when it is a worker egress address', async () => {
    const app = new Hono();
    app.get('/', (c) => c.json({ ip: trustedClientIp(c) }));

    const untrusted = await app.request('/', {
      headers: { 'cf-connecting-ip': WORKER_EGRESS_IP },
    });
    expect(await untrusted.json()).toEqual({ ip: null });

    const trusted = await app.request('/', {
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(await trusted.json()).toEqual({ ip: '203.0.113.7' });
  });

  it('withholds the IP on a worker-to-worker hop', async () => {
    const app = new Hono();
    app.get('/', (c) => c.json({ ip: trustedClientIp(c) }));

    const res = await app.request('/', {
      headers: {
        'cf-connecting-ip': '203.0.113.7',
        'x-worker-signature': 'signed-by-another-worker',
      },
    });
    expect(await res.json()).toEqual({ ip: null });
  });

  it('never consults the client-settable X-Forwarded-For', async () => {
    const app = new Hono();
    app.get('/', (c) => c.json({ ip: trustedClientIp(c) }));

    const res = await app.request('/', {
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    expect(await res.json()).toEqual({ ip: null });
  });

  it('NEGATIVE CONTROL: two trustworthy addresses get separate budgets', async () => {
    const app = new Hono();
    app.use(
      '/probe',
      rateLimit({
        preset: 'auth',
        namespace: createFakeRateLimitNamespace(),
        subject: trustedIpSubject(),
        obs: createLoggerSpy().logger,
      })
    );
    app.get('/probe', (c) => c.text('OK'));

    const hit = (ip: string) =>
      app.request('/probe', { headers: { 'cf-connecting-ip': ip } });

    for (
      let attempt = 0;
      attempt < RATE_LIMIT_PRESETS.auth.maxRequests;
      attempt++
    ) {
      expect((await hit('203.0.113.7')).status).toBe(200);
    }
    expect((await hit('203.0.113.7')).status).toBe(429);
    expect((await hit('203.0.113.8')).status).toBe(200);
  });
});

describe('rate limit — native binding store', () => {
  function bindingApp(binding: ReturnType<typeof createFakeRateLimitBinding>) {
    const app = new Hono();
    app.use(
      '/api',
      rateLimit({
        preset: 'strict',
        binding,
        subject: sessionSubject(),
        obs: createLoggerSpy().logger,
      })
    );
    app.get('/api', (c) => c.text('OK'));
    return app;
  }

  function asUser(app: Hono, userId: string) {
    const withUser = new Hono<{ Variables: { user: { id: string } } }>();
    withUser.use('*', async (c, next) => {
      c.set('user', { id: userId });
      await next();
    });
    withUser.route('/', app);
    return withUser;
  }

  it('blocks once the binding reports failure', async () => {
    const budget = RATE_LIMIT_PRESETS.strict.maxRequests;
    const app = asUser(
      bindingApp(createFakeRateLimitBinding(budget)),
      'user-1'
    );

    for (let attempt = 0; attempt < budget; attempt++) {
      expect((await app.request('/api')).status).toBe(200);
    }
    expect((await app.request('/api')).status).toBe(429);
  });

  it('NEGATIVE CONTROL: two users get separate buckets', async () => {
    const budget = RATE_LIMIT_PRESETS.strict.maxRequests;
    const binding = createFakeRateLimitBinding(budget);
    const inner = bindingApp(binding);

    const first = asUser(inner, 'user-1');
    for (let attempt = 0; attempt <= budget; attempt++) {
      await first.request('/api');
    }
    expect((await first.request('/api')).status).toBe(429);

    const second = asUser(inner, 'user-2');
    expect((await second.request('/api')).status).toBe(200);
    expect(binding.counts.size).toBe(2);
  });

  it('omits X-RateLimit-* because the binding cannot produce them', async () => {
    const app = asUser(
      bindingApp(
        createFakeRateLimitBinding(RATE_LIMIT_PRESETS.strict.maxRequests)
      ),
      'user-1'
    );
    const res = await app.request('/api');

    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
    expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
    expect(res.headers.get('X-RateLimit-Reset')).toBeNull();
  });

  it('never puts a raw subject in the bucket key', async () => {
    const binding = createFakeRateLimitBinding(100);
    const app = asUser(bindingApp(binding), 'secret-user-id');
    await app.request('/api');

    const keys = [...binding.counts.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain('secret-user-id');
    expect(keys[0]).toMatch(/^rl:strict:session:[0-9a-f]{32}$/);
  });
});

describe('rate limit — fails open, loudly (Codex-kgrdp.3)', () => {
  const expectFailOpen = (
    spy: ReturnType<typeof createLoggerSpy>,
    reason: string
  ) => {
    expect(spy.error).toHaveBeenCalled();
    const [message, metadata] = spy.error.mock.calls[0] ?? [];
    expect(message).toContain(RATE_LIMIT_FAIL_OPEN_SIGNAL);
    expect(metadata).toMatchObject({
      signal: RATE_LIMIT_FAIL_OPEN_SIGNAL,
      reason,
    });
  };

  it('missing binding: request proceeds and the signal fires', async () => {
    const spy = createLoggerSpy();
    const app = new Hono();
    app.use(
      '/api',
      rateLimit({ preset: 'api', subject: sessionSubject(), obs: spy.logger })
    );
    app.get('/api', (c) => c.text('OK'));

    expect((await app.request('/api')).status).toBe(200);
    expectFailOpen(spy, 'missing-binding');
    expect(spy.error.mock.calls[0]?.[1]).toMatchObject({
      expectedBinding: RATE_LIMIT_PRESETS.api.bindingName,
    });
  });

  it('missing namespace: request proceeds and the signal fires', async () => {
    const spy = createLoggerSpy();
    const app = new Hono();
    app.use(
      '/sign-in',
      rateLimit({
        preset: 'auth',
        subject: credentialSubject(),
        obs: spy.logger,
      })
    );
    app.post('/sign-in', (c) => c.text('OK'));

    expect((await signIn(app, 'a@example.com')).status).toBe(200);
    expectFailOpen(spy, 'missing-namespace');
  });

  it('no trustworthy subject: request proceeds and the signal fires', async () => {
    const spy = createLoggerSpy();
    const app = new Hono();
    app.use(
      '/sign-in',
      rateLimit({
        preset: 'auth',
        namespace: createFakeRateLimitNamespace(),
        // Only the transport address, which is a worker egress address here.
        subject: trustedIpSubject(),
        obs: spy.logger,
      })
    );
    app.post('/sign-in', (c) => c.text('OK'));

    expect((await signIn(app, 'a@example.com')).status).toBe(200);
    expectFailOpen(spy, 'no-subject');
  });

  it('backend error: request proceeds, the signal fires, and no PII leaks', async () => {
    const spy = createLoggerSpy();
    const app = new Hono();
    app.use(
      '/sign-in',
      rateLimit({
        preset: 'auth',
        namespace: createBrokenRateLimitNamespace(),
        subject: credentialSubject(),
        obs: spy.logger,
      })
    );
    app.post('/sign-in', (c) => c.text('OK'));

    expect((await signIn(app, 'private@example.com')).status).toBe(200);
    expectFailOpen(spy, 'backend-error');

    const logged = JSON.stringify(spy.error.mock.calls);
    expect(logged).not.toContain('private@example.com');
    expect(logged).toContain('subjectKind');
  });

  it('signals on EVERY fail-open, not once per middleware construction', async () => {
    const spy = createLoggerSpy();
    const app = new Hono();
    app.use(
      '/api',
      rateLimit({ preset: 'api', subject: sessionSubject(), obs: spy.logger })
    );
    app.get('/api', (c) => c.text('OK'));

    await app.request('/api');
    await app.request('/api');
    await app.request('/api');

    expect(spy.error).toHaveBeenCalledTimes(3);
  });
});

describe('rate limit — preset legality', () => {
  it('every binding-backed preset uses a period the binding accepts', () => {
    for (const [name, preset] of Object.entries(RATE_LIMIT_PRESETS)) {
      if (preset.store !== 'binding') continue;
      expect(
        RATE_LIMIT_BINDING_PERIODS as readonly number[],
        `${name} period must be 10 or 60`
      ).toContain(preset.periodSeconds);
    }
  });

  it('the auth preset is on the Durable Object because 15 minutes is not expressible', () => {
    expect(RATE_LIMIT_PRESETS.auth.store).toBe('durable-object');
    expect(RATE_LIMIT_PRESETS.auth.windowMs).toBe(15 * 60 * 1000);
    expect(RATE_LIMIT_PRESETS.auth.maxRequests).toBe(5);
  });

  it('has no webhook preset — Stripe and RunPod are HMAC-authenticated', () => {
    expect(Object.keys(RATE_LIMIT_PRESETS)).not.toContain('webhook');
  });

  it('every binding-backed preset names a distinct binding', () => {
    const bindings = new Set<string>();
    for (const preset of Object.values(RATE_LIMIT_PRESETS)) {
      if (preset.store !== 'binding') continue;
      bindings.add(preset.bindingName);
    }
    const bindingBacked = Object.values(RATE_LIMIT_PRESETS).filter(
      (preset) => preset.store === 'binding'
    ).length;
    expect(bindings.size).toBe(bindingBacked);
  });

  it('declares no canonical namespace_id — ids are per worker AND per env', () => {
    // A preset-wide id would make every worker that binds the preset share one
    // account-wide counter, which is the coupling that let a dev worker spend
    // production's budget. The wrangler configs own the allocation.
    for (const preset of Object.values(RATE_LIMIT_PRESETS)) {
      expect(preset).not.toHaveProperty('namespaceId');
    }
  });
});

describe('rate limit — skip', () => {
  it('bypasses the check entirely when skip returns true', async () => {
    const binding = createFakeRateLimitBinding(0);
    const app = new Hono();
    app.use(
      '/api',
      rateLimit({
        preset: 'api',
        binding,
        subject: sessionSubject(),
        skip: () => true,
        obs: createLoggerSpy().logger,
      })
    );
    app.get('/api', (c) => c.text('OK'));

    expect((await app.request('/api')).status).toBe(200);
    expect(binding.counts.size).toBe(0);
  });
});
