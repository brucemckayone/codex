/**
 * Short-lived HMAC tokens for HLS playlist proxy authentication.
 *
 * WP-14 (Codex-fc5oh.14) — prod HLS streaming auth.
 *
 * `ContentAccessService.getStreamingUrl` runs the full (revocation + DB
 * transactional) access check ONCE, then mints one of these tokens and embeds
 * it in the master-playlist proxy URL. The master/variant proxy routes verify
 * the token instead of re-running the DB access check on every playlist fetch,
 * and the token's payload carries `creatorId` + `mediaId` so the proxies can
 * build R2 keys with NO database round-trip.
 *
 * Token format: `base64url(JSON payload).base64url(HMAC-SHA256(payload))`.
 *
 * The payload BINDS the token to a single media item (`creatorId`, `mediaId`)
 * so a token minted for one piece of content cannot be replayed against
 * another. `exp` (epoch seconds) bounds the lifetime — once expired the token
 * is rejected, mirroring the presigned-URL TTL exposure-after-revocation
 * control that the master URL itself no longer carries.
 *
 * Uses Web Crypto (`crypto.subtle`) — same primitive and secret-loading style
 * as worker-to-worker HMAC auth (`@codex/security` `generateWorkerSignature`)
 * — so it runs unchanged in the Cloudflare Workers runtime.
 */

/**
 * Decoded HLS token payload. Carries exactly what the proxy routes need to
 * build R2 keys without a DB hit.
 */
export interface HlsTokenPayload {
  /** Media item owner — first segment of the R2 HLS key. */
  creatorId: string;
  /** Media item UUID — identifies the HLS output tree in R2. */
  mediaId: string;
  /** Expiry as epoch SECONDS (not ms). Token is invalid once `now >= exp`. */
  exp: number;
}

const textEncoder = new TextEncoder();

/** base64url-encode a UTF-8 string (RFC 4648 §5 — URL-safe, no padding). */
function base64UrlEncodeString(value: string): string {
  return base64UrlFromBytes(textEncoder.encode(value));
}

/** base64url-encode raw bytes. */
function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode a base64url string back to a UTF-8 string. */
function base64UrlDecodeToString(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Constant-time string comparison to prevent timing attacks on signature
 * verification. Mirrors the internal helper in `@codex/security` worker-auth
 * (which is not exported). Always iterates the full length so the comparison
 * duration does not leak where the strings diverge.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = textEncoder.encode(a);
  const bufB = textEncoder.encode(b);

  if (bufA.byteLength !== bufB.byteLength) {
    let _diff = 1;
    const maxLen = Math.max(bufA.byteLength, bufB.byteLength);
    for (let i = 0; i < maxLen; i++) {
      _diff |=
        (bufA[i % (bufA.byteLength || 1)] ?? 0) ^
        (bufB[i % (bufB.byteLength || 1)] ?? 0);
    }
    return false;
  }

  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSha256Base64Url(
  message: string,
  secret: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(message)
  );
  return base64UrlFromBytes(new Uint8Array(signature));
}

/**
 * Mint a short-lived HLS proxy token bound to a single media item.
 *
 * @param payload - `{ creatorId, mediaId, exp }`. `exp` is epoch SECONDS.
 * @param secret - HMAC signing secret (worker env-injected).
 * @returns `base64url(json).base64url(hmac)` token string.
 */
export async function signHlsToken(
  payload: HlsTokenPayload,
  secret: string
): Promise<string> {
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await hmacSha256Base64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verify an HLS proxy token and return its payload, or `null` when the token
 * is malformed, tampered (signature mismatch), or expired.
 *
 * Never throws — callers map a `null` result to HTTP 403.
 *
 * @param token - Token string from the request query.
 * @param secret - HMAC signing secret (must match the minting secret).
 * @param nowSeconds - Current time in epoch seconds (injectable for tests).
 */
export async function verifyHlsToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<HlsTokenPayload | null> {
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex === token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, dotIndex);
  const providedSignature = token.slice(dotIndex + 1);

  const expectedSignature = await hmacSha256Base64Url(encodedPayload, secret);
  if (!constantTimeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  let payload: HlsTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
  } catch {
    return null;
  }

  if (
    typeof payload?.creatorId !== 'string' ||
    typeof payload?.mediaId !== 'string' ||
    typeof payload?.exp !== 'number'
  ) {
    return null;
  }

  if (nowSeconds >= payload.exp) {
    return null;
  }

  return payload;
}
