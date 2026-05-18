/**
 * @codex/agreements/services — barrel
 */

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
