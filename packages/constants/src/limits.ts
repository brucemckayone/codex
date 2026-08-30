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

/**
 * Cache-Control presets (Codex-yf2fc).
 *
 * ONE vocabulary shared by the workers and by apps/web, so a route's caching
 * posture is a named decision rather than a hand-written header string. Each
 * value is a complete `Cache-Control` header value: a worker emits it with
 * `c.header('Cache-Control', CACHE_PRESETS.public)`, apps/web with
 * `setHeaders({ 'Cache-Control': CACHE_PRESETS.private })`.
 *
 * The six names, and what each one asserts about the RESPONSE BODY.
 *
 * VIEWER-INVARIANT — the body is identical for every viewer, so any shared
 * cache may store it and serve it to anyone for the freshness window. These
 * three differ only in HOW LONG, and the length is set by who is waiting for a
 * change to become visible:
 *
 * - `public` — 60s browser + CDN. A human may be looking at this page waiting
 *   for a publish to appear; see the bound below.
 * - `static` — 1h browser + CDN, plus a day of `stale-while-revalidate`.
 *   Documents read by CRAWLERS on their own cadence (the two sitemaps).
 * - `asset` — 1h browser, 24h CDN. Content-addressed bytes streamed through
 *   the R2 proxies, where the KEY changes when the bytes change.
 *
 * VIEWER-VARIANT — the body may differ per viewer, so no shared cache may
 * reuse a stored copy:
 *
 * - `per-viewer` — the body MAY differ per viewer. A shared cache may STORE
 *   it, but must revalidate with the origin before serving it to anyone.
 * - `private` — only the viewer's own browser may store it. No shared cache
 *   may hold a copy at all.
 * - `fresh` — nothing anywhere may store it, not even the browser's disk.
 *
 * THE TEST AN AUTHOR APPLIES IS VIEWER-INVARIANCE, NOT WINDOW LENGTH. What
 * licenses `public` / `static` / `asset` on a response is that every viewer
 * would receive the same bytes — never that the number looks small enough to
 * be harmless. A 60s shared window on a body that varies by viewer is the leak
 * this vocabulary exists to stop; a 24h shared window on a body that cannot
 * vary is not a leak at all. Ask "would two different viewers get the same
 * bytes?", not "is this window short?".
 *
 * Which auth levels may declare which preset is enforced by the procedure
 * types, NOT here. The short version: `auth: 'required' | 'worker' |
 * 'platform_owner'` may only be `private` or `fresh`; all three
 * viewer-invariant presets are open to `auth: 'none'`; and `auth: 'optional'`
 * may be `public` only alongside an explicit `variesBySession: false`, because
 * `optional` covers both routes that ignore the session entirely (the journeys
 * portal reads) and routes that branch on it, and no type can tell them apart.
 * Nothing declared at all means `private` — the safe reading is the default.
 *
 * THE 60s WINDOW ON `public` IS BOUNDED BY THE INVALIDATION MECHANISM, NOT BY
 * THE HIT RATE. Content freshness on this platform is event-driven: a publish
 * writes one KV version bump and every `VersionedCache` entry for that org
 * stales at once (see `public-cache.ts` for that contract). No such event can
 * reach a CDN or a browser — an HTTP cache can only expire on the clock. So a shared-cache
 * window is a window during which a publish is INVISIBLE, and it must not
 * outlive the mechanism that is supposed to make the publish visible. 60s is
 * the value content-api already chose on exactly these grounds; apps/web's
 * unused presets said 300s. 60s wins, and the deltas are recorded on the
 * presets below.
 *
 * THAT ARGUMENT ONLY BITES WHEN A HUMAN IS WAITING TO SEE THE CHANGE. It is
 * why `static` and `asset` carry far longer windows without contradicting the
 * paragraph above, and why neither is a licence to stretch `public`:
 *
 * - `static` is read by crawlers on their own cadence. A crawler that indexes
 *   yesterday's sitemap is the normal case, not a defect — nobody is refreshing
 *   the page wondering why the publish has not appeared. `stale-while-revalidate`
 *   is acceptable HERE and only here for the same reason: the extra day of
 *   staleness it licenses is a day of crawler traffic no human is watching. The
 *   leak-guard test pins it to this one preset.
 * - `asset` is content-addressed. The R2 key changes when the bytes change, so
 *   a stored copy can never go stale — it can only be superseded, by a request
 *   for a different key. There is no invisible-publish window to bound, which
 *   is what makes 24h at the edge defensible where 60s is the ceiling on
 *   `public`.
 *
 * An earlier version of this comment said the sitemap routes "keep their own
 * inline header and stay outside this vocabulary rather than stretching
 * `public`". That was a convention with nothing enforcing it, and
 * `scripts/checks/check-data-access-contract.mjs` disagreed with it the moment
 * it ran: a hand-written header is a value nobody can change centrally, however
 * good the prose beside it. The gate is right — what was incomplete was the
 * vocabulary, so the two windows are named here instead.
 *
 * Keys are the preset names EXACTLY as authors write them in a route
 * declaration, so `per-viewer` is hyphenated rather than SCREAMING_SNAKE like
 * the rate-limit presets — the string in the config and the key in this object
 * must be the same token, or the vocabulary has two spellings.
 */
