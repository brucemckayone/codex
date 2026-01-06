/**
 * RunPod Webhook Signature Verification Middleware
 *
 * Verifies HMAC-SHA256 signatures from RunPod webhook callbacks.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Security:
 * - Timing-safe comparison via constant-time XOR
 * - Validates signature format before comparison
 * - Returns 401 for missing/invalid signatures
 *
 * Headers expected:
 * - X-Runpod-Signature: HMAC-SHA256 signature (hex encoded)
 * - X-Runpod-Timestamp: Unix timestamp (optional, for replay protection)
 */

import type { HonoEnv } from '@codex/shared-types';
import type { Context, Next } from 'hono';

/**
 * Header names for RunPod webhook authentication
 */
const SIGNATURE_HEADER = 'X-Runpod-Signature';
const TIMESTAMP_HEADER = 'X-Runpod-Timestamp';

/**
 * Maximum age of webhook request in seconds (5 minutes)
 * Prevents replay attacks
 */
const MAX_AGE_SECONDS = 300;

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Timing-safe comparison of two byte arrays
 *
 * Uses constant-time XOR comparison to prevent timing attacks.
 * The comparison always takes the same amount of time regardless
 * of where the first difference occurs.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  // Constant-time comparison using XOR
  // Result accumulates differences but timing is constant
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Generate HMAC-SHA256 signature for payload
 */
async function generateSignature(
  payload: string,
  secret: string,
  timestamp?: number
): Promise<string> {
  const encoder = new TextEncoder();

  // If timestamp provided, include in signed message (format: timestamp.payload)
  const message = timestamp ? `${timestamp}.${payload}` : payload;
  const data = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);

  // Convert to hex string
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify RunPod webhook signature
 *
 * @param payload - Raw request body
 * @param signature - Signature from header (hex encoded)
 * @param secret - Webhook secret
 * @param timestamp - Optional timestamp for replay protection
 * @returns true if signature is valid
 */
async function verifySignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp?: number
): Promise<boolean> {
  // Validate signature format (should be 64 hex chars for SHA-256)
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expectedSignature = await generateSignature(payload, secret, timestamp);

  // Convert both to bytes for timing-safe comparison
  const signatureBytes = hexToBytes(signature.toLowerCase());
  const expectedBytes = hexToBytes(expectedSignature.toLowerCase());

  return timingSafeEqual(signatureBytes, expectedBytes);
}

export interface VerifyRunpodSignatureOptions {
  /**
   * Whether to validate timestamp for replay protection
   * Default: true
   */
  validateTimestamp?: boolean;

  /**
   * Maximum age of request in seconds
   * Default: 300 (5 minutes)
   */
  maxAge?: number;
}

/**
 * Hono middleware to verify RunPod webhook signatures
 *
 * IMPORTANT: This middleware MUST be applied before any JSON parsing
 * to ensure the raw body is available for signature verification.
 *
 * @example
 * ```ts
 * import { verifyRunpodSignature } from './middleware/verify-runpod-signature';
 *
 * app.post('/api/transcoding/webhook',
 *   verifyRunpodSignature(),
 *   async (c) => {
 *     // Signature verified, process webhook
 *     const payload = await c.req.json();
 *     // ...
 *   }
 * );
 * ```
 */
export function verifyRunpodSignature(
  options: VerifyRunpodSignatureOptions = {}
) {
  const { validateTimestamp = true, maxAge = MAX_AGE_SECONDS } = options;

  return async (c: Context<HonoEnv>, next: Next) => {
    // Get webhook secret from environment
    const secret = c.env.RUNPOD_WEBHOOK_SECRET;
    if (!secret) {
      console.error(
        '[verifyRunpodSignature] RUNPOD_WEBHOOK_SECRET not configured'
      );
      return c.json(
        {
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'Webhook verification not configured',
          },
        },
        500
      );
    }

    // Extract signature from header
    const signature = c.req.header(SIGNATURE_HEADER);
    if (!signature) {
      return c.json(
        {
          error: {
            code: 'MISSING_SIGNATURE',
            message: 'Missing webhook signature',
            required: SIGNATURE_HEADER,
          },
        },
        401
      );
    }

    // Extract and validate timestamp if required
    let timestamp: number | undefined;
    if (validateTimestamp) {
      const timestampStr = c.req.header(TIMESTAMP_HEADER);
      if (timestampStr) {
        timestamp = parseInt(timestampStr, 10);
        if (Number.isNaN(timestamp)) {
          return c.json(
            {
              error: {
                code: 'INVALID_TIMESTAMP',
                message: 'Invalid timestamp format',
              },
            },
            401
          );
        }

        // Check for replay attacks
        const now = Math.floor(Date.now() / 1000);
        const age = now - timestamp;

        if (age > maxAge) {
          return c.json(
            {
              error: {
                code: 'TIMESTAMP_EXPIRED',
                message: 'Request timestamp expired',
                maxAge,
                age,
              },
            },
            401
          );
        }

        // Prevent future timestamps (clock skew attack)
        if (age < -60) {
          return c.json(
            {
              error: {
                code: 'TIMESTAMP_FUTURE',
                message: 'Request timestamp in future',
              },
            },
            401
          );
        }
      }
    }

    // Get raw request body for signature verification
    const body = await c.req.text();

    // Verify signature (timing-safe)
    const isValid = await verifySignature(body, signature, secret, timestamp);

    if (!isValid) {
      return c.json(
        {
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Invalid webhook signature',
          },
        },
        401
      );
    }

    // Signature valid, proceed to handler
    // Store raw body for handler to parse
    // Type assertion: rawBody is defined in Variables interface in @codex/shared-types
    (c.set as (key: string, value: string) => void)('rawBody', body);

    await next();
  };
}
