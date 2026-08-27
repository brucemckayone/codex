/**
 * `policy.rateLimit` is actually enforced (Codex-kgrdp.9).
 *
 * The field was declared on ~150 routes and read by nothing: `mergedPolicy`
 * in helpers.ts carried `rateLimit: policy.rateLimit ?? 'api'` and no branch
 * consumed it, so `rateLimit: 'strict'` on Stripe Checkout and Connect
 * onboarding was decorative. Every test here fails on that tree — the first
 * one because the 21st request through a 'strict' route was allowed.
 *
 * This suite deliberately does NOT mock @codex/security: the real
 * `rateLimit()` middleware, the real subject resolvers and the real
 * Cloudflare-egress detection run, with only the native binding faked (there
 * is no binding in a node test process). What is asserted is the wiring —
 * which preset is picked, what it is keyed on, what a block looks like on the
 * way out, and that a limiter fault does not block.
 */
import type { ObservabilityClient } from '@codex/observability';
import type { HonoEnv } from '@codex/shared-types';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// helpers.ts imports `../auth-middleware` statically, which reaches the DB
// layer. Neither is exercised: every test here supplies the user directly, so
// `authenticateSession` returns on its first line.
vi.mock('../../auth-middleware', () => ({
  createSessionMiddleware:
    () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
      return undefined;
    },
}));

// @codex/security's session-auth module imports the DB client at module scope.
vi.mock('@codex/database', () => ({
  createDbClient: vi.fn(),
  schema: {},
}));

import { RateLimitExceededError } from '@codex/service-errors';
import { enforcePolicyInline } from '../helpers';

// --- Addresses --------------------------------------------------------------

/**
 * Inside Cloudflare's published `2a06:98c0::/29`. This exact address was 78%
 * of traffic to the auth host — it is a Worker's egress address, not a user,
 * so `trustedClientIp` must withhold it.
 */
const EGRESS_IP = '2a06:98c0:3600::103';

/** TEST-NET-3. Never inside a Cloudflare range, so genuinely countable. */
const CLIENT_IP = '203.0.113.7';
const OTHER_CLIENT_IP = '198.51.100.9';

// --- Fakes ------------------------------------------------------------------

interface FakeBinding {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
  keys: string[];
  calls: () => number;
}

/**
 * Stands in for the native Workers Rate Limiting binding: a fixed-window
 * counter per key, recording every key it was handed.
 */
function makeBinding(maxRequests: number, opts: { throws?: boolean } = {}) {
  const counts = new Map<string, number>();
  const keys: string[] = [];

  const limit = vi.fn<
    (options: { key: string }) => Promise<{ success: boolean }>
  >(async ({ key }) => {
    if (opts.throws) throw new Error('rate limit backend unavailable');
    keys.push(key);
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return { success: next <= maxRequests };
  });

  return {
    limit,
    keys,
    calls: () => limit.mock.calls.length,
  } as FakeBinding & {
    limit: typeof limit;
  };
}

function makeObs() {
  return {
    debug: vi.fn<(m: string, meta?: Record<string, unknown>) => void>(),
    info: vi.fn<(m: string, meta?: Record<string, unknown>) => void>(),
    warn: vi.fn<(m: string, meta?: Record<string, unknown>) => void>(),
    error: vi.fn<(m: string, meta?: Record<string, unknown>) => void>(),
  };
}

type Obs = ReturnType<typeof makeObs>;

interface RunOptions {
  policy: Parameters<typeof enforcePolicyInline>[1];
  env?: Record<string, unknown>;
  ip?: string;
  user?: { id: string; role?: string };
  workerHop?: boolean;
  obs?: Obs;
}

interface RunResult {
  headers: Record<string, string>;
  error: unknown;
}

/**
 * Drive one request through `enforcePolicyInline` on a fresh context and
 * report the prepared response headers plus whatever it threw.
 */
