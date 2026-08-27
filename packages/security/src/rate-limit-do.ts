/**
 * Rate Limit Durable Object (SQLite-backed)
 *
 * The arbitrary-window half of the rate-limit substrate (Codex-kgrdp.17).
 *
 * Cloudflare's native Workers Rate Limiting binding only accepts a
 * `simple.period` of exactly 10 or 60 seconds, so the `auth` preset — 5
 * requests per 15 MINUTES — is not expressible on it at all. This DO supplies
 * what the binding cannot: an arbitrary window, an atomic increment, and global
 * consistency per key. It also knows the exact remaining count and window end,
 * so `X-RateLimit-*` stay accurate on the presets that run here.
 *
 * SQLite backend (`new_sqlite_classes` in wrangler) because that is the only
 * Durable Object backend the free plan supports. Follows the existing
 * `OrphanedFileCleanupDO` pattern in workers/media-api: `implements
 * DurableObject`, schema created under `blockConcurrencyWhile`, HTTP-addressed
 * via `fetch`.
 *
 * Sharded, not one-DO-per-key: attacker-supplied credentials would otherwise
 * mint unbounded instances whose expired rows nothing ever prunes. With a
 * bounded shard count every call also GCs its own shard.
 */

import type {
  DurableObject,
  DurableObjectState,
} from '@cloudflare/workers-types';
import { RATE_LIMIT_DO_SHARDS } from '@codex/constants';

/**
 * Synthetic origin for the DO stub fetch.
 *
 * Never routed and never resolved — a stub fetch just needs a syntactically
 * valid URL and only the pathname is read on the other side. This is not a
 * service address, so `getServiceUrl` does not apply.
 */
const DO_INTERNAL_ORIGIN = 'https://rate-limit.durable-object.internal';

/** How often an instance sweeps expired rows out of its shard. */
const PRUNE_INTERVAL_MS = 60_000;

/**
 * Outcome of one rate-limit check.
 *
 * `remaining` / `resetAt` are only meaningful for the Durable Object store.
 * The native binding returns `{ success }` alone, so its decisions report
 * `remaining: null` / `resetAt: null` and callers must not synthesise them.
 */
export interface RateLimitDecision {
  /** False when the budget for this window is exhausted. */
  success: boolean;
  /** The configured ceiling for the window. */
  limit: number;
  /** Requests left in the window, or null when the store cannot know. */
  remaining: number | null;
  /** Epoch ms when the window rolls over, or null when the store cannot know. */
  resetAt: number | null;
  /** Seconds a client should wait before retrying. */
  retryAfterSeconds: number;
}

/** Window configuration for a single check. */
export interface RateLimitWindow {
  windowMs: number;
  maxRequests: number;
}

/**
 * Minimal stub surface the store needs. Satisfied by `DurableObjectStub`.
 *
 * Deliberately expressed WITHOUT the ambient `Request` / `Response` globals.
 * Every worker compiles with `lib: ["ES2022", "WebWorker"]` AND
 * `types: ["@cloudflare/workers-types"]`, which declare colliding `Request` /
 * `Headers`; a public `.d.ts` referencing those globals resolves to a
 * different type in the consumer than `DurableObjectStub.fetch` provides, and
 * the namespace stops being assignable (`Headers` is missing `getAll`). Naming
 * only the members the store actually uses keeps this a structural contract,
 * which is what the doc always claimed it was — and it stays satisfiable by a
 * plain object in a test.
 */
export interface RateLimitStubResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface RateLimitStub {
  fetch(
    url: string,
    init: { method: string; body: string }
  ): Promise<RateLimitStubResponse>;
}

/**
 * Minimal namespace surface the store needs. Satisfied by
 * `DurableObjectNamespace`; `Id` is left open so tests can supply a fake.
 */
export interface RateLimitNamespace<Id = unknown> {
  idFromName(name: string): Id;
  get(id: Id): RateLimitStub;
}

interface WindowRow extends Record<string, string | number | null> {
  hits: number;
  window_start_ms: number;
  expires_at_ms: number;
}

interface LimitRequestBody {
  bucket?: unknown;
  windowMs?: unknown;
  maxRequests?: unknown;
}

/**
 * FNV-1a 32-bit. Only used to spread already-hashed bucket keys across a fixed
 * number of shards — not a security primitive.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Which shard a bucket belongs to. Exported so the DO and its callers cannot
 * drift on the mapping.
 */
export function rateLimitShardName(
  bucket: string,
  shards: number = RATE_LIMIT_DO_SHARDS
): string {
  const count = shards > 0 ? shards : 1;
  return `rl-shard-${fnv1a32(bucket) % count}`;
}

/**
 * Run one rate-limit check against the Durable Object store.
 *
 * Throws if the DO is unreachable — the caller owns the fail-open decision and
 * the observability signal that goes with it.
 */
