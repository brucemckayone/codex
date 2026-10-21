/**
 * A creator who leaves has their agreements ended at that moment (owner
 * decision AGR-09, "End on removal"; docs/payments/agreements.md §Leaving an
 * organisation):
 * - removed from an organisation: their agreements and open proposals THERE;
 * - deleted their account: theirs in EVERY organisation ("End them like a
 *   removal").
 *
 * Money earned before is still paid: rows already recorded are untouched, and
 * a sale made before `at` still finds the agreement, which was terminated
 * after it. Runs in the caller's transaction, beside the change that caused
 * it, so neither can land without the other; after a removal the caller
 * emails the creator once it commits
 * (`AgreementService.notifyTerminatedOnDeparture`).
 */

import type { DatabaseClient } from '@codex/database';
import {
  agreementProposals,
  creatorOrganizationAgreements,
} from '@codex/database/schema';
import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

type Tx = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

export const DEPARTURE_TERMINATION_REASON =
  'No longer a member of the organisation';

export const ACCOUNT_DELETED_TERMINATION_REASON =
  'The creator deleted their account';

export type DepartureTerminatedAgreement =
  typeof creatorOrganizationAgreements.$inferSelect;

/**
 * Whose agreements end, and where. A caller must name one organisation or say
 * `everyOrganisation`: there is no default, so a forgotten organisation can't
 * silently end a creator's agreements everywhere.
 */
export type DepartureScope = { creatorId: string; at: Date } & (
  | { organizationId: string; everyOrganisation?: never }
  | { everyOrganisation: true; organizationId?: never }
);

function inScope(organizationColumn: PgColumn, scope: DepartureScope): SQL[] {
  return scope.everyOrganisation === true
    ? []
    : [eq(organizationColumn, scope.organizationId)];
}

/**
 * The creator's open proposals in scope, withdrawn at `at`, so a creator who
 * left cannot accept one and start a new agreement. Call it BEFORE the
 * membership change: accept and counter lock the proposal and then the
 * membership, so taking them in the same order cannot deadlock.
 */
export async function withdrawProposalsOnDeparture(
  tx: Tx | DatabaseClient,
  scope: DepartureScope
): Promise<Array<typeof agreementProposals.$inferSelect>> {
  return tx
    .update(agreementProposals)
    .set({
      status: 'withdrawn',
      respondedAt: scope.at,
      // Nobody withdrew it: the creator left.
      respondedByUserId: null,
      updatedAt: scope.at,
    })
    .where(
      and(
        ...inScope(agreementProposals.organizationId, scope),
        eq(agreementProposals.creatorId, scope.creatorId),
        eq(agreementProposals.status, 'open')
      )
    )
    .returning();
}

/** The creator's active agreements in scope, terminated at `at`. */
export async function terminateAgreementsOnDeparture(
  tx: Tx | DatabaseClient,
  scope: DepartureScope & { reason?: string }
): Promise<DepartureTerminatedAgreement[]> {
  return tx
    .update(creatorOrganizationAgreements)
    .set({
      status: 'terminated',
      terminatedAt: scope.at,
      // Nobody terminated it: the creator left. The column is nullable.
      terminatedByUserId: null,
      terminationReason: scope.reason ?? DEPARTURE_TERMINATION_REASON,
      updatedAt: scope.at,
    })
    .where(
      and(
        ...inScope(creatorOrganizationAgreements.organizationId, scope),
        eq(creatorOrganizationAgreements.creatorId, scope.creatorId),
        eq(creatorOrganizationAgreements.status, 'active')
      )
    )
    .returning();
}
