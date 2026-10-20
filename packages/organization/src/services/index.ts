/**
 * Identity Services Export
 *
 * Centralizes all service exports for the identity package.
 * Provides both service classes and factory functions.
 */
// Organization Service

// Dev-only Cloudflare Custom Domain provisioner
export {
  DevDomainService,
  type DevDomainServiceConfig,
} from './dev-domain-service';
export {
  OrganizationService,
  type OrganizationServiceConfig,
  type OwnershipMailer,
  type OwnershipTemplateName,
} from './organization-service';
export {
  OWNERSHIP_OFFER_TTL_MS,
  type OwnershipChange,
  type OwnershipOfferDto,
  type OwnershipViewCore,
  type OwnershipViewerRole,
} from './ownership-transfer';
