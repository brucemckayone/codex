export const IP_ADDRESSES = {
  LOOPBACK: '127.0.0.1',
  ANY: '0.0.0.0',
} as const;

export const PAGINATION = {
  DEFAULT: 20,
  MAX: 100,
} as const;

export const FILE_SIZES = {
  LOGO_MAX_BYTES: 5 * 1024 * 1024, // 5MB
  IMAGE_MAX_BYTES: 5 * 1024 * 1024, // 5MB (for avatars, thumbnails, etc.)
  MEDIA_MAX_BYTES: 5 * 1024 * 1024 * 1024, // 5GB (video/audio uploads)
  MEDIA_MIN_BYTES: 1024, // 1KB minimum (reject empty/corrupt uploads)
} as const;

export const VIDEO_PROGRESS = {
  COMPLETION_THRESHOLD: 0.95, // 95%
} as const;

/**
 * Cloudflare's own published IP ranges (https://www.cloudflare.com/ips/).
 *
 * These are also the addresses a Worker's outbound `fetch()` egresses from, so
 * a `CF-Connecting-IP` inside one of them is NOT an end user — it is another
 * Worker (or a Cloudflare WARP client). Measured 2026-08-27: a single address
 * in `2a06:98c0::/29` was 34% of all zone traffic and 78% of traffic to the
 * auth host, because the SvelteKit login action calls the auth worker
 * server-side.
 *
 * Lives beside the rate-limit presets because it exists solely to keep an
 * untrustworthy transport address out of a rate-limit key (Codex-kgrdp.16).
 */
export const CLOUDFLARE_EGRESS_PREFIXES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

/**
 * Single greppable signal emitted on EVERY rate-limit fail-open.
 *
 * The KV limiter warned once and continued, which is why a completely
 * unenforced auth limiter sat in production unnoticed. Alert on this string.
 */
export const RATE_LIMIT_FAIL_OPEN_SIGNAL = 'rate_limit.fail_open';

/** Reasons a rate-limit check fell open. Every one is an operational fault. */
export const RATE_LIMIT_FAIL_OPEN_REASONS = {
  /** Preset wants the native binding but `env` has no binding bound. */
  MISSING_BINDING: 'missing-binding',
  /** Preset wants the Durable Object but `env` has no namespace bound. */
  MISSING_NAMESPACE: 'missing-namespace',
  /** The subject resolver could not name a subject it trusts. */
  NO_SUBJECT: 'no-subject',
  /** The store itself threw or timed out. */
  BACKEND_ERROR: 'backend-error',
} as const;

export type RateLimitFailOpenReason =
  (typeof RATE_LIMIT_FAIL_OPEN_REASONS)[keyof typeof RATE_LIMIT_FAIL_OPEN_REASONS];

/**
 * How many Durable Object instances the arbitrary-window store shards across.
 *
 * Bounded on purpose: one DO per subject would let attacker-supplied emails
 * mint unbounded instances whose expired rows nothing ever prunes. Sharding
 * means every call also GCs its shard.
 */
export const RATE_LIMIT_DO_SHARDS = 16;

/**
 * The only two `simple.period` values Cloudflare's Workers Rate Limiting
 * binding accepts. Anything else is rejected at deploy time.
 */
export const RATE_LIMIT_BINDING_PERIODS = [10, 60] as const;
export type RateLimitBindingPeriod =
  (typeof RATE_LIMIT_BINDING_PERIODS)[number];

