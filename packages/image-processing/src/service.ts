/**
 * Image Processing Service
 *
 * Handles image upload validation, R2 storage coordination, and database updates
 * for thumbnails, logos, and avatars.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import { eq, schema } from '@codex/database';
import { BaseService, type ServiceConfig } from '@codex/service-errors';
import {
  getContentThumbnailKey,
  getOrgLogoKey,
  getUserAvatarKey,
} from '@codex/transcoding';
import { MAX_IMAGE_SIZE_BYTES } from '@codex/validation';
import { processImageVariants } from './processor';
import { extractMimeType, validateImageUpload } from './validation'; // Falling back to local validation for now to match Main pattern if @codex/validation export is tricky

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

    // Check size limit (using imported constant) or validate
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `File size exceeds limit of ${MAX_IMAGE_SIZE_BYTES} bytes`
      );
    }

    // Process variants (HEAD logic)
    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const keys = {
      sm: getContentThumbnailKey(creatorId, contentId, 'sm'),
      md: getContentThumbnailKey(creatorId, contentId, 'md'),
      lg: getContentThumbnailKey(creatorId, contentId, 'lg'),
    };

    // Upload in parallel
    await Promise.all([
      this.r2Service.put(keys.sm, variants.sm, undefined, {
        contentType: 'image/webp',
      }),
      this.r2Service.put(keys.md, variants.md, undefined, {
        contentType: 'image/webp',
      }),
      this.r2Service.put(keys.lg, variants.lg, undefined, {
        contentType: 'image/webp',
      }),
    ]);

    // Use LG variant as determining URL for DB
    const r2Key = keys.lg;
    const url = `https://${this.mediaBucket}.s3.amazonaws.com/${r2Key}`;

    // Update content record
    await this.db
      .update(schema.content)
      .set({ thumbnailUrl: url })
      .where(eq(schema.content.id, contentId));

    return {
      url,
      size: variants.lg.byteLength,
      mimeType: 'image/webp',
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
    const buffer = await file.arrayBuffer();
    const mimeType = extractMimeType(file.type || 'image/jpeg');

    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `File size exceeds limit of ${MAX_IMAGE_SIZE_BYTES} bytes`
      );
    }

    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const keys = {
      sm: getUserAvatarKey(userId, 'sm'),
      md: getUserAvatarKey(userId, 'md'),
      lg: getUserAvatarKey(userId, 'lg'),
    };

    await Promise.all([
      this.r2Service.put(keys.sm, variants.sm, undefined, {
        contentType: 'image/webp',
      }),
      this.r2Service.put(keys.md, variants.md, undefined, {
        contentType: 'image/webp',
      }),
      this.r2Service.put(keys.lg, variants.lg, undefined, {
        contentType: 'image/webp',
      }),
    ]);

    const r2Key = keys.lg;
    const url = `https://${this.mediaBucket}.s3.amazonaws.com/${r2Key}`;

    // Update user record
    await this.db
      .update(schema.users)
      .set({ image: url })
      .where(eq(schema.users.id, userId));

    return {
      url,
      size: variants.lg.byteLength,
      mimeType: 'image/webp',
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
    const buffer = await file.arrayBuffer();
    const mimeType = extractMimeType(file.type || 'image/jpeg');

    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `File size exceeds limit of ${MAX_IMAGE_SIZE_BYTES} bytes`
      );
    }

    // Special handling for SVG
    if (mimeType === 'image/svg+xml') {
      const key = `${creatorId}/branding/logo/logo.svg`;
      await this.r2Service.put(key, new Uint8Array(buffer), {
        contentType: 'image/svg+xml',
      });
      const url = `https://${this.mediaBucket}.s3.amazonaws.com/${key}`;

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

    // Raster processing
    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const keys = {
      sm: getOrgLogoKey(creatorId, 'sm'),
      md: getOrgLogoKey(creatorId, 'md'),
      lg: getOrgLogoKey(creatorId, 'lg'),
    };

    await Promise.all([
      this.r2Service.put(keys.sm, variants.sm, undefined, {
        contentType: 'image/webp',
      }),
      this.r2Service.put(keys.md, variants.md, undefined, {
        contentType: 'image/webp',
      }),
      this.r2Service.put(keys.lg, variants.lg, undefined, {
        contentType: 'image/webp',
      }),
    ]);

    const r2Key = keys.lg;
    const url = `https://${this.mediaBucket}.s3.amazonaws.com/${r2Key}`;

    // Update organization record
    await this.db
      .update(schema.organizations)
      .set({ logoUrl: url })
      .where(eq(schema.organizations.id, organizationId));

    return {
      url,
      size: variants.lg.byteLength,
      mimeType: 'image/webp',
    };
  }
}
