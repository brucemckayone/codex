/**
 * AccessRevocation
 *
 * Per-user, per-org short-TTL KV "block list".
 * `ContentAccessService.getStreamingUrl()` reads it before its DB access
 * check, so once access ends no NEW stream link is issued for that
 * organisation.
 *
 * What it does not do: stop a link already issued. A stream link is an HLS
 * token that plays until it expires (`DEFAULT_STREAMING_URL_TTL_SECONDS`,
 * 10 minutes by default), and the playlist proxy checks only the token, never
 * this key. The owner accepted that window (Codex-2hxff.61, option c: no
 * per-segment check). The DB access check is the authority: it refuses a new
 * link whether or not the key is there, so a missing KV binding, a failed
 * write or an early clear never grants anything.
 *
 * Design decisions (see docs/payments/access.md, "Streaming revocation"):
 * - Keyspace `revoked:` is deliberately distinct from `cache:` so there is
 *   zero confusion with `@codex/cache` / `VersionedCache`. This is NOT a
 *   versioned cache — it's an authoritative short-TTL block list and does
 *   NOT belong in `CacheType`.
 * - TTL is `REVOCATION_TTL_SECONDS` (1200s). It bounds only how long the key
 *   lives; it has no effect on links already issued.
 * - Written by: `customer.subscription.deleted`, `customer.subscription.updated
 *   → unpaid`, `customer.subscription.paused`, `charge.refunded` (a full
 *   refund of the latest subscription payment), and a chargeback opened or
 *   lost on a subscription invoice, or on a purchase whose item the buyer
 *   holds no other way (opened: `'purchase_dispute'` or
 *   `'subscription_dispute'`; lost: `'refund'`). NOT by
 *   `invoice.payment_failed`: a failed renewal
 *   keeps access while Stripe retries (owner decision P-3).
 * - Cleared by: `customer.subscription.updated → active` while billing is not
 *   paused (a `pause_collection` there is our own dispute hold, so it never
 *   clears the block), `invoice.payment_succeeded`,
 *   `customer.subscription.resumed`, the reactivate and resume routes, and a
 *   won dispute that restores the access.
 * - NOT written on `cancel_at_period_end=true` — the user retains paid access
 *   through `currentPeriodEnd` by product decision.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { ObservabilityClient } from '@codex/observability';
import { ValidationError } from '@codex/service-errors';

/**
 * Why access was revoked. Used for observability and optional UX messaging,
 * never for authorization branching — revocation is binary (present or not).
 *
 * The two dispute values mean access is PAUSED, not ended: a chargeback is
 * open on the purchase, or on one of the subscription's invoices. The content
 * page says so, and offers no Buy button (Codex-2hxff.60). The writer knows
 * which kind it is, and the payload has no room for a second field, so the
 * kind is in the value. A lost dispute writes `'refund'`: the access has ended.
 */
export type RevocationReason =
  | 'subscription_deleted'
  | 'payment_failed'
  | 'refund'
  | 'admin_revoke'
  | 'purchase_dispute'
  | 'subscription_dispute';

/**
 * Payload stored in KV under `revoked:user:{userId}:{orgId}`.
 */
export interface Revocation {
  /** ISO 8601 timestamp of when revocation was written. */
  revokedAt: string;
  /** Reason code — debugging aid only, never trusted for authorization. */
  reason: RevocationReason;
}

/**
 * KV TTL in seconds: how long a block refuses new stream links. Links issued
 * before the block play to their own expiry whatever this is; the DB access
 * check keeps refusing after the key expires.
 */
export const REVOCATION_TTL_SECONDS = 1200;

/**
 * Keyspace prefix. Deliberately distinct from `cache:` (used by
 * `@codex/cache` / `VersionedCache`) so there is zero confusion between
 * authoritative revocation and best-effort cache invalidation.
 */
export const REVOCATION_KEY_PREFIX = 'revoked:user';

