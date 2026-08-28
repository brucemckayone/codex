/**
 * Rate limiting middleware
 *
 * Two substrates, one middleware (Codex-kgrdp.16 / .17 / .3):
 *
 * - `binding` presets run on Cloudflare's native Workers Rate Limiting binding.
 *   No storage billing, no read-modify-write. `simple.period` is only accepted
 *   as exactly 10 or 60 seconds and `limit()` returns `{ success }` alone, so
 *   `X-RateLimit-Remaining` / `-Reset` are unknowable and are NOT emitted.
 * - `durable-object` presets run on `RateLimitDO`, which gives an arbitrary
 *   window, an atomic increment and exact remaining/reset. The `auth` preset
 *   lives here because 5 requests per 15 minutes cannot be expressed on the
 *   binding at all.
 *
 * The KV store this replaced did `kv.get` then `kv.put` on every request: it
 * burned the 1,000 writes/day free budget, and being eventually consistent with
 * no atomic increment it undercounted a burst at the same time.
 *
 * There is NO default key generator. The previous default keyed on
 * `CF-Connecting-IP`, which on any surface reached by a worker-to-worker fetch
 * holds the CALLING worker's Cloudflare egress address rather than the user's —
 * collapsing every user on the platform into a single bucket. `subject` is a
 * required option, and `trustedIpSubject()` returns nothing at all when the
 * transport address is not trustworthy.
 */

import type { DurableObjectId, RateLimit } from '@cloudflare/workers-types';
import {
  CLOUDFLARE_EGRESS_PREFIXES,
  COOKIES,
  HEADERS,
  RATE_LIMIT_PRESETS as PRESETS,
  RATE_LIMIT_DO_SHARDS,
  RATE_LIMIT_FAIL_OPEN_REASONS,
  RATE_LIMIT_FAIL_OPEN_SIGNAL,
  type RateLimitFailOpenReason,
} from '@codex/constants';
import { type Logger, ObservabilityClient } from '@codex/observability';
import type { Context, Next } from 'hono';
import {
  limitViaDurableObject,
  type RateLimitDecision,
  type RateLimitNamespace,
} from './rate-limit-do';
import { extractSessionCookie } from './session-cookie';

const fallbackObs = new ObservabilityClient('rate-limit');

/**
 * Preset rate limit configurations.
 *
 * Deliberately no `webhook` preset: Stripe and RunPod webhooks are
 * HMAC-authenticated, so a per-IP cap adds no security and can only break a
 * legitimate retry burst.
 */
export const RATE_LIMIT_PRESETS = {
  /** Auth - credential surfaces (5 requests per 15 minutes, Durable Object) */
  auth: PRESETS.AUTH,

  /** Strict - sensitive mutations (20 requests per minute, binding) */
  strict: PRESETS.STRICT,

  /** Streaming - presigned URL generation (60 requests per minute, binding) */
  streaming: PRESETS.STREAMING,

  /** API - standard API endpoints (100 requests per minute, binding) */
  api: PRESETS.API,

  /** Web - general web traffic (300 requests per minute, binding) */
  web: PRESETS.WEB,
} as const;

export type RateLimitPresetName = keyof typeof RATE_LIMIT_PRESETS;

// ============================================================================
// Subjects — what the counter is keyed on
// ============================================================================

/**
 * What a rate-limit bucket counts.
 *
 * - `credential` — the submitted identifier (normalised email). The subject
 *   actually under attack in credential stuffing, and immune to egress
 *   collapse because it does not come from the transport at all.
 * - `session` — the authenticated user id. Correct for endpoints behind auth.
 * - `trusted-ip` — the transport address, and ONLY where it is trustworthy.
 *   See `trustedClientIp`.
 */
export type RateLimitSubjectKind = 'credential' | 'session' | 'trusted-ip';

export interface RateLimitSubject {
  kind: RateLimitSubjectKind;
  value: string;
}

/**
 * Names the subject(s) to count for a request.
 *
 * Returning `null` (or an empty array) means "no subject I trust" — the
 * limiter then fails open and says so loudly. Returning several subjects
 * charges each its own bucket and blocks if ANY is exhausted, which is how an
 * IP-keyed second signal rides alongside a credential-keyed primary.
 */
export type RateLimitSubjectResolver = (
  c: Context
) =>
  | RateLimitSubject
  | RateLimitSubject[]
  | null
  | Promise<RateLimitSubject | RateLimitSubject[] | null>;

// ============================================================================
// IP trust
// ============================================================================

