/**
 * Notification Preferences Service
 *
 * Manages user notification preferences (email opt-in/out settings).
 * Users can control which types of notifications they receive.
 *
 * Security: All operations scoped to authenticated user.
 */

import { schema } from '@codex/database';
import type {
  NewNotificationPreference,
  NotificationPreference,
} from '@codex/database/schema';
import {
  BaseService,
  InternalServiceError,
  NotFoundError,
} from '@codex/service-errors';
import type { UpdateNotificationPreferencesInput } from '@codex/validation';
import { eq } from 'drizzle-orm';

/**
 * Configuration for NotificationPreferencesService
 */
export interface NotificationPreferencesServiceConfig {
  db: typeof schema;
  environment: string;
}

/**
 * User's notification preferences
 */
export type UserNotificationPreferences = Omit<
  NotificationPreference,
  'userId'
>;

/**
 * Notification Preferences Service
 *
 * Handles user notification preference management.
 */
export class NotificationPreferencesService extends BaseService {
  // ===========================================================================
  // Get User Preferences
  // ===========================================================================

  /**
   * Get notification preferences for a user
   *
   * Creates default preferences if none exist for the user
   *
   * @param userId - User ID (BetterAuth user.id)
   * @returns User's notification preferences
   */
  async getPreferences(userId: string): Promise<UserNotificationPreferences> {
    const preferences = await this.db.query.notificationPreferences.findFirst({
      where: eq(schema.notificationPreferences.userId, userId),
    });

    // Return existing or create defaults
    if (preferences) {
      return {
        emailMarketing: preferences.emailMarketing,
        emailTransactional: preferences.emailTransactional,
        emailDigest: preferences.emailDigest,
        createdAt: preferences.createdAt,
        updatedAt: preferences.updatedAt,
      };
    }

    // Create default preferences for new user
    return this.createDefaultPreferences(userId);
  }

  /**
   * Update notification preferences for a user
   *
   * Creates preferences with defaults if none exist, then updates provided fields
   *
   * @param userId - User ID (BetterAuth user.id)
   * @param input - Partial preferences to update
   * @returns Updated notification preferences
   */
  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput
  ): Promise<UserNotificationPreferences> {
    // Validate input is not empty
    const updates = Object.keys(input).filter(
      (key) =>
        input[key as keyof UpdateNotificationPreferencesInput] !== undefined
    );

    if (updates.length === 0) {
      // No updates provided, return current preferences (or create defaults)
      return this.getPreferences(userId);
    }

    // Check if preferences exist
    const existing = await this.db.query.notificationPreferences.findFirst({
      where: eq(schema.notificationPreferences.userId, userId),
    });

    if (!existing) {
      // Create with specified values (defaults for unspecified)
      return this.createPreferences(userId, input);
    }

    // Update existing preferences
    const [updated] = await this.db
      .update(schema.notificationPreferences)
      .set({
        ...input,
        updatedAt: new Date(),
      })
      .where(eq(schema.notificationPreferences.userId, userId))
      .returning();

    if (!updated) {
      throw new NotFoundError('Notification preferences not found', {
        userId,
      });
    }

    this.obs.info('Notification preferences updated', {
      userId,
      updatedFields: updates,
    });

    return {
      emailMarketing: updated.emailMarketing,
      emailTransactional: updated.emailTransactional,
      emailDigest: updated.emailDigest,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Create default preferences for a user
   * All emails enabled by default
   */
  private async createDefaultPreferences(
    userId: string
  ): Promise<UserNotificationPreferences> {
    const defaults: NewNotificationPreference = {
      userId,
      emailMarketing: true,
      emailTransactional: true,
      emailDigest: true,
    };

    const [created] = await this.db
      .insert(schema.notificationPreferences)
      .values(defaults)
      .returning();

    if (!created) {
      throw new InternalServiceError(
        'Failed to create notification preferences',
        {
          userId,
        }
      );
    }

    this.obs.info('Default notification preferences created', { userId });

    return {
      emailMarketing: created.emailMarketing,
      emailTransactional: created.emailTransactional,
      emailDigest: created.emailDigest,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /**
   * Create preferences with specific values
   * Unspecified fields use defaults
   */
  private async createPreferences(
    userId: string,
    input: UpdateNotificationPreferencesInput
  ): Promise<UserNotificationPreferences> {
    const newPreferences: NewNotificationPreference = {
      userId,
      emailMarketing: input.emailMarketing ?? true,
      emailTransactional: input.emailTransactional ?? true,
      emailDigest: input.emailDigest ?? true,
    };

    const [created] = await this.db
      .insert(schema.notificationPreferences)
      .values(newPreferences)
      .returning();

    if (!created) {
      throw new InternalServiceError(
        'Failed to create notification preferences',
        {
          userId,
        }
      );
    }

    this.obs.info('Notification preferences created', {
      userId,
      ...input,
    });

    return {
      emailMarketing: created.emailMarketing,
      emailTransactional: created.emailTransactional,
      emailDigest: created.emailDigest,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /**
   * Check if user has opted out of a specific notification type
   *
   * @param userId - User ID
   * @param type - Type of notification to check
   * @returns true if user has opted out
   */
  async hasOptedOut(
    userId: string,
    type: 'marketing' | 'transactional' | 'digest'
  ): Promise<boolean> {
    const preferences = await this.db.query.notificationPreferences.findFirst({
      where: eq(schema.notificationPreferences.userId, userId),
    });

    if (!preferences) {
      // No preferences set - assume opted in (defaults)
      return false;
    }

    switch (type) {
      case 'marketing':
        return !preferences.emailMarketing;
      case 'transactional':
        return !preferences.emailTransactional;
      case 'digest':
        return !preferences.emailDigest;
      default:
        return false;
    }
  }
}
