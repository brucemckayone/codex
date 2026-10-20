/**
 * Creator revenue-share agreement lookup (Codex-nk4km WP-4, extracted for reuse
 * by Codex-2pryk WP-6).
 *
 * The creator's slice of the post-platform pool, from the agreement in force at
 * `at` — the content purchase, the one-off COURSE purchase (which reuses
 * `content_purchase` share terms per HARDENING §H4(a)) and the course-
 * subscription payout (`subscription` terms) all read it here. Returns the
 * share in basis points, or `null` when no agreement applies (the caller falls
 * back to the FeeConfigService-resolved org fee).
 *
 * Which agreements are in force is `agreementsInForce` in @codex/agreements,
 * the one rule every payment path reads (docs/payments/architecture.md WP4).
 * `at` is the pinned purchase/invoice timestamp so a webhook replay lands on
 * the same side of any agreement boundary.
 */

import {
  type AgreementRevenueType,
  agreementsInForce,
} from '@codex/agreements';
import type { DatabaseClient } from '@codex/database';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
type QueryClient = DatabaseClient | Tx;

export type { AgreementRevenueType };

/**
 * The creator's agreed share of the post-platform pool in basis points, or
 * `null` when no agreement is in force at `at`.
 */
export async function findActiveCreatorAgreementShare(
  client: QueryClient,
  params: {
    organizationId: string;
    creatorId: string;
    revenueType: AgreementRevenueType;
    at: Date;
    obs?: { warn(message: string, metadata?: Record<string, unknown>): void };
  }
): Promise<number | null> {
  const [agreement] = await agreementsInForce(client, params);
  return agreement?.sharePercent ?? null;
}
