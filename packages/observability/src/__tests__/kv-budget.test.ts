import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createKvBudgetMiddleware,
  instrumentKvBindings,
  isKvQuotaError,
  KV_PAID_MONTHLY_WRITES,
  kvBudgetSnapshot,
  resetKvBudget,
  withKvBudget,
} from '../kv-budget';

type LogFn = (message: string, metadata?: Record<string, unknown>) => void;

function fakeObs() {
  return {
    info: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    error: vi.fn<LogFn>(),
  };
}

function fakeKv() {
  return {
    get: vi.fn<(key: string, type?: string) => Promise<unknown>>(
      async () => null
    ),
    put: vi.fn<
      (key: string, value: string, options?: unknown) => Promise<void>
    >(async () => {}),
    delete: vi.fn<(key: string) => Promise<void>>(async () => {}),
    list: vi.fn<() => Promise<{ keys: string[] }>>(async () => ({ keys: [] })),
  };
}

/** Metadata of the first call whose metadata carries `signal`. */
function signalOf(fn: ReturnType<typeof vi.fn<LogFn>>) {
  const call = fn.mock.calls.find((c) => c[1]?.signal !== undefined);
  return call?.[1] as Record<string, unknown> | undefined;
}

const T0 = 1_800_000_000_000;

beforeEach(() => {
  resetKvBudget();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  resetKvBudget();
});

describe('withKvBudget', () => {
  it('passes arguments and results through untouched', async () => {
    const kv = fakeKv();
    kv.get.mockResolvedValue({ cached: true });
    const wrapped = withKvBudget(kv, { obs: fakeObs(), binding: 'CACHE_KV' });

    const result = await wrapped.get('some:key', 'json');

    expect(result).toEqual({ cached: true });
    expect(kv.get).toHaveBeenCalledExactlyOnceWith('some:key', 'json');
  });

  it('issues no operations of its own', async () => {
    const kv = fakeKv();
    const wrapped = withKvBudget(kv, { obs: fakeObs(), binding: 'CACHE_KV' });

    await wrapped.get('k');
    await wrapped.put('k', 'v', { expirationTtl: 60 });

    // The monitor must not consume the budget it monitors: exactly the caller's
    // own two operations reach KV, and nothing else does.
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.delete).not.toHaveBeenCalled();
    expect(kv.list).not.toHaveBeenCalled();
  });

  it('counts reads and writes by class', async () => {
    const kv = fakeKv();
    const wrapped = withKvBudget(kv, { obs: fakeObs(), binding: 'CACHE_KV' });

    await wrapped.get('a');
    await wrapped.list();
    await wrapped.put('b', 'v');
    await wrapped.delete('c');

    const snapshot = kvBudgetSnapshot('CACHE_KV');
    expect(snapshot).toMatchObject({
      binding: 'CACHE_KV',
      reads: 2,
      writes: 2,
      quotaFailures: 0,
      otherFailures: 0,
    });
  });

  it('passes non-KV members through, bound to the real namespace', () => {
    const kv = { ...fakeKv(), region: 'weur', describe: describeSelf };
    function describeSelf(this: { region: string }) {
      return this.region;
    }
    const wrapped = withKvBudget(kv, { obs: fakeObs(), binding: 'CACHE_KV' });

    expect(wrapped.region).toBe('weur');
    expect(wrapped.describe()).toBe('weur');
  });
});

