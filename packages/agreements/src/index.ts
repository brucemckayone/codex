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
  ACCOUNT_DELETED_TERMINATION_REASON,
  type AcceptProposalInput,
  type ActiveAgreementShareView,
  type AgreementEmailRecipient,
  type AgreementInForce,
  type AgreementLifecycleMailer,
  type AgreementRevenueType,
  AgreementService,
  type AgreementServiceConfig,
  type AgreementTemplateName,
  type AgreementWithShare,
  agreementsInForce,
  buildAgreementEmailLink,
  type CounterProposeInput,
  creatorShareFromLegacyOrgFee,
  DEPARTURE_TERMINATION_REASON,
  type DeclineProposalInput,
  type DepartureScope,
  type DepartureTerminatedAgreement,
  formatRevenueTypeLabel,
  isEnvName,
  legacyOrgFeeFromCreatorShare,
  lockProposalsOnDeparture,
  type ProposeAgreementInput,
  type ResolverLogger,
  sumActiveCreatorShares,
  type TerminateAgreementInput,
  terminateAgreementsOnDeparture,
  type ValidateProposedShareInput,
  validateProposedShare,
  type WithdrawProposalInput,
  withdrawProposalsOnDeparture,
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
  type AgreementRecipientRefusal,
  AgreementServiceError,
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  FutureStartNotAllowedError,
  InternalServiceError,
  InvalidProposalStateError,
  isAgreementServiceError,
  NotFoundError,
  RecipientCannotHoldAgreementError,
  ShareExceedsAvailableError,
  ValidationError,
  wrapError,
} from './errors';

// ─── Re-exports for convenience ───────────────────────────────────────────

export type { ServiceConfig } from '@codex/service-errors';