/** Parse a dotted-quad into 4 bytes. */
function parseIpv4(input: string): Uint8Array | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (!part || !/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

/**
 * Parse an IPv6 literal into 16 bytes, expanding `::` and any embedded IPv4.
 * An IPv4-mapped address collapses to its 4 bytes so it matches IPv4 prefixes.
 */
function parseIpv6(input: string): Uint8Array | null {
  const bare = input.split('%')[0] ?? '';
  const halves = bare.split('::');
  if (halves.length > 2) return null;

  const expand = (side: string): number[] | null => {
    if (side === '') return [];
    const groups: number[] = [];
    const chunks = side.split(':');
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] ?? '';
      if (chunk.includes('.')) {
        // Embedded IPv4 is only legal as the final 32 bits.
        if (i !== chunks.length - 1) return null;
        const v4 = parseIpv4(chunk);
        if (!v4) return null;
        groups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0));
        groups.push(((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(chunk)) return null;
      groups.push(Number.parseInt(chunk, 16));
    }
    return groups;
  };

  const head = expand(halves[0] ?? '');
  const tail = halves.length === 2 ? expand(halves[1] ?? '') : [];
  if (!head || !tail) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const group = groups[i] ?? 0;
    bytes[i * 2] = (group >> 8) & 0xff;
    bytes[i * 2 + 1] = group & 0xff;
  }

  const isV4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  return isV4Mapped ? bytes.slice(12) : bytes;
}

function parseIp(input: string): Uint8Array | null {
  return input.includes(':') ? parseIpv6(input) : parseIpv4(input);
}

function ipInPrefix(address: Uint8Array, prefix: string): boolean {
  const [network, bitsRaw] = prefix.split('/');
  if (!network || !bitsRaw) return false;

  const networkBytes = parseIp(network);
  if (!networkBytes || networkBytes.length !== address.length) return false;

  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > address.length * 8) {
    return false;
  }

  const wholeBytes = bits >> 3;
  for (let i = 0; i < wholeBytes; i++) {
    if (address[i] !== networkBytes[i]) return false;
  }

  const spareBits = bits & 7;
  if (spareBits === 0) return true;

  const mask = (0xff << (8 - spareBits)) & 0xff;
  return (
    ((address[wholeBytes] ?? 0) & mask) ===
    ((networkBytes[wholeBytes] ?? 0) & mask)
  );
}

/**
 * True when the address belongs to Cloudflare itself — i.e. it is a Worker's
 * outbound egress address (or a WARP client), not an end user.
 */
export function isCloudflareEgressIp(address: string): boolean {
  const parsed = parseIp(address);
  if (!parsed) return false;
  return CLOUDFLARE_EGRESS_PREFIXES.some((prefix) =>
    ipInPrefix(parsed, prefix)
  );
}

/**
 * The client IP, but only when it can be believed.
 *
 * Returns null when the request arrived over a worker-to-worker hop, or when
 * `CF-Connecting-IP` is a Cloudflare address — in both cases the header holds
 * the calling worker's egress address, and keying on it merges unrelated users.
 *
 * `X-Forwarded-For` is never consulted: it is client-settable, so trusting it
 * would let an attacker both evade their own bucket and pin a bucket onto
 * someone else's address.
 */
export function trustedClientIp(c: Context): string | null {
  if (c.req.header(HEADERS.WORKER_SIGNATURE)) return null;

  const address = c.req.header('cf-connecting-ip');
  if (!address) return null;

  return isCloudflareEgressIp(address) ? null : address;
}

// ============================================================================
// Subject resolvers
// ============================================================================

/**
 * Read one field out of the request body without disturbing it.
 *
 * The body is read from a clone because the auth worker hands `c.req.raw`
 * straight to BetterAuth — consuming the original would deliver it an empty
 * body. A malformed body yields null: the downstream validator will reject the
 * request anyway, and null makes the limiter announce that it could not key.
 */
