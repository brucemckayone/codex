/**
 * @codex/agreements — AgreementService
 *
 * State machine for revenue-share negotiations + lifecycle of the
 * resulting `creator_organization_agreements` rows. Drives the schema
 * landed in WP-1 (PR #207) and feeds the payout pipeline WP-4 will
 * rewire.
 *
 * Reference reading before editing:
 *   - `packages/database/src/schema/ecommerce.ts` (agreementProposals,
 *     creatorOrganizationAgreements, *Relations)
 *   - `~/.claude/projects/.../memory/project_revenue_share_wp1_discoveries.md`
 *     (three load-bearing constraints below — owner-resolution via
 *     memberships, dual-write legacy fee column, Drizzle relationName).
 *   - `~/.claude/projects/.../memory/project_revenue_share_decisions.md`
 *     (creator share snapshotted; platform fee read fresh in the payout
 *     pipeline — but NOT in share-validation, see `agreement-math.ts`).
 *
 * Every multi-step write goes through `this.db.transaction()` so the
 * database is never left in a half-applied state — agreement acceptance
 * in particular touches three tables (proposal, prior active agreement,
 * new active agreement) plus marks siblings superseded.
 *
 * Concurrency: all five mutation methods (propose/counter/accept/
 * decline/withdraw + terminate) acquire row-level `SELECT FOR UPDATE`
 * locks on the target proposal / agreement row inside the transaction
 * before the status check, closing the READ COMMITTED window in which
 * two concurrent callers could both observe `status='open'` and both
 * proceed.
 */

import { whereNotDeleted } from '@codex/database';
import {
  agreementProposals,
  creatorOrganizationAgreements,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import {
  BaseService,
  ForbiddenError,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
} from '@codex/service-errors';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AgreementNotFoundError, InvalidProposalStateError } from '../errors';
import type {
  AgreementProposal,
  CreatorOrganizationAgreement,
  RevenueType,
} from '../types';
import {
  creatorShareFromLegacyOrgFee,
  legacyOrgFeeFromCreatorShare,
  validateProposedShare,
} from './agreement-math';

// ─── Public input shapes ──────────────────────────────────────────────────

export interface ProposeAgreementInput {
  organizationId: string;
  creatorId: string;
  revenueType: RevenueType;
  /** Basis points 0–10000. */
  sharePercent: number;
  /** Soft-lock review window in months. `null` = indefinite. */
  termMonths: number | null;
  note?: string | null;
  /** User initiating the propose; must be an active owner of the org. */
  proposedByUserId: string;
  /** Defaults to `new Date()` if omitted. */
  effectiveFrom?: Date;
}

export interface CounterProposeInput {
  /** The proposal being countered. Must currently be `status='open'`. */
  proposalId: string;
  sharePercent: number;
  termMonths: number | null;
  note?: string | null;
  /** Must be the counterparty of the proposal being countered. */
  counteredByUserId: string;
}

export interface AcceptProposalInput {
  proposalId: string;
  /** Must be the counterparty of the proposal being accepted. */
  acceptedByUserId: string;
}

export interface DeclineProposalInput {
  proposalId: string;
  /** Must be the counterparty of the proposal being declined. */
  declinedByUserId: string;
  reason?: string | null;
}

export interface WithdrawProposalInput {
  proposalId: string;
  /** Must be the *proposing* party. */
  withdrawnByUserId: string;
}

export interface TerminateAgreementInput {
  agreementId: string;
  /** Must be the org owner or the creator named on the agreement. */
  terminatedByUserId: string;
  reason?: string | null;
}

// ─── Service config ───────────────────────────────────────────────────────

/**
 * Constructor config. As of the PR #210 review, the service no longer
 * threads `FeeConfigService` through share validation — `agreement-math`
 * reasons purely about the post-platform pool. Platform fee is still
 * read fresh in the WP-4 payout pipeline; if a future feature needs it
 * inside this service (e.g. a /preview endpoint that breaks down org
 * residual after platform fee), re-add the dep at that point.
 */
export type AgreementServiceConfig = ServiceConfig;

// ─── Service ──────────────────────────────────────────────────────────────

/**
 * Transaction handle type — the parameter the callback receives from
 * `db.transaction()`. Extracted once here so the helper signatures don't
 * each repeat the nested `Parameters<Parameters<...>[0]>[0]` chain.
 */
