/**
 * Image Processing Service
 *
 * Handles image upload validation, R2 storage coordination, and database updates
 * for thumbnails, logos, and avatars.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import {
  and,
  eq,
  messageForLog,
  schema,
  whereNotDeleted,
} from '@codex/database';
import {
  BaseService,
  InternalServiceError,
  NotFoundError,
  type ServiceConfig,
  ValidationError,
} from '@codex/service-errors';
import {
  getContentThumbnailBaseKey,
  getUserAvatarBaseKey,
} from '@codex/transcoding';
import {
  extractMimeType,
  MAX_IMAGE_SIZE_BYTES,
  readStillFolderName,
  SUPPORTED_IMAGE_MIME_TYPES,
  validateImageSignature,
} from '@codex/validation';
import {
  isStillFolderReferenced,
  type OrphanedFileService,
} from './orphaned-file-service';
import {
  pageImageKey,
  pageImageObjectKeys,
  pageImageVariantKeys,
} from './page-image-keys';
import { processStillVariants, type StillVariants } from './processor';
import { CALLER_OWNED_STILL_BASE } from './still-bases';
import {
  deleteStillFiles,
  newStillFolder,
  ownedStillFolder,
  recordOrphansOrLog,
  type StillKeys,
  type StillOrphanTarget,
  stillVariantKeys,
  uploadImageVariants,
  variantKeyList,
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
 * Validates image file before processing.
 *
 * RASTER ONLY, with no opt-out. This took an `allowSvg` flag until Codex-z520h
 * removed `processOrgLogo`, the only caller that ever passed `true`; every
 * other caller feeds `processStillVariants`, which decodes via Photon and
 * cannot rasterise SVG, so an SVG would have failed inside the Wasm decoder
 * rather than at this boundary. A flag no caller can set is an unreachable
 * branch in a security validator, so it is gone rather than defaulted. SVG
 * uploads now live only on the org-logo path in `@codex/platform-settings`
 * `BrandingSettingsService.uploadLogo`, which stores sanitized markup verbatim
 * instead of producing variants.
 *
 * @throws ValidationError if file is invalid
 */
