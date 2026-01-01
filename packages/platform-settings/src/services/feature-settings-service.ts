/**
 * Feature Settings Service
 *
 * Manages organization feature toggles:
 * enable signups, enable purchases.
 */

import { type dbHttp, type dbWs, schema } from '@codex/database';
import { BaseService } from '@codex/service-errors';
import {
  DEFAULT_FEATURES,
  type FeatureSettingsResponse,
  type UpdateFeaturesInput,
} from '@codex/validation';
import { eq } from 'drizzle-orm';
import { SettingsUpsertError } from '../errors';

/**
 * Configuration for FeatureSettingsService
 */
export interface FeatureSettingsConfig {
  /** Database connection (supports both HTTP and WebSocket clients) */
  db: typeof dbHttp | typeof dbWs;
  /** Runtime environment */
  environment: string;
  /** Organization ID for scoping */
  organizationId: string;
}

/**
 * FeatureSettingsService
 *
 * Handles feature toggle configuration for an organization.
 * Uses composition pattern - instantiated by PlatformSettingsService.
 */
export class FeatureSettingsService extends BaseService {
  private readonly organizationId: string;

  constructor(config: FeatureSettingsConfig) {
    super(config);
    this.organizationId = config.organizationId;
  }

  /**
   * Get feature settings for the organization.
   * Returns defaults if no settings exist.
   */
  async get(): Promise<FeatureSettingsResponse> {
    const result = await this.db
      .select({
        enableSignups: schema.featureSettings.enableSignups,
        enablePurchases: schema.featureSettings.enablePurchases,
      })
      .from(schema.featureSettings)
      .where(eq(schema.featureSettings.organizationId, this.organizationId))
      .limit(1);

    const row = result[0];
    if (!row) {
      this.obs.info('No feature settings found, returning defaults', {
        organizationId: this.organizationId,
      });
      return { ...DEFAULT_FEATURES };
    }

    return {
      enableSignups: row.enableSignups,
      enablePurchases: row.enablePurchases,
    };
  }

  /**
   * Update feature settings.
   * Uses upsert pattern to create or update.
   */
  async update(input: UpdateFeaturesInput): Promise<FeatureSettingsResponse> {
    // Ensure hub row exists first
    await this.ensurePlatformSettingsExists();

    // Build update values from input
    const updateValues: Record<string, unknown> = {};
    if (input.enableSignups !== undefined) {
      updateValues.enableSignups = input.enableSignups;
    }
    if (input.enablePurchases !== undefined) {
      updateValues.enablePurchases = input.enablePurchases;
    }

    // If no updates, just return current state
    if (Object.keys(updateValues).length === 0) {
      return this.get();
    }

    // Upsert feature settings
    const result = await this.db
      .insert(schema.featureSettings)
      .values({
        organizationId: this.organizationId,
        enableSignups: input.enableSignups ?? DEFAULT_FEATURES.enableSignups,
        enablePurchases:
          input.enablePurchases ?? DEFAULT_FEATURES.enablePurchases,
      })
      .onConflictDoUpdate({
        target: schema.featureSettings.organizationId,
        set: {
          ...updateValues,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.obs.info('Feature settings updated', {
      organizationId: this.organizationId,
      updatedFields: Object.keys(updateValues),
    });

    const row = result[0];
    if (!row) {
      throw new SettingsUpsertError('feature', this.organizationId);
    }
    return {
      enableSignups: row.enableSignups,
      enablePurchases: row.enablePurchases,
    };
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
}
