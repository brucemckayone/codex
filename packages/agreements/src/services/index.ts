/**
 * @codex/agreements/services — barrel
 */

export {
  DEPARTURE_TERMINATION_REASON,
  type DepartureTerminatedAgreement,
  terminateAgreementsOnDeparture,
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