describe('write-rate rollup', () => {
  it('stays quiet below the rollup threshold', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    for (let i = 0; i < 24; i++) {
      await wrapped.put(`k${i}`, 'v');
    }

    expect(obs.info).not.toHaveBeenCalled();
    expect(obs.warn).not.toHaveBeenCalled();
    expect(obs.error).not.toHaveBeenCalled();
  });

  it('reports a healthy write rate at info', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    // 25 writes spread over a full day projects to ~781/month, three orders of
    // magnitude below the 1,000,000/month Paid allowance.
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(T0 + (i + 1) * 3_456_000);
      await wrapped.put(`k${i}`, 'v');
    }

    expect(obs.error).not.toHaveBeenCalled();
    expect(obs.warn).not.toHaveBeenCalled();
    const metadata = signalOf(obs.info);
    expect(metadata).toMatchObject({
      signal: 'kv_write_budget',
      binding: 'CACHE_KV',
      writes: 25,
      monthlyWriteLimit: KV_PAID_MONTHLY_WRITES,
    });
    expect(metadata?.projectedMonthlyWrites).toBeLessThan(
      KV_PAID_MONTHLY_WRITES
    );
  });

  it('does NOT escalate on a short burst, however fast', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    // 25 writes in ten seconds. Naive arithmetic projects ~6,480,000/month —
    // six times the allowance — but ten seconds is a burst, not a rate, and a
    // single request invalidating a handful of cache keys produces exactly
    // this shape. The gauge must stay quiet rather than cry wolf; the only
    // reason to trust it later is that it does not fire now.
    for (let i = 0; i < 25; i++) {
      vi.setSystemTime(T0 + (i + 1) * 400);
      await wrapped.put(`k${i}`, 'v');
    }

    expect(obs.error).not.toHaveBeenCalled();
    expect(obs.warn).not.toHaveBeenCalled();
    const metadata = signalOf(obs.info);
    expect(metadata).toMatchObject({ signal: 'kv_write_budget', writes: 25 });
    expect(metadata?.projectedMonthlyWrites).toBeNull();
  });

  it('escalates to error once a sustained rate outpaces the monthly allowance', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    // 125 writes at one per 2.5s — a 310,000ms window, past the five-minute
    // floor, projecting ~1,045,000/month against an allowance of 1,000,000.
    for (let i = 0; i < 125; i++) {
      vi.setSystemTime(T0 + (i + 1) * 2_500);
      await wrapped.put(`k${i}`, 'v');
    }

    const metadata = signalOf(obs.error);
    expect(metadata).toMatchObject({
      signal: 'kv_write_budget',
      writes: 125,
      monthlyWriteLimit: KV_PAID_MONTHLY_WRITES,
    });
    expect(metadata?.projectedMonthlyWrites).toBeGreaterThan(
      KV_PAID_MONTHLY_WRITES
    );
  });

  it('warns rather than errors while a sustained rate is under the allowance', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    // 125 writes at one per 3.8s — a 471,200ms window projecting ~688,000/month,
    // past half the allowance but not past it.
    for (let i = 0; i < 125; i++) {
      vi.setSystemTime(T0 + (i + 1) * 3_800);
      await wrapped.put(`k${i}`, 'v');
    }

    expect(obs.error).not.toHaveBeenCalled();
    const metadata = signalOf(obs.warn);
    expect(metadata).toMatchObject({ signal: 'kv_write_budget' });
    const projected = metadata?.projectedMonthlyWrites as number;
    expect(projected).toBeGreaterThan(KV_PAID_MONTHLY_WRITES / 2);
    expect(projected).toBeLessThan(KV_PAID_MONTHLY_WRITES);
  });

  it('reports null rather than a nonsense projection on a zero-length window', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    for (let i = 0; i < 25; i++) {
      await wrapped.put(`k${i}`, 'v');
    }

    const metadata = signalOf(obs.info);
    expect(metadata?.projectedMonthlyWrites).toBeNull();
    expect(metadata?.windowMs).toBe(0);
  });

  it('counts across wrapper instances so per-request wrapping still signals', async () => {
    const obs = fakeObs();
    const rollupEveryWrites = 25;

    // env is rebuilt per request, so each request wraps the binding afresh.
    for (let request = 0; request < 5; request++) {
      const wrapped = withKvBudget(fakeKv(), {
        obs,
        binding: 'CACHE_KV',
        rollupEveryWrites,
      });
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(T0 + (request * 5 + i + 1) * 400);
        await wrapped.put(`k${i}`, 'v');
      }
    }

    expect(kvBudgetSnapshot('CACHE_KV')?.writes).toBe(25);
    // The rollup fires at info: 25 writes over a ten-second window is a burst,
    // so the projection is withheld and cannot escalate. What this case pins is
    // that the COUNT survived five separate wrappers, not the level.
    expect(signalOf(obs.info)).toMatchObject({ signal: 'kv_write_budget' });
  });
});

describe('quota exhaustion signal', () => {
  it('logs loudly once and re-throws the original error', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    const quota = new Error('KV PUT failed: 429 Too Many Requests');
    kv.put.mockRejectedValue(quota);
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    await expect(wrapped.put('a', 'v')).rejects.toBe(quota);
    await expect(wrapped.put('b', 'v')).rejects.toBe(quota);

    expect(obs.error).toHaveBeenCalledTimes(1);
    expect(signalOf(obs.error)).toMatchObject({
      signal: 'kv_quota_exhausted',
      binding: 'CACHE_KV',
      method: 'put',
      quotaFailures: 1,
    });
    expect(kvBudgetSnapshot('CACHE_KV')?.quotaFailures).toBe(2);
  });

  it('degrades to warn when the logger has no error method', async () => {
    const kv = fakeKv();
    kv.put.mockRejectedValue(new Error('KV PUT failed: 429'));
    const warn = vi.fn<LogFn>();
    const wrapped = withKvBudget(kv, {
      obs: { warn },
      binding: 'CACHE_KV',
    });

    await expect(wrapped.put('a', 'v')).rejects.toThrow();

    expect(signalOf(warn)).toMatchObject({ signal: 'kv_quota_exhausted' });
  });

  it('separates ordinary failures from quota failures', async () => {
    const kv = fakeKv();
    const obs = fakeObs();
    kv.get.mockRejectedValue(new Error('Network connection lost'));
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    await expect(wrapped.get('a')).rejects.toThrow('Network connection lost');

    expect(obs.error).not.toHaveBeenCalled();
    expect(kvBudgetSnapshot('CACHE_KV')).toMatchObject({
      quotaFailures: 0,
      otherFailures: 1,
    });
  });

  it('records a synchronous throw as well as a rejection', () => {
    const kv = fakeKv();
    const obs = fakeObs();
    kv.put.mockImplementation(() => {
      throw new Error('daily request limit exceeded');
    });
    const wrapped = withKvBudget(kv, { obs, binding: 'CACHE_KV' });

    expect(() => wrapped.put('a', 'v')).toThrow('daily request limit');
    expect(kvBudgetSnapshot('CACHE_KV')?.quotaFailures).toBe(1);
  });
});

