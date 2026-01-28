import type { R2Bucket } from '@cloudflare/workers-types';
import { users } from '@codex/database/schema';
import {
  ImageProcessingService,
  type ImageUploadResult,
} from '@codex/image-processing';
import { BaseService } from '@codex/service-errors';
import { eq } from 'drizzle-orm';
import { UserNotFoundError } from '../errors';

export interface IdentityServiceConfig {
  db: any; // Using any for BaseService compatibility, strictly typings are handled in BaseService
  r2?: R2Bucket;
}

export class IdentityService extends BaseService {
  /**
   * Upload and process user avatar
   *
   * @param userId - User ID
   * @param file - Avatar image file
   * @param r2 - R2 Bucket instance
   * @returns Result containing upload URLs
   */
  async uploadAvatar(
    userId: string,
    file: File,
    r2: R2Bucket
  ): Promise<ImageUploadResult> {
    const existing = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!existing) {
      throw new UserNotFoundError(userId);
    }

    // Process image
    const imageService = new ImageProcessingService({ r2 });

    // Convert File to FormData as expected by the service
    const formData = new FormData();
    formData.append('avatar', file);

    const result = await imageService.processUserAvatar(userId, formData);

    try {
      // Update database
      await this.db
        .update(users)
        .set({
          avatarUrl: result.basePath,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return result;
    } catch (error) {
      // Best-effort cleanup of uploaded images if DB update fails
      try {
        const keys = Object.values(result.urls);
        await Promise.all(keys.map((key) => r2.delete(key)));
      } catch (cleanupError) {
        // Log cleanup error but throw original error
        console.error('Failed to cleanup orphaned images:', cleanupError);
      }
      throw error;
    }
  }
}
