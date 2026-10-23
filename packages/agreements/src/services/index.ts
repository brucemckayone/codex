/**
 * @codex/agreements/services — barrel
 */

export {
  ACCOUNT_DELETED_TERMINATION_REASON,
  DEPARTURE_TERMINATION_REASON,
  type DepartureScope,
  type DepartureTerminatedAgreement,
  lockProposalsOnDeparture,
  terminateAgreementsOnDeparture,
  withdrawProposalsOnDeparture,
} from './agreement-departure';
export {
  type ActiveAgreementShareView,
  creatorShareFromLegacyOrgFee,
  formatRevenueTypeLabel,
  legacyOrgFeeFromCreatorShare,
  sumActiveCreatorShares,
  type ValidateProposedShareInput,
  validateProposedShare,
} from './agreement-math';
export {
  type AgreementInForce,
  type AgreementRevenueType,
  agreementsInForce,
  type ResolverLogger,
} from './agreement-resolver';
export {
  type AcceptProposalInput,
  type AgreementLifecycleMailer,
  AgreementService,
  type AgreementServiceConfig,
  type AgreementTemplateName,
  type CounterProposeInput,
  type DeclineProposalInput,
  type ProposeAgreementInput,
  type TerminateAgreementInput,
  type WithdrawProposalInput,
} from './agreement-service';