type Tx = Parameters<Parameters<AgreementService['db']['transaction']>[0]>[0];

export class AgreementService extends BaseService {
  constructor(config: AgreementServiceConfig) {
    super(config);
  }

  // ── Public: propose ─────────────────────────────────────────────────────

  /**
   * Owner-initiated initial proposal (round 1). Per the plan, only the
   * organization owner can open a negotiation. Subsequent rounds are
   * created via `counterPropose`.
   *
   * Validates:
   *   1. proposer is an active owner of the org
   *   2. creator is an active member of the org (any role; org may have
   *      promoted a member to "creator" or kept them as "member" — we
   *      gate on membership, not on role, to allow paying any team
   *      member out of pooled revenue)
   *   3. no other proposal in this (org, creator, revenue_type) thread
   *      is currently `open` or `countered` (one negotiation at a time
   *      per bucket — keeps the UI sane)
   *   4. proposed share + active sibling shares ≤ 100% of the
   *      post-platform pool (see `agreement-math.ts` header for the
   *      unit semantics)
   */
  async proposeAgreement(
    input: ProposeAgreementInput
  ): Promise<AgreementProposal> {
    try {
      return await this.db.transaction(async (tx) => {
        await this.assertActiveOwner(
          tx,
          input.organizationId,
          input.proposedByUserId
        );
        await this.assertActiveMember(
          tx,
          input.organizationId,
          input.creatorId
        );
        await this.assertNoOpenThread(
          tx,
          input.organizationId,
          input.creatorId,
          input.revenueType
        );

        // Existing active shares ELSEWHERE in the org for this revenue
        // type — these reduce the headroom. We deliberately exclude
        // (org, creator, revenue_type) because no active agreement
        // for that triple can exist (partial unique index) and the
        // payout splitter sums per-creator, not per-row.
        const existingActiveShares = await this.fetchExistingActiveShares(
          tx,
          input.organizationId,
          input.revenueType,
          { excludeCreatorId: input.creatorId }
        );

        validateProposedShare({
          proposedSharePercent: input.sharePercent,
          existingActiveShares,
        });

        const [row] = await tx
          .insert(agreementProposals)
          .values({
            organizationId: input.organizationId,
            creatorId: input.creatorId,
            revenueType: input.revenueType,
            parentProposalId: null,
            roundNumber: 1,
            proposedByUserId: input.proposedByUserId,
            proposedByRole: 'owner',
            proposedCreatorSharePercent: input.sharePercent,
            proposedTermMonths: input.termMonths,
            proposedEffectiveFrom: input.effectiveFrom ?? new Date(),
            note: input.note ?? null,
            status: 'open',
          })
          .returning();

        if (!row) {
          throw new InternalServiceError('Failed to insert agreement proposal');
        }
        return row;
      });
    } catch (error) {
      this.handleError(error, 'proposeAgreement');
    }
  }

  // ── Public: counter ─────────────────────────────────────────────────────

