/**
 * KV Operation Budget Signal
 *
 * Cloudflare KV on the free tier allows 100,000 reads/day but only 1,000
 * WRITES/day, and both are billed PER ACCOUNT — a dev worker burning the write
 * quota takes production's session cache and rate limiter down with it.
 *
 * Every KV failure path on this platform swallows its error by design:
 * `VersionedCache` falls back to the fetcher, `createKVSecondaryStorage`
 * returns null, `cacheSessionInKV` logs and continues, and the rate limiter's
 * KV store is the only backend it has. That graceful degradation is correct —
 * a cache miss must never fail a request — but it means quota exhaustion has
 * no operator signal at all. The symptom is "the app feels slow", and the
 * diagnosis arrives with the bill.
 *
 * WHAT A WORKER CAN AND CANNOT SEE
 *
 * A Worker cannot read its own account-wide quota counters — there is no
 * binding for that, so any design that reports "X of 1000 writes used today"
 * is lying. What a Worker CAN do is count the operations this code path itself
 * issues, measure how long it took to issue them, and recognise a
 * quota-shaped error when KV returns one. That gives two honest signals:
 *
 *  1. `kv_quota_exhausted` — KV rejected an operation with a 429/limit-shaped
 *     error. This is the moment exhaustion starts, logged at `error` even
 *     though the caller will go on to swallow the failure.
 *  2. `kv_write_budget` — a periodic rollup of this isolate's write rate,
 *     projected to a day and compared against the daily cap. Because the
 *     account total is the SUM across every isolate of every worker, one
 *     isolate's projection is a LOWER BOUND on the account rate: if a single
 *     isolate is already on pace for 40,000 writes/day, the account is far
 *     past 1,000 and no further arithmetic is needed.
 *
 * Both signals go through {@link Logger}, so they land in Workers Logs, which
 * is already enabled for all 10 workers at head_sampling_rate 1. Nothing new
 * has to be provisioned for an operator to see them.
 *
 * COST
 *
 * The counters are plain integers held at module scope in the isolate. This
 * costs no KV operations, no Durable Object operations, no subrequests and no
 * `waitUntil` work — a monitor that consumed the budget it monitors would be
 * self-defeating. Log volume is self-limiting for the same reason it is worth
 * monitoring: rollups fire per N writes, and writes are what the 1,000/day cap
 * bounds.
 *
 * @example One-line adoption — wraps every `*_KV` binding for a whole worker
 * ```typescript
 * const env = instrumentKvBindings(c.env, { obs });
 * ```
 *
 * @example Instrumenting a single namespace
 * ```typescript
 * const cache = new VersionedCache({
 *   kv: withKvBudget(env.CACHE_KV, { obs, binding: 'CACHE_KV' }),
 *   waitUntil: (p) => ctx.executionCtx.waitUntil(p),
 * });
 * ```
 */

import type { Logger } from './index';

/** Free-tier daily KV write allowance (put + delete), per ACCOUNT. */
export const KV_FREE_TIER_DAILY_WRITES = 1000;

/** Free-tier daily KV read allowance (get + list), per ACCOUNT. */
export const KV_FREE_TIER_DAILY_READS = 100_000;

/** Writes counted in one isolate between rollup log lines. */
const DEFAULT_ROLLUP_EVERY_WRITES = 25;

/**
 * Below this window length a projection is arithmetic noise (25 writes in 40ms
 * projects to 54 million/day), so the rollup reports `null` instead.
 */
const PROJECTION_MIN_WINDOW_MS = 1000;

/** Guard against an unbounded counter map if a caller passes dynamic names. */
const MAX_TRACKED_BINDINGS = 32;

const MS_PER_DAY = 86_400_000;

/** Methods that consume the read allowance. */
const READ_METHODS = new Set(['get', 'getWithMetadata', 'list']);

/** Methods that consume the write allowance — the scarce one. */
const WRITE_METHODS = new Set(['put', 'delete']);

/**
 * Error shapes Cloudflare KV uses when an allowance is exhausted or a key is
 * being written too fast. Matched case-insensitively against the message.
 *
 * These are heuristics: the binding surfaces quota rejections as
 * `KV PUT failed: 429 ...` and the daily cap as a limit-exceeded message, and
 * neither string is contractual. A miss degrades to `otherFailures`, which
 * still shows up in the rollup — so a wrong guess loses precision, never the
 * signal.
 */
const QUOTA_ERROR_PATTERNS: RegExp[] = [
  /\b429\b/,
  /too many requests/i,
  /daily (request )?limit/i,
  /limit exceeded/i,
  /quota/i,
  /rate limit/i,
];

