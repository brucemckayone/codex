import type { R2Service } from '@codex/cloudflare-clients';
import {
  notificationPreferences,
  organizationMemberships,
  users,
} from '@codex/database/schema';
import {
  type ImageProcessingResult,
  ImageProcessingService,
} from '@codex/image-processing';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { and, eq } from 'drizzle-orm';

import { UserNotFoundError } from '../errors';

export interface IdentityServiceConfig extends ServiceConfig {
  r2Service: R2Service;
  r2PublicUrlBase: string;
}

export class IdentityService extends BaseService {
  private r2Service: R2Service;
  private r2PublicUrlBase: string;

  constructor(config: IdentityServiceConfig) {
    super(config);
    this.r2Service = config.r2Service;
    this.r2PublicUrlBase = config.r2PublicUrlBase;
  }

  /**
   * Upload and process user avatar
   *
   * @param userId - User ID
   * @param file - Avatar image file
   * @returns Result containing upload URL
   */
  async uploadAvatar(
    userId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!existing) {
      throw new UserNotFoundError(userId);
    }

    // Create image processing service
    const imageService = new ImageProcessingService({
      db: this.db,
      environment: this.environment,
      r2Service: this.r2Service,
      r2PublicUrlBase: this.r2PublicUrlBase,
    });

    // Process, upload, and update DB (cleanup handled inside ImageProcessingService)
    return await imageService.processUserAvatar(userId, file);
  }

  /**
   * Get the authenticated user's membership in an organization
   *
   * @param orgId - Organization ID
   * @param userId - Authenticated user ID
   * @returns Membership info or null if not a member
   */
  async getMyMembership(
    orgId: string,
    userId: string
  ): Promise<{ role: string; status: string; joinedAt: string } | null> {
    try {
      const membership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, orgId),
          eq(organizationMemberships.userId, userId)
        ),
      });

      if (!membership) {
        return null;
      }

      return {
        role: membership.role,
        status: membership.status,
        joinedAt: membership.createdAt.toISOString(),
      };
    } catch (error) {
      this.handleError(error, 'IdentityService.getMyMembership');
    }
  }

  /**
   * Update user profile
   *
   * @param userId - User ID
   * @param input - Profile fields to update
   * @returns Updated user data
   */
  async updateProfile(
    userId: string,
    input: { name?: string }
  ): Promise<{
    id: string;
    name: string;
    email: string;
    image: string | null;
  }> {
    try {
      const updateData: Partial<{ name: string }> = {};
      if (input.name !== undefined) {
        updateData.name = input.name;
      }

      const [updated] = await this.db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      if (!updated) {
        throw new UserNotFoundError(userId);
      }

      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        image: updated.image,
      };
    } catch (error) {
      this.handleError(error, 'IdentityService.updateProfile');
    }
  }

  /**
   * Get notification preferences for a user (upserts defaults on first access)
   *
   * @param userId - User ID
   * @returns Notification preferences
   */
  async getNotificationPreferences(userId: string): Promise<{
    emailMarketing: boolean;
    emailTransactional: boolean;
    emailDigest: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      // Upsert: insert defaults if not exists, return existing if present
      const [prefs] = await this.db
        .insert(notificationPreferences)
        .values({ userId })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { userId }, // no-op update to return the row
        })
        .returning();

      return {
        emailMarketing: prefs.emailMarketing,
        emailTransactional: prefs.emailTransactional,
        emailDigest: prefs.emailDigest,
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
      };
    } catch (error) {
      this.handleError(error, 'IdentityService.getNotificationPreferences');
    }
  }

  /**
   * Update notification preferences for a user
   *
   * @param userId - User ID
   * @param input - Preference fields to update
   * @returns Updated notification preferences
   */
  async updateNotificationPreferences(
    userId: string,
    input: {
      emailMarketing?: boolean;
      emailTransactional?: boolean;
      emailDigest?: boolean;
    }
  ): Promise<{
    emailMarketing: boolean;
    emailTransactional: boolean;
    emailDigest: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> {
    try {
      // Upsert: insert with provided values or update existing
      const [prefs] = await this.db
        .insert(notificationPreferences)
        .values({
          userId,
          ...(input.emailMarketing !== undefined && {
            emailMarketing: input.emailMarketing,
          }),
          ...(input.emailTransactional !== undefined && {
            emailTransactional: input.emailTransactional,
          }),
          ...(input.emailDigest !== undefined && {
            emailDigest: input.emailDigest,
          }),
        })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: {
            ...(input.emailMarketing !== undefined && {
              emailMarketing: input.emailMarketing,
            }),
            ...(input.emailTransactional !== undefined && {
              emailTransactional: input.emailTransactional,
            }),
            ...(input.emailDigest !== undefined && {
              emailDigest: input.emailDigest,
            }),
            updatedAt: new Date(),
          },
        })
        .returning();

      return {
        emailMarketing: prefs.emailMarketing,
        emailTransactional: prefs.emailTransactional,
        emailDigest: prefs.emailDigest,
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
      };
    } catch (error) {
      this.handleError(error, 'IdentityService.updateNotificationPreferences');
    }
  }
}
