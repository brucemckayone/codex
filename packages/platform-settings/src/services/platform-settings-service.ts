/**
 * Platform Settings Facade
 *
 * Facade pattern: provides a unified interface to the specialized settings services.
 * Composes BrandingSettingsService, ContactSettingsService, and FeatureSettingsService.
 *
 * @see https://refactoring.guru/design-patterns/facade
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { dbHttp, dbWs } from '@codex/database';
import type { ServiceConfig } from '@codex/service-errors';
import type {
  AllSettingsResponse,
  BrandingSettingsResponse,
  ContactSettingsResponse,
  FeatureSettingsResponse,
} from '@codex/shared-types';
import type {
  UpdateBrandingInput,
  UpdateContactInput,
  UpdateFeaturesInput,
} from '@codex/validation';
import {
  type BrandingSettingsConfig,
  BrandingSettingsService,
} from './branding-settings-service';
import { ContactSettingsService } from './contact-settings-service';
import { FeatureSettingsService } from './feature-settings-service';

/**
 * Configuration for PlatformSettingsFacade
 */
export interface PlatformSettingsFacadeConfig {
  /** Database connection instance */
  db: typeof dbHttp | typeof dbWs;
  /** Runtime environment */
  environment: string;
  /** Organization ID for scoping */
  organizationId: string;
  /** R2 service for logo storage (optional) */
  r2?: R2Service;
  /** Public URL base for R2 bucket (optional) */
  r2PublicUrlBase?: string;
}

/**
 * PlatformSettingsFacade
 *
 * Composes specialized services for branding, contact, and features.
 * Provides both specialized access and unified access to all settings.
 *
 * @example
 * ```typescript
 * const facade = new PlatformSettingsFacade({
 *   db: dbHttp,
 *   environment: 'production',
 *   organizationId: 'org-123',
 *   r2: r2Service,
 *   r2PublicUrlBase: 'https://bucket.r2.cloudflarestorage.com',
 * });
 *
 * // Specialized access (efficient - queries only what's needed)
 * const branding = await facade.getBranding();
 * const contact = await facade.getContact();
 * const features = await facade.getFeatures();
 *
 * // Unified access (parallel queries)
 * const all = await facade.getAllSettings();
 * ```
 */
export class PlatformSettingsFacade {
  private readonly branding: BrandingSettingsService;
  private readonly contact: ContactSettingsService;
  private readonly features: FeatureSettingsService;

  constructor(config: PlatformSettingsFacadeConfig) {
    const baseConfig: ServiceConfig = {
      db: config.db,
      environment: config.environment,
    };

    // Create specialized services with shared config
    const brandingConfig: BrandingSettingsConfig = {
      ...baseConfig,
      organizationId: config.organizationId,
      r2: config.r2,
      r2PublicUrlBase: config.r2PublicUrlBase,
    };

    this.branding = new BrandingSettingsService(brandingConfig);
    this.contact = new ContactSettingsService({
      ...baseConfig,
      organizationId: config.organizationId,
    });
    this.features = new FeatureSettingsService({
      ...baseConfig,
      organizationId: config.organizationId,
    });
  }

  // ============================================================================
  // Branding Settings (delegated)
  // ============================================================================

  /**
   * Get branding settings
   */
  async getBranding(): Promise<BrandingSettingsResponse> {
    return this.branding.get();
  }

  /**
   * Update branding settings (color only - use uploadLogo for logo)
   */
  async updateBranding(
    input: UpdateBrandingInput
  ): Promise<BrandingSettingsResponse> {
    return this.branding.update(input);
  }

  /**
   * Upload a new logo
   *
   * @param validatedFile - Validated file data from validateLogoUpload()
   */
  async uploadLogo(
    validatedFile: import('@codex/validation').ValidatedLogoFile
  ): Promise<BrandingSettingsResponse> {
    return this.branding.uploadLogo(validatedFile);
  }

  /**
   * Delete the current logo
   */
  async deleteLogo(): Promise<BrandingSettingsResponse> {
    return this.branding.deleteLogo();
  }

  // ============================================================================
  // Contact Settings (delegated)
  // ============================================================================

  /**
   * Get contact settings
   */
  async getContact(): Promise<ContactSettingsResponse> {
    return this.contact.get();
  }

  /**
   * Update contact settings
   */
  async updateContact(
    input: UpdateContactInput
  ): Promise<ContactSettingsResponse> {
    return this.contact.update(input);
  }

  // ============================================================================
  // Feature Settings (delegated)
  // ============================================================================

  /**
   * Get feature settings
   */
  async getFeatures(): Promise<FeatureSettingsResponse> {
    return this.features.get();
  }

  /**
   * Update feature settings
   */
  async updateFeatures(
    input: UpdateFeaturesInput
  ): Promise<FeatureSettingsResponse> {
    return this.features.update(input);
  }

  // ============================================================================
  // Unified Access (parallel queries)
  // ============================================================================

  /**
   * Get all settings in parallel.
   * Efficient for admin dashboard that needs all settings at once.
   */
  async getAllSettings(): Promise<AllSettingsResponse> {
    const [branding, contact, features] = await Promise.all([
      this.branding.get(),
      this.contact.get(),
      this.features.get(),
    ]);

    return { branding, contact, features };
  }
}