export type KvOpClass = 'read' | 'write';

/** Point-in-time view of one binding's counters within this isolate. */
export interface KvBudgetSnapshot {
  /** Binding name, e.g. `CACHE_KV`. */
  binding: string;
  /** Read operations attempted since this isolate started counting. */
  reads: number;
  /** Write operations attempted since this isolate started counting. */
  writes: number;
  /** Failures whose error looked like quota exhaustion. */
  quotaFailures: number;
  /** Failures with any other cause (network, malformed value, unbound namespace). */
  otherFailures: number;
  /** Age of the counting window in milliseconds. */
  windowMs: number;
  /** Writes/day this isolate alone is on pace for, or null if the window is too short. */
  projectedDailyWrites: number | null;
  /** Reads/day this isolate alone is on pace for, or null if the window is too short. */
  projectedDailyReads: number | null;
}

export interface KvBudgetOptions {
  /** Where signals are emitted. Any `ObservabilityClient` satisfies this. */
  obs: Logger;
  /** Binding name used to key counters and to label every log line. */
  binding: string;
  /** Writes between rollup logs (default 25). */
  rollupEveryWrites?: number;
  /** Daily write cap to compare projections against (default free tier, 1000). */
  dailyWriteLimit?: number;
}

interface BindingCounters {
  reads: number;
  writes: number;
  quotaFailures: number;
  otherFailures: number;
  startedAt: number;
  writesAtLastRollup: number;
  /** The loud one-shot has already fired for this binding in this isolate. */
  quotaLogged: boolean;
}

/**
 * Counters live at MODULE scope, not per wrapper instance.
 *
 * `env` is rebuilt for every request, so a caller wrapping `env.CACHE_KV`
 * creates a new proxy per request. Per-instance counters would reset before
 * any rollup threshold could be reached and the signal would never fire. The
 * isolate outlives the request, which is exactly the window a write RATE is
 * meaningful over.
 *
 * This is deliberate cross-request state and safe to hold: the map contains
 * only integers and timestamps keyed by binding name. No request data, no key
 * names, no PII ever enters it.
 */
const counters = new Map<string, BindingCounters>();

let bindingCapWarned = false;

function newCounters(): BindingCounters {
  return {
    reads: 0,
    writes: 0,
    quotaFailures: 0,
    otherFailures: 0,
    startedAt: Date.now(),
    writesAtLastRollup: 0,
    quotaLogged: false,
  };
}

function countersFor(binding: string): BindingCounters | null {
  const existing = counters.get(binding);
  if (existing) return existing;
  if (counters.size >= MAX_TRACKED_BINDINGS) return null;

  const created = newCounters();
  counters.set(binding, created);
  return created;
}

function project(count: number, windowMs: number): number | null {
  if (windowMs < PROJECTION_MIN_WINDOW_MS) return null;
  return Math.round((count / windowMs) * MS_PER_DAY);
}

function snapshotOf(binding: string, state: BindingCounters): KvBudgetSnapshot {
  // Date.now() in workerd is pinned to the last I/O boundary; every operation
  // counted here IS I/O, so the window advances as expected.
  const windowMs = Math.max(0, Date.now() - state.startedAt);

  return {
    binding,
    reads: state.reads,
    writes: state.writes,
    quotaFailures: state.quotaFailures,
    otherFailures: state.otherFailures,
    windowMs,
    projectedDailyWrites: project(state.writes, windowMs),
    projectedDailyReads: project(state.reads, windowMs),
  };
}

/**
 * Does this error look like KV refusing an operation on quota grounds?
 *
 * Exported so callers that must decide something on the strength of it — a
 * rate limiter choosing to fail open, for instance — can distinguish quota
 * exhaustion from an ordinary KV failure rather than treating every error the
 * same way.
 */
export function isKvQuotaError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429) return true;

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!message) return false;

  return QUOTA_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Read the counters for one binding, or for every tracked binding.
 *
 * Intended for tests and for an internal health/ops route. Reading is free —
 * it touches no KV.
 */
export function kvBudgetSnapshot(binding: string): KvBudgetSnapshot | null;
export function kvBudgetSnapshot(): KvBudgetSnapshot[];
export function kvBudgetSnapshot(
  binding?: string
): KvBudgetSnapshot | null | KvBudgetSnapshot[] {
  if (binding !== undefined) {
    const state = counters.get(binding);
    return state ? snapshotOf(binding, state) : null;
  }

  return Array.from(counters.entries(), ([name, state]) =>
    snapshotOf(name, state)
  );
}

