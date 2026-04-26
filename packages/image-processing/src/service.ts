/**
 * Image Processing Service
 *
 * Handles image upload validation, R2 storage coordination, and database updates
 * for thumbnails, logos, and avatars.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import { and, eq, schema } from '@codex/database';
import {
  BaseService,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import {
  getContentThumbnailKey,
  getOrgLogoKey,
  getUserAvatarKey,
} from '@codex/transcoding';
import {
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  SUPPORTED_IMAGE_MIME_TYPES,
  sanitizeSvgContent,
  validateImageSignature,
} from '@codex/validation';
import type { OrphanedFileService } from './orphaned-file-service';
import { processImageVariants } from './processor';
import {
  uploadImageVariants,
  type VariantKeys,
  withDbUpdateOrphanCleanup,
} from './utils/upload-pipeline';

export interface ImageProcessingResult {
  url: string;
  size: number;
  mimeType: string;
}

interface ImageProcessingServiceConfig extends ServiceConfig {
  r2Service: R2Service;
  r2PublicUrlBase: string;
  orphanedFileService?: OrphanedFileService;
}

/**
 * Validates image file before processing
 * @throws ValidationError if file is invalid
 */
async function validateImageFile(
  file: File,
  allowSvg: boolean = false
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  // 1. Check file is not empty
  if (file.size === 0) {
    throw new ValidationError('File cannot be empty');
  }

  // 2. Validate file size (5MB limit)
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    const maxMB = MAX_IMAGE_SIZE_BYTES / 1024 / 1024;
    throw new ValidationError(
      `File size exceeds maximum allowed size of ${maxMB}MB`
    );
  }

  // 3. Extract and validate MIME type
  const mimeType = extractMimeType(file.type || 'image/jpeg');

  // Check if MIME type is supported
  const isSupportedRaster = SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
  const isSvg = mimeType === 'image/svg+xml';

  if (!isSupportedRaster && !(isSvg && allowSvg)) {
    const allowed = Array.from(SUPPORTED_IMAGE_MIME_TYPES);
    if (allowSvg) allowed.push('image/svg+xml');
    throw new ValidationError(
      `Unsupported MIME type: ${mimeType}. Allowed: ${allowed.join(', ')}`
    );
  }

  // 4. Read file and validate magic bytes (signature)
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Ensure file has enough bytes to check signature
  if (bytes.length < 4) {
    throw new ValidationError(
      'File is too small to validate (minimum 4 bytes required)'
    );
  }

  if (!validateImageSignature(bytes, mimeType)) {
    throw new ValidationError(
      `File content does not match claimed MIME type (${mimeType}). Invalid file signature.`
    );
  }

  return { buffer, mimeType };
}

/** Helper: collect a `VariantKeys` object as a flat `string[]` in sm/md/lg order. */
function variantKeyList(keys: VariantKeys): string[] {
  return [keys.sm, keys.md, keys.lg];
}

/**
 * Image Processing Service
 * Coordinates image validation, R2 upload, and database updates
 */
export class ImageProcessingService extends BaseService {
  private r2Service: R2Service;
  private r2PublicUrlBase: string;
  private orphanedFileService?: OrphanedFileService;

  constructor(config: ImageProcessingServiceConfig) {
    super(config);
    this.r2Service = config.r2Service;
    this.r2PublicUrlBase = config.r2PublicUrlBase;
    this.orphanedFileService = config.orphanedFileService;
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
    // Validate image (MIME type, size, magic bytes)
    const { buffer } = await validateImageFile(file, false);

    // Process variants (HEAD logic)
    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const keys: VariantKeys = {
      sm: getContentThumbnailKey(creatorId, contentId, 'sm'),
      md: getContentThumbnailKey(creatorId, contentId, 'md'),
      lg: getContentThumbnailKey(creatorId, contentId, 'lg'),
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Thumbnail',
    });

    // Use LG variant as determining URL for DB
    const url = `${this.r2PublicUrlBase}/${keys.lg}`;