  /**
   * Counter-proposal — same negotiation thread, next round, flipped role.
   *
   * The parent proposal must currently be `status='open'`. The actor must
   * be the *counterparty* — if the parent was proposed by an owner, the
   * actor must be the creator named on the proposal (and vice versa for
   * owner-counters-creator). The parent transitions to `'countered'` in
   * the same transaction so the read-side never observes two `open`
   * rows in a thread.
   */
  async counterPropose(input: CounterProposeInput): Promise<AgreementProposal> {
    try {
      return await this.db.transaction(async (tx) => {
        const parent = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (parent.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be countered',
            {
              proposalId: parent.id,
              currentStatus: parent.status,
              attemptedAction: 'counter',
            }
          );
        }

        // Counter-party check. If the parent was owner-proposed, only
        // the named creator may counter. If creator-proposed, only an
        // active owner of the org may counter.
        const counteringRole: 'owner' | 'creator' =
          parent.proposedByRole === 'owner' ? 'creator' : 'owner';

        if (counteringRole === 'creator') {
          if (parent.creatorId !== input.counteredByUserId) {
            throw new ForbiddenError(
              'Only the counterparty creator may counter this proposal',
              { proposalId: parent.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            parent.organizationId,
            input.counteredByUserId
          );
        }

        // Re-check share against current world. The counter may land
        // months after the parent — sibling agreements may have shifted.
        const existingActiveShares = await this.fetchExistingActiveShares(
          tx,
          parent.organizationId,
          parent.revenueType as RevenueType,
          { excludeCreatorId: parent.creatorId }
        );
        validateProposedShare({
          proposedSharePercent: input.sharePercent,
          existingActiveShares,
        });

        // Parent → countered. responded_* captures who closed the parent
        // row out, separate from who created the new child row.
        await tx
          .update(agreementProposals)
          .set({
            status: 'countered',
            respondedAt: new Date(),
            respondedByUserId: input.counteredByUserId,
            updatedAt: new Date(),
          })
          .where(eq(agreementProposals.id, parent.id));

        const [child] = await tx
          .insert(agreementProposals)
          .values({
            organizationId: parent.organizationId,
            creatorId: parent.creatorId,
            revenueType: parent.revenueType,
            parentProposalId: parent.id,
            roundNumber: parent.roundNumber + 1,
            proposedByUserId: input.counteredByUserId,
            proposedByRole: counteringRole,
            proposedCreatorSharePercent: input.sharePercent,
            proposedTermMonths: input.termMonths,
            // Counter-proposals inherit the parent's effective_from —
            // the negotiation is about the same contract window, not a
            // new start date.
            proposedEffectiveFrom: parent.proposedEffectiveFrom,
            note: input.note ?? null,
            status: 'open',
          })
          .returning();

        if (!child) {
          throw new InternalServiceError('Failed to insert counter proposal');
        }
        return child;
      });
    } catch (error) {
      this.handleError(error, 'counterPropose');
    }
  }

  // ── Public: accept ──────────────────────────────────────────────────────

  /**
   * Accept an open proposal. Atomically:
   *   1. validates the actor is the counterparty
   *   2. re-validates the share against the current world
   *   3. marks the accepted proposal `status='accepted'`
   *   4. marks any sibling `open|countered` proposals in the thread
   *      `status='superseded'` (defence in depth — the partial unique
   *      index alone would not catch a stranded open row in the same
   *      thread because that index is on the AGREEMENT table, not the
   *      proposal table)
   *   5. marks any prior `active` agreement for the triple
   *      `status='terminated'` (auto-terminate the predecessor; the
   *      partial unique index enforces this anyway, but explicit
   *      gives a clean audit trail with `terminationReason` set)
   *   6. inserts the new `creator_organization_agreements` row with
   *      `status='active'`, links it back via `current_proposal_id`,
   *      and dual-writes the legacy `organization_fee_percentage`
   *      column per WP-1 discovery.
   */
  async acceptProposal(
    input: AcceptProposalInput
  ): Promise<CreatorOrganizationAgreement> {
    try {
      return await this.db.transaction(async (tx) => {
        const proposal = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (proposal.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be accepted',
            {
              proposalId: proposal.id,
              currentStatus: proposal.status,
              attemptedAction: 'accept',
            }
          );
        }

        // Counter-party authorisation: the side that did NOT propose
        // is the one allowed to accept. Defensive: if a future bug ever
        // creates a proposal whose `proposed_by_user_id` equals the
        // creator slot AND `proposed_by_role='owner'`, this check still
        // does the right thing because we look at the role, not the
        // user-id.
        if (proposal.proposedByRole === 'owner') {
          if (proposal.creatorId !== input.acceptedByUserId) {
            throw new ForbiddenError(
              'Only the counterparty creator may accept this proposal',
              { proposalId: proposal.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            proposal.organizationId,
            input.acceptedByUserId
          );
        }

        // Re-validate share at accept time — siblings may have moved.
        const existingActiveShares = await this.fetchExistingActiveShares(
          tx,
          proposal.organizationId,
          proposal.revenueType as RevenueType,
          { excludeCreatorId: proposal.creatorId }
        );
        validateProposedShare({
          proposedSharePercent: proposal.proposedCreatorSharePercent,
          existingActiveShares,
        });

        const now = new Date();

        // (3) Mark the proposal accepted.
        await tx
          .update(agreementProposals)
          .set({
            status: 'accepted',
            respondedAt: now,
            respondedByUserId: input.acceptedByUserId,
            updatedAt: now,
          })
          .where(eq(agreementProposals.id, proposal.id));

        // (4) Supersede sibling open/countered proposals in the thread.
        await tx
          .update(agreementProposals)
          .set({ status: 'superseded', updatedAt: now })
          .where(
            and(
              eq(agreementProposals.organizationId, proposal.organizationId),
              eq(agreementProposals.creatorId, proposal.creatorId),
              eq(agreementProposals.revenueType, proposal.revenueType),
              ne(agreementProposals.id, proposal.id),
              inArray(agreementProposals.status, ['open', 'countered'])
            )
          );

        // (5) Terminate the predecessor active agreement, if any.
        await tx
          .update(creatorOrganizationAgreements)
          .set({
            status: 'terminated',
            terminatedAt: now,
            terminatedByUserId: input.acceptedByUserId,
            terminationReason: 'Superseded by accepted proposal',
            updatedAt: now,
          })
          .where(
            and(
              eq(
                creatorOrganizationAgreements.organizationId,
                proposal.organizationId
              ),
              eq(creatorOrganizationAgreements.creatorId, proposal.creatorId),
              eq(
                creatorOrganizationAgreements.revenueType,
                proposal.revenueType
              ),
              eq(creatorOrganizationAgreements.status, 'active')
            )
          );

        // (6) Insert the new active agreement.
        // Dual-write invariant (WP-1 discovery): the legacy
        // `organization_fee_percentage` column is NOT NULL and the
        // payout pipeline still reads it. Until WP-4 swaps the read
        // path, every write to `proposed_creator_share_percent` must
        // be paired with `organization_fee_percentage = 10000 - share`
        // in the SAME transaction. Centralised in
        // `legacyOrgFeeFromCreatorShare()`.
        const [agreement] = await tx
          .insert(creatorOrganizationAgreements)
          .values({
            creatorId: proposal.creatorId,
            organizationId: proposal.organizationId,
            organizationFeePercentage: legacyOrgFeeFromCreatorShare(
              proposal.proposedCreatorSharePercent
            ),
            revenueType: proposal.revenueType,
            status: 'active',
            currentProposalId: proposal.id,
            effectiveFrom: proposal.proposedEffectiveFrom,
            effectiveUntil: this.computeEffectiveUntil(
              proposal.proposedEffectiveFrom,
              proposal.proposedTermMonths
            ),
          })
          .returning();

        if (!agreement) {
          throw new InternalServiceError(
            'Failed to insert creator organization agreement'
          );
        }
        return agreement;
      });
    } catch (error) {
      this.handleError(error, 'acceptProposal');
    }
  }

  // ── Public: decline ─────────────────────────────────────────────────────

  async declineProposal(
    input: DeclineProposalInput
  ): Promise<AgreementProposal> {
    try {
      return await this.db.transaction(async (tx) => {
        const proposal = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (proposal.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be declined',
            {
              proposalId: proposal.id,
              currentStatus: proposal.status,
              attemptedAction: 'decline',
            }
          );
        }

        if (proposal.proposedByRole === 'owner') {
          if (proposal.creatorId !== input.declinedByUserId) {
            throw new ForbiddenError(
              'Only the counterparty creator may decline this proposal',
              { proposalId: proposal.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            proposal.organizationId,
            input.declinedByUserId
          );
        }

        const now = new Date();
        const [updated] = await tx
          .update(agreementProposals)
          .set({
            status: 'declined',
            respondedAt: now,
            respondedByUserId: input.declinedByUserId,
            declineReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(agreementProposals.id, proposal.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update proposal to declined'
          );
        }
        return updated;
      });
    } catch (error) {
      this.handleError(error, 'declineProposal');
    }
  }

  // ── Public: withdraw ────────────────────────────────────────────────────

  async withdrawProposal(
    input: WithdrawProposalInput
  ): Promise<AgreementProposal> {
    try {
      return await this.db.transaction(async (tx) => {
        const proposal = await this.findProposalForUpdateOrThrow(
          tx,
          input.proposalId
        );

        if (proposal.status !== 'open') {
          throw new InvalidProposalStateError(
            'Only open proposals can be withdrawn',
            {
              proposalId: proposal.id,
              currentStatus: proposal.status,
              attemptedAction: 'withdraw',
            }
          );
        }

        // Withdraw is "the side that PROPOSED rescinds the offer". For
        // owner-proposed rows, the actor must be an active owner of the
        // org (allows co-owners to clean up after each other). For
        // creator-proposed counters, the actor must be the named
        // creator.
        if (proposal.proposedByRole === 'creator') {
          if (proposal.creatorId !== input.withdrawnByUserId) {
            throw new ForbiddenError(
              'Only the proposing creator may withdraw this proposal',
              { proposalId: proposal.id }
            );
          }
        } else {
          await this.assertActiveOwner(
            tx,
            proposal.organizationId,
            input.withdrawnByUserId
          );
        }

        const now = new Date();
        const [updated] = await tx
          .update(agreementProposals)
          .set({
            status: 'withdrawn',
            respondedAt: now,
            respondedByUserId: input.withdrawnByUserId,
            updatedAt: now,
          })
          .where(eq(agreementProposals.id, proposal.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update proposal to withdrawn'
          );
        }
        return updated;
      });
    } catch (error) {
      this.handleError(error, 'withdrawProposal');
    }
  }

  // ── Public: terminate active agreement ──────────────────────────────────

  async terminateAgreement(
    input: TerminateAgreementInput
  ): Promise<CreatorOrganizationAgreement> {
    try {
      return await this.db.transaction(async (tx) => {
        const agreement = await this.findAgreementForUpdateOrThrow(
          tx,
          input.agreementId
        );

        if (agreement.status !== 'active') {
          throw new InvalidProposalStateError(
            'Only active agreements can be terminated',
            {
              agreementId: agreement.id,
              currentStatus: agreement.status,
              attemptedAction: 'terminate',
            }
          );
        }

        // Either party may terminate — the creator named on the row, or
        // any active owner of the org. We check creator first because
        // it's a single equality compare; the membership lookup falls
        // through only when needed.
        if (agreement.creatorId !== input.terminatedByUserId) {
          await this.assertActiveOwner(
            tx,
            agreement.organizationId,
            input.terminatedByUserId
          );
        }

        const now = new Date();
        const [updated] = await tx
          .update(creatorOrganizationAgreements)
          .set({
            status: 'terminated',
            terminatedAt: now,
            terminatedByUserId: input.terminatedByUserId,
            terminationReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(creatorOrganizationAgreements.id, agreement.id))
          .returning();
        if (!updated) {
          throw new InternalServiceError(
            'Failed to update agreement to terminated'
          );
        }
        return updated;
      });
    } catch (error) {
      this.handleError(error, 'terminateAgreement');
    }
  }

  // ── Public: reads ───────────────────────────────────────────────────────

  /**
   * Active agreements for an org — every `status='active'` row, both
   * revenue types. Sorted by `effectiveFrom DESC` so the most recent
   * agreements bubble up.
   */
  async getActiveAgreements(input: {
    organizationId: string;
  }): Promise<CreatorOrganizationAgreement[]> {
    try {
      return await this.db.query.creatorOrganizationAgreements.findMany({
        where: and(
          eq(
            creatorOrganizationAgreements.organizationId,
            input.organizationId
          ),
          eq(creatorOrganizationAgreements.status, 'active'),
          // The agreements table doesn't carry a `deletedAt` column —
          // termination is the soft-delete vector. The `terminatedAt`
          // filter is defence-in-depth: a row in `active` should never
          // also carry a `terminated_at` (enforced by
          // `check_creator_org_agreement_terminated_shape`), but if a
          // future bug skews them we still refuse to surface it.
          isNull(creatorOrganizationAgreements.terminatedAt)
        ),
        orderBy: [desc(creatorOrganizationAgreements.effectiveFrom)],
      });
    } catch (error) {
      this.handleError(error, 'getActiveAgreements');
    }
  }

  /**
   * Creator's portfolio across all orgs — used by the creator-studio
   * /negotiations page. Filters to `status='active'` only.
   */
  async getActiveAgreementsForCreator(input: {
    creatorId: string;
  }): Promise<CreatorOrganizationAgreement[]> {
    try {
      return await this.db.query.creatorOrganizationAgreements.findMany({
        where: and(
          eq(creatorOrganizationAgreements.creatorId, input.creatorId),
          eq(creatorOrganizationAgreements.status, 'active'),
          isNull(creatorOrganizationAgreements.terminatedAt)
        ),
        orderBy: [desc(creatorOrganizationAgreements.effectiveFrom)],
      });
    } catch (error) {
      this.handleError(error, 'getActiveAgreementsForCreator');
    }
  }

  /**
   * Full negotiation thread for a (org, creator, revenue_type) triple,
   * chronological. Empty array if no thread exists yet.
   *
   * The UI uses this to render the proposal history alongside the
   * accept/counter/decline controls. Round numbers are monotonic per
   * thread so the order is unambiguous.
   */
  async getNegotiationThread(input: {
    organizationId: string;
    creatorId: string;
    revenueType: RevenueType;
  }): Promise<AgreementProposal[]> {
    try {
      return await this.db.query.agreementProposals.findMany({
        where: and(
          eq(agreementProposals.organizationId, input.organizationId),
          eq(agreementProposals.creatorId, input.creatorId),
          eq(agreementProposals.revenueType, input.revenueType)
        ),
        orderBy: [
          asc(agreementProposals.roundNumber),
          asc(agreementProposals.createdAt),
        ],
      });
    } catch (error) {
      this.handleError(error, 'getNegotiationThread');
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Resolve "is this user an active owner of this org?".
   *
   * Per WP-1 discovery, `organizations.owner_id` does NOT exist —
   * ownership is encoded by `organization_memberships.role='owner' AND
   * status='active'`. There may be 0 or many such rows.
   *
   * Implementation: two targeted queries. The first asks "is THIS user
   * an active owner?" and short-circuits the happy path. If no, we
   * issue a second query to distinguish "you are not an owner" (some
   * owner exists, just not you) from "no owner exists at all" (orphan
   * org) — useful telemetry and a precise error message for the UI.
   *
   * Throws `ForbiddenError` when the user is not an active owner, or
   * when the org has no active owner at all (orphaned organisations).
   */
  private async assertActiveOwner(
    tx: Tx,
    organizationId: string,
    userId: string
  ): Promise<void> {
    // Quick existence check on the org first — gives a more precise
    // error than "no active owner" when the org id is bogus.
    const org = await tx.query.organizations.findFirst({
      where: and(
        eq(organizations.id, organizationId),
        whereNotDeleted(organizations)
      ),
      columns: { id: true },
    });
    if (!org) {
      throw new NotFoundError('Organization not found', {
        resource: 'organization',
        organizationId,
      });
    }

    // Targeted lookup: is THIS user an active owner? Single-row hit.
    const myOwnership = await tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      ),
      columns: { id: true },
    });
    if (myOwnership) return;

    // Not this user — distinguish "no owner exists" from "you aren't
    // the owner". Both are 403; the message + context differ so the UI
    // can render the right next step.
    const anyOwner = await tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.role, 'owner'),
        eq(organizationMemberships.status, 'active')
      ),
      columns: { id: true },
    });
    if (!anyOwner) {
      throw new ForbiddenError('Organization has no active owner', {
        organizationId,
      });
    }
    throw new ForbiddenError(
      'Only an active organization owner may perform this action',
      { organizationId, userId }
    );
  }

