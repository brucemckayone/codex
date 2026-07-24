/**
 * Creator revenue-share agreement lookup (Codex-nk4km WP-4, extracted for reuse
 * by Codex-2pryk WP-6).
 *
 * Resolves the creator's slice of the post-platform pool from their ACTIVE
 * `creator_organization_agreements` row (via the accepted proposal it points
 * at). Returns the share in basis points, or `null` when no agreement applies
 * (caller falls back to the FeeConfigService-resolved org fee).
 *
 * This is the exact query `PurchaseService.completePurchase` ran inline for
 * content purchases; hoisted so the one-off COURSE purchase (which reuses
 * `content_purchase` share terms per HARDENING §H4(a)) and the course-
 * subscription payout (`subscription` terms) apply IDENTICAL agreement math
 * without duplicating the subtle Decision-Q3 date predicates.
 *
 * Decision Q3 (active-as-of-`at`): an agreement counts when it is `active`, OR
 * `terminated` after `at`; and its effective window brackets `at`. `at` is the
 * pinned purchase/invoice timestamp so a webhook replay lands on the same side
 * of any agreement boundary.
 */

import type { DatabaseClient } from '@codex/database';
import {
  agreementProposals,
  creatorOrganizationAgreements,
} from '@codex/database/schema';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
type QueryClient = DatabaseClient | Tx;

/** Revenue types an agreement can be scoped to (`creator_organization_agreements`). */
export type AgreementRevenueType = 'subscription' | 'content_purchase';

/**
 * The creator's agreed share of the post-platform pool in basis points, or
 * `null` when no active agreement brackets `at`.
 */
export async function findActiveCreatorAgreementShare(
  client: QueryClient,
  params: {
    organizationId: string;
    creatorId: string;
    revenueType: AgreementRevenueType;
    at: Date;
  }
): Promise<number | null> {
  const [row] = await client
    .select({
      sharePercent: agreementProposals.proposedCreatorSharePercent,
    })
    .from(creatorOrganizationAgreements)
    .innerJoin(
      agreementProposals,
      eq(agreementProposals.id, creatorOrganizationAgreements.currentProposalId)
    )
    .where(
      and(
        eq(creatorOrganizationAgreements.organizationId, params.organizationId),
        eq(creatorOrganizationAgreements.creatorId, params.creatorId),
        eq(creatorOrganizationAgreements.revenueType, params.revenueType),
        // Q3: active, or terminated after `at`. The schema CHECK enforces
        // status='terminated' ⇔ terminatedAt IS NOT NULL, so status='active'
        // implies terminatedAt IS NULL.
        or(
          eq(creatorOrganizationAgreements.status, 'active'),
          and(
            eq(creatorOrganizationAgreements.status, 'terminated'),
            gt(creatorOrganizationAgreements.terminatedAt, params.at)
          )
        ),
        lte(creatorOrganizationAgreements.effectiveFrom, params.at),
        or(
          isNull(creatorOrganizationAgreements.effectiveUntil),
          gt(creatorOrganizationAgreements.effectiveUntil, params.at)
        )
      )
    )
    .limit(1);

  return row?.sharePercent ?? null;
}
