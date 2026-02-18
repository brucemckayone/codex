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
import { and, eq, isNull, ne } from 'drizzle-orm';

import { UserNotFoundError, UsernameTakenError } from '../errors';

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
   * Returns the user's role, status, and joined date for the specified organization.
   * Returns null for role/status/joinedAt if not a member (graceful degradation).
   * Does not throw errors for "not found" - this is intentional for frontend convenience.
   *
   * @param orgId - Organization ID
   * @param userId - Authenticated user ID
   * @returns Membership lookup response with role, status, and joinedAt (all null if not a member)
   */
  async getMyMembership(
    orgId: string,
    userId: string
  ): Promise<{
    role: string | null;
    status: string | null;
    joinedAt: string | null;
  }> {
    try {
      const membership = await this.db.query.organizationMemberships.findFirst({
        where: and(
          eq(organizationMemberships.organizationId, orgId),
          eq(organizationMemberships.userId, userId)
        ),
      });

      if (!membership) {
        return {
          role: null,
          status: null,
          joinedAt: null,
        };
      }

      return {
        role: membership.role,
        status: membership.status,
        joinedAt: membership.createdAt.toISOString(),
      };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.getMyMembership');
    }
  }

  /**
   * Update user profile
   *
   * @param userId - User ID
   * @param input - Profile fields to update (displayName maps to name, email requires re-verification, username/bio/socialLinks for creator profile)
   * @returns Updated user data
   */
  async updateProfile(
    userId: string,
    input: {
      displayName?: string;
      email?: string;
      username?: string | null;
      bio?: string | null;
      socialLinks?: {
        website?: string;
        twitter?: string;
        youtube?: string;
        instagram?: string;
      } | null;
    }
  ): Promise<{
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    username: string | null;
    bio: string | null;
    socialLinks: {
      website?: string;
      twitter?: string;
      youtube?: string;
      instagram?: string;
    } | null;
  }> {
    try {
      // First, fetch the current user to check if email or username is changing
      const existing = await this.db.query.users.findFirst({
        where: eq(users.id, userId),
      });

      if (!existing) {
        throw new UserNotFoundError(userId);
      }

      const updateData: Partial<{
        name: string;
        email: string;
        emailVerified: boolean;
        username: string | null;
        bio: string | null;
        socialLinks: {
          website?: string;
          twitter?: string;
          youtube?: string;
          instagram?: string;
        } | null;
      }> = {};

      // displayName maps to the 'name' column in the database
      if (input.displayName !== undefined) {
        updateData.name = input.displayName;
      }

      // If email is being changed, mark it as unverified (requires re-verification)
      if (input.email !== undefined && input.email !== existing.email) {
        updateData.email = input.email;
        updateData.emailVerified = false;
      }

      // Username uniqueness check (if changing to a new non-null username)
      if (
        input.username !== undefined &&
        input.username !== existing.username
      ) {
        if (input.username !== null) {
          // Check if username is already taken by another ACTIVE user
          // We need: username = input.username AND id != userId AND deletedAt IS NULL
          const otherUserWithUsername = await this.db.query.users.findFirst({
            where: and(
              eq(users.username, input.username),
              ne(users.id, userId),
              isNull(users.deletedAt) // Exclude soft-deleted users
            ),
          });

          if (otherUserWithUsername) {
            throw new UsernameTakenError(input.username);
          }

          this.obs.info('Username update', {
            userId,
            username: input.username,
          });
        }
        updateData.username = input.username;
      }

      // Bio update (can be set to a string or null to clear)
      if (input.bio !== undefined) {
        updateData.bio = input.bio;
      }

      // Social links update (can be set to an object or null to clear)
      if (input.socialLinks !== undefined) {
        updateData.socialLinks = input.socialLinks;
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
        emailVerified: updated.emailVerified,
        image: updated.image,
        username: updated.username ?? null,
        bio: updated.bio ?? null,
        socialLinks: updated.socialLinks ?? null,
      };
    } catch (error) {
      throw this.handleError(error, 'IdentityService.updateProfile');
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
      throw this.handleError(
        error,
        'IdentityService.getNotificationPreferences'
      );
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
      throw this.handleError(
        error,
        'IdentityService.updateNotificationPreferences'
      );
    }
  }
}