    // Update content record — cleanup R2 if DB fails
    await withDbUpdateOrphanCleanup(
      {
        keys: variantKeyList(keys),
        imageType: 'content_thumbnail',
        entityId: contentId,
        entityType: 'content',
        r2: this.r2Service,
        obs: this.obs,
        orphanedFileService: this.orphanedFileService,
        warnContext: 'content-thumbnail',
        warnExtras: { creatorId },
      },
      async () => {
        await this.db
          .update(schema.content)
          .set({ thumbnailUrl: url })
          .where(
            and(
              eq(schema.content.id, contentId),
              eq(schema.content.creatorId, creatorId)
            )
          );
      }
    );

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
    // Validate image (MIME type, size, magic bytes)
    const { buffer } = await validateImageFile(file, false);

    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const keys: VariantKeys = {
      sm: getUserAvatarKey(userId, 'sm'),
      md: getUserAvatarKey(userId, 'md'),
      lg: getUserAvatarKey(userId, 'lg'),
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Avatar',
    });

    const url = `${this.r2PublicUrlBase}/${keys.lg}`;

    // Update user record — cleanup R2 if DB fails
    await withDbUpdateOrphanCleanup(
      {
        keys: variantKeyList(keys),
        imageType: 'avatar',
        entityId: userId,
        entityType: 'user',
        r2: this.r2Service,
        obs: this.obs,
        orphanedFileService: this.orphanedFileService,
        warnContext: 'user-avatar',
      },
      async () => {
        await this.db
          .update(schema.users)
          .set({ avatarUrl: url })
          .where(eq(schema.users.id, userId));
      }
    );

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
    // Validate image (MIME type, size, magic bytes) - allow SVG for logos
    const { buffer, mimeType } = await validateImageFile(file, true);

    // Special handling for SVG
    if (mimeType === 'image/svg+xml') {
      const key = `${creatorId}/branding/logo/logo.svg`;

      // Sanitize SVG to remove XSS vectors (script tags, event handlers, etc.)
      const svgText = new TextDecoder().decode(new Uint8Array(buffer));
      const sanitized = await sanitizeSvgContent(svgText);
      const sanitizedBuffer = new TextEncoder().encode(sanitized);

      // SVG uses shorter cache (1 hour) because filename is fixed.
      // This allows logo updates to propagate within reasonable time.
      // Raster images use immutable cache since they have unique filenames per upload.
      await this.r2Service.put(
        key,
        sanitizedBuffer,
        {},
        {
          contentType: 'image/svg+xml',
          cacheControl: 'public, max-age=3600',
        }
      );
      const url = `${this.r2PublicUrlBase}/${key}`;

      try {
        await this.db
          .update(schema.organizations)
          .set({ logoUrl: url })
          .where(eq(schema.organizations.id, organizationId));
      } catch (error) {
        const cleanupResult = await this.r2Service
          .delete(key)
          .then(() => ({ success: true as const }))
          .catch((e) => ({ success: false as const, error: e }));

        if (!cleanupResult.success) {
          if (this.orphanedFileService) {
            await this.orphanedFileService.recordOrphanedFile({
              r2Key: key,
              imageType: 'logo',
              entityId: organizationId,
              entityType: 'organization',
            });
          } else {
            this.obs.warn('R2 cleanup failed after DB error', {
              context: 'org-logo-svg',
              resourceId: organizationId,
              creatorId,
              r2Keys: [key],
            });
          }
        }
        throw error;
      }

      return {
        url,
        size: sanitizedBuffer.byteLength,
        mimeType,
      };
    }

    // Raster processing
    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const keys: VariantKeys = {
      sm: getOrgLogoKey(creatorId, 'sm'),
      md: getOrgLogoKey(creatorId, 'md'),
      lg: getOrgLogoKey(creatorId, 'lg'),
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Logo',
    });

    const url = `${this.r2PublicUrlBase}/${keys.lg}`;

    // Update organization record — cleanup R2 if DB fails
    await withDbUpdateOrphanCleanup(
      {
        keys: variantKeyList(keys),
        imageType: 'logo',
        entityId: organizationId,
        entityType: 'organization',
        r2: this.r2Service,
        obs: this.obs,
        orphanedFileService: this.orphanedFileService,
        warnContext: 'org-logo-raster',
        warnExtras: { creatorId },
      },
      async () => {
        await this.db
          .update(schema.organizations)
          .set({ logoUrl: url })
          .where(eq(schema.organizations.id, organizationId));
      }
    );

    return {
      url,
      size: variants.lg.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Delete all size variants for a content thumbnail
   * Called by DELETE endpoint
   *
   * On R2 failure: Records orphans for deferred cleanup instead of throwing
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

    // Try to delete from R2, track failures as orphans
    const deleteResults = await Promise.allSettled(
      keys.map((key) => this.r2Service.delete(key))
    );

    // Record any failed deletions as orphans
    const failedKeys = keys.filter(
      (_, i) => deleteResults[i]?.status === 'rejected'
    );
    if (failedKeys.length > 0 && this.orphanedFileService) {
      await this.orphanedFileService.recordOrphanedFiles(
        failedKeys.map((r2Key) => ({
          r2Key,
          imageType: 'content_thumbnail' as const,
          entityId: contentId,
          entityType: 'content' as const,
        }))
      );
    } else if (failedKeys.length > 0) {
      this.obs.warn('R2 thumbnail deletion failed, no orphan service', {
        context: 'content-thumbnail-delete',
        contentId,
        creatorId,
        failedKeys,
      });
    }

    // Clear database field regardless of R2 result
    await this.db
      .update(schema.content)
      .set({ thumbnailUrl: null })
      .where(
        and(
          eq(schema.content.id, contentId),
          eq(schema.content.creatorId, creatorId)
        )
      );
  }

  /**
   * Delete all size variants for a user avatar
   * Called by DELETE endpoint
   *
   * On R2 failure: Records orphans for deferred cleanup instead of throwing
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

    // Try to delete from R2, track failures as orphans
    const deleteResults = await Promise.allSettled(
      keys.map((key) => this.r2Service.delete(key))
    );

    // Record any failed deletions as orphans
    const failedKeys = keys.filter(
      (_, i) => deleteResults[i]?.status === 'rejected'
    );

    if (failedKeys.length > 0 && this.orphanedFileService) {
      await this.orphanedFileService.recordOrphanedFiles(
        failedKeys.map((r2Key) => ({
          r2Key,
          imageType: 'avatar' as const,
          entityId: userId,
          entityType: 'user' as const,
        }))
      );
    } else if (failedKeys.length > 0) {
      this.obs.warn('R2 avatar deletion failed, no orphan service', {
        context: 'user-avatar-delete',
        userId,
        failedKeys,
      });
    }

    // Clear database field regardless of R2 result
    await this.db
      .update(schema.users)
      .set({ avatarUrl: null, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
  }

  /**
   * Delete all size variants for an organization logo
   * Called by DELETE endpoint
   *
   * On R2 failure: Records orphans for deferred cleanup instead of throwing
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

    let keys: string[];
    if (isSvg) {
      keys = [`${creatorId}/branding/logo/logo.svg`];
    } else {
      keys = [
        getOrgLogoKey(creatorId, 'sm'),
        getOrgLogoKey(creatorId, 'md'),
        getOrgLogoKey(creatorId, 'lg'),
      ];
    }

    // Try to delete from R2, track failures as orphans
    const deleteResults = await Promise.allSettled(
      keys.map((key) => this.r2Service.delete(key))
    );

    // Record any failed deletions as orphans
    const failedKeys = keys.filter(
      (_, i) => deleteResults[i]?.status === 'rejected'
    );

    if (failedKeys.length > 0 && this.orphanedFileService) {
      await this.orphanedFileService.recordOrphanedFiles(
        failedKeys.map((r2Key) => ({
          r2Key,
          imageType: 'logo' as const,
          entityId: organizationId,
          entityType: 'organization' as const,
        }))
      );
    } else if (failedKeys.length > 0) {
      this.obs.warn('R2 logo deletion failed, no orphan service', {
        context: 'org-logo-delete',
        organizationId,
        creatorId,
        failedKeys,
      });
    }

    // Clear database field regardless of R2 result
    await this.db
      .update(schema.organizations)
      .set({ logoUrl: null })
      .where(eq(schema.organizations.id, organizationId));
  }
}
