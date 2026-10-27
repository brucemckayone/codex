/**
 * Creator revenue-share agreement lookup (Codex-nk4km WP-4, extracted for reuse
 * by Codex-2pryk WP-6).
 *
 * The creator's slice of the post-platform pool, from the agreement in force at
 * `at` — the content purchase, the one-off COURSE purchase (which reuses
 * `content_purchase` share terms per HARDENING §H4(a)) and the course-
 * subscription payout (`subscription` terms) all read it here. Returns the
 * agreement and its share in basis points, or `null` when no agreement applies
 * (the caller falls back to the FeeConfigService-resolved org fee).
 *
 * The agreement's id is what the sale records as the agreement it used:
 * `purchases.creator_org_agreement_id` and, for a course-subscription invoice,
 * the creator slice's `payouts.creator_org_agreement_id` (Codex-2hxff.19
 * AGR-06).
 *
 * Which agreements are in force is `agreementsInForce` in @codex/agreements,
 * the one rule every payment path reads (docs/payments/architecture.md WP4).
 * `at` is the pinned purchase/invoice timestamp so a webhook replay lands on
 * the same side of any agreement boundary.
 */

import {
  type AgreementInForce,
  type AgreementRevenueType,
  agreementsInForce,
  type ResolverLogger,
} from '@codex/agreements';
import type { DatabaseClient } from '@codex/database';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
type QueryClient = DatabaseClient | Tx;

export type { AgreementRevenueType };

/** The agreement a sale is split by, and the creator's share under it. */
export type CreatorAgreementShare = Pick<
  AgreementInForce,
  'agreementId' | 'sharePercent'
>;

/**
 * The creator's agreement in force at `at`, with their share of the
 * post-platform pool in basis points, or `null` when none is.
 */
export async function findActiveCreatorAgreementShare(
  client: QueryClient,
  params: {
    organizationId: string;
    creatorId: string;
    revenueType: AgreementRevenueType;
    at: Date;
    obs: ResolverLogger;
  }
): Promise<CreatorAgreementShare | null> {
  const [agreement] = await agreementsInForce(client, params);
  if (!agreement) return null;
  return {
    agreementId: agreement.agreementId,
    sharePercent: agreement.sharePercent,
  };
}
