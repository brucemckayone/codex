/**
 * @codex/platform-settings
 *
 * Platform settings management for Codex organizations.
 * Handles branding (logo, colors), contact info, and feature toggles.
 *
 * @example
 * ```typescript
 * import { PlatformSettingsFacade } from '@codex/platform-settings';
 *
 * const settings = new PlatformSettingsFacade({
 *   db: dbHttp,
 *   environment: 'production',
 *   organizationId: 'org-123',
 *   r2: r2Service,
 *   r2PublicUrlBase: 'https://bucket.r2.cloudflarestorage.com',
 * });
 *
 * // Get all settings in parallel
 * const all = await settings.getAllSettings();
 *
 * // Or get individual categories
 * const branding = await settings.getBranding();
 * const contact = await settings.getContact();
 * const features = await settings.getFeatures();
 * ```
 */

// Error classes
export {
  FileTooLargeError,
  InvalidFileTypeError,
  type SettingsTable,
  SettingsUpsertError,
} from './errors';

// Specialized services (for advanced use cases)
export {
  type BrandingSettingsConfig,
  BrandingSettingsService,
} from './services/branding-settings-service';
export { ContactSettingsService } from './services/contact-settings-service';
export { FeatureSettingsService } from './services/feature-settings-service';
// Main facade (primary export)
export {
  PlatformSettingsFacade,
  type PlatformSettingsFacadeConfig,
} from './services/platform-settings-service';