async function run(opts: RunOptions): Promise<RunResult> {
  const headers: Record<string, string> = {};
  const requestHeaders: Record<string, string> = {};
  if (opts.ip) requestHeaders['cf-connecting-ip'] = opts.ip;
  if (opts.workerHop) requestHeaders['x-worker-signature'] = 'sha256=stub';

  const vars: Record<string, unknown> = {};
  if (opts.user) vars.user = opts.user;
  if (opts.workerHop) vars.workerAuth = true;

  const c = {
    req: {
      method: 'POST',
      url: 'https://api.example.com/checkout/create',
      header(name?: string) {
        if (name === undefined) return requestHeaders;
        return requestHeaders[name.toLowerCase()];
      },
      param(name?: string) {
        return name === undefined ? {} : undefined;
      },
      query(name?: string) {
        return name === undefined ? {} : undefined;
      },
      raw: new Request('https://api.example.com/checkout/create', {
        method: 'POST',
      }),
    },
    env: opts.env ?? {},
    get(key: string) {
      return vars[key];
    },
    set(key: string, value: unknown) {
      vars[key] = value;
    },
    header(name: string, value: string) {
      headers[name] = value;
    },
    json(body: unknown, status?: number) {
      return new Response(JSON.stringify(body), { status: status ?? 200 });
    },
  } as unknown as Context<HonoEnv>;

  let error: unknown;
  try {
    await enforcePolicyInline(
      c,
      opts.policy,
      opts.obs as unknown as ObservabilityClient | undefined
    );
  } catch (caught) {
    error = caught;
  }

  return { headers, error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// A declared preset is enforced
// ============================================================================
describe("procedure rate limiting · policy.rateLimit: 'strict'", () => {
  it('rejects once the strict budget is spent', async () => {
    const binding = makeBinding(20);
    const env = { RATE_LIMIT_STRICT: binding };
    const policy = { auth: 'required' as const, rateLimit: 'strict' as const };
    const user = { id: 'user-1', role: 'creator' };

    for (let i = 0; i < 20; i++) {
      const { error } = await run({ policy, env, user, ip: EGRESS_IP });
      expect(error, `request ${i + 1} of the budget`).toBeUndefined();
    }

    const { error, headers } = await run({
      policy,
      env,
      user,
      ip: EGRESS_IP,
    });

    expect(error).toBeInstanceOf(RateLimitExceededError);
    // `.name` is unreliable under minification — assert the stable code.
    expect((error as RateLimitExceededError).code).toBe('RATE_LIMIT_EXCEEDED');
    expect((error as RateLimitExceededError).statusCode).toBe(429);
    expect(headers['Retry-After']).toBe('60');
  });

  it('charges the strict binding, not the api one', async () => {
    const strict = makeBinding(20);
    const api = makeBinding(100);
    const env = { RATE_LIMIT_STRICT: strict, RATE_LIMIT_API: api };

    await run({
      policy: { auth: 'required', rateLimit: 'strict' },
      env,
      user: { id: 'user-1' },
      ip: EGRESS_IP,
    });

    expect(strict.calls()).toBe(1);
    expect(api.calls()).toBe(0);
    expect(strict.keys[0]).toMatch(/^rl:strict:session:/);
  });

  it("falls back to the 'api' preset when the route declares nothing", async () => {
    const strict = makeBinding(20);
    const api = makeBinding(100);
    const env = { RATE_LIMIT_STRICT: strict, RATE_LIMIT_API: api };

    await run({
      policy: { auth: 'required' },
      env,
      user: { id: 'user-1' },
      ip: EGRESS_IP,
    });

    expect(api.calls()).toBe(1);
    expect(strict.calls()).toBe(0);
    expect(api.keys[0]).toMatch(/^rl:api:session:/);
  });

  it('never puts the subject value in the bucket key', async () => {
    const binding = makeBinding(20);

    await run({
      policy: { auth: 'required', rateLimit: 'strict' },
      env: { RATE_LIMIT_STRICT: binding },
      user: { id: 'e2d1c8f4-0000-4000-8000-abcdefabcdef' },
      ip: EGRESS_IP,
    });

    expect(binding.keys[0]).toMatch(/^rl:strict:session:[0-9a-f]{32}$/);
    expect(binding.keys[0]).not.toContain('e2d1c8f4');
  });
});

// ============================================================================
// Negative controls — one exhausted subject must not exhaust another
// ============================================================================
describe('procedure rate limiting · subject isolation', () => {
  it('leaves a second user untouched when the first is exhausted', async () => {
    const binding = makeBinding(20);
    const env = { RATE_LIMIT_STRICT: binding };
    const policy = { auth: 'required' as const, rateLimit: 'strict' as const };

    // Both users arrive on the SAME Cloudflare egress address, so the only
    // countable subject is the session. If the session key were ignored (or
    // the address trusted) they would share one bucket.
    for (let i = 0; i < 21; i++) {
      await run({ policy, env, user: { id: 'victim' }, ip: EGRESS_IP });
    }

    const exhausted = await run({
      policy,
      env,
      user: { id: 'victim' },
      ip: EGRESS_IP,
    });
    expect(exhausted.error).toBeInstanceOf(RateLimitExceededError);

    const bystander = await run({
      policy,
      env,
      user: { id: 'someone-else' },
      ip: EGRESS_IP,
    });
    expect(bystander.error).toBeUndefined();
  });

  it('also charges the trusted address, so it can block on its own', async () => {
    const binding = makeBinding(20);
    const env = { RATE_LIMIT_STRICT: binding };
    const policy = { auth: 'required' as const, rateLimit: 'strict' as const };

    for (let i = 0; i < 20; i++) {
      await run({ policy, env, user: { id: 'user-a' }, ip: CLIENT_IP });
    }

    // A fresh session behind the same countable address is blocked by the
    // address bucket — the second signal is live, not decorative.
    const sameAddress = await run({
      policy,
      env,
      user: { id: 'user-b' },
      ip: CLIENT_IP,
    });
    expect(sameAddress.error).toBeInstanceOf(RateLimitExceededError);

    const otherAddress = await run({
      policy,
      env,
      user: { id: 'user-c' },
      ip: OTHER_CLIENT_IP,
    });
    expect(otherAddress.error).toBeUndefined();
  });
});

// ============================================================================
// Auth levels
// ============================================================================
describe('procedure rate limiting · auth levels', () => {
  it("keys auth: 'none' on the client address", async () => {
    const binding = makeBinding(20);
    const env = { RATE_LIMIT_STRICT: binding };
    const policy = { auth: 'none' as const, rateLimit: 'strict' as const };

    for (let i = 0; i < 20; i++) {
      const { error } = await run({ policy, env, ip: CLIENT_IP });
      expect(error).toBeUndefined();
    }

    const { error } = await run({ policy, env, ip: CLIENT_IP });
    expect(error).toBeInstanceOf(RateLimitExceededError);
    expect(binding.keys[0]).toMatch(/^rl:strict:trusted-ip:[0-9a-f]{32}$/);

    // A different address starts fresh.
    const other = await run({ policy, env, ip: OTHER_CLIENT_IP });
    expect(other.error).toBeUndefined();
  });

  it("exempts auth: 'worker' — the caller is HMAC-authenticated", async () => {
    const binding = makeBinding(20);

    const { error } = await run({
      policy: { auth: 'worker', rateLimit: 'strict' },
      env: { RATE_LIMIT_STRICT: binding, WORKER_SHARED_SECRET: 'secret' },
      workerHop: true,
      ip: EGRESS_IP,
    });

    expect(error).toBeUndefined();
    expect(binding.calls()).toBe(0);
  });

  it('does not count, or complain about, an anonymous internal hop', async () => {
    const binding = makeBinding(20);
    const obs = makeObs();

    // auth: 'none' reached over a worker hop from a Cloudflare address: there
    // is no countable subject, the real client is upstream, and announcing a
    // fail-open here on every SSR-driven public read would bury the signal.
    const { error } = await run({
      policy: { auth: 'none', rateLimit: 'api' },
      env: { RATE_LIMIT_API: binding },
      ip: EGRESS_IP,
      workerHop: true,
      obs,
    });

    expect(error).toBeUndefined();
    expect(binding.calls()).toBe(0);
    expect(obs.error).not.toHaveBeenCalled();
    expect(obs.warn).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Fail open, loudly
// ============================================================================
describe('procedure rate limiting · fail open', () => {
  it('passes the request through when the binding is not bound, and says so', async () => {
    const obs = makeObs();

    const { error } = await run({
      policy: { auth: 'required', rateLimit: 'strict' },
      env: {},
      user: { id: 'user-1' },
      ip: CLIENT_IP,
      obs,
    });

    expect(error).toBeUndefined();
    expect(obs.error).toHaveBeenCalledTimes(1);
    const [message, metadata] = obs.error.mock.calls[0] ?? [];
    expect(message).toContain('rate_limit.fail_open');
    expect(metadata).toMatchObject({
      signal: 'rate_limit.fail_open',
      preset: 'strict',
      reason: 'missing-binding',
    });
    // The signal must never carry the subject it could not count.
    expect(JSON.stringify(metadata)).not.toContain('user-1');
  });

  it('passes the request through when the backend throws, and says so', async () => {
    const obs = makeObs();
    const binding = makeBinding(20, { throws: true });

    const { error } = await run({
      policy: { auth: 'required', rateLimit: 'strict' },
      env: { RATE_LIMIT_STRICT: binding },
      user: { id: 'user-1' },
      ip: CLIENT_IP,
      obs,
    });

    expect(error).toBeUndefined();
    expect(obs.error).toHaveBeenCalledTimes(1);
    expect(obs.error.mock.calls[0]?.[1]).toMatchObject({
      signal: 'rate_limit.fail_open',
      reason: 'backend-error',
    });
  });

  it('announces every failed-open request, not just the first', async () => {
    const obs = makeObs();

    for (let i = 0; i < 3; i++) {
      await run({
        policy: { auth: 'required', rateLimit: 'api' },
        env: {},
        user: { id: 'user-1' },
        ip: CLIENT_IP,
        obs,
      });
    }

    expect(obs.error).toHaveBeenCalledTimes(3);
  });
});