export async function limitViaDurableObject<Id>(
  namespace: RateLimitNamespace<Id>,
  bucket: string,
  window: RateLimitWindow,
  shards: number = RATE_LIMIT_DO_SHARDS
): Promise<RateLimitDecision> {
  const stub = namespace.get(
    namespace.idFromName(rateLimitShardName(bucket, shards))
  );

  // URL + init rather than a constructed Request: see `RateLimitStub`. The
  // stub's own fetch accepts a string input, so nothing is lost.
  const response = await stub.fetch(`${DO_INTERNAL_ORIGIN}/limit`, {
    method: 'POST',
    body: JSON.stringify({
      bucket,
      windowMs: window.windowMs,
      maxRequests: window.maxRequests,
    }),
  });

  if (!response.ok) {
    throw new Error(`rate-limit DO responded ${response.status}`);
  }

  return (await response.json()) as RateLimitDecision;
}

/**
 * Fixed-window counter over SQLite, one row per bucket.
 *
 * Read-modify-write is atomic here in a way the KV limiter never was: a
 * Durable Object serialises its own events, and `transactionSync` wraps the
 * select + update so a concurrent burst cannot undercount.
 */
export class RateLimitDO implements DurableObject {
  private state: DurableObjectState;
  private nextPruneAtMs = 0;

  constructor(state: DurableObjectState) {
    this.state = state;

    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS rate_limit_windows (
           bucket TEXT PRIMARY KEY,
           hits INTEGER NOT NULL,
           window_start_ms INTEGER NOT NULL,
           expires_at_ms INTEGER NOT NULL
         )`
      );
      this.state.storage.sql.exec(
        `CREATE INDEX IF NOT EXISTS rate_limit_windows_expiry
           ON rate_limit_windows (expires_at_ms)`
      );
    });
  }

  /**
   * HTTP handler.
   *
   * POST /limit - consume one request from a bucket's budget
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'POST' || url.pathname !== '/limit') {
      return new Response('Not Found', { status: 404 });
    }

    const body = (await request
      .json()
      .catch(() => null)) as LimitRequestBody | null;

    const bucket = typeof body?.bucket === 'string' ? body.bucket : null;
    const windowMs = typeof body?.windowMs === 'number' ? body.windowMs : null;
    const maxRequests =
      typeof body?.maxRequests === 'number' ? body.maxRequests : null;

    if (!bucket || !windowMs || windowMs <= 0 || !maxRequests) {
      return new Response(
        JSON.stringify({ error: 'bucket, windowMs and maxRequests required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const decision = this.consume(bucket, { windowMs, maxRequests });

    return new Response(JSON.stringify(decision), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Increment a bucket and decide. Starts a fresh window when the stored one
   * has expired, so the window is fixed rather than sliding — the same shape
   * the native binding uses, and the shape the presets are written against.
   */
  private consume(bucket: string, window: RateLimitWindow): RateLimitDecision {
    const now = Date.now();
    const { windowMs, maxRequests } = window;

    const { hits, expiresAtMs } = this.state.storage.transactionSync(() => {
      const sql = this.state.storage.sql;
      const existing = sql
        .exec<WindowRow>(
          `SELECT hits, window_start_ms, expires_at_ms
             FROM rate_limit_windows WHERE bucket = ?`,
          bucket
        )
        .toArray()[0];

      if (!existing || existing.expires_at_ms <= now) {
        const expiresAt = now + windowMs;
        sql.exec(
          `INSERT INTO rate_limit_windows
             (bucket, hits, window_start_ms, expires_at_ms)
             VALUES (?, 1, ?, ?)
           ON CONFLICT(bucket) DO UPDATE SET
             hits = 1,
             window_start_ms = excluded.window_start_ms,
             expires_at_ms = excluded.expires_at_ms`,
          bucket,
          now,
          expiresAt
        );
        return { hits: 1, expiresAtMs: expiresAt };
      }

      // Cap the stored counter one past the ceiling. Everything above that is
      // indistinguishable for the decision, and not storing it keeps a
      // sustained attack from growing the integer for the whole window.
      const hitCount = Math.min(existing.hits + 1, maxRequests + 1);
      sql.exec(
        'UPDATE rate_limit_windows SET hits = ? WHERE bucket = ?',
        hitCount,
        bucket
      );
      return { hits: hitCount, expiresAtMs: existing.expires_at_ms };
    });

    this.pruneIfDue(now);

    return {
      success: hits <= maxRequests,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - hits),
      resetAt: expiresAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - now) / 1000)),
    };
  }

  /**
   * Sweep expired rows out of this shard at most once a minute. Rows carry
   * their own expiry so a shard holding several presets prunes correctly.
   */
  private pruneIfDue(now: number): void {
    if (now < this.nextPruneAtMs) return;
    this.nextPruneAtMs = now + PRUNE_INTERVAL_MS;
    this.state.storage.sql.exec(
      'DELETE FROM rate_limit_windows WHERE expires_at_ms <= ?',
      now
    );
  }
}
