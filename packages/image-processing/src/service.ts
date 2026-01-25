<<<<<<< HEAD

import type { R2Bucket } from '@cloudflare/workers-types';
import { R2Service } from '@codex/cloudflare-clients';
import {
  getContentThumbnailKey,
  getOrgLogoKey,
  getUserAvatarKey,
} from '@codex/transcoding';
import { MAX_IMAGE_SIZE_BYTES, validateImageUpload } from '@codex/validation';
import { processImageVariants } from './processor';

export interface ImageProcessingServiceConfig {
  r2: R2Bucket;
}

export interface ImageUploadResult {
  basePath: string;
  urls: {
    sm: string;
    md: string;
    lg: string;
  };
}

export class ImageProcessingService {
  private r2: R2Service;

  constructor(config: ImageProcessingServiceConfig) {
    this.r2 = new R2Service(config.r2);
  }

  /**
   * Process and upload a content thumbnail
   */
  async processContentThumbnail(
    creatorId: string,
    contentId: string,
    formData: FormData
  ): Promise<ImageUploadResult> {
    const validated = await validateImageUpload(formData, {
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
      fieldName: 'thumbnail', // Expected field name, or make optional/generic
    });

    // Content thumbnails are always raster -> WebP
    const inputBuffer = new Uint8Array(validated.buffer);
    const variants = processImageVariants(inputBuffer);

    const keys = {
      sm: getContentThumbnailKey(creatorId, contentId, 'sm'),
      md: getContentThumbnailKey(creatorId, contentId, 'md'),
      lg: getContentThumbnailKey(creatorId, contentId, 'lg'),
    };

    // Upload in parallel
    await Promise.all([
      this.r2.put(keys.sm, variants.sm, undefined, {
        contentType: 'image/webp',
      }),
      this.r2.put(keys.md, variants.md, undefined, {
        contentType: 'image/webp',
      }),
      this.r2.put(keys.lg, variants.lg, undefined, {
        contentType: 'image/webp',
      }),
    ]);

    return {
      basePath: `${creatorId}/content-thumbnails/${contentId}`,
      urls: keys,
=======
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
>>>>>>> 8382ae6cb976af715f83b1cc106536c18c8b47cf
    };
  }

  /**
<<<<<<< HEAD
   * Process and upload a user avatar
   */
  async processUserAvatar(
    userId: string,
    formData: FormData
  ): Promise<ImageUploadResult> {
    const validated = await validateImageUpload(formData, {
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
      fieldName: 'avatar',
    });

    const inputBuffer = new Uint8Array(validated.buffer);
    const variants = processImageVariants(inputBuffer);

    const keys = {
      sm: getUserAvatarKey(userId, 'sm'),
      md: getUserAvatarKey(userId, 'md'),
      lg: getUserAvatarKey(userId, 'lg'),
    };

    await Promise.all([
      this.r2.put(keys.sm, variants.sm, undefined, {
        contentType: 'image/webp',
      }),
      this.r2.put(keys.md, variants.md, undefined, {
        contentType: 'image/webp',
      }),
      this.r2.put(keys.lg, variants.lg, undefined, {
        contentType: 'image/webp',
      }),
    ]);

    return {
      basePath: `avatars/${userId}`,
      urls: keys,
=======
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
>>>>>>> 8382ae6cb976af715f83b1cc106536c18c8b47cf
    };
  }

  /**
<<<<<<< HEAD
   * Process and upload an organization logo
   * Supports SVG passthrough
   */
  async processOrgLogo(
    creatorId: string,
    formData: FormData
  ): Promise<ImageUploadResult> {
    const validated = await validateImageUpload(formData, {
      allowedMimeTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/svg+xml',
      ],
      maxSizeBytes: MAX_IMAGE_SIZE_BYTES,
      sanitizeSvg: true,
      fieldName: 'logo',
    });

    // Special handling for SVG
    if (validated.mimeType === 'image/svg+xml') {
      // Store as single SVG file
      const key = `${creatorId}/branding/logo/logo.svg`;
      await this.r2.put(key, validated.buffer, undefined, {
        contentType: 'image/svg+xml',
      });

      return {
        basePath: key, // For SVG, base path points to file
        urls: {
          sm: key,
          md: key,
          lg: key,
        },
      };
    }

    // Raster processing
    const inputBuffer = new Uint8Array(validated.buffer);
    const variants = processImageVariants(inputBuffer);

    const keys = {
      sm: getOrgLogoKey(creatorId, 'sm'),
      md: getOrgLogoKey(creatorId, 'md'),
      lg: getOrgLogoKey(creatorId, 'lg'),
    };

    await Promise.all([
      this.r2.put(keys.sm, variants.sm, undefined, {
        contentType: 'image/webp',
      }),
      this.r2.put(keys.md, variants.md, undefined, {
        contentType: 'image/webp',
      }),
      this.r2.put(keys.lg, variants.lg, undefined, {
        contentType: 'image/webp',
      }),
    ]);

    return {
      basePath: `${creatorId}/branding/logo`,
      urls: keys,
=======
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
>>>>>>> 8382ae6cb976af715f83b1cc106536c18c8b47cf
    };
  }
}