/**
 * Clear counters — all bindings, or one.
 *
 * Used by tests to isolate cases. In a Worker there is no reason to call it:
 * the counting window should be the isolate's lifetime.
 */
export function resetKvBudget(binding?: string): void {
  if (binding === undefined) {
    counters.clear();
    bindingCapWarned = false;
    return;
  }
  counters.delete(binding);
}

/**
 * Emit at a level, degrading to `warn` when the logger has no `error`.
 *
 * `Logger` only guarantees `warn` (see index.ts). A quota signal that vanished
 * because a caller passed a warn-only stub would reproduce the exact failure
 * this module exists to end, so `error` degrades rather than no-ops. `info` is
 * routine and may be dropped.
 */
function emit(
  obs: Logger,
  level: 'info' | 'warn' | 'error',
  message: string,
  metadata: Record<string, unknown>
): void {
  if (level === 'info') {
    obs.info?.(message, metadata);
    return;
  }
  if (level === 'error' && obs.error) {
    obs.error(message, metadata);
    return;
  }
  obs.warn(message, metadata);
}

/**
 * Emit the loud, one-shot exhaustion signal.
 *
 * Logged at `error` even though the caller is about to swallow the failure —
 * that swallowing is the whole reason this signal has to exist. Fires once per
 * binding per isolate; ongoing exhaustion stays visible through the rollups,
 * which escalate to `error` while `quotaFailures > 0`.
 */
function logQuotaExhausted(
  obs: Logger,
  binding: string,
  state: BindingCounters,
  method: string,
  dailyWriteLimit: number
): void {
  emit(obs, 'error', 'kv-budget: KV rejected an operation on quota grounds', {
    signal: 'kv_quota_exhausted',
    method,
    dailyWriteLimit,
    ...snapshotOf(binding, state),
  });
}

/**
 * Emit the periodic write-rate rollup.
 *
 * Level escalates on what the numbers mean rather than logging everything at
 * one level, so an operator can alert on `warn`+ without also subscribing to
 * healthy traffic:
 *  - `error` — quota errors seen, or this isolate alone is already projecting
 *    past the daily cap
 *  - `warn`  — projecting past half the cap
 *  - `info`  — routine, and the record that lets the rate be reconstructed
 */