function assertNonEmptyIdentifier(
  value: string,
  field: 'userId' | 'orgId'
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${field} is required`, { field });
  }
}

/**
 * Manages the per-user, per-org revocation keyspace.
 *
 * Single responsibility: read/write/delete one KV key per (userId, orgId).
 * No DB access, no business logic — this is a thin, testable KV wrapper.
 */
export class AccessRevocation {
  private readonly obs: ObservabilityClient;

  constructor(
    private readonly kv: KVNamespace,
    obs?: ObservabilityClient
  ) {
    this.obs = obs ?? new ObservabilityClient('AccessRevocation');
  }

  /**
   * Build the KV key. Private so the keyspace prefix is owned here —
   * callers never construct revocation keys by hand.
   */
  private key(userId: string, orgId: string): string {
    return `${REVOCATION_KEY_PREFIX}:${userId}:${orgId}`;
  }

  /**
   * Revoke access for (userId, orgId). Overwrites any existing entry —
   * later reason wins. TTL is reset to `REVOCATION_TTL_SECONDS` on every
   * write so repeated revocations extend the block window.
   */
  async revoke(
    userId: string,
    orgId: string,
    reason: RevocationReason
  ): Promise<void> {
    assertNonEmptyIdentifier(userId, 'userId');
    assertNonEmptyIdentifier(orgId, 'orgId');

    const value: Revocation = {
      revokedAt: new Date().toISOString(),
      reason,
    };

    await this.kv.put(this.key(userId, orgId), JSON.stringify(value), {
      expirationTtl: REVOCATION_TTL_SECONDS,
    });
  }

  /**
   * Check whether (userId, orgId) is currently revoked.
   *
   * Returns the parsed `Revocation` on hit, `null` on miss.
   *
   * Defensive JSON parsing: if the KV value is somehow malformed (should
   * never happen in practice, but this is on the critical access path),
   * we log a warning and return `null` rather than throw. Failing open on
   * a malformed block-list entry is acceptable because:
   *   1. The underlying DB access check still runs afterwards.
   *   2. Crashing the streaming path would be a worse outcome than a
   *      brief window where a malformed key is ignored until TTL expiry.
   */
  async isRevoked(userId: string, orgId: string): Promise<Revocation | null> {
    assertNonEmptyIdentifier(userId, 'userId');
    assertNonEmptyIdentifier(orgId, 'orgId');

    const raw = await this.kv.get(this.key(userId, orgId));
    if (raw === null) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRevocation(parsed)) {
        this.obs.warn('Malformed revocation payload — ignoring', {
          userId,
          orgId,
        });
        return null;
      }
      return parsed;
    } catch {
      this.obs.warn('Malformed revocation JSON — ignoring', {
        userId,
        orgId,
      });
      return null;
    }
  }

  /**
   * Clear the revocation key for (userId, orgId). Idempotent — deleting a
   * non-existent key is a no-op in Cloudflare KV.
   */
  async clear(userId: string, orgId: string): Promise<void> {
    assertNonEmptyIdentifier(userId, 'userId');
    assertNonEmptyIdentifier(orgId, 'orgId');

    await this.kv.delete(this.key(userId, orgId));
  }
}

/**
 * Every reason a reader accepts. A value missing here makes its key read as
 * malformed, so the block is ignored (the DB check still refuses the stream,
 * but the content page loses its copy).
 */
const REVOCATION_REASONS: ReadonlySet<RevocationReason> = new Set([
  'subscription_deleted',
  'payment_failed',
  'refund',
  'admin_revoke',
  'purchase_dispute',
  'subscription_dispute',
]);

function isRevocation(value: unknown): value is Revocation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.revokedAt !== 'string' ||
    candidate.revokedAt.length === 0
  ) {
    return false;
  }
  if (typeof candidate.reason !== 'string') {
    return false;
  }
  return REVOCATION_REASONS.has(candidate.reason as RevocationReason);
}
