/**
 * @codex/agreements — Domain types
 *
 * Literal unions modelling the agreement-proposal state machine and the
 * read-side payloads the service exposes. Mirrors the CHECK constraints
 * declared on `agreement_proposals` and `creator_organization_agreements`
 * in `packages/database/src/schema/ecommerce.ts` (WP-1, Codex-ppxtd).
 *
 * Why literal unions over enums:
 *   - The schema uses CHECK constraints, not native PG enums, so the
 *     DB layer already stores `varchar`. Drizzle returns these as `string`,
 *     and we use these unions to narrow them in the service layer.
 *   - Avoids the dual-emit / barrel-import quirks of TS enums.
 */

import type {
  AgreementProposal as DbAgreementProposal,
  CreatorOrganizationAgreement as DbCreatorOrganizationAgreement,
  NewAgreementProposal as DbNewAgreementProposal,
  NewCreatorOrganizationAgreement as DbNewCreatorOrganizationAgreement,
} from '@codex/database/schema';

// ─── Literal unions ────────────────────────────────────────────────────────

/**
 * Revenue stream that an agreement governs.
 *
 * A creator can simultaneously hold an `active` agreement of each kind with
 * the same org — enforced by the partial unique index
 * `uq_creator_org_agreement_active_per_type`.
 */
export type RevenueType = 'subscription' | 'content_purchase';

/**
 * Lifecycle of a single negotiation proposal row.
 *
 * Transitions (see `AgreementService` for the gate):
 *   open      → accepted | declined | countered | withdrawn | superseded
 *   countered → superseded
 *   any terminal → throw InvalidProposalStateError
 */
export type ProposalStatus =
  | 'open'
  | 'accepted'
  | 'declined'
  | 'countered'
  | 'withdrawn'
  | 'superseded';

/**
 * Lifecycle of the canonical "active row" agreement.
 *
 * `expired` transitions are reserved for a future cron job (WP-?? in the
 * epic plan) — WP-2 only handles termination by an actor.
 */
export type AgreementStatus = 'active' | 'terminated' | 'expired';

/**
 * Which side initiated a proposal. Round 1 is always `'owner'`; counters
 * alternate as the negotiation walks down the parent chain.
 */
export type ProposedByRole = 'owner' | 'creator';

// ─── Re-exports from the database schema ──────────────────────────────────

/**
 * Row shape returned by Drizzle `select` on `agreement_proposals`. The
 * `status`/`proposedByRole`/`revenueType` columns come back as `string`
 * from the driver — service callers should narrow with the unions above.
 */
export type AgreementProposal = DbAgreementProposal;
export type NewAgreementProposal = DbNewAgreementProposal;
export type CreatorOrganizationAgreement = DbCreatorOrganizationAgreement;
export type NewCreatorOrganizationAgreement = DbNewCreatorOrganizationAgreement;