describe('isKvQuotaError', () => {
  it.each([
    'KV PUT failed: 429 Too Many Requests',
    'daily request limit exceeded',
    'Reached daily limit for this namespace',
    'KV quota exceeded',
    'rate limit reached',
  ])('classifies %s as quota exhaustion', (message) => {
    expect(isKvQuotaError(new Error(message))).toBe(true);
  });

  it('classifies a 429 status without a matching message', () => {
    expect(isKvQuotaError({ status: 429 })).toBe(true);
  });

  it.each([
    'Network connection lost',
    'Invalid key',
    'KV GET failed: 500 Internal Server Error',
  ])('does not classify %s as quota exhaustion', (message) => {
    expect(isKvQuotaError(new Error(message))).toBe(false);
  });

  it('handles non-error values', () => {
    expect(isKvQuotaError(undefined)).toBe(false);
    expect(isKvQuotaError(null)).toBe(false);
    expect(isKvQuotaError('429 too many')).toBe(true);
  });
});

describe('instrumentKvBindings', () => {
  it('wraps every KV binding and leaves everything else alone', async () => {
    const cacheKv = fakeKv();
    const sessionKv = fakeKv();
    const env = {
      CACHE_KV: cacheKv,
      AUTH_SESSION_KV: sessionKv,
      ASSETS_BUCKET: { get: () => null },
      DATABASE_URL: 'postgres://localhost/codex',
      NOT_A_KV: { get: 1, put: 2 },
    };

    const instrumented = instrumentKvBindings(env, { obs: fakeObs() });

    expect(instrumented.DATABASE_URL).toBe(env.DATABASE_URL);
    expect(instrumented.ASSETS_BUCKET).toBe(env.ASSETS_BUCKET);
    expect(instrumented.NOT_A_KV).toBe(env.NOT_A_KV);

    await instrumented.CACHE_KV.put('a', 'v');
    await instrumented.AUTH_SESSION_KV.get('b');

    expect(kvBudgetSnapshot('CACHE_KV')).toMatchObject({ writes: 1 });
    expect(kvBudgetSnapshot('AUTH_SESSION_KV')).toMatchObject({ reads: 1 });
  });

  it('does not mutate the env it was given', () => {
    const cacheKv = fakeKv();
    const env = { CACHE_KV: cacheKv };

    instrumentKvBindings(env, { obs: fakeObs() });

    expect(env.CACHE_KV).toBe(cacheKv);
  });
});

describe('kvBudgetSnapshot', () => {
  it('returns null for an untracked binding and a list for all', async () => {
    expect(kvBudgetSnapshot('NEVER_BOUND_KV')).toBeNull();
    expect(kvBudgetSnapshot()).toEqual([]);

    const wrapped = withKvBudget(fakeKv(), {
      obs: fakeObs(),
      binding: 'CACHE_KV',
    });
    await wrapped.put('a', 'v');

    expect(kvBudgetSnapshot()).toHaveLength(1);
    expect(kvBudgetSnapshot()[0]).toMatchObject({
      binding: 'CACHE_KV',
      writes: 1,
    });
  });
});

describe('createKvBudgetMiddleware', () => {
  it('replaces the KV bindings on the context and calls next', async () => {
    const cacheKv = fakeKv();
    const c = { env: { CACHE_KV: cacheKv, DATABASE_URL: 'postgres://x' } };
    const next = vi.fn<() => Promise<void>>(async () => {});

    await createKvBudgetMiddleware({ obs: fakeObs() })(c, next);

    expect(next).toHaveBeenCalledOnce();
    expect(c.env.CACHE_KV).not.toBe(cacheKv);
    expect(c.env.DATABASE_URL).toBe('postgres://x');

    await c.env.CACHE_KV.put('a', 'v');
    expect(cacheKv.put).toHaveBeenCalledExactlyOnceWith('a', 'v');
    expect(kvBudgetSnapshot('CACHE_KV')).toMatchObject({ writes: 1 });
  });

  it('is a no-op when the context has no env', async () => {
    const next = vi.fn<() => Promise<void>>(async () => {});

    await createKvBudgetMiddleware({ obs: fakeObs() })(
      { env: undefined as unknown as object },
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(kvBudgetSnapshot()).toEqual([]);
  });
});