  /**
   * Membership existence check — the creator must be on the team. Any
   * active role qualifies; we don't gate on `role='creator'` so an
   * owner can propose to themselves (single-creator-orgs do this to
   * pre-empt the org-keeps-100% fallback path).
   */
  private async assertActiveMember(
    tx: Tx,
    organizationId: string,
    userId: string
  ): Promise<void> {
    const membership = await tx.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId),
        eq(organizationMemberships.status, 'active')
      ),
      columns: { id: true },
    });
    if (!membership) {
      throw new ForbiddenError(
        'Target user is not an active member of this organization',
        { organizationId, userId }
      );
    }
  }

  /**
   * Refuse to open a new round-1 proposal when a thread is already in
   * flight for the same (org, creator, revenue_type) triple. The
   * "in flight" set is `status IN ('open', 'countered')` — any
   * terminal status frees the bucket.
   *
   * If the caller wants to re-open after a decline/withdraw, they
   * call `proposeAgreement` again, which lands in this guard and
   * passes because the previous thread is fully terminal.
   */
  private async assertNoOpenThread(
    tx: Tx,
    organizationId: string,
    creatorId: string,
    revenueType: RevenueType
  ): Promise<void> {
    const inflight = await tx.query.agreementProposals.findFirst({
      where: and(
        eq(agreementProposals.organizationId, organizationId),
        eq(agreementProposals.creatorId, creatorId),
        eq(agreementProposals.revenueType, revenueType),
        inArray(agreementProposals.status, ['open', 'countered'])
      ),
      columns: { id: true, status: true },
    });
    if (inflight) {
      throw new InvalidProposalStateError(
        'A proposal is already open for this creator + revenue type — counter or decline it first',
        {
          proposalId: inflight.id,
          currentStatus: inflight.status,
          attemptedAction: 'propose',
        }
      );
    }
  }

  /**
   * Existing active creator shares for this (org, revenue_type) bucket.
   *
   * We reconstruct each share via the legacy `organization_fee_percentage`
   * column on the agreement (`share = 10000 - fee`). That column is:
   *
   *   - NOT NULL (schema constraint),
   *   - dual-written by `acceptProposal()` here in this service, and
   *   - backfilled by migration 0072 for pre-existing rows.
   *
   * Reading it directly avoids a JOIN to `agreement_proposals` on a hot
   * validation path. When WP-4 swaps the read path to query
   * `proposed_creator_share_percent` via `current_proposal_id`, this
   * helper can be flipped over too — the public signature is stable.
   *
   * Returns an array (not the sum) so the caller can include the
   * breakdown in `ShareExceedsAvailableError.context.existingActiveShares`.
   */
  private async fetchExistingActiveShares(
    tx: Tx,
    organizationId: string,
    revenueType: RevenueType,
    options: { excludeCreatorId?: string } = {}
  ): Promise<number[]> {
    const conditions = [
      eq(creatorOrganizationAgreements.organizationId, organizationId),
      eq(creatorOrganizationAgreements.revenueType, revenueType),
      eq(creatorOrganizationAgreements.status, 'active'),
      isNull(creatorOrganizationAgreements.terminatedAt),
    ];
    if (options.excludeCreatorId) {
      conditions.push(
        ne(creatorOrganizationAgreements.creatorId, options.excludeCreatorId)
      );
    }
    const rows = await tx
      .select({
        orgFee: creatorOrganizationAgreements.organizationFeePercentage,
      })
      .from(creatorOrganizationAgreements)
      .where(and(...conditions));

    // Inverse of the dual-write invariant: org fee → creator share.
    // Same arithmetic as `legacyOrgFeeFromCreatorShare` (10000 - x is
    // its own inverse), but the helper-name documents the direction at
    // the call site — important for WP-4 when the read path swaps off
    // the legacy column entirely.
    return rows.map((r) => creatorShareFromLegacyOrgFee(r.orgFee));
  }

  /**
   * Walks `proposed_term_months` into a concrete `effective_until`
   * timestamp. `null` term = indefinite agreement, so we leave
   * `effective_until` null. Months are added by walking the date
   * components — DST-safe within the resolution this column needs
   * (monthly).
   */
  private computeEffectiveUntil(
    effectiveFrom: Date,
    termMonths: number | null
  ): Date | null {
    if (termMonths == null) return null;
    const d = new Date(effectiveFrom.getTime());
    d.setUTCMonth(d.getUTCMonth() + termMonths);
    return d;
  }

  /**
   * Locked proposal lookup — `SELECT ... FOR UPDATE` on the proposal
   * row inside the calling transaction. Closes the READ COMMITTED race
   * window where two concurrent callers could both observe
   * `status='open'`, both proceed, and corrupt the audit trail.
   *
   * Used by all five proposal-mutating methods (counter / accept /
   * decline / withdraw + the agreement counterpart `terminate`). The
   * unlocked read path (`findProposalOrThrow`) is reserved for the
   * non-mutating endpoints we don't yet have but might add (e.g. a
   * /preview surface).
   */
  private async findProposalForUpdateOrThrow(
    tx: Tx,
    proposalId: string
  ): Promise<AgreementProposal> {
    const rows = await tx
      .select()
      .from(agreementProposals)
      .where(eq(agreementProposals.id, proposalId))
      .for('update');
    const row = rows[0];
    if (!row) {
      throw new AgreementNotFoundError('Proposal not found', { proposalId });
    }
    return row;
  }

  /**
   * Locked agreement lookup — counterpart of
   * {@link findProposalForUpdateOrThrow} for the
   * `creator_organization_agreements` table. Called by
   * `terminateAgreement` so the active → terminated transition is
   * serialised against any concurrent caller.
   */
  private async findAgreementForUpdateOrThrow(
    tx: Tx,
    agreementId: string
  ): Promise<CreatorOrganizationAgreement> {
    const rows = await tx
      .select()
      .from(creatorOrganizationAgreements)
      .where(eq(creatorOrganizationAgreements.id, agreementId))
      .for('update');
    const row = rows[0];
    if (!row) {
      throw new AgreementNotFoundError('Agreement not found', { agreementId });
    }
    return row;
  }
}
