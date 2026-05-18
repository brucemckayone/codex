/**
 * @codex/agreements/services — barrel
 */

export {
  type ActiveAgreementShareView,
  creatorShareFromLegacyOrgFee,
  legacyOrgFeeFromCreatorShare,
  sumActiveCreatorShares,
  type ValidateProposedShareInput,
  validateProposedShare,
} from './agreement-math';
export {
  type AcceptProposalInput,
  AgreementService,
  type AgreementServiceConfig,
  type CounterProposeInput,
  type DeclineProposalInput,
  type ProposeAgreementInput,
  type TerminateAgreementInput,
  type WithdrawProposalInput,
} from './agreement-service';
