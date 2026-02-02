/**
 * Branding Settings Service
 *
 * Manages organization branding: logo and primary color.
 * Uses R2 for logo storage with public URLs.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import { MIME_TYPES } from '@codex/constants';
import { type dbHttp, type dbWs, schema } from '@codex/database';
import { BaseService } from '@codex/service-errors';
import type { BrandingSettingsResponse } from '@codex/shared-types';
import {
  ALLOWED_LOGO_MIME_TYPES,
  DEFAULT_BRANDING,
  type UpdateBrandingInput,
} from '@codex/validation';
import { eq } from 'drizzle-orm';
import { InvalidFileTypeError, SettingsUpsertError } from '../errors';

/**
 * Configuration for BrandingSettingsService
 */
export interface BrandingSettingsConfig {
  /** Database connection (supports both HTTP and WebSocket clients) */
  db: typeof dbHttp | typeof dbWs;
  /** Runtime environment */
  environment: string;
  /** Organization ID for scoping */
  organizationId: string;
  /** R2 service for logo storage */
  r2?: R2Service;
  /** Public URL base for R2 bucket (e.g., https://bucket.r2.cloudflarestorage.com) */
  r2PublicUrlBase?: string;
}

/**
 * BrandingSettingsService
 *
 * Handles branding configuration (logo, colors) for an organization.
 * Uses composition pattern - instantiated by PlatformSettingsService.
 */
export class BrandingSettingsService extends BaseService {
  private readonly organizationId: string;
  private readonly r2?: R2Service;
  private readonly r2PublicUrlBase?: string;

  constructor(config: BrandingSettingsConfig) {
    super(config);
    this.organizationId = config.organizationId;
    this.r2 = config.r2;
    this.r2PublicUrlBase = config.r2PublicUrlBase;
  }

  /**
   * Get branding settings for the organization.
   * Returns defaults if no settings exist.
   */
  async get(): Promise<BrandingSettingsResponse> {
    const result = await this.db
      .select({
        logoUrl: schema.brandingSettings.logoUrl,
        primaryColorHex: schema.brandingSettings.primaryColorHex,
      })
      .from(schema.brandingSettings)
      .where(eq(schema.brandingSettings.organizationId, this.organizationId))
      .limit(1);

    const row = result[0];
    if (!row) {
      this.obs.info('No branding settings found, returning defaults', {
        organizationId: this.organizationId,
      });
      return { ...DEFAULT_BRANDING };
    }

    return {
      logoUrl: row.logoUrl,
      primaryColorHex: row.primaryColorHex,
    };
  }

