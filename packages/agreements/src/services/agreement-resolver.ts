/**
 * Which revenue-share agreements are in force at a moment: the one rule every
 * payment path reads (docs/payments/agreements.md §How a share applies;
 * docs/payments/architecture.md WP4, `agreementResolver(at)`). Before it, three
 * pasted copies of the predicate drifted apart.
 *
 * An agreement is in force at `at` when:
 * - it is `active`, or was `terminated` after `at` (no pro-rating: whoever
 *   holds it at the moment of a sale gets that sale's full share);
 * - it took effect at or before `at`.
 *
 * The term's end (`effective_until`) is a REVIEW date, not an expiry (owner
 * decision AGR-01, "Keeps paying"): it is deliberately not read here.
 *
 * Membership is deliberately not read either. Removing a creator terminates
 * their agreements at that moment (AGR-09, `terminateAgreementsOnDeparture`),
 * and that timestamp is what keeps money earned before the removal paid: a
 * webhook for an earlier invoice that lands, or is retried, after the removal
 * still finds the agreement. A join on the membership as it is NOW would drop
 * that creator's share.
 *
 * One agreement per creator. A creator matches two only mid-renegotiation —
 * the old agreement ends when the new one is accepted, and the new one can
 * take effect from when it was proposed — so for an invoice raised before the
 * acceptance both match, and the OLDER row is the one that was in force. After
 * it only the new one matches. Oldest first is therefore right on both sides,
 * and deterministic.
 */

import type { DatabaseClient } from '@codex/database';
import {
  agreementProposals,
  creatorOrganizationAgreements,
} from '@codex/database/schema';
import { and, asc, eq, gt, lte, or } from 'drizzle-orm';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
type QueryClient = DatabaseClient | Tx;

/** Revenue types an agreement can be scoped to. */
export type AgreementRevenueType = 'subscription' | 'content_purchase';

export interface AgreementInForce {
  agreementId: string;
  creatorId: string;
  /** The creator's share of the post-platform pool, in basis points. */
  sharePercent: number;
}

/** Required: a skipped agreement moves a creator's money, so it must be seen. */
export interface ResolverLogger {
  error(message: string, metadata?: Record<string, unknown>): void;
}

/**
 * The agreements in force for `revenueType` in an organisation at `at`, one per
 * creator, ordered by creator. Narrowed to one creator when `creatorId` is
 * given. An agreement with no accepted proposal linked has no share to apply:
 * that creator gets no share, never a newer agreement's, and it is logged as an
 * error with the sale's moment so the creator can be made whole.
 */
export async function agreementsInForce(
  client: QueryClient,
  params: {
    organizationId: string;
    revenueType: AgreementRevenueType;
    at: Date;
    creatorId?: string;
    obs: ResolverLogger;
  }
): Promise<AgreementInForce[]> {
  const rows = await client
    .select({
      agreementId: creatorOrganizationAgreements.id,
      creatorId: creatorOrganizationAgreements.creatorId,
      sharePercent: agreementProposals.proposedCreatorSharePercent,
    })
    .from(creatorOrganizationAgreements)
    // Left join: `current_proposal_id` is `ON DELETE SET NULL`, and an inner
    // join hid such agreements instead of reporting them (Codex-ez3tl).
    .leftJoin(
      agreementProposals,
      eq(agreementProposals.id, creatorOrganizationAgreements.currentProposalId)
    )
    .where(
      and(
        eq(creatorOrganizationAgreements.organizationId, params.organizationId),
        eq(creatorOrganizationAgreements.revenueType, params.revenueType),
        params.creatorId
          ? eq(creatorOrganizationAgreements.creatorId, params.creatorId)
          : undefined,
        // The schema CHECK enforces status='terminated' ⇔ terminated_at set,
        // so status='active' implies it was never terminated.
        or(
          eq(creatorOrganizationAgreements.status, 'active'),
          and(
            eq(creatorOrganizationAgreements.status, 'terminated'),
            gt(creatorOrganizationAgreements.terminatedAt, params.at)
          )
        ),
        lte(creatorOrganizationAgreements.effectiveFrom, params.at)
      )
    )
    .orderBy(
      asc(creatorOrganizationAgreements.creatorId),
      asc(creatorOrganizationAgreements.createdAt),
      asc(creatorOrganizationAgreements.id)
    );

  const inForce: AgreementInForce[] = [];
  const resolved = new Set<string>();
  for (const row of rows) {
    if (resolved.has(row.creatorId)) continue;
    resolved.add(row.creatorId);
    if (row.sharePercent === null) {
      params.obs.error('agreement has no current proposal; skipped', {
        errorId: crypto.randomUUID(),
        agreementId: row.agreementId,
        organizationId: params.organizationId,
        creatorId: row.creatorId,
        revenueType: params.revenueType,
        at: params.at.toISOString(),
      });
      continue;
    }
    inForce.push({
      agreementId: row.agreementId,
      creatorId: row.creatorId,
      sharePercent: row.sharePercent,
    });
  }
  return inForce;
}
