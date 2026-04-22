/**
 * AccessRevocation
 *
 * Per-user, per-org short-TTL KV "block list" used to close the window where a
 * cryptographic presigned R2 URL outlives its access check. Checked before
 * minting signed URLs in `ContentAccessService.getStreamingUrl()`.
 *
 * Design decisions (see docs/subscription-cache-audit/phase-2-followup.md):
 * - Keyspace `revoked:` is deliberately distinct from `cache:` so there is
 *   zero confusion with `@codex/cache` / `VersionedCache`. This is NOT a
 *   versioned cache — it's an authoritative short-TTL block list and does
 *   NOT belong in `CacheType`.
 * - TTL is 1200s (2× the max presigned URL TTL of 600s) to cover in-flight
 *   signed URLs minted just before revocation.
 * - Written by: `customer.subscription.deleted`, `invoice.payment_failed`,
 *   `charge.refunded`, `charge.dispute.created`, `customer.subscription.paused`.
 * - Cleared by: `customer.subscription.updated → ACTIVE`,
 *   `invoice.payment_succeeded` after PAST_DUE, `customer.subscription.resumed`.
 * - NOT written on `cancel_at_period_end=true` — the user retains paid access
 *   through `currentPeriodEnd` by product decision.
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import { ObservabilityClient } from '@codex/observability';
import { ValidationError } from '@codex/service-errors';

/**
 * Why access was revoked. Used for observability and optional UX messaging,
 * never for authorization branching — revocation is binary (present or not).
 */
export type RevocationReason =
  | 'subscription_deleted'
  | 'payment_failed'
  | 'refund'
  | 'admin_revoke';

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
 * KV TTL in seconds. 2× the maximum presigned URL TTL (600s) to cover
 * in-flight signed URLs minted moments before revocation.
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

const REVOCATION_REASONS: ReadonlySet<RevocationReason> = new Set([
  'subscription_deleted',
  'payment_failed',
  'refund',
  'admin_revoke',
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