  /**
   * Update branding settings.
   * Uses upsert pattern to create or update.
   */
  async update(input: UpdateBrandingInput): Promise<BrandingSettingsResponse> {
    // Ensure hub row exists first
    await this.ensurePlatformSettingsExists();

    // Build update values from input
    const updateValues: Record<string, unknown> = {};
    if (input.primaryColorHex !== undefined) {
      updateValues.primaryColorHex = input.primaryColorHex;
    }

    // If no updates, just return current state
    if (Object.keys(updateValues).length === 0) {
      return this.get();
    }

    // Upsert branding settings
    const result = await this.db
      .insert(schema.brandingSettings)
      .values({
        organizationId: this.organizationId,
        primaryColorHex:
          input.primaryColorHex ?? DEFAULT_BRANDING.primaryColorHex,
      })
      .onConflictDoUpdate({
        target: schema.brandingSettings.organizationId,
        set: {
          ...updateValues,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.obs.info('Branding settings updated', {
      organizationId: this.organizationId,
      updatedFields: Object.keys(updateValues),
    });

    const row = result[0];
    if (!row) {
      throw new SettingsUpsertError('branding', this.organizationId);
    }
    return {
      logoUrl: row.logoUrl,
      primaryColorHex: row.primaryColorHex,
    };
  }

  /**
   * Upload a new logo.
   * File validation (MIME type, size, magic numbers, SVG sanitization) handled
   * by @codex/validation validateLogoUpload() before calling this method.
   *
   * @param validatedFile - Validated file data from validateLogoUpload()
   * @returns Updated branding settings with new logo URL
   */
  async uploadLogo(
    validatedFile: import('@codex/validation').ValidatedLogoFile
  ): Promise<BrandingSettingsResponse> {
    if (!this.r2) {
      throw new Error('R2 service not configured for logo uploads');
    }

    const { buffer, mimeType } = validatedFile;

    // Generate R2 path for logo
    const extension = this.getExtensionFromMimeType(mimeType);
    const r2Path = `logos/${this.organizationId}/logo.${extension}`;

    // Get old logo path before upload (for deletion after success)
    const currentResult = await this.db
      .select({ logoR2Path: schema.brandingSettings.logoR2Path })
      .from(schema.brandingSettings)
      .where(eq(schema.brandingSettings.organizationId, this.organizationId))
      .limit(1);

    const oldLogoPath = currentResult[0]?.logoR2Path;

    // Step 1: Upload new logo to R2 first
    await this.r2.put(r2Path, buffer, undefined, {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000', // 1 year cache
    });

    // Build public URL
    const logoUrl = this.r2PublicUrlBase
      ? `${this.r2PublicUrlBase}/${r2Path}`
      : r2Path;

    try {
      // Step 2: Update database with new logo
      // Ensure hub row exists
      await this.ensurePlatformSettingsExists();

      const result = await this.db
        .insert(schema.brandingSettings)
        .values({
          organizationId: this.organizationId,
          logoUrl,
          logoR2Path: r2Path,
          primaryColorHex: DEFAULT_BRANDING.primaryColorHex,
        })
        .onConflictDoUpdate({
          target: schema.brandingSettings.organizationId,
          set: {
            logoUrl,
            logoR2Path: r2Path,
            updatedAt: new Date(),
          },
        })
        .returning();

      this.obs.info('Logo uploaded', {
        organizationId: this.organizationId,
        r2Path,
        logoUrl,
      });

      const row = result[0];
      if (!row) {
        throw new SettingsUpsertError(
          'branding',
          this.organizationId,
          'logo_upload'
        );
      }

      // Step 3: Success - delete old logo (non-blocking)
      if (oldLogoPath && oldLogoPath !== r2Path) {
        try {
          await this.r2.delete(oldLogoPath);
          this.obs.info('Deleted old logo', {
            organizationId: this.organizationId,
            r2Path: oldLogoPath,
          });
        } catch (error) {
          // R2 delete failures are non-blocking. Orphaned files are acceptable
          // tradeoff vs failing the operation. Background cleanup can handle later.
          this.obs.warn('Failed to delete old logo', {
            organizationId: this.organizationId,
            r2Path: oldLogoPath,
            error: String(error),
          });
        }
      }

      return {
        logoUrl: row.logoUrl,
        primaryColorHex: row.primaryColorHex,
      };
    } catch (error) {
      // Step 4: Compensation - delete the new logo we just uploaded
      try {
        await this.r2.delete(r2Path);
        this.obs.info('Compensation: deleted new logo after DB failure', {
          organizationId: this.organizationId,
          r2Path,
        });
      } catch (cleanupError) {
        this.obs.error('Failed to cleanup new logo after DB failure', {
          organizationId: this.organizationId,
          r2Path,
          error: String(cleanupError),
        });
      }
      throw error;
    }
  }

  /**
   * Delete the current logo.
   * Removes from R2 and updates database.
   */
  async deleteLogo(): Promise<BrandingSettingsResponse> {
    if (!this.r2) {
      throw new Error('R2 service not configured for logo operations');
    }

    // Get current logo path
    const currentResult = await this.db
      .select({ logoR2Path: schema.brandingSettings.logoR2Path })
      .from(schema.brandingSettings)
      .where(eq(schema.brandingSettings.organizationId, this.organizationId))
      .limit(1);

    const currentRow = currentResult[0];
    if (currentRow?.logoR2Path) {
      try {
        await this.r2.delete(currentRow.logoR2Path);
        this.obs.info('Deleted logo from R2', {
          organizationId: this.organizationId,
          r2Path: currentRow.logoR2Path,
        });
      } catch (error) {
        this.obs.warn('Failed to delete logo from R2', {
          organizationId: this.organizationId,
          r2Path: currentRow.logoR2Path,
          error: String(error),
        });
      }
    }

    // Update database to clear logo
    if (currentRow) {
      await this.db
        .update(schema.brandingSettings)
        .set({
          logoUrl: null,
          logoR2Path: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.brandingSettings.organizationId, this.organizationId));
    }

    return this.get();
  }

  /**
   * Ensure platform_settings hub row exists for the organization.
   * Creates if missing.
   */
  private async ensurePlatformSettingsExists(): Promise<void> {
    await this.db
      .insert(schema.platformSettings)
      .values({ organizationId: this.organizationId })
      .onConflictDoNothing();
  }

  /**
   * Get file extension from MIME type.
   */
  private getExtensionFromMimeType(mimeType: string): string {
    let extension = '';
    switch (mimeType) {
      case MIME_TYPES.IMAGE.PNG:
        extension = 'png';
        break;
      case MIME_TYPES.IMAGE.JPEG:
        extension = 'jpg';
        break;
      case MIME_TYPES.IMAGE.WEBP:
        extension = 'webp';
        break;
      case MIME_TYPES.IMAGE.SVG:
        extension = 'svg';
        break;
      default:
        throw new InvalidFileTypeError(mimeType, ALLOWED_LOGO_MIME_TYPES);
    }
    return extension;
  }
}
