/**
 * Contact Settings Service
 *
 * Manages organization contact information:
 * platform name, support email, contact URL, timezone.
 */

import { type dbHttp, type dbWs, schema } from '@codex/database';
import { BaseService } from '@codex/service-errors';
import type { ContactSettingsResponse } from '@codex/shared-types';
import { DEFAULT_CONTACT, type UpdateContactInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import { SettingsUpsertError } from '../errors';

/**
 * Configuration for ContactSettingsService
 */
export interface ContactSettingsConfig {
  /** Database connection (supports both HTTP and WebSocket clients) */
  db: typeof dbHttp | typeof dbWs;
  /** Runtime environment */
  environment: string;
  /** Organization ID for scoping */
  organizationId: string;
}

/**
 * ContactSettingsService
 *
 * Handles contact configuration for an organization.
 * Uses composition pattern - instantiated by PlatformSettingsService.
 */
export class ContactSettingsService extends BaseService {
  private readonly organizationId: string;

  constructor(config: ContactSettingsConfig) {
    super(config);
    this.organizationId = config.organizationId;
  }

  /**
   * Get contact settings for the organization.
   * Returns defaults if no settings exist.
   */
  async get(): Promise<ContactSettingsResponse> {
    const result = await this.db
      .select({
        platformName: schema.contactSettings.platformName,
        supportEmail: schema.contactSettings.supportEmail,
        contactUrl: schema.contactSettings.contactUrl,
        timezone: schema.contactSettings.timezone,
        // Social media URLs
        twitterUrl: schema.contactSettings.twitterUrl,
        youtubeUrl: schema.contactSettings.youtubeUrl,
        instagramUrl: schema.contactSettings.instagramUrl,
        tiktokUrl: schema.contactSettings.tiktokUrl,
      })
      .from(schema.contactSettings)
      .where(eq(schema.contactSettings.organizationId, this.organizationId))
      .limit(1);

    const row = result[0];
    if (!row) {
      this.obs.info('No contact settings found, returning defaults', {
        organizationId: this.organizationId,
      });
      return { ...DEFAULT_CONTACT };
    }

    return {
      platformName: row.platformName,
      supportEmail: row.supportEmail,
      contactUrl: row.contactUrl,
      timezone: row.timezone,
      // Social media URLs
      twitterUrl: row.twitterUrl,
      youtubeUrl: row.youtubeUrl,
      instagramUrl: row.instagramUrl,
      tiktokUrl: row.tiktokUrl,
    };
  }

  /**
   * Update contact settings.
   * Uses upsert pattern to create or update.
   */
  async update(input: UpdateContactInput): Promise<ContactSettingsResponse> {
    // Ensure hub row exists first
    await this.ensurePlatformSettingsExists();

    // Build update values from input
    const updateValues: Record<string, unknown> = {};
    if (input.platformName !== undefined) {
      updateValues.platformName = input.platformName;
    }
    if (input.supportEmail !== undefined) {
      updateValues.supportEmail = input.supportEmail;
    }
    if (input.contactUrl !== undefined) {
      updateValues.contactUrl = input.contactUrl;
    }
    if (input.timezone !== undefined) {
      updateValues.timezone = input.timezone;
    }
    // Social media URLs
    if (input.twitterUrl !== undefined) {
      updateValues.twitterUrl = input.twitterUrl;
    }
    if (input.youtubeUrl !== undefined) {
      updateValues.youtubeUrl = input.youtubeUrl;
    }
    if (input.instagramUrl !== undefined) {
      updateValues.instagramUrl = input.instagramUrl;
    }
    if (input.tiktokUrl !== undefined) {
      updateValues.tiktokUrl = input.tiktokUrl;
    }

    // If no updates, just return current state
    if (Object.keys(updateValues).length === 0) {
      return this.get();
    }

    // Upsert contact settings
    const result = await this.db
      .insert(schema.contactSettings)
      .values({
        organizationId: this.organizationId,
        platformName: input.platformName ?? DEFAULT_CONTACT.platformName,
        supportEmail: input.supportEmail ?? DEFAULT_CONTACT.supportEmail,
        contactUrl: input.contactUrl ?? DEFAULT_CONTACT.contactUrl,
        timezone: input.timezone ?? DEFAULT_CONTACT.timezone,
        // Social media URLs
        twitterUrl: input.twitterUrl ?? DEFAULT_CONTACT.twitterUrl,
        youtubeUrl: input.youtubeUrl ?? DEFAULT_CONTACT.youtubeUrl,
        instagramUrl: input.instagramUrl ?? DEFAULT_CONTACT.instagramUrl,
        tiktokUrl: input.tiktokUrl ?? DEFAULT_CONTACT.tiktokUrl,
      })
      .onConflictDoUpdate({
        target: schema.contactSettings.organizationId,
        set: {
          ...updateValues,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.obs.info('Contact settings updated', {
      organizationId: this.organizationId,
      updatedFields: Object.keys(updateValues),
    });

    const row = result[0];
    if (!row) {
      throw new SettingsUpsertError('contact', this.organizationId);
    }
    return {
      platformName: row.platformName,
      supportEmail: row.supportEmail,
      contactUrl: row.contactUrl,
      timezone: row.timezone,
      // Social media URLs
      twitterUrl: row.twitterUrl,
      youtubeUrl: row.youtubeUrl,
      instagramUrl: row.instagramUrl,
      tiktokUrl: row.tiktokUrl,
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
