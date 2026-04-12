/**
 * Unsubscribe Token Utility
 *
 * Generates and verifies HMAC-signed tokens for email unsubscribe links.
 * Tokens encode userId + category + expiry, signed with HMAC-SHA256.
 *
 * Only marketing and digest categories can be unsubscribed.
 * Transactional emails (receipts, security) always deliver.
 */

export interface UnsubscribePayload {
  userId: string;
  category: 'marketing' | 'digest';
  expiresAt: number; // Unix timestamp (seconds)
}

/**
 * Generate an HMAC-signed unsubscribe token.
 *
 * Format: base64url(JSON(payload)).base64url(HMAC-SHA256(payload, secret))
 * Expiry: 30 days from generation.
 */
export async function generateUnsubscribeToken(
  payload: Omit<UnsubscribePayload, 'expiresAt'>,
  secret: string,
  expiryDays = 30
): Promise<string> {
  const fullPayload: UnsubscribePayload = {
    ...payload,
    expiresAt: Math.floor(Date.now() / 1000) + expiryDays * 86400,
  };

  const payloadStr = JSON.stringify(fullPayload);
  const payloadB64 = btoa(payloadStr)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadStr)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify and decode an unsubscribe token.
 *
 * Returns the decoded payload if valid, or null if:
 * - Token format is invalid
 * - Signature doesn't match (tampered)
 * - Token has expired
 */
export async function verifyUnsubscribeToken(
  token: string,
  secret: string
): Promise<UnsubscribePayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  // Decode payload
  let payloadStr: string;
  try {
    // Restore base64 padding
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    payloadStr = atob(padded);
  } catch {
    return null;
  }

  // Verify signature
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  let sigBytes: Uint8Array;
  try {
    const padded = sigB64.replace(/-/g, '+').replace(/_/g, '/');
    sigBytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(payloadStr)
  );

  if (!valid) return null;

  // Parse payload
  let payload: UnsubscribePayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.expiresAt < now) return null;

  // Only allow marketing and digest categories
  if (payload.category !== 'marketing' && payload.category !== 'digest') {
    return null;
  }

  return payload;
}
