import type { KVNamespace } from '@cloudflare/workers-types';
import type { Context, Next } from 'hono';

export interface RateLimitOptions {
  /**
   * Cloudflare KV namespace for storing rate limit data
   * If not provided, falls back to in-memory (not recommended for production)
   */
  kv?: KVNamespace;

  /**
   * Time window in milliseconds (default: 60000 = 1 minute)
   */
  windowMs?: number;

  /**
   * Maximum number of requests per window (default: 100)
   */
  maxRequests?: number;

  /**
   * Key prefix for KV storage (default: "rl:")
   */
  keyPrefix?: string;

  /**
   * Custom key generator (default: uses CF-Connecting-IP)
   */
  keyGenerator?: (c: Context) => string;

  /**
   * Custom handler when rate limit is exceeded
   */
  handler?: (c: Context) => Response | Promise<Response>;

  /**
   * Skip rate limiting for certain requests
   */
  skip?: (c: Context) => boolean | Promise<boolean>;
}

/**
 * In-memory fallback (NOT recommended for production multi-instance deployments)
 * Only use this for local development or single-instance workers
 */
class InMemoryStore {
  private store = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || existing.resetAt < now) {
      // Start new window
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }

    // Increment existing window
    existing.count++;
    this.store.set(key, existing);

    // Cleanup old entries (prevent memory leak)
    if (this.store.size > 10000) {
      for (const [k, v] of this.store.entries()) {
        if (v.resetAt < now) {
          this.store.delete(k);
        }
      }
    }

    return existing.count;
  }

  async getReset(key: string): Promise<number | null> {
    const existing = this.store.get(key);
    return existing?.resetAt ?? null;
  }
}

/**
 * KV-based rate limiting (recommended for production)
 */
class KVStore {
  constructor(
    private kv: KVNamespace,
    private keyPrefix: string
  ) {}

  async increment(key: string, windowMs: number): Promise<number> {
    const kvKey = `${this.keyPrefix}${key}`;
    const now = Date.now();

    // Try to get existing value
    const existing = await this.kv.get<{ count: number; resetAt: number }>(
      kvKey,
      'json'
    );

    if (!existing || existing.resetAt < now) {
      // Start new window
      const newValue = { count: 1, resetAt: now + windowMs };
      await this.kv.put(kvKey, JSON.stringify(newValue), {
        expirationTtl: Math.ceil(windowMs / 1000), // Convert ms to seconds
      });
      return 1;
    }

    // Increment existing window
    const newValue = { count: existing.count + 1, resetAt: existing.resetAt };
    await this.kv.put(kvKey, JSON.stringify(newValue), {
      expirationTtl: Math.max(60, Math.ceil((existing.resetAt - now) / 1000)),
    });

    return newValue.count;
  }

  async getReset(key: string): Promise<number | null> {
    const kvKey = `${this.keyPrefix}${key}`;
    const existing = await this.kv.get<{ count: number; resetAt: number }>(
      kvKey,
      'json'
    );
    return existing?.resetAt ?? null;
  }
}

/**
 * Default key generator using Cloudflare's CF-Connecting-IP header
 */
function defaultKeyGenerator(c: Context): string {
  // Cloudflare provides real IP in CF-Connecting-IP header
  const ip =
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for') ||
    'unknown';
  const route = new URL(c.req.url).pathname;
  return `${ip}:${route}`;
}

/**
 * Hono middleware for rate limiting
 *
 * Uses Cloudflare KV for distributed rate limiting across worker instances.
 * Falls back to in-memory storage if KV is not provided (not recommended for production).
 *
 * @example
 * ```ts
 * // In wrangler.jsonc
 * // [[kv_namespaces]]
 * // binding = "RATE_LIMIT_KV"
 * // id = "your-kv-namespace-id"
 *
 * import { rateLimit } from '@codex/security';
 *
 * // Apply to all routes
 * app.use('*', rateLimit({
 *   kv: c.env.RATE_LIMIT_KV,
 *   windowMs: 60000, // 1 minute
 *   maxRequests: 100
 * }));
 *
 * // Or apply to specific routes
 * const loginLimiter = rateLimit({
 *   kv: c.env.RATE_LIMIT_KV,
 *   windowMs: 900000, // 15 minutes
 *   maxRequests: 5
 * });
 *
 * app.post('/login', loginLimiter, async (c) => {
 *   // ... login logic
 * });
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const {
    kv,
    windowMs = 60000,
    maxRequests = 100,
    keyPrefix = 'rl:',
    keyGenerator = defaultKeyGenerator,
    handler,
    skip,
  } = options;

  // Choose store based on KV availability
  const store = kv ? new KVStore(kv, keyPrefix) : new InMemoryStore();

  if (!kv) {
    console.warn(
      '[RateLimit] Using in-memory store (not recommended for production). ' +
        'Bind a KV namespace for distributed rate limiting.'
    );
  }

  return async (c: Context, next: Next) => {
    // Skip rate limiting if skip function returns true
    if (skip && (await skip(c))) {
      return next();
    }

    // Generate key for this request
    const key = keyGenerator(c);

    // Increment counter
    const count = await store.increment(key, windowMs);

    // Get reset time
    const resetAt = await store.getReset(key);

    // Add rate limit headers
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header(
      'X-RateLimit-Remaining',
      Math.max(0, maxRequests - count).toString()
    );
    if (resetAt) {
      c.header('X-RateLimit-Reset', Math.floor(resetAt / 1000).toString());
    }

    // Check if limit exceeded
    if (count > maxRequests) {
      if (handler) {
        return handler(c);
      }

      const retryAfter = resetAt
        ? Math.ceil((resetAt - Date.now()) / 1000)
        : Math.ceil(windowMs / 1000);

      return c.json(
        {
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        429,
        {
          'Retry-After': retryAfter.toString(),
        }
      );
    }

    // Proceed with request
    await next();
  };
}

/**
 * Preset rate limit configurations
 */
export const RATE_LIMIT_PRESETS = {
  /**
   * Auth - for authentication endpoints (5 requests per 15 minutes)
   */
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
  },

  /**
   * Strict - for sensitive operations like streaming URLs (20 requests per minute)
   */
  strict: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 20,
  },

  /**
   * Streaming - for presigned URL generation (60 requests per minute)
   * Prevents abuse while allowing legitimate HLS segment refreshes
   */
  streaming: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60,
    keyPrefix: 'rl:stream:',
  },

  /**
   * API - for standard API endpoints (100 requests per minute)
   */
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100,
  },

  /**
   * Webhook - for webhooks (1000 requests per minute)
   */
  webhook: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 1000,
  },

  /**
   * Web - for general web traffic (300 requests per minute)
   */
  web: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 300,
  },
};
