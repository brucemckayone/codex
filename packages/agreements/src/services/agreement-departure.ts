/**
 * A creator removed from an organisation has their agreements there
 * terminated at that moment (owner decision AGR-09, "End on removal";
 * docs/payments/agreements.md §Leaving an organisation).
 *
 * Money earned before the removal is still paid: rows already recorded are
 * untouched, and a sale made before `at` still finds the agreement, which was
 * terminated after it. Runs in the caller's transaction, beside the membership
 * change, so neither can land without the other; the caller emails the
 * creator after the commit (`AgreementService.notifyTerminatedOnDeparture`).
 */

import type { DatabaseClient } from '@codex/database';
import { creatorOrganizationAgreements } from '@codex/database/schema';
import { and, eq } from 'drizzle-orm';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

export const DEPARTURE_TERMINATION_REASON =
  'No longer a member of the organisation';

export type DepartureTerminatedAgreement =
  typeof creatorOrganizationAgreements.$inferSelect;

/** The creator's active agreements in the organisation, terminated at `at`. */
export async function terminateAgreementsOnDeparture(
  tx: Tx | DatabaseClient,
  params: { organizationId: string; creatorId: string; at: Date }
): Promise<DepartureTerminatedAgreement[]> {
  return tx
    .update(creatorOrganizationAgreements)
    .set({
      status: 'terminated',
      terminatedAt: params.at,
      // Nobody terminated it: the membership ended. The column is nullable.
      terminatedByUserId: null,
      terminationReason: DEPARTURE_TERMINATION_REASON,
      updatedAt: params.at,
    })
    .where(
      and(
        eq(creatorOrganizationAgreements.organizationId, params.organizationId),
        eq(creatorOrganizationAgreements.creatorId, params.creatorId),
        eq(creatorOrganizationAgreements.status, 'active')
      )
    )
    .returning();
}
