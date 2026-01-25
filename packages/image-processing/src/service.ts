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
    };
  }

  /**
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
    };
  }

  /**
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
    };
  }
}