/**
 * Rate limit presets (Codex-kgrdp.16 / .17 / .3).
 *
 * Two substrates, assigned per preset:
 *
 * - `binding` — Cloudflare's native Workers Rate Limiting binding. No storage
 *   billing and no read-modify-write, but `simple.period` must be EXACTLY 10
 *   or 60 seconds and `limit()` returns `{ success }` alone, so remaining/reset
 *   are unknowable and `X-RateLimit-Remaining` / `-Reset` cannot be emitted.
 *   Counters are per-Cloudflare-location and eventually consistent — the docs
 *   call the API "permissive". Acceptable for throttles.
 * - `durable-object` — SQLite-backed Durable Object. Arbitrary window, atomic
 *   increment, globally consistent per key, exact remaining/reset. Used for
 *   `AUTH`, whose 15-minute window the binding cannot express at all.
 *
 * `subjects` records which key kinds this preset may be counted on. It is
 * DOCUMENTATION, not an enforced whitelist — nothing reads it — and it is not a
 * default either: `rateLimit()` deliberately has no default key generator.
 * `credential` appears on `STREAMING` and `API` because two real mounts key on
 * a token rather than a session: the HLS proxy in content-api (the player
 * carries a short-lived query token, never a cookie) and `/unsubscribe/*` in
 * notifications-api (apps/web proxies both hops server-side, so the address is
 * a Cloudflare egress address and `trustedIpSubject()` correctly withholds it).
 * Anyone making this list enforceable must keep those two working. Keying a credential surface on `CF-Connecting-IP` collapsed every
 * user on the platform into one bucket because a worker-to-worker fetch puts
 * the CALLING worker's egress address in that header (Codex-kgrdp.16).
 *
 * `bindingName` is the canonical wrangler value: the `ratelimits` entry in each
 * worker's wrangler config MUST use it, and its `simple.limit` /
 * `simple.period` MUST match `maxRequests` / `periodSeconds` here — the
 * binding, not this file, is what the runtime enforces.
 *
 * There is deliberately NO canonical `namespace_id` here, because no single id
 * per preset can be correct. Two `ratelimits` entries sharing a namespace_id
 * share counters across the whole ACCOUNT, so a preset-wide id would let one
 * worker's traffic spend another's budget — and a browser action that fans out
 * to several workers would 429 at a fraction of the nominal rate — while an
 * env-wide id would let E2E traffic spend production's. That account-wide
 * coupling is the pathology this epic exists to remove. Ids are therefore
 * allocated PER WORKER AND PER ENV in the wrangler configs, on the scheme
 * documented there: env digit (1 dev, 2 test, 3 production) + two-digit worker
 * number from CLAUDE.md + preset digit (1 strict, 2 streaming, 3 api, 4 web).
 *
 * There is deliberately NO `webhook` preset. Stripe and RunPod webhooks are
 * HMAC-authenticated; a per-IP cap adds no security there and can only break a
 * legitimate retry burst (Codex-kgrdp.17).
 */
export const RATE_LIMIT_PRESETS = {
  /**
   * Auth - credential surfaces (5 requests per 15 minutes).
   *
   * Durable-Object-backed: 900s is not expressible on the binding. Counted on
   * the submitted credential, which is the subject actually under attack in
   * credential stuffing and is immune to egress collapse.
   */
  AUTH: {
    store: 'durable-object',
    subjects: ['credential', 'trusted-ip'],
    maxRequests: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    keyPrefix: 'rl:auth:',
  },

  /**
   * Strict - sensitive mutations, e.g. commerce writes (20 requests per minute)
   */
  STRICT: {
    store: 'binding',
    subjects: ['session', 'trusted-ip'],
    maxRequests: 20,
    periodSeconds: 60,
    bindingName: 'RATE_LIMIT_STRICT',
    keyPrefix: 'rl:strict:',
  },

  /**
   * Streaming - presigned URL generation (60 requests per minute).
   * Prevents abuse while allowing legitimate HLS segment refreshes.
   */
  STREAMING: {
    store: 'binding',
    subjects: ['session', 'credential', 'trusted-ip'],
    maxRequests: 60,
    periodSeconds: 60,
    bindingName: 'RATE_LIMIT_STREAMING',
    keyPrefix: 'rl:stream:',
  },

  /**
   * API - standard API endpoints (100 requests per minute)
   */
  API: {
    store: 'binding',
    subjects: ['session', 'credential', 'trusted-ip'],
    maxRequests: 100,
    periodSeconds: 60,
    bindingName: 'RATE_LIMIT_API',
    keyPrefix: 'rl:api:',
  },

  /**
   * Web - general web traffic (300 requests per minute)
   */
  WEB: {
    store: 'binding',
    subjects: ['session', 'trusted-ip'],
    maxRequests: 300,
    periodSeconds: 60,
    bindingName: 'RATE_LIMIT_WEB',
    keyPrefix: 'rl:web:',
  },
} as const;

export const TIMEOUTS = {
  DEFAULT_TEST: 10000,
  LONG_TEST: 60000,
} as const;

export const STREAMING = {
  DEFAULT_EXPIRY_SECONDS: 3600, // 1 hour
} as const;

export const R2_DEFAULTS = {
  MAX_RETRIES: 3,
  BASE_DELAY_MS: 100,
  MAX_DELAY_MS: 2000,
  MAX_EXPIRY_SECONDS: 604800, // 7 days (AWS limit)
} as const;

export const ANALYTICS = {
  TREND_DAYS_DEFAULT: 30,
  MAX_RANGE_DAYS: 365,
} as const;

export const CACHE_TTL = {
  BRAND_CACHE_SECONDS: 604800, // 7 days
  BRAND_CACHE_REFRESH_MS: 24 * 60 * 60 * 1000, // 24 hours
  ORG_PUBLIC_INFO_SECONDS: 30 * 60, // 30 minutes
} as const;
