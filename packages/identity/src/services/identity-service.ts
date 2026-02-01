import type { R2Service } from '@codex/cloudflare-clients';
import { users } from '@codex/database/schema';
import {
  type ImageProcessingResult,
  ImageProcessingService,
} from '@codex/image-processing';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { eq } from 'drizzle-orm';

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
}
