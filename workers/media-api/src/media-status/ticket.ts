/**
 * The one-minute ticket a studio tab opens its status socket with
 * (Codex-l2c48.9, owner's choice 1A).
 *
 * A browser cannot send the session cookie to media-api's origin on a
 * WebSocket upgrade it can trust (and CORS does not cover upgrades), so the
 * tab first asks for a ticket over its authenticated API path, then presents
 * it on the upgrade. The ticket is `base64url(claims).base64url(HMAC)`,
 * bound to one creator and the session's expiry, and good for 60 s.
 *
 * The key is derived from WORKER_SHARED_SECRET under its own label, so no
 * new secret has to be provisioned, and a ticket can never pass as a
 * worker-to-worker signature (those are HMACs over other bytes, with the
 * secret itself as the key).
 */

import { creatorIdSchema } from '@codex/validation';
import { z } from 'zod';

const TICKET_LIFETIME_MS = 60_000;
const KEY_LABEL = 'media-status-ticket/v1';

export interface TicketClaims {
  creatorId: string;
  /** The session's own expiry: the socket is closed then. */
  sessionExpiresAt: number;
}

/** A verified ticket: its claims, plus what makes it single-use. */
export interface VerifiedTicket extends TicketClaims {
  /** The ticket's signature, unique to it. */
  id: string;
  expiresAt: number;
}

/** Creator, session expiry, ticket expiry. */
const payloadSchema = z.object({
  c: creatorIdSchema,
  s: z.number(),
  e: z.number(),
});

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function ticketKey(workerSecret: string): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey(
    'raw',
    encoder.encode(workerSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const derived = await crypto.subtle.sign(
    'HMAC',
    root,
    encoder.encode(KEY_LABEL)
  );
  return crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function mintTicket(
  claims: TicketClaims,
  workerSecret: string,
  now = Date.now()
): Promise<{ ticket: string; expiresAt: number }> {
  const expiresAt = now + TICKET_LIFETIME_MS;
  const payload: z.infer<typeof payloadSchema> = {
    c: claims.creatorId,
    s: claims.sessionExpiresAt,
    e: expiresAt,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await ticketKey(workerSecret),
    encoder.encode(body)
  );
  return {
    ticket: `${body}.${toBase64Url(new Uint8Array(signature))}`,
    expiresAt,
  };
}

/** The ticket, or null when it is forged, expired, or malformed. */
export async function verifyTicket(
  ticket: string,
  workerSecret: string,
  now = Date.now()
): Promise<VerifiedTicket | null> {
  const [body, signatureText, extra] = ticket.split('.');
  if (!body || !signatureText || extra !== undefined) return null;
  const signature = fromBase64Url(signatureText);
  if (!signature) return null;

  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify(
    'HMAC',
    await ticketKey(workerSecret),
    signature,
    encoder.encode(body)
  );
  if (!valid) return null;

  const bytes = fromBase64Url(body);
  if (!bytes) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const payload = payloadSchema.safeParse(decoded);
  if (!payload.success || payload.data.e <= now || payload.data.s <= now) {
    return null;
  }
  return {
    creatorId: payload.data.c,
    sessionExpiresAt: payload.data.s,
    id: signatureText,
    expiresAt: payload.data.e,
  };
}
