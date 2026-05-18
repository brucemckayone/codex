/**
 * @codex/agreements
 *
 * Revenue-share agreement state machine + validation math for the Codex
 * platform. Operates on the schema landed in WP-1 (Codex-ppxtd, PR #207)
 * and feeds the payout pipeline (WP-4 of epic Codex-nk4km).
 *
 * Quick start (route handler):
 * ```ts
 * const agreement = await ctx.services.agreements.acceptProposal({
 *   proposalId: ctx.input.params.id,
 *   acceptedByUserId: ctx.user.id,
 * });
 * ```
 *
 * Construction is normally via the worker service registry. For tests:
 * ```ts
 * const service = new AgreementService({
 *   db, // setupTestDatabase() — dbWs supports transactions
 *   environment: 'test',
 *   feeConfig,
 * });
 * ```
 */

// ─── Services ─────────────────────────────────────────────────────────────

export {
  type AcceptProposalInput,
  type ActiveAgreementShareView,
  AgreementService,
  type AgreementServiceConfig,
  type CounterProposeInput,
  type DeclineProposalInput,
  legacyOrgFeeFromCreatorShare,
  type ProposeAgreementInput,
  sumActiveCreatorShares,
  type TerminateAgreementInput,
  type ValidateProposedShareInput,
  validateProposedShare,
  type WithdrawProposalInput,
} from './services';

// ─── Types ────────────────────────────────────────────────────────────────

export type {
  AgreementProposal,
  AgreementStatus,
  CreatorOrganizationAgreement,
  NewAgreementProposal,
  NewCreatorOrganizationAgreement,
  ProposalStatus,
  ProposedByRole,
  RevenueType,
} from './types';

// ─── Errors ───────────────────────────────────────────────────────────────

export {
  AgreementNotFoundError,
  AgreementServiceError,
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  InvalidProposalStateError,
  isAgreementServiceError,
  NotFoundError,
  ShareExceedsAvailableError,
  ValidationError,
  wrapError,
} from './errors';

// ─── Re-exports for convenience ───────────────────────────────────────────

export type { ServiceConfig } from '@codex/service-errors';