async function readBodyField(
  c: Context,
  field: string
): Promise<string | null> {
  const request = c.req.raw;
  if (!request.body) return null;

  const contentType = request.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('json')) {
      const parsed = (await request.clone().json()) as Record<
        string,
        unknown
      > | null;
      const value = parsed?.[field];
      return typeof value === 'string' ? value : null;
    }

    if (contentType.includes('form')) {
      const value = (await request.clone().formData()).get(field);
      return typeof value === 'string' ? value : null;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Count against the submitted credential — the subject actually under attack.
 *
 * Normalised (trimmed, lower-cased) so casing cannot mint fresh buckets, then
 * hashed before it reaches any store or log.
 */
export function credentialSubject(field = 'email'): RateLimitSubjectResolver {
  return async (c) => {
    const raw = await readBodyField(c, field);
    if (!raw) return null;
    const value = raw.trim().toLowerCase();
    return value ? { kind: 'credential', value } : null;
  };
}

/** Count against the authenticated user id. Requires an auth middleware first. */
export function sessionSubject(): RateLimitSubjectResolver {
  return (c) => {
    const user = c.get('user') as { id?: unknown } | undefined;
    return typeof user?.id === 'string'
      ? { kind: 'session', value: user.id }
      : null;
  };
}

/**
 * Count against the session token the caller PRESENTED, before auth has run.
 *
 * `sessionSubject()` reads `c.get('user')`, which only exists after an auth
 * middleware (or `procedure()`) has populated it. A limiter mounted ahead of
 * that — the usual shape for `app.use('/api/*', ...)` — would therefore name
 * nothing on every request and announce a fail-open per call, drowning the
 * signal that exists to catch a genuinely dead backend.
 *
 * The forwarded cookie is the same identity one step earlier: apps/web puts it
 * on every server-side call (`buildAuthForwardingCookie`), and the middleware
 * SHA-256s the value before it reaches a bucket key or a log line.
 *
 * The value is attacker-chosen, so an UNAUTHENTICATED caller can mint a fresh
 * bucket per request. Pair it with `trustedIpSubject()`, which covers a direct
 * hit on a public custom domain, where the address genuinely is the caller's.
 */
export function presentedSessionSubject(
  cookieName: string = COOKIES.SESSION_NAME
): RateLimitSubjectResolver {
  return (c) => {
    const token = extractSessionCookie(c.req.header('cookie'), cookieName);
    return token ? { kind: 'session', value: token } : null;
  };
}

/** Count against the transport address, and only where it is trustworthy. */
export function trustedIpSubject(): RateLimitSubjectResolver {
  return (c) => {
    const address = trustedClientIp(c);
    return address ? { kind: 'trusted-ip', value: address } : null;
  };
}

/**
 * Charge every resolver that names a subject its own bucket, and block if ANY
 * of them is exhausted. Resolvers that name nothing simply drop out.
 */
export function combineSubjects(
  ...resolvers: RateLimitSubjectResolver[]
): RateLimitSubjectResolver {
  return async (c) => {
    const subjects: RateLimitSubject[] = [];
    for (const resolve of resolvers) {
      const resolved = await resolve(c);
      if (!resolved) continue;
      if (Array.isArray(resolved)) subjects.push(...resolved);
      else subjects.push(resolved);
    }
    return subjects;
  };
}

// ============================================================================
// Middleware
// ============================================================================

export interface RateLimitOptions<Id = DurableObjectId> {
  /** Which preset to enforce. The preset owns the window and the store. */
  preset: RateLimitPresetName;

  /**
   * REQUIRED. What to count. There is no default — an implicit IP default is
   * exactly how every user on the platform ended up sharing one bucket.
   */
  subject: RateLimitSubjectResolver;

  /** Native Workers Rate Limiting binding. Required by `binding` presets. */
  binding?: RateLimit;

  /** `RateLimitDO` namespace. Required by `durable-object` presets. */
  namespace?: RateLimitNamespace<Id>;

  /** Overrides the preset's bucket prefix. Rarely needed. */
  keyPrefix?: string;

  /** Logger for the fail-open signal. Defaults to `c.get('obs')`. */
  obs?: Logger;

  /** Skip the check entirely for certain requests. */
  skip?: (c: Context) => boolean | Promise<boolean>;

  /** Replaces the default 429 response. */
  handler?: (
    c: Context,
    decision: RateLimitDecision
  ) => Response | Promise<Response>;
}

/**
 * Announce that the limiter did not run.
 *
 * Fail-open is deliberate (an unavailable backend must not take sign-in down),
 * but the KV limiter failed open on a `warn` that nobody ever saw, which is the
 * whole reason this substrate exists. Every fail-open carries
 * `RATE_LIMIT_FAIL_OPEN_SIGNAL` at error level so it is alertable. Subject
 * values are never included — only their kind.
 */
function announceFailOpen(
  log: Logger,
  c: Context,
  preset: RateLimitPresetName,
  reason: RateLimitFailOpenReason,
  detail?: Record<string, unknown>
): void {
  const message = `${RATE_LIMIT_FAIL_OPEN_SIGNAL}: ${preset} unenforced (${reason})`;
  const metadata = {
    signal: RATE_LIMIT_FAIL_OPEN_SIGNAL,
    preset,
    reason,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    ...detail,
  };

  if (log.error) log.error(message, metadata);
  else log.warn(message, metadata);
}

/**
 * Bucket key: `<prefix><kind>:<sha256 prefix>`.
 *
 * Hashed so a credential never lands in a store key, a log line or the
 * binding's key space, and so keys stay a bounded length whatever the subject.
 */
async function bucketKey(
  prefix: string,
  subject: RateLimitSubject
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${prefix}${subject.kind}:${subject.value}`)
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}${subject.kind}:${hex.slice(0, 32)}`;
}

/**
 * The binding reports only `{ success }` — no remaining, no reset. Those are
 * reported as null rather than guessed, and `retryAfterSeconds` falls back to
 * the full period, which is the correct upper bound for a fixed window.
 */
async function limitViaBinding(
  binding: RateLimit,
  bucket: string,
  limit: number,
  periodSeconds: number
): Promise<RateLimitDecision> {
  const { success } = await binding.limit({ key: bucket });
  return {
    success,
    limit,
    remaining: null,
    resetAt: null,
    retryAfterSeconds: periodSeconds,
  };
}

/**
 * Hono middleware for rate limiting.
 *
 * @example
 * ```ts
 * // Credential surface: keyed on the submitted email, with the IP as a
 * // second signal only where the IP can be believed.
 * app.use('/api/auth/sign-in/email', rateLimit({
 *   preset: 'auth',
 *   namespace: c.env.RATE_LIMIT_DO,
 *   subject: combineSubjects(credentialSubject(), trustedIpSubject()),
 * }));
 *
 * // Throttle behind auth: keyed on the user, not the transport.
 * app.use('/api/*', rateLimit({
 *   preset: 'api',
 *   binding: c.env.RATE_LIMIT_API,
 *   subject: combineSubjects(sessionSubject(), trustedIpSubject()),
 * }));
 * ```
 */
export function rateLimit<Id = DurableObjectId>(
  options: RateLimitOptions<Id>
): (c: Context, next: Next) => Promise<Response | undefined> {
  const {
    preset: presetName,
    subject,
    binding,
    namespace,
    keyPrefix,
    obs,
    skip,
    handler,
  } = options;

  const preset = RATE_LIMIT_PRESETS[presetName];
  const prefix = keyPrefix ?? preset.keyPrefix;

  return async (c: Context, next: Next): Promise<Response | undefined> => {
    if (skip && (await skip(c))) {
      await next();
      return undefined;
    }

    const log = obs ?? (c.get('obs') as Logger | undefined) ?? fallbackObs;

    if (preset.store === 'binding' && !binding) {
      announceFailOpen(
        log,
        c,
        presetName,
        RATE_LIMIT_FAIL_OPEN_REASONS.MISSING_BINDING,
        { expectedBinding: preset.bindingName }
      );
      await next();
      return undefined;
    }

    if (preset.store === 'durable-object' && !namespace) {
      announceFailOpen(
        log,
        c,
        presetName,
        RATE_LIMIT_FAIL_OPEN_REASONS.MISSING_NAMESPACE
      );
      await next();
      return undefined;
    }

    const resolved = await subject(c);
    const subjects = resolved
      ? Array.isArray(resolved)
        ? resolved
        : [resolved]
      : [];

    if (subjects.length === 0) {
      announceFailOpen(
        log,
        c,
        presetName,
        RATE_LIMIT_FAIL_OPEN_REASONS.NO_SUBJECT
      );
      await next();
      return undefined;
    }

    // Every subject gets its own bucket; the request is blocked if any one of
    // them is exhausted. Where remaining is knowable, the headers report the
    // tightest of the surviving budgets.
    let blocked: RateLimitDecision | null = null;
    let tightest: RateLimitDecision | null = null;

    for (const item of subjects) {
      const bucket = await bucketKey(prefix, item);

      let decision: RateLimitDecision;
      try {
        decision =
          preset.store === 'binding'
            ? await limitViaBinding(
                binding as RateLimit,
                bucket,
                preset.maxRequests,
                preset.periodSeconds
              )
            : await limitViaDurableObject(
                namespace as RateLimitNamespace<Id>,
                bucket,
                { windowMs: preset.windowMs, maxRequests: preset.maxRequests },
                RATE_LIMIT_DO_SHARDS
              );
      } catch (error) {
        announceFailOpen(
          log,
          c,
          presetName,
          RATE_LIMIT_FAIL_OPEN_REASONS.BACKEND_ERROR,
          {
            subjectKind: item.kind,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        await next();
        return undefined;
      }

      if (!decision.success) {
        blocked = decision;
        break;
      }

      if (
        decision.remaining !== null &&
        (tightest?.remaining == null || decision.remaining < tightest.remaining)
      ) {
        tightest = decision;
      }
    }

    const reported = blocked ?? tightest;

    // The binding cannot produce these — nothing in apps/web reads them, so
    // binding-backed presets emit none rather than a fabricated number.
    if (reported && reported.remaining !== null && reported.resetAt !== null) {
      c.header('X-RateLimit-Limit', reported.limit.toString());
      c.header('X-RateLimit-Remaining', reported.remaining.toString());
      c.header(
        'X-RateLimit-Reset',
        Math.floor(reported.resetAt / 1000).toString()
      );
    }

    if (blocked) {
      if (handler) return handler(c, blocked);

      const retryAfter = blocked.retryAfterSeconds;
      return c.json(
        {
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        429,
        { 'Retry-After': retryAfter.toString() }
      );
    }

    await next();
    return undefined;
  };
}