async function validateImageFile(
  file: File
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
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    const allowed = Array.from(SUPPORTED_IMAGE_MIME_TYPES);
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

/**
 * A still ready to store (Codex-kk9nv.5): decoded once and upright, its sizes
 * made up to `xl` = min(1600, width), and its own size measured. The upload
 * itself is not kept (owner, 2026-10-21: "Defer originals"): in the public
 * assets bucket it would serve the photo's raw EXIF, GPS included.
 */
type PreparedStill = StillVariants;

/** Validate (MIME type, size, magic bytes; raster only) and prepare a still. */
async function prepareStill(file: File): Promise<PreparedStill> {
  const { buffer } = await validateImageFile(file);
  return processStillVariants(new Uint8Array(buffer));
}

/** Orphan classification for the four stills whose DB write the caller owns. */
type CallerOwnedStill =
  | { imageType: 'category_cover'; entityType: 'category' }
  | {
      imageType: 'course_cover' | 'course_hero' | 'course_signature';
      entityType: 'course';
    };

/** The log/orphan context of a dropped avatar, by why it was dropped. */
const AVATAR_DROP_CONTEXT = {
  'avatar-removed': 'user-avatar-delete',
  'account-deleted': 'user-avatar-account-deleted',
} as const;

/**
 * The folder a content thumbnail URL names, if it is one of that content's own
 * uploads (Codex-kk9nv.5). Null for a poster frame, another content's picture,
 * a URL on another host, or when no CDN base is configured.
 */
export function ownContentThumbnailFolder(
  url: string | null | undefined,
  content: { creatorId: string; contentId: string },
  publicBase: string | undefined
): string | null {
  if (!publicBase) return null;
  return ownedStillFolder(
    url,
    getContentThumbnailBaseKey(content.creatorId, content.contentId),
    publicBase
  );
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
   * Put a still's four files into a NEW folder under `base` (Codex-kk9nv.5).
   * Nothing references the folder yet, so a put that fails part way deletes
   * whatever landed and rethrows; the picture the row addresses is untouched.
   */
  private async putNewStill(
    base: string,
    still: PreparedStill,
    target: StillOrphanTarget,
    failureLabel: string
  ): Promise<{ folder: string; keys: StillKeys }> {
    const folder = newStillFolder(base, still);
    const keys = stillVariantKeys(folder);
    try {
      await uploadImageVariants({
        keys,
        variants: still.variants,
        r2: this.r2Service,
        failureLabel,
        obs: this.obs,
      });
    } catch (error) {
      await this.deleteStill(folder, target, `${target.imageType}-put-failed`);
      throw error;
    }
    return { folder, keys };
  }

  /** Delete a folder's four files; a failed delete is recorded, never thrown. */
  private deleteStill(
    folder: string,
    target: StillOrphanTarget,
    context: string
  ): Promise<void> {
    return deleteStillFiles({
      keys: variantKeyList(stillVariantKeys(folder)),
      target,
      r2: this.r2Service,
      obs: this.obs,
      orphanedFileService: this.orphanedFileService,
      context,
    });
  }

  /**
   * Run the write that points the row at a new folder, then delete the folder
   * it used to address, in the same request (owner, 2026-10-21: "Inline, same
   * request"). A failed write deletes the NEW folder instead, unless its row
   * names it after all ({@link discardUnlessAddressed}), and rethrows.
   *
   * `replaced` is the old address as {@link ownedStillFolder} read it, so it is
   * null unless the folder is this entity's own: a poster frame, another
   * entity's picture or a URL on another host is never deleted.
   */
  private async writeNewStill<T>(
    params: {
      folder: string;
      replaced: string | null;
      target: StillOrphanTarget;
    },
    write: () => Promise<T>
  ): Promise<T> {
    const { folder, replaced, target } = params;
    let result: T;
    try {
      result = await write();
    } catch (error) {
      // Committed after all: the folder it replaced is dropped, as on success.
      if (await this.discardUnlessAddressed(folder, replaced, target)) {
        await this.deleteReplaced(replaced, folder, target);
      }
      throw error;
    }
    await this.deleteReplaced(replaced, folder, target);
    return result;
  }

  private async deleteReplaced(
    replaced: string | null,
    folder: string,
    target: StillOrphanTarget
  ): Promise<void> {
    if (replaced && replaced !== folder) {
      await this.deleteStill(replaced, target, `${target.imageType}-replaced`);
    }
  }

  /**
   * After a write that reported failure, delete the new folder unless its row
   * addresses it after all (Codex-kk9nv.16). A write can commit and still
   * report failure (a COMMIT whose ack was lost, a timeout after the commit),
   * and deleting then breaks the picture the row now names.
   *
   * When the row cannot be read either, the write may or may not have landed,
   * so either folder may be the dropped one: the new folder if it did not,
   * the one it replaced if it did. Both are recorded for the sweep, which
   * asks the row again before it deletes anything. A replaced folder from
   * before Codex-kk9nv.5 (files directly under the base) is only named in the
   * log: the sweep decides an unsized folder by its re-upload check alone,
   * and would delete it while the row still uses it.
   *
   * @returns Whether the row addresses the new folder: the write landed
   */
  private async discardUnlessAddressed(
    folder: string,
    replaced: string | null,
    target: StillOrphanTarget
  ): Promise<boolean> {
    const context = `${target.imageType}-write-failed`;
    let addressed: boolean | null;
    try {
      addressed = await isStillFolderReferenced(
        this.db,
        { imageType: target.imageType, originalEntityId: target.entityId },
        folder
      );
    } catch (probeError) {
      // It may have landed or not, so either folder may be the dropped one.
      const folders =
        replaced && replaced !== folder ? [folder, replaced] : [folder];
      await this.leaveToTheSweep(folders, target, context, probeError);
      return false;
    }
    if (addressed === null) {
      // Unreachable while every type writeNewStill serves is in STILL_OWNER.
      // A type that is not has this check switched off, so say so.
      this.obs.error(
        'Still write failed and its folder cannot be placed; discarded',
        { context, resourceId: target.entityId }
      );
    }
    if (addressed) {
      this.obs.warn(
        'Still write reported failure, but its row addresses the new folder; kept',
        { context, resourceId: target.entityId }
      );
      return true;
    }
    await this.deleteStill(folder, target, context);
    return false;
  }

  /**
   * Hand folders that may or may not still be in use to the sweep, which asks
   * their row before it deletes anything (`isStillFolderReferenced`): the
   * outcome of a failed write that could not be read back. An unsized folder
   * (files directly under the base, from before Codex-kk9nv.5) is only
   * logged, at error: the sweep decides those by its re-upload check alone,
   * and would delete one that is still in use.
   *
   * Logged by each folder's name under its base (`{w}x{h}-{nonce}`): a whole
   * key holds the user's or creator's id, which production redaction hashes,
   * and the folder with it.
   */
  private async leaveToTheSweep(
    folders: string[],
    target: StillOrphanTarget,
    context: string,
    cause: unknown
  ): Promise<void> {
    const nameOf = (folder: string) => folder.split('/').at(-1) ?? '';
    const sized = folders.filter((f) => readStillFolderName(nameOf(f)));
    const unsizedKept = sized.length < folders.length;
    this.obs[unsizedKept ? 'error' : 'warn'](
      'Still change failed and its outcome is unknown; folders kept for the sweep',
      {
        context,
        resourceId: target.entityId,
        folders: sized.map(nameOf),
        ...(unsizedKept && { unsizedBaseKept: true }),
        error: messageForLog(cause),
      }
    );
    if (sized.length > 0 && this.orphanedFileService) {
      await recordOrphansOrLog(
        this.orphanedFileService,
        sized
          .flatMap((f) => variantKeyList(stillVariantKeys(f)))
          .map((r2Key) => ({ r2Key, ...target })),
        this.obs,
        context
      );
    }
  }

  /**
   * Process and store content thumbnail.
   *
   * Each upload goes to a new folder under `(creatorId, contentId)`'s base key,
   * named for the picture's size (Codex-kk9nv.5), and the row's `thumbnailUrl`
   * is that folder's `lg`. Once the row points at it, the folder it addressed
   * before is deleted, if it was this content's own. Transcoding output
   * (`media-thumbnails/{mediaId}/...`, `waveforms/{mediaId}/...`) lives under
   * other prefixes and is NEVER touched: it is the transcoding pipeline's, and
   * a row that points at a poster frame has nothing of its own to delete.
   *
   * Uploads to R2 and updates content record.
   */
  async processContentThumbnail(
    contentId: string,
    creatorId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    const still = await prepareStill(file);
    const base = getContentThumbnailBaseKey(creatorId, contentId);
    const target = {
      imageType: 'content_thumbnail',
      entityType: 'content',
      entityId: contentId,
    } as const;

    // The thumbnail this upload replaces. Read BEFORE the puts, so a failing
    // read costs nothing, and with the update's own WHERE clause, so it
    // describes exactly the row the write targets.
    const existing = await this.db.query.content.findFirst({
      where: and(
        eq(schema.content.id, contentId),
        eq(schema.content.creatorId, creatorId)
      ),
      columns: { thumbnailUrl: true },
    });

    const { folder, keys } = await this.putNewStill(
      base,
      still,
      target,
      'Thumbnail'
    );
    // The lg variant is the URL the row stores.
    const url = `${this.r2PublicUrlBase}/${keys.lg}`;

    await this.writeNewStill(
      {
        folder,
        target,
        replaced: ownContentThumbnailFolder(
          existing?.thumbnailUrl,
          { creatorId, contentId },
          this.r2PublicUrlBase
        ),
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
      size: still.variants.lg.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Run the CALLER's DB write for a still produced by `processCategoryCover` /
   * `processCourseCover` / `processCourseHero` / `processCourseSignature`, with
   * the same cleanup `processContentThumbnail` gets (Codex-29fs0).
   *
   * Those four methods only upload: the scoped DB write lives in the
   * space/org-aware service that owns the row, so this cannot be done inside
   * them. A write that fails deletes the new folder, which nothing references;
   * one that succeeds deletes `storedKey`'s folder, the picture it replaced.
   *
   * `key` is the folder the `process*` method returned, and `storedKey` the key
   * column as read BEFORE the upload. Only a folder of this entity's own is
   * ever deleted ({@link ownedStillFolder}), so a key set by hand to another
   * category's or course's picture is left alone.
   */
  async persistStillWithOrphanCleanup<T>(
    params: CallerOwnedStill & {
      key: string;
      storedKey: string | null;
      entityId: string;
    },
    dbWrite: () => Promise<T>
  ): Promise<T> {
    const { imageType, entityType, entityId } = params;
    const base = CALLER_OWNED_STILL_BASE[imageType](entityId);
    const folder = ownedStillFolder(params.key, base);
    if (!folder || folder === base) {
      // Only a folder a `process*` method just made for this entity may be
      // written here, because a failed write deletes it.
      throw new InternalServiceError(
        `${imageType} key is not a new upload of this ${entityType}`
      );
    }
    return this.writeNewStill(
      {
        folder,
        replaced: ownedStillFolder(params.storedKey, base),
        target: { imageType, entityType, entityId },
      },
      dbWrite
    );
  }

  /**
   * Delete the files of a caller-owned still that its row no longer
   * references, or whose row was deleted: a cleared course still, a category
   * cover a PATCH changed by hand, or a deleted category's cover
   * (Codex-kk9nv.14). Call it AFTER the write that dropped the reference or
   * the row. A later upload goes to a new folder, so nothing would ever
   * overwrite these files.
   *
   * Only a folder of this entity's own is deleted ({@link ownedStillFolder}),
   * and a failed delete is recorded for the sweep, never thrown.
   */
  async deleteDroppedStill(
    params: CallerOwnedStill & { entityId: string; droppedKey: string | null }
  ): Promise<void> {
    const { imageType, entityType, entityId } = params;
    const folder = ownedStillFolder(
      params.droppedKey,
      CALLER_OWNED_STILL_BASE[imageType](entityId)
    );
    if (!folder) return;
    await this.deleteStill(
      folder,
      { imageType, entityType, entityId },
      `${imageType}-dropped`
    );
  }

  /**
   * Process and store a category cover image (org landing "Browse by topic").
   *
   * Mirrors {@link processContentThumbnail}'s variant pipeline (sm/md/lg/xl WebP →
   * R2) with two deliberate differences:
   *   • It does NOT touch the database. Category ownership (the resolved space)
   *     lives in `CategoriesService`, not here, so the caller persists the
   *     returned `coverImageKey` via `categories.update(id, { coverImageKey },
   *     space)`. Keeping the DB write in the space-aware service avoids
   *     duplicating scope logic in the image layer.
   *   • Each upload goes to a new folder under `categories/{id}/cover`, named
   *     for the picture's size (Codex-kk9nv.5). The caller writes it through
   *     {@link persistStillWithOrphanCleanup}, which deletes the cover it
   *     replaced.
   *
   * @param categoryId - Owning category (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The folder's R2 key plus the md CDN URL, size, and mime type.
   *   Append `/{sm|md|lg|xl}.webp` to `coverImageKey` to address a variant.
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
    const still = await prepareStill(file);

    const { folder, keys } = await this.putNewStill(
      CALLER_OWNED_STILL_BASE.category_cover(categoryId),
      still,
      {
        imageType: 'category_cover',
        entityType: 'category',
        entityId: categoryId,
      },
      'Category cover'
    );

    return {
      coverImageKey: folder,
      // Return the md variant — the public topic list serves `${key}/md.webp`,
      // so the immediately-usable URL stays consistent with what renders.
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: still.variants.md.byteLength,
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
   * same sm/md/lg/xl WebP → R2 pipeline and the same "caller owns the DB write"
   * split — `CourseJourneyService.setCourseCoverImageKey` persists the returned
   * key org-scoped, so no scope logic is duplicated in the image layer.
   *
   * Each upload goes to a new folder under `courses/{id}/cover`, named for the
   * picture's size (Codex-kk9nv.5); {@link persistStillWithOrphanCleanup}
   * deletes the cover it replaced once the row points at the new one.
   *
   * @param courseId - Owning course (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The folder's R2 key plus the md CDN URL, size, and mime type.
   *   Append `/{sm|md|lg|xl}.webp` to `coverImageKey` to address a variant.
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
    const still = await prepareStill(file);

    const { folder, keys } = await this.putNewStill(
      CALLER_OWNED_STILL_BASE.course_cover(courseId),
      still,
      { imageType: 'course_cover', entityType: 'course', entityId: courseId },
      'Course cover'
    );

    return {
      coverImageKey: folder,
      // The md variant — journey cards serve `${key}/md.webp`, so the
      // immediately-usable URL matches what renders.
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: still.variants.md.byteLength,
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
   * Deliberately the same shape as {@link processCourseCover} — same sm/md/lg/xl
   * WebP → R2 pipeline, same "the caller owns the DB write" split
   * (`CourseJourneyService.setCourseHeroImageKey` persists the returned key
   * org-scoped, so no scope logic is duplicated in the image layer), and the same
   * `courses/{id}/…` namespace so both stills a course owns live together.
   *
   * TWO deliberate differences from the cover, both about SIZE:
   *   • The returned `url` is the **lg** variant, not `md`. A cover fills a card;
   *     a hero paints edge to edge, and handing back the 400px variant would show
   *     the creator a soft preview of the image the page will not use.
   *   • Since Codex-kk9nv.5 every still also gets `xl` at min(1600, width), so
   *     a full-bleed hero has a file to draw at 1440 instead of stretching the
   *     800px `lg`. A hero uploaded before that has no `xl` and no recorded
   *     size, and the web draws it from sm/md/lg as before. The returned `url`
   *     stays `lg`, the one size every hero, old or new, has.
   *
   * Each upload goes to a new folder under `courses/{id}/hero`, named for the
   * picture's size (Codex-kk9nv.5), exactly as the cover does.
   *
   * @param courseId - Owning course (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The folder's R2 key plus the lg CDN URL, size, and mime type.
   *   Append `/{sm|md|lg|xl}.webp` to `heroImageKey` to address a variant.
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
    // Raster-only is not an oversight: `processStillVariants` decodes through
    // Photon, which cannot rasterise SVG, so an SVG here would fail in the Wasm
    // decoder rather than at the boundary. The one path on this platform that
    // DOES accept SVG — `BrandingSettingsService.uploadLogo` in
    // `@codex/platform-settings` — stores the sanitized markup verbatim instead
    // of producing variants.
    const still = await prepareStill(file);

    const { folder, keys } = await this.putNewStill(
      CALLER_OWNED_STILL_BASE.course_hero(courseId),
      still,
      { imageType: 'course_hero', entityType: 'course', entityId: courseId },
      'Course hero'
    );

    return {
      heroImageKey: folder,
      // The lg variant — the hero serves `${key}/lg.webp`, so the
      // immediately-usable URL matches what renders (see the doc comment).
      url: `${this.r2PublicUrlBase}/${keys.lg}`,
      size: still.variants.lg.byteLength,
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
   * {@link processCourseCover} — same sm/md/lg/xl WebP → R2 pipeline, same "the
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
   * Each upload goes to a new folder under `courses/{id}/signature`, named for
   * the picture's size (Codex-kk9nv.5), exactly as the cover does.
   *
   * @param courseId - Owning course (keys are namespaced under it)
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * @returns The folder's R2 key plus the md CDN URL, size, and mime type.
   *   Append `/{sm|md|lg|xl}.webp` to `signatureImageKey` to address a variant.
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
    // Raster-only costs something real worth naming here: a signature is exactly
    // the kind of mark that is often an SVG. It still cannot come through this
    // path, because `processStillVariants` decodes via Photon, which cannot
    // rasterise SVG — an SVG would fail inside the Wasm decoder rather than at
    // this boundary. The one path on this platform that DOES accept SVG —
    // `BrandingSettingsService.uploadLogo` in `@codex/platform-settings` —
    // stores the sanitized markup verbatim instead of producing variants, and
    // that is the shape a future vector signature would have to take.
    const still = await prepareStill(file);

    const { folder, keys } = await this.putNewStill(
      CALLER_OWNED_STILL_BASE.course_signature(courseId),
      still,
      {
        imageType: 'course_signature',
        entityType: 'course',
        entityId: courseId,
      },
      'Course signature'
    );

    return {
      signatureImageKey: folder,
      // The md variant — the letter serves `${key}/md.webp`, so the
      // immediately-usable URL matches what renders (see the doc comment).
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: still.variants.md.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Process and store user avatar
   * Uploads to R2 and updates user record
   *
   * A new folder per upload, and the avatar it replaced deleted once the row
   * points at the new one, exactly as {@link processContentThumbnail}.
   */
  async processUserAvatar(
    userId: string,
    file: File
  ): Promise<ImageProcessingResult> {
    const still = await prepareStill(file);
    const base = getUserAvatarBaseKey(userId);
    const target = {
      imageType: 'avatar',
      entityType: 'user',
      entityId: userId,
    } as const;

    // The avatar this upload replaces, read before the puts.
    const existing = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { avatarUrl: true },
    });

    const { folder, keys } = await this.putNewStill(
      base,
      still,
      target,
      'Avatar'
    );
    const url = `${this.r2PublicUrlBase}/${keys.lg}`;

    await this.writeNewStill(
      {
        folder,
        target,
        replaced: ownedStillFolder(
          existing?.avatarUrl,
          base,
          this.r2PublicUrlBase
        ),
      },
      async () => {
        // Never onto a deleted account: an upload still in flight when the
        // account is deleted would put the photo back on the scrubbed row
        // (Codex-kk9nv.14). Matching no row throws, so the new folder is
        // discarded like any failed write.
        const [written] = await this.db
          .update(schema.users)
          .set({ avatarUrl: url })
          .where(
            and(eq(schema.users.id, userId), whereNotDeleted(schema.users))
          )
          // Whole rows: on the http|ws union `returning` takes no field map.
          .returning();
        if (!written) throw new NotFoundError('User not found', { userId });
      }
    );

    return {
      url,
      size: still.variants.lg.byteLength,
      mimeType: 'image/webp',
    };
  }

  /**
   * Delete a content thumbnail's files after the row moved `thumbnailUrl` off
   * them: cleared, or pointed at a poster frame (Codex-kk9nv.5). A later
   * upload goes to a new folder, so nothing would ever overwrite these.
   *
   * Only a folder of this content's own is deleted ({@link ownedStillFolder}):
   * a poster frame or another content's picture is left alone. A failed delete
   * is recorded for the sweep, never thrown.
   */
  async deleteDroppedContentThumbnail(
    contentId: string,
    creatorId: string,
    droppedUrl: string | null
  ): Promise<void> {
    const folder = ownContentThumbnailFolder(
      droppedUrl,
      { creatorId, contentId },
      this.r2PublicUrlBase
    );
    if (!folder) return;
    await this.deleteStill(
      folder,
      {
        imageType: 'content_thumbnail',
        entityType: 'content',
        entityId: contentId,
      },
      'content-thumbnail-delete'
    );
  }

  /**
   * Delete all size variants for a content thumbnail
   * Called by DELETE endpoint
   *
   * The row is cleared first and the files deleted after, so a failed clear
   * leaves the row pointing at files that still exist.
   *
   * On R2 failure: Records orphans for deferred cleanup instead of throwing
   */
  async deleteContentThumbnail(
    contentId: string,
    creatorId: string
  ): Promise<void> {
    const where = and(
      eq(schema.content.id, contentId),
      eq(schema.content.creatorId, creatorId)
    );
    const existing = await this.db.query.content.findFirst({
      where,
      columns: { thumbnailUrl: true },
    });

    await this.db
      .update(schema.content)
      .set({ thumbnailUrl: null })
      .where(where);

    await this.deleteDroppedContentThumbnail(
      contentId,
      creatorId,
      existing?.thumbnailUrl ?? null
    );
  }

  /**
   * Delete all size variants for a user avatar
   * Called by DELETE endpoint
   *
   * The row is cleared first and the files deleted after, as
   * {@link deleteContentThumbnail} does.
   *
   * The URL is read under a row lock and cleared in the same transaction
   * (Codex-kk9nv.17). Read and cleared apart, an upload committing in between
   * had its new URL nulled here while this deleted the folder it replaced, so
   * the new photo stayed public with nothing pointing at it. Locked, an
   * upload either commits first, and its photo is the one removed, or waits
   * and lands on the cleared row.
   *
   * On R2 failure: Records orphans for deferred cleanup instead of throwing
   *
   * @returns Whether there was an uploaded avatar to remove. A user whose only
   *   picture is their sign-in provider's has none (Codex-kk9nv.10).
   */
  async deleteUserAvatar(userId: string): Promise<boolean> {
    // What the locked read found, kept for the failure path below.
    let read: string | null = null;
    let droppedUrl: string | null;
    try {
      droppedUrl = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .select({ avatarUrl: schema.users.avatarUrl })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .for('update');
        if (!user?.avatarUrl) return null;
        read = user.avatarUrl;

        await tx
          .update(schema.users)
          .set({ avatarUrl: null, updatedAt: new Date() })
          .where(eq(schema.users.id, userId));
        return user.avatarUrl;
      });
    } catch (error) {
      // The clear may have committed with its ack lost: the photo the user
      // removed would then stay public with nothing naming it. Its folder goes
      // to the sweep, which keeps it if the row still names it (a rollback).
      const folder = ownedStillFolder(
        read,
        getUserAvatarBaseKey(userId),
        this.r2PublicUrlBase
      );
      if (folder) {
        await this.leaveToTheSweep(
          [folder],
          { imageType: 'avatar', entityType: 'user', entityId: userId },
          'avatar-remove-failed',
          error
        );
      }
      throw error;
    }
    if (!droppedUrl) return false;

    await this.deleteDroppedAvatar(userId, droppedUrl, 'avatar-removed');
    return true;
  }

  /**
   * The CDN cache prefix every avatar of this user is served under, current
   * and replaced: `{host}{path}/avatars/{userId}` with no scheme, the form a
   * prefix purge takes (Codex-kk9nv.15).
   */
  avatarCachePrefix(userId: string): string {
    const { host, pathname } = new URL(this.r2PublicUrlBase);
    return `${host}${pathname.replace(/\/+$/, '')}/${getUserAvatarBaseKey(userId)}`;
  }

  /**
   * Delete an avatar's files after the row dropped `avatarUrl`: a removed
   * avatar, or a deleted account's scrub (Codex-kk9nv.14). A later upload goes
   * to a new folder, so nothing would ever overwrite these.
   *
   * Only this user's own folder is deleted ({@link ownedStillFolder}), so a
   * provider's picture is left alone. A URL that names this user's avatar
   * folder but is not one of its own folders here (an older CDN host, or a
   * file or subfolder this service never writes) cannot be deleted from here,
   * and is logged so it is not lost silently. A failed delete is recorded for
   * the sweep, never thrown.
   *
   * @param cause - Why the avatar was dropped, which labels the logs
   */
  async deleteDroppedAvatar(
    userId: string,
    droppedUrl: string | null,
    cause: keyof typeof AVATAR_DROP_CONTEXT
  ): Promise<void> {
    const base = getUserAvatarBaseKey(userId);
    const folder = ownedStillFolder(droppedUrl, base, this.r2PublicUrlBase);
    if (!folder) {
      const at = droppedUrl?.indexOf(`/${base}/`) ?? -1;
      if (droppedUrl && at >= 0) {
        // A deleted account's photo left public is worth an alert. The host
        // and the path under the user's base go as their own fields: a whole
        // folder holds the 32-character user id, which production redaction
        // hashes, and the nonce with it. `userId` arrives hashed too, but the
        // hash is deterministic: hashing the accounts deleted (or changed) at
        // the log's time finds the one, and with it the folder to purge.
        const level = cause === 'account-deleted' ? 'error' : 'warn';
        this.obs[level](
          "Avatar files not deleted: the URL is not one of this user's own folders",
          {
            userId,
            cause,
            host: /^[a-z]+:\/\/([^/]+)/i.exec(droppedUrl)?.[1],
            underBase: droppedUrl.slice(
              at + base.length + 2,
              droppedUrl.lastIndexOf('/')
            ),
          }
        );
      }
      return;
    }
    await this.deleteStill(
      folder,
      { imageType: 'avatar', entityType: 'user', entityId: userId },
      AVATAR_DROP_CONTEXT[cause]
    );
  }

  /**
   * Process and store a PAGE IMAGE — free-placement uploads for the
   * landing-page builder's blocks (Codex-61zsk.10, contract amendment A3).
   *
   * DELIBERATELY NOT ANOTHER STILL SLOT. `processCourseCover` /
   * `processCourseHero` / `processCourseSignature` above each fill exactly one
   * named column per course, and the write that replaces it deletes the folder
   * it replaced. A page image has no column and no 1:1 slot: `imageId` is a
   * FRESH uuid the caller mints per upload, so every call produces its own key
   * and nothing is ever overwritten. A page
   * may hold arbitrarily many, referenced from anywhere in its `sections`
   * jsonb as an `ImageRef = { key, alt? }` (`props.image`, `props.background`,
   * `items[].image`, ...) — this method has no idea which prop, or even which
   * block, the caller will put the key into.
   *
   * Consequently this method has no `persistWithOrphanCleanup` counterpart:
   * there is no column to write, so nothing a DB failure could roll back.
   * Instead its objects are recorded as PENDING `page_image` orphans
   * the moment they land. That is what reclaims an upload no page ever
   * references (the creator picked an image and then left): the sweep acts
   * on a page image only after `PAGE_IMAGE_GRACE_MS`, and only if no page in
   * its org still references it (`OrphanedFileService.isPageImageReferenced`),
   * so recording an image that does get used is safe — it is retained, never
   * deleted. `CourseJourneyService.saveJourneyPage` nominates the images a
   * save drops the same way.
   *
   * Keys are namespaced by `pageId` AND `imageId` (`page-image-keys.ts`).
   * Replacing a value in a block means uploading a NEW image and writing its
   * (different) key over the old one. No column says which key a page dropped,
   * so the old key's bytes are untouched here and become the save-time diff's
   * job to notice, where a still's are deleted by the write that replaces it.
   *
   * @param pageId - Owning landing page (keys are namespaced under it)
   * @param imageId - Caller-minted uuid; unique per upload, never reused or
   *   overwritten
   * @param file - Uploaded image (validated: MIME allowlist, size, magic bytes)
   * FOUR variants, like every still: `xl` (`min(1600, width)`, Codex-61zsk.13)
   * means a picture drawn across the band is never an 800px file stretched.
   * Every object is in `pageImageObjectKeys`, so the upload records all four
   * and the sweep can delete all four.
   *
   * @returns The base R2 key plus the md CDN URL, size, mime type, and the
   *   source picture's own `width` and `height`, which the page stores on its
   *   `ImageRef` (`w`/`h`). Append `/{sm|md|lg|xl}.webp` to `key` to address
   *   a specific variant — the same convention
   *   `lib/page-builder/page-images.ts`'s `resolvePageImageUrl` reproduces on
   *   the web side.
   */
  async processPageImage(
    pageId: string,
    imageId: string,
    file: File
  ): Promise<{
    key: string;
    url: string;
    size: number;
    mimeType: string;
    width: number;
    height: number;
  }> {
    // Validate image (MIME type, size, magic bytes) — no SVG (raster only),
    // same posture and same reason as every still above: the processor
    // decodes via Photon, which cannot rasterise SVG.
    const still = await prepareStill(file);
    const { variants, width, height } = still;

    const key = pageImageKey(pageId, imageId);
    const keys = pageImageVariantKeys(key);
    const objectKeys = pageImageObjectKeys(key);

    try {
      await uploadImageVariants({
        keys,
        variants,
        r2: this.r2Service,
        failureLabel: 'Page image',
        obs: this.obs,
      });
    } catch (error) {
      // A fresh uuid nothing references, and a retry mints another, so
      // whatever did land is removed here and anything that cannot be removed
      // is queued. Recorded as `page_image` orphans, not via `putNewStill`,
      // because the sweep treats page images by their own grace rule.
      await this.discardPageImageObjects(pageId, objectKeys);
      throw error;
    }

    await this.recordPageImageObjects(pageId, objectKeys, 'page-image-upload');

    return {
      key,
      // The md variant — a reasonable general-purpose default for an
      // immediately-usable preview URL. A block that wants `sm`/`lg` resolves
      // its own via `resolvePageImageUrl`, exactly as it would for any other
      // stored `ImageRef`.
      url: `${this.r2PublicUrlBase}/${keys.md}`,
      size: variants.md.byteLength,
      mimeType: 'image/webp',
      width,
      height,
    };
  }

  /**
   * Queue a page image's objects for the sweep, which keeps them for as long
   * as a page references them (see {@link processPageImage}). Never throws.
   */
  private async recordPageImageObjects(
    pageId: string,
    r2Keys: string[],
    context: string
  ): Promise<void> {
    if (!this.orphanedFileService) {
      this.obs.warn('Page image not tracked for cleanup, no orphan service', {
        context,
        pageId,
        r2Keys,
      });
      return;
    }
    await recordOrphansOrLog(
      this.orphanedFileService,
      r2Keys.map((r2Key) => ({
        r2Key,
        imageType: 'page_image' as const,
        entityId: pageId,
        entityType: 'landing_page' as const,
      })),
      this.obs,
      context
    );
  }

  /** Delete a failed upload's objects now; queue any delete that fails. */
  private async discardPageImageObjects(
    pageId: string,
    r2Keys: string[]
  ): Promise<void> {
    const results = await Promise.allSettled(
      r2Keys.map((r2Key) => this.r2Service.delete(r2Key))
    );
    const failedKeys = r2Keys.filter(
      (_, i) => results[i]?.status === 'rejected'
    );
    if (failedKeys.length > 0) {
      await this.recordPageImageObjects(
        pageId,
        failedKeys,
        'page-image-upload-failed'
      );
    }
  }
}
