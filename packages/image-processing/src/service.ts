/**
 * Image Processing Service
 *
 * Handles image upload validation, R2 storage coordination, and database updates
 * for thumbnails, logos, and avatars.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import { eq, schema } from '@codex/database';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import { extractMimeType, validateImageUpload } from './validation';

export interface ImageProcessingResult {
  url: string;
  size: number;
  mimeType: string;
}

/**
 * Image Processing Service
 * Coordinates image validation, R2 upload, and database updates
 */
export class ImageProcessingService extends BaseService {
  private r2Service: R2Service;
  private mediaBucket: string;

  constructor(
    config: ServiceConfig & { r2Service: R2Service; mediaBucket: string }
  ) {
    super(config);
    this.r2Service = config.r2Service;
    this.mediaBucket = config.mediaBucket;
  }

  /**
   * Process and store content thumbnail
   * Uploads to R2 and updates content record
   */
  async processContentThumbnail(
    contentId: string,
    creatorId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    // Validate image
    const buffer = await file.arrayBuffer();
    const mimeType = extractMimeType(file.type || 'image/jpeg');
    validateImageUpload(buffer, mimeType);

    // Upload to R2
    const r2Key = `${creatorId}/content-thumbnails/${contentId}/thumbnail.webp`;
    await this.r2Service.put(r2Key, new Uint8Array(buffer), {
      contentType: mimeType,
    });

    // Generate public URL (R2 public bucket)
    const url = `https://${this.mediaBucket}.s3.amazonaws.com/${r2Key}`;

    // Update content record
    await this.db
      .update(schema.content)
      .set({ thumbnailUrl: url })
      .where(eq(schema.content.id, contentId));

    return {
      url,
      size: buffer.byteLength,
      mimeType,
    };
  }

  /**
   * Process and store user avatar
   * Uploads to R2 and updates user record
   */
  async processUserAvatar(
    userId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    // Validate image
    const buffer = await file.arrayBuffer();
    const mimeType = extractMimeType(file.type || 'image/jpeg');
    validateImageUpload(buffer, mimeType);

    // Upload to R2 (user-scoped, separate from creator content)
    const r2Key = `avatars/${userId}/avatar.webp`;
    await this.r2Service.put(r2Key, new Uint8Array(buffer), {
      contentType: mimeType,
    });

    // Generate public URL
    const url = `https://${this.mediaBucket}.s3.amazonaws.com/${r2Key}`;

    // Update user record
    await this.db
      .update(schema.users)
      .set({ image: url })
      .where(eq(schema.users.id, userId));

    return {
      url,
      size: buffer.byteLength,
      mimeType,
    };
  }

  /**
   * Process and store organization logo
   * Uploads to R2 and updates organization record
   */
  async processOrgLogo(
    organizationId: string,
    creatorId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    // Validate image
    const buffer = await file.arrayBuffer();
    const mimeType = extractMimeType(file.type || 'image/jpeg');
    validateImageUpload(buffer, mimeType);

    // Upload to R2
    const r2Key = `${creatorId}/branding/logo/logo.webp`;
    await this.r2Service.put(r2Key, new Uint8Array(buffer), {
      contentType: mimeType,
    });

    // Generate public URL
    const url = `https://${this.mediaBucket}.s3.amazonaws.com/${r2Key}`;

    // Update organization record
    await this.db
      .update(schema.organizations)
      .set({ logoUrl: url })
      .where(eq(schema.organizations.id, organizationId));

    return {
      url,
      size: buffer.byteLength,
      mimeType,
    };
  }
}