function logWriteRollup(
  obs: Logger,
  binding: string,
  state: BindingCounters,
  dailyWriteLimit: number
): void {
  const snapshot = snapshotOf(binding, state);
  const projected = snapshot.projectedDailyWrites;

  const overBudget = projected !== null && projected > dailyWriteLimit;
  const nearBudget = projected !== null && projected > dailyWriteLimit / 2;

  const metadata = {
    signal: 'kv_write_budget',
    dailyWriteLimit,
    dailyReadLimit: KV_FREE_TIER_DAILY_READS,
    ...snapshot,
  };

  if (state.quotaFailures > 0 || overBudget) {
    emit(
      obs,
      'error',
      'kv-budget: KV write rate exceeds the daily account allowance',
      metadata
    );
    return;
  }

  if (nearBudget) {
    emit(
      obs,
      'warn',
      'kv-budget: KV write rate approaching the daily allowance',
      metadata
    );
    return;
  }

  emit(obs, 'info', 'kv-budget: KV write rate', metadata);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

/**
 * Wrap a KV namespace so every operation it serves is counted.
 *
 * The wrapper is a transparent `Proxy`: it returns the caller's own type, so
 * it drops into anything that expects a `KVNamespace` without a cast, and it
 * changes no behaviour — results pass through untouched and errors are
 * re-thrown after being recorded. Consumers keep swallowing their KV failures
 * exactly as before; the difference is that the failure is now on the record.
 *
 * Proxying rather than reimplementing the interface is what keeps this free of
 * a `@cloudflare/workers-types` dependency and immune to KV gaining methods.
 *
 * @param kv - The namespace to instrument
 * @param options - Where to log, and which binding this is
 */
export function withKvBudget<T extends object>(
  kv: T,
  options: KvBudgetOptions
): T {
  const {
    obs,
    binding,
    rollupEveryWrites = DEFAULT_ROLLUP_EVERY_WRITES,
    dailyWriteLimit = KV_FREE_TIER_DAILY_WRITES,
  } = options;

  const state = countersFor(binding);

  // More distinct binding names than we are willing to track. Hand back the
  // namespace untouched rather than grow the map without bound — losing the
  // signal is preferable to leaking memory in every isolate.
  if (!state) {
    if (!bindingCapWarned) {
      bindingCapWarned = true;
      obs.warn('kv-budget: too many distinct KV bindings, counting disabled', {
        signal: 'kv_write_budget',
        binding,
        tracked: counters.size,
      });
    }
    return kv;
  }

  return new Proxy(kv, {
    get(target, prop) {
      // `target` as receiver, not the proxy: KV bindings are host objects and
      // their accessors must see the real object as `this`.
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;

      const method = typeof prop === 'string' ? prop : '';
      const fn = value as (...args: unknown[]) => unknown;

      const opClass: KvOpClass | null = READ_METHODS.has(method)
        ? 'read'
        : WRITE_METHODS.has(method)
          ? 'write'
          : null;

      if (!opClass) return fn.bind(target);

      return (...args: unknown[]): unknown => {
        // Attempts, not successes: a rejected write still tells you what this
        // code path asked the account to spend, and a rejected write is the
        // number you want when the answer is "more than the account had".
        if (opClass === 'read') {
          state.reads++;
        } else {
          state.writes++;
          if (state.writes - state.writesAtLastRollup >= rollupEveryWrites) {
            state.writesAtLastRollup = state.writes;
            logWriteRollup(obs, binding, state, dailyWriteLimit);
          }
        }

        const record = (error: unknown): never => {
          if (isKvQuotaError(error)) {
            state.quotaFailures++;
            if (!state.quotaLogged) {
              state.quotaLogged = true;
              logQuotaExhausted(obs, binding, state, method, dailyWriteLimit);
            }
          } else {
            state.otherFailures++;
          }
          throw error;
        };

        // A synchronous throw from a KV method would otherwise bypass counting
        // entirely, so both paths funnel through `record`.
        let result: unknown;
        try {
          result = fn.apply(target, args);
        } catch (error) {
          record(error);
        }

        return isPromiseLike(result) ? result.then(undefined, record) : result;
      };
    },
  });
}

/**
 * Instrument every KV binding on an env object in one call.
 *
 * Picks out own properties whose name ends in `_KV` and which look like a KV
 * namespace (callable `get` and `put`), and replaces each with a
 * {@link withKvBudget} wrapper labelled by its binding name. Anything else on
 * `env` is carried through by reference.
 *
 * Returns a shallow copy — `env` itself is never mutated, since in workerd it
 * is a host-provided object and writing to it is not guaranteed to stick.
 *
 * This is the adoption path worth taking: instrumenting at the env boundary
 * covers `VersionedCache`, `createKVSecondaryStorage`, `cacheSessionInKV` and
 * the rate limiter at once, because all four are handed their namespace from
 * here and none of them needs to change.
 *
 * @param env - Worker env / Hono `c.env`
 * @param options - Where to log, plus optional rollup and cap overrides
 */
export function instrumentKvBindings<T extends object>(
  env: T,
  options: Omit<KvBudgetOptions, 'binding'>
): T {
  const instrumented: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(env)) {
    const candidate = value as { get?: unknown; put?: unknown } | null;
    const isKvNamespace =
      key.endsWith('_KV') &&
      !!candidate &&
      typeof candidate === 'object' &&
      typeof candidate.get === 'function' &&
      typeof candidate.put === 'function';

    instrumented[key] = isKvNamespace
      ? withKvBudget(candidate as object, { ...options, binding: key })
      : value;
  }

  return instrumented as T;
}

/**
 * Hono middleware that instruments every KV binding for the whole worker.
 *
 * This is the intended adoption point, and it is one line:
 *
 * ```typescript
 * app.use('*', createKvBudgetMiddleware({ obs }));
 * ```
 *
 * Placed once in the worker factory it covers `VersionedCache`,
 * `createKVSecondaryStorage`, `cacheSessionInKV` and the rate limiter across
 * every worker, because all of them take their namespace from `c.env` and the
 * replacement is type-identical. None of those call sites changes, and none of
 * them stops swallowing its KV failures — they simply can no longer swallow
 * them unobserved.
 *
 * The context is typed structurally rather than as Hono's `Context` so this
 * package keeps its dependency list empty; the generic makes the result
 * assignable to `MiddlewareHandler` without a cast.
 */
export function createKvBudgetMiddleware(
  options: Omit<KvBudgetOptions, 'binding'>
) {
  return async <C extends { env: object }>(
    c: C,
    next: () => Promise<void>
  ): Promise<void> => {
    // `c.env` is absent in some unit-test contexts; nothing to instrument.
    if (c.env && typeof c.env === 'object') {
      c.env = instrumentKvBindings(c.env, options);
    }
    await next();
  };
}
