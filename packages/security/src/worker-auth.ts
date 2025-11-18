import type { Context, Next } from 'hono';

export interface WorkerAuthOptions {
  /**
   * Shared secret for HMAC signature (stored in secrets)
   */
  secret: string;

  /**
   * Allowed worker origins (e.g., ["https://auth.revelations.studio"])
   * If not provided, any origin with valid signature is accepted
   */
  allowedOrigins?: string[];

  /**
   * Custom header name for signature (default: X-Worker-Signature)
   */
  signatureHeader?: string;

  /**
   * Custom header name for timestamp (default: X-Worker-Timestamp)
   */
  timestampHeader?: string;

  /**
   * Maximum age of request in seconds (default: 300 = 5 minutes)
   */
  maxAge?: number;
}

/**
 * Generate HMAC signature for worker-to-worker communication
 *
 * @param payload - Request body or data to sign
 * @param secret - Shared secret
 * @param timestamp - Unix timestamp in seconds
 */
export async function generateWorkerSignature(
  payload: string,
  secret: string,
  timestamp: number
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${timestamp}:${payload}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Verify HMAC signature for worker-to-worker communication
 */
async function verifyWorkerSignature(
  payload: string,
  signature: string,
  secret: string,
  timestamp: number
): Promise<boolean> {
  const expectedSignature = await generateWorkerSignature(
    payload,
    secret,
    timestamp
  );
  return signature === expectedSignature;
}

/**
 * Hono middleware to authenticate requests from other workers
 *
 * Validates HMAC signature and timestamp to prevent replay attacks.
 *
 * @example
 * ```ts
 * // In receiving worker (e.g., stripe-webhook-handler)
 * import { workerAuth } from '@codex/security';
 *
 * app.use('/internal/*', workerAuth({
 *   secret: c.env.WORKER_SHARED_SECRET,
 *   allowedOrigins: ['https://auth.revelations.studio']
 * }));
 * ```
 *
 * @example
 * ```ts
 * // In calling worker (e.g., auth worker calling stripe handler)
 * import { generateWorkerSignature } from '@codex/security';
 *
 * const timestamp = Math.floor(Date.now() / 1000);
 * const body = JSON.stringify({ userId: '123' });
 * const signature = await generateWorkerSignature(body, secret, timestamp);
 *
 * await fetch('https://api.revelations.studio/internal/webhook', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'X-Worker-Signature': signature,
 *     'X-Worker-Timestamp': timestamp.toString(),
 *   },
 *   body,
 * });
 * ```
 */
export function workerAuth(options: WorkerAuthOptions) {
  const {
    secret,
    allowedOrigins,
    signatureHeader = 'X-Worker-Signature',
    timestampHeader = 'X-Worker-Timestamp',
    maxAge = 300,
  } = options;

  return async (c: Context, next: Next) => {
    // Check origin if allowlist provided
    if (allowedOrigins) {
      const origin = c.req.header('origin');
      if (!origin || !allowedOrigins.includes(origin)) {
        return c.json({ error: 'Unauthorized origin' }, 403);
      }
    }

    // Get signature and timestamp from headers
    const signature = c.req.header(signatureHeader);
    const timestampStr = c.req.header(timestampHeader);

    if (!signature || !timestampStr) {
      return c.json(
        {
          error: 'Missing authentication headers',
          required: [signatureHeader, timestampHeader],
        },
        401
      );
    }

    // Validate timestamp
    const timestamp = parseInt(timestampStr, 10);
    if (Number.isNaN(timestamp)) {
      return c.json({ error: 'Invalid timestamp format' }, 401);
    }

    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;

    // Prevent replay attacks (request too old)
    if (age > maxAge) {
      return c.json(
        {
          error: 'Request timestamp expired',
          maxAge,
          age,
        },
        401
      );
    }

    // Prevent future timestamps (clock skew attack)
    if (age < -60) {
      // Allow 60s clock skew
      return c.json({ error: 'Request timestamp in future' }, 401);
    }

    // Get request body
    const body = await c.req.text();

    // Verify signature
    const isValid = await verifyWorkerSignature(
      body,
      signature,
      secret,
      timestamp
    );

    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Signature valid, proceed
    await next();
  };
}

/**
 * Helper to make authenticated worker-to-worker requests
 *
 * @example
 * ```ts
 * import { workerFetch } from '@codex/security';
 *
 * const response = await workerFetch(
 *   'https://api.revelations.studio/internal/webhook',
 *   {
 *     method: 'POST',
 *     body: JSON.stringify({ userId: '123' }),
 *   },
 *   c.env.WORKER_SHARED_SECRET
 * );
 * ```
 */
export async function workerFetch(
  url: string,
  init: RequestInit & { body: string },
  secret: string,
  options: Pick<WorkerAuthOptions, 'signatureHeader' | 'timestampHeader'> = {}
): Promise<Response> {
  const {
    signatureHeader = 'X-Worker-Signature',
    timestampHeader = 'X-Worker-Timestamp',
  } = options;

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await generateWorkerSignature(init.body, secret, timestamp);

  const headers = new Headers(init.headers);
  headers.set(signatureHeader, signature);
  headers.set(timestampHeader, timestamp.toString());
  headers.set('Content-Type', 'application/json');

  return fetch(url, {
    ...init,
    headers,
  });
}
