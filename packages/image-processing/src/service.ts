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
   * Process and store content thumbnail.
   *
   * Replacement semantics — important invariant:
   *   The R2 keys (sm/md/lg) are deterministic per `(creatorId, contentId)`,
   *   so re-uploading a thumbnail OVERWRITES at the same keys. This means:
   *     • the previous custom thumbnail is replaced atomically (no orphan);
   *     • transcoding output (`media-thumbnails/{mediaId}/...`,
   *       `waveforms/{mediaId}/...`) lives under different prefixes and is
   *       NEVER touched by this method — those are owned by the transcoding
   *       pipeline and serve as the immutable fallback.
   *   Do NOT change the key shape to be timestamped or content-hashed without
   *   adding an explicit "delete previous keys" step here, or the storage
   *   layer will start accumulating orphans.
   *
   * Uploads to R2 and updates content record.
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
   * Process and store a category cover image (org landing "Browse by topic").
   *
   * Mirrors {@link processContentThumbnail}'s variant pipeline (sm/md/lg WebP →
   * R2) with two deliberate differences:
   *   • It does NOT touch the database. Category ownership (the resolved space)
   *     lives in `CategoriesService`, not here, so the caller persists the
   *     returned `coverImageKey` via `categories.update(id, { coverImageKey },
   *     space)`. Keeping the DB write in the space-aware service avoids
   *     duplicating scope logic in the image layer.
   *   • Keys are namespaced by `categoryId` (`categories/{id}/cover/{size}.webp`)
   *     and therefore deterministic, so a re-upload OVERWRITES the previous
   *     cover in place — no orphaned objects on replace.
   *
   * @param categoryId - Owning category (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The base R2 key plus the lg CDN URL, size, and mime type. Append
   *   `/{sm|md|lg}.webp` to `coverImageKey` to address a specific variant.
   */
  async processCategoryCover(
    categoryId: string,
    file: File
  ): Promise<{
    coverImageKey: string;
    url: string;
    size: number;
    mimeType: string;
  }> {
    // Validate image (MIME type, size, magic bytes) — no SVG (raster only).
    const { buffer } = await validateImageFile(file, false);

    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const coverImageKey = `categories/${categoryId}/cover`;
    const keys: VariantKeys = {
      sm: `${coverImageKey}/sm.webp`,
      md: `${coverImageKey}/md.webp`,
      lg: `${coverImageKey}/lg.webp`,
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Category cover',
    });

    return {
      coverImageKey,
      // Return the md variant — the public topic list serves `${key}/md.webp`,
      // so the immediately-usable URL stays consistent with what renders.
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: variants.md.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Process and store a COURSE (journey) cover image — the still poster the
   * journey card and the sales-page share sheet render (Codex-eqh0z).
   *
   * Identical in shape to {@link processCategoryCover}, and deliberately so: a
   * course cover is a still image, and `media_items` is CHECK-constrained to
   * ('video','audio'), so the cover cannot be a media-item ref. It reuses the
   * same sm/md/lg WebP → R2 pipeline and the same "caller owns the DB write"
   * split — `CourseJourneyService.setCourseCoverImageKey` persists the returned
   * key org-scoped, so no scope logic is duplicated in the image layer.
   *
   * Keys are namespaced by `courseId` (`courses/{id}/cover/{size}.webp`) and are
   * therefore deterministic: re-uploading OVERWRITES in place, so replacing a
   * cover never orphans an R2 object.
   *
   * @param courseId - Owning course (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The base R2 key plus the md CDN URL, size, and mime type. Append
   *   `/{sm|md|lg}.webp` to `coverImageKey` to address a specific variant.
   */
  async processCourseCover(
    courseId: string,
    file: File
  ): Promise<{
    coverImageKey: string;
    url: string;
    size: number;
    mimeType: string;
  }> {
    // Validate image (MIME type, size, magic bytes) — no SVG (raster only).
    const { buffer } = await validateImageFile(file, false);

    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const coverImageKey = `courses/${courseId}/cover`;
    const keys: VariantKeys = {
      sm: `${coverImageKey}/sm.webp`,
      md: `${coverImageKey}/md.webp`,
      lg: `${coverImageKey}/lg.webp`,
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Course cover',
    });

    return {
      coverImageKey,
      // The md variant — journey cards serve `${key}/md.webp`, so the
      // immediately-usable URL matches what renders.
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: variants.md.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Process and store a COURSE (journey) HERO image — the still the sales page's
   * loudest section paints (Codex-490z7, contract amendment A32).
   *
   * WHY THIS EXISTS AT ALL. `courses.heroMediaId` is a `media_items` ref, and
   * that table is CHECK-constrained to ('video','audio'), so the "hero image" a
   * creator picked there was really the auto-generated POSTER FRAME of a video.
   * A creator who owned a photograph and no film could not put it in their own
   * hero. A32's chain is therefore `heroImageKey ?? heroMediaId's poster ??
   * synthetic plate`, and this method produces the first link.
   *
   * Deliberately the same shape as {@link processCourseCover} — same sm/md/lg
   * WebP → R2 pipeline, same "the caller owns the DB write" split
   * (`CourseJourneyService.setCourseHeroImageKey` persists the returned key
   * org-scoped, so no scope logic is duplicated in the image layer), and the same
   * `courses/{id}/…` namespace so both stills a course owns live together.
   *
   * TWO deliberate differences from the cover, both about SIZE:
   *   • The returned `url` is the **lg** variant, not `md`. A cover fills a card;
   *     a hero paints edge to edge, and handing back the 400px variant would show
   *     the creator a soft preview of the image the page will not use.
   *   • `lg` is 800px wide (`VARIANT_WIDTHS`), which is the widest this pipeline
   *     produces. On a 1440px viewport a full-bleed hero upscales it. That is a
   *     known limit of the shared variant ladder, NOT of this key: the ladder is
   *     the same one every other still in the product rides, and widening it
   *     would re-encode every existing image. Recorded here so the next reader
   *     does not mistake the softness for a bug in the hero path.
   *
   * Keys are namespaced by `courseId` (`courses/{id}/hero/{size}.webp`) and are
   * therefore deterministic: re-uploading OVERWRITES in place, so replacing a
   * hero never orphans an R2 object — the same property the cover relies on.
   *
   * @param courseId - Owning course (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The base R2 key plus the lg CDN URL, size, and mime type. Append
   *   `/{sm|md|lg}.webp` to `heroImageKey` to address a specific variant.
   */
  async processCourseHero(
    courseId: string,
    file: File
  ): Promise<{
    heroImageKey: string;
    url: string;
    size: number;
    mimeType: string;
  }> {
    // Validate image (MIME type, size, magic bytes) — no SVG (raster only).
    //
    // `allowSvg: false` matches every other variant-ladder caller and is not an
    // oversight: `processImageVariants` decodes through Photon, which cannot
    // rasterise SVG, so an SVG here would fail in the Wasm decoder rather than at
    // the boundary. The one path that DOES accept SVG (`processOrgLogo`) stores
    // the sanitized markup verbatim instead of producing variants.
    const { buffer } = await validateImageFile(file, false);

    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const heroImageKey = `courses/${courseId}/hero`;
    const keys: VariantKeys = {
      sm: `${heroImageKey}/sm.webp`,
      md: `${heroImageKey}/md.webp`,
      lg: `${heroImageKey}/lg.webp`,
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Course hero',
    });

    return {
      heroImageKey,
      // The lg variant — the hero serves `${key}/lg.webp`, so the
      // immediately-usable URL matches what renders (see the doc comment).
      url: `${this.r2PublicUrlBase}/${keys.lg}`,
      size: variants.lg.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Process and store a COURSE (journey) SIGNATURE image — the guide's sign-off
   * mark that `guide.letter` closes with (Codex-wqxv4's named-slot half).
   *
   * WHY THIS EXISTS AT ALL, and it is the sharpest case of the three stills.
   * `courses.signatureMediaId` is a `media_items` ref, and that table is
   * CHECK-constrained to ('video','audio'), so the "signature" a creator could
   * pick there was the auto-generated POSTER FRAME of a video. A signature is a
   * scan of ink — nobody films one — so unlike the hero (where a film's frame is
   * at least a plausible still) that slot could never hold the thing it named.
   * The `letter` composition has described signing off with the guide's mark
   * since it shipped, and rendered typeset text alone.
   *
   * Deliberately the same shape as {@link processCourseHero} and
   * {@link processCourseCover} — same sm/md/lg WebP → R2 pipeline, same "the
   * caller owns the DB write" split (`CourseJourneyService.
   * setCourseSignatureImageKey` persists the returned key org-scoped), and the
   * same `courses/{id}/…` namespace so every still a course owns lives together.
   *
   * ONE deliberate difference, and it is about SIZE in the opposite direction
   * from the hero: the returned `url` is the **md** (400px) variant. A signature
   * is a small inline mark — `GuideSection`'s `.guide__sig` is sized by HEIGHT
   * (`calc(var(--jp-heading-size) * 1.6)`, so roughly 50–100px depending on the
   * `type` axis) with `width: auto`, which puts a typically-wide mark somewhere
   * around 200–400 CSS px. `md` covers that at 1x and most of it at 2x; `sm`
   * (200px) would be soft on any retina display, and `lg` would ship 800px for a
   * mark that is never painted that wide.
   *
   * A NOTE ON TRANSPARENCY, because it decides what a creator should upload: the
   * variant ladder encodes WebP, which keeps an alpha channel, so a PNG of ink on
   * transparency survives the round trip and sits on the letter's own background.
   * A JPEG cannot carry alpha and will arrive as ink on a white rectangle — that
   * is a property of the source file, not of this pipeline, so the panel's hint
   * says so rather than this method trying to key out a background.
   *
   * Keys are namespaced by `courseId` (`courses/{id}/signature/{size}.webp`) and
   * are therefore deterministic: re-uploading OVERWRITES in place, so replacing a
   * signature never orphans an R2 object.
   *
   * @param courseId - Owning course (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The base R2 key plus the md CDN URL, size, and mime type. Append
   *   `/{sm|md|lg}.webp` to `signatureImageKey` to address a specific variant.
   */
  async processCourseSignature(
    courseId: string,
    file: File
  ): Promise<{
    signatureImageKey: string;
    url: string;
    size: number;
    mimeType: string;
  }> {
    // Validate image (MIME type, size, magic bytes) — no SVG (raster only).
    //
    // `allowSvg: false` matches every other variant-ladder caller, and here it
    // costs something real worth naming: a signature is exactly the kind of mark
    // that is often an SVG. It still cannot come through this path, because
    // `processImageVariants` decodes via Photon, which cannot rasterise SVG — an
    // SVG would fail inside the Wasm decoder rather than at this boundary. The
    // one path that DOES accept SVG (`processOrgLogo`) stores the sanitized
    // markup verbatim instead of producing variants, and that is the shape a
    // future vector signature would have to take.
    const { buffer } = await validateImageFile(file, false);

    const inputBuffer = new Uint8Array(buffer);
    const variants = processImageVariants(inputBuffer);

    const signatureImageKey = `courses/${courseId}/signature`;
    const keys: VariantKeys = {
      sm: `${signatureImageKey}/sm.webp`,
      md: `${signatureImageKey}/md.webp`,
      lg: `${signatureImageKey}/lg.webp`,
    };

    await uploadImageVariants({
      keys,
      variants,
      r2: this.r2Service,
      failureLabel: 'Course signature',
    });

    return {
      signatureImageKey,
      // The md variant — the letter serves `${key}/md.webp`, so the
      // immediately-usable URL matches what renders (see the doc comment).
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: variants.md.byteLength,
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