export const CACHE_PRESETS = {
  /**
   * Public - the body does not vary by viewer (60s browser + CDN).
   *
   * Byte-identical to what `public.ts` and `journeys-cache.ts` already emit, so
   * adopting it there changes nothing. The 300s in apps/web's `DYNAMIC_PUBLIC`
   * is the value that loses: it was never emitted (that preset has no callers),
   * and 300s is five times the KV invalidation window it would be papering over.
   */
  public: 'public, max-age=60, s-maxage=60',

  /**
   * Static - viewer-invariant documents on a crawler's cadence (1h + 1d SWR).
   *
   * The two `sitemap.xml` routes (platform-wide and per-org) and any equivalent
   * document whose only readers are crawlers. Byte-identical to what the
   * platform sitemap and apps/web's `CACHE_HEADERS.STATIC_PUBLIC` already
   * emitted by hand.
   *
   * THE PER-ORG SITEMAP'S 1800s IS THE VALUE THAT LOSES, and its stated reason
   * ("org content churns faster") does not survive the crawler argument: a
   * crawler's own revisit interval is hours to days, so halving a 3600s edge
   * window changes nothing any crawler can observe while costing an extra
   * origin render per hit. One window, one decision.
   *
   * THE ONLY PRESET CARRYING `stale-while-revalidate`, and the leak guard in
   * `__tests__/cache-presets.test.ts` pins it to this name alone. It licenses a
   * shared cache to serve an already-expired body for a further 24h while it
   * refreshes behind the scenes — an extension of the invisible-publish window
   * with no purge path, which is precisely what `public` must never have. It is
   * safe here only because no human is waiting on this body.
   */
  static: 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',

  /**
   * Asset - content-addressed bytes through the R2 proxies (1h browser, 24h CDN).
   *
   * `apps/web/src/lib/server/cdn-proxy.ts` and the local `dev-cdn` worker, both
   * of which stream an R2 object straight through on a path that bypasses the
   * bucket's own custom-domain cache rule. Byte-identical to what cdn-proxy
   * already emitted; dev-cdn's `public, max-age=3600` gains the shared window,
   * which is inert locally (nothing shared sits in front of a dev worker) and
   * makes the two proxies one decision rather than two.
   *
   * THE 24x ASYMMETRY IS DELIBERATE, not a typo for 3600. The shared copy is
   * what bounds R2 egress cost, and there is no correctness argument on the
   * other side of that trade: the key encodes the bytes, so a stored copy is
   * never stale — new bytes are a new key and therefore a new cache entry, and
   * a superseded key is simply never requested again. Shortening `s-maxage` to
   * 3600 would make the CDN re-fetch from R2 24 times more often and buy
   * nothing.
   *
   * It also keeps the worker path consistent with the buckets' own declared
   * rule: `edgeTtl: 86400` / `browserTtl: 3600` for the production asset
   * buckets in `.github/config/r2-infrastructure.json`, so an object served
   * through here caches exactly as its bucket intends. The preview buckets
   * declare a shorter 3600/300 and the worker path has never distinguished
   * them; that predates this preset and is not changed by it.
   */
  asset: 'public, max-age=3600, s-maxage=86400',

  /**
   * Per-viewer - a shared cache may store it, but never reuse it blind.
   *
   * `no-cache` is doing the real work here: RFC 9111 lets a shared cache STORE
   * a `no-cache` response but forbids serving it to any other request without
   * forwarding that request to the origin for validation. That is precisely
   * "cacheable for anonymous visitors, revalidated per viewer" — an anonymous
   * burst can be absorbed as 304s, and a signed-in viewer always gets their own
   * body. `max-age=0` is belt-and-braces for an intermediary that honours only
   * the freshness directive.
   *
   * NOTE THE MISSING `s-maxage`, and do not put one back. apps/web's
   * `DYNAMIC_PUBLIC_REVALIDATE` was
   * `public, max-age=0, s-maxage=300, stale-while-revalidate=3600` (verified
   * against commit f65cf5e7 — quote it in full, because dropping the
   * `stale-while-revalidate` under-states it by the 3600s a shared cache was
   * additionally licensed to serve the expired body) and was REMOVED from the
   * platform landing page for leaking: `max-age=0` fixes only the browser half,
   * while `s-maxage=300` still lets the edge hand one viewer's stored render to
   * the next, because shared caches key on URL and NEVER on Cookie. CI caught it
   * deterministically — miniflare's CF cache emulation honours `s-maxage` for
   * HTML by URL key alone. See the comment at the top of
   * `apps/web/src/routes/(platform)/+page.server.ts`.
   */
  'per-viewer': 'public, max-age=0, no-cache',

  /**
   * Private - the viewer's own browser only (the default when nothing is said).
   *
   * Byte-identical to what apps/web's `CACHE_HEADERS.PRIVATE` already emitted,
   * so adopting it there changed no bytes on any response. (Deliberately no
   * count of that object's entries here — it is a list under active edit, and a
   * number stated from across a package boundary goes stale silently.)
   * `no-cache` rather than a `max-age` so the browser revalidates on
   * every navigation instead of re-rendering a stale auth state from its own
   * disk.
   */
  private: 'private, no-cache',

  /**
   * Fresh - never stored anywhere, by anyone.
   *
   * For bodies that are not merely per-viewer but per-REQUEST: the HLS playlists
   * in `content-access.ts` embed short-lived presigned URLs and a per-user
   * token, so a copy on the browser's own disk outlives the credential in it.
   * Byte-identical to what that route already emits.
   */
  fresh: 'private, no-store',
} as const;

/** The six preset names, as authors write them in a route declaration. */
export type CachePresetName = keyof typeof CACHE_PRESETS;

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
