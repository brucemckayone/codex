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
import {
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  sanitizeSvgContent,
  validateImageSignature,
} from '@codex/validation';
import { processImageVariants } from './processor';

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
  private r2PublicUrlBase: string;

  constructor(
    config: ServiceConfig & { r2Service: R2Service; r2PublicUrlBase: string }
  ) {
    super(config);
    this.r2Service = config.r2Service;
    this.r2PublicUrlBase = config.r2PublicUrlBase;
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
      this.r2Service.put(
        keys.sm,
        variants.sm,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
      this.r2Service.put(
        keys.md,
        variants.md,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
      this.r2Service.put(
        keys.lg,
        variants.lg,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
    ]);

    // Use LG variant as determining URL for DB
    const r2Key = keys.lg;
    const url = `${this.r2PublicUrlBase}/${r2Key}`;

    // Update content record
    await this.db
      .update(schema.content)
      .set({ thumbnailUrl: url })
      .where(eq(schema.content.id, contentId));

    return {
      url,
      size: variants.lg.byteLength,
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
      this.r2Service.put(
        keys.sm,
        variants.sm,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
      this.r2Service.put(
        keys.md,
        variants.md,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
      this.r2Service.put(
        keys.lg,
        variants.lg,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
    ]);

    const r2Key = keys.lg;
    const url = `${this.r2PublicUrlBase}/${r2Key}`;

    // Update user record (use avatarUrl for custom uploads, NOT image which is for OAuth)
    await this.db
      .update(schema.users)
      .set({ avatarUrl: url })
      .where(eq(schema.users.id, userId));

    return {
      url,
      size: variants.lg.byteLength,
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
    const buffer = await file.arrayBuffer();
    const mimeType = extractMimeType(file.type || 'image/jpeg');

    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `File size exceeds limit of ${MAX_IMAGE_SIZE_BYTES} bytes`
      );
    }

    // Special handling for SVG
    if (mimeType === 'image/svg+xml') {
      // Validate SVG signature before processing
      if (!validateImageSignature(new Uint8Array(buffer), mimeType)) {
        throw new ValidationError('Invalid SVG file signature');
      }

      const key = `${creatorId}/branding/logo/logo.svg`;

      // Sanitize SVG to remove XSS vectors (script tags, event handlers, etc.)
      const svgText = new TextDecoder().decode(new Uint8Array(buffer));
      const sanitized = await sanitizeSvgContent(svgText);
      const sanitizedBuffer = new TextEncoder().encode(sanitized);

      await this.r2Service.put(key, sanitizedBuffer, {
        contentType: 'image/svg+xml',
        cacheControl: 'public, max-age=31536000, immutable',
      });
      const url = `${this.r2PublicUrlBase}/${key}`;

      await this.db
        .update(schema.organizations)
        .set({ logoUrl: url })
        .where(eq(schema.organizations.id, organizationId));

      return {
        url,
        size: sanitizedBuffer.byteLength,
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
      this.r2Service.put(
        keys.sm,
        variants.sm,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
      this.r2Service.put(
        keys.md,
        variants.md,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
      this.r2Service.put(
        keys.lg,
        variants.lg,
        {},
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      ),
    ]);

    const r2Key = keys.lg;
    const url = `${this.r2PublicUrlBase}/${r2Key}`;

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

  /**
   * Delete all size variants for a content thumbnail
   * Called by DELETE endpoint
   */
  async deleteContentThumbnail(
    contentId: string,
    creatorId: string
  ): Promise<void> {
    const keys = [
      getContentThumbnailKey(creatorId, contentId, 'sm'),
      getContentThumbnailKey(creatorId, contentId, 'md'),
      getContentThumbnailKey(creatorId, contentId, 'lg'),
    ];

    await Promise.all(keys.map((key) => this.r2Service.delete(key)));

    // Clear database field
    await this.db
      .update(schema.content)
      .set({ thumbnailUrl: null })
      .where(eq(schema.content.id, contentId));
  }

  /**
   * Delete all size variants for a user avatar
   * Called by DELETE endpoint
   */
  async deleteUserAvatar(userId: string): Promise<void> {
    // Get current avatar URL
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { avatarUrl: true },
    });

    if (!user?.avatarUrl) {
      return; // Nothing to delete
    }

    // Delete all size variants using key helpers
    const keys = [
      getUserAvatarKey(userId, 'sm'),
      getUserAvatarKey(userId, 'md'),
      getUserAvatarKey(userId, 'lg'),
    ];
    await Promise.all(keys.map((key) => this.r2Service.delete(key)));

    // Clear database field
    await this.db
      .update(schema.users)
      .set({ avatarUrl: null, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  /**
   * Delete all size variants for an organization logo
   * Called by DELETE endpoint
   */
  async deleteOrgLogo(
    organizationId: string,
    creatorId: string
  ): Promise<void> {
    // Get current logo URL
    const org = await this.db.query.organizations.findFirst({
      where: eq(schema.organizations.id, organizationId),
      columns: { logoUrl: true },
    });

    if (!org?.logoUrl) {
      return; // Nothing to delete
    }

    // Determine if SVG or WebP
    const isSvg = org.logoUrl.includes('.svg');

    if (isSvg) {
      // Delete single SVG file
      await this.r2Service.delete(`${creatorId}/branding/logo/logo.svg`);
    } else {
      // Delete WebP variants using key helpers
      const keys = [
        getOrgLogoKey(creatorId, 'sm'),
        getOrgLogoKey(creatorId, 'md'),
        getOrgLogoKey(creatorId, 'lg'),
      ];
      await Promise.all(keys.map((key) => this.r2Service.delete(key)));
    }

    // Clear database field
    await this.db
      .update(schema.organizations)
      .set({ logoUrl: null })
      .where(eq(schema.organizations.id, organizationId));
  }
}
