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
 * it, so neither can land without the other. After a removal commits, the
 * creator gets one email listing everything it ended
 * (`followUpMemberDeparture` in @codex/worker-utils, Codex-2hxff.64 Q5).
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
 * Lock the creator's open proposals in scope, without changing them. Accept
 * and counter lock the proposal and then the membership, so a departure
 * takes these before the membership too (Codex-kk9nv.8). It then writes
 * after the membership change, with {@link withdrawProposalsOnDeparture},
 * which reads afresh and so also withdraws a proposal that a transaction it
 * waited on has committed since.
 *
 * In id order: a removal (one organisation) and an account deletion (every
 * organisation) can both lock the same creator's proposals, through
 * different indexes, and rows locked in different orders deadlock. A
 * transaction only, since a lock outside one ends with its statement.
 */
export async function lockProposalsOnDeparture(
  tx: Tx,
  scope: DepartureScope
): Promise<void> {
  await tx
    .select({ id: agreementProposals.id })
    .from(agreementProposals)
    .where(
      and(
        ...inScope(agreementProposals.organizationId, scope),
        eq(agreementProposals.creatorId, scope.creatorId),
        eq(agreementProposals.status, 'open')
      )
    )
    .orderBy(agreementProposals.id)
    .for('update');
}

/**
 * The creator's open proposals in scope, withdrawn at `at`, so a creator who
 * left cannot accept one and start a new agreement. Lock them with
 * {@link lockProposalsOnDeparture} before the membership change, then call
 * this after it: proposeAgreement holds the membership while it inserts, so
 * a proposal committed while the change waited is withdrawn too. Accept and
 * counter lock the proposal and then the membership, so that order does not
 * deadlock with them.
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
