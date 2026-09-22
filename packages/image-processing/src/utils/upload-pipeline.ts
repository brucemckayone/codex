/**
 * Upload Pipeline Helpers
 *
 * Shared building blocks for the near-identical raster image pipelines inside
 * `ImageProcessingService` — `processContentThumbnail`, `processUserAvatar`,
 * `processCategoryCover`, `processCourseCover`, `processCourseHero` and
 * `processCourseSignature`. (A seventh, `processOrgLogo`, was removed in
 * Codex-z520h: it was a second org-logo implementation with no call sites.)
 *
 * Two helpers:
 *
 *   - `uploadImageVariants` — `Promise.allSettled` puts of 3 WebP variants with
 *     the canonical R2 options literal; on partial failure, runs an
 *     `allSettled` cleanup of all 3 keys and throws `ValidationError`.
 *
 *   - `withDbUpdateOrphanCleanup` — wraps a database update; if the update
 *     throws, runs an `allSettled` cleanup of the supplied keys, records any
 *     failed deletes via `OrphanedFileService` (or warns when not configured),
 *     and rethrows the original error. Works for both 3-variant raster and
 *     1-key SVG flows.
 *
 * Behavior is preserved bit-for-bit from the previous inline implementations.
 */
import type { R2Service } from '@codex/cloudflare-clients';
import { R2_OVERWRITTEN_OBJECT_CACHE_CONTROL } from '@codex/constants';
import type { OrphanedEntityType, OrphanedImageType } from '@codex/database';
import type { Logger } from '@codex/observability';
import { ValidationError } from '@codex/service-errors';
import type { OrphanedFileService } from '../orphaned-file-service';

/** R2 keys for the three size variants of a raster image. */
export interface VariantKeys {
  sm: string;
  md: string;
  lg: string;
}

/** WebP buffers for the three size variants. Internal helper — service.ts
 * passes a structurally-matching object literal to `uploadImageVariants`
 * and never imports the named type, so this stays unexported. */
interface VariantBuffers {
  sm: Uint8Array;
  md: Uint8Array;
  lg: Uint8Array;
}

/**
 * Canonical R2 put options for raster (WebP) image variants.
 *
 * The `Cache-Control` is `R2_OVERWRITTEN_OBJECT_CACHE_CONTROL` from
 * `@codex/constants`, NOT a value written here. Every key this package builds
 * is a pure function of `(entityId, size)` and is overwritten in place on
 * re-upload — `processContentThumbnail`'s own docblock states that as a
 * deliberate invariant — so the object cannot claim to be immutable, which it
 * did (`public, max-age=31536000, immutable`) until Codex-p3rre. The full
 * reasoning for the chosen directives, and for the deliberately absent
 * `s-maxage`, lives beside the constant in `packages/constants/src/limits.ts`,
 * where it is shared with the org-logo path in `@codex/platform-settings` —
 * the same invariant held two hand-written strings in two packages before.
 */
const IMAGE_VARIANT_PUT_OPTIONS = {
  contentType: 'image/webp',
  cacheControl: R2_OVERWRITTEN_OBJECT_CACHE_CONTROL,
} as const;

/**
 * Upload three WebP variants to R2 in parallel via `Promise.allSettled`.
 *
 * On any rejection, all three keys are cleaned up (`Promise.allSettled` of
 * deletes — R2 delete is idempotent) and a `ValidationError` is thrown with
 * the supplied `failureLabel` (e.g. "Thumbnail", "Avatar", "Logo").
 */
export async function uploadImageVariants(params: {
  keys: VariantKeys;
  variants: VariantBuffers;
  r2: R2Service;
  failureLabel: string;
}): Promise<void> {
  const { keys, variants, r2, failureLabel } = params;

  const uploadResults = await Promise.allSettled([
    r2.put(keys.sm, variants.sm, {}, IMAGE_VARIANT_PUT_OPTIONS),
    r2.put(keys.md, variants.md, {}, IMAGE_VARIANT_PUT_OPTIONS),
    r2.put(keys.lg, variants.lg, {}, IMAGE_VARIANT_PUT_OPTIONS),
  ]);

  const failures = uploadResults.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    // Cleanup all variants (R2 delete is idempotent)
    await Promise.allSettled([
      r2.delete(keys.sm),
      r2.delete(keys.md),
      r2.delete(keys.lg),
    ]);
    throw new ValidationError(
      `${failureLabel} upload failed: ${failures.length} variant(s) failed`
    );
  }
}

/**
 * Run a DB update; on failure, clean up the supplied R2 keys and rethrow.
 *
 * If any of the cleanup deletes themselves fail, those keys are recorded via
 * `OrphanedFileService` for deferred batch cleanup. When no orphan service is
 * configured, a single `obs.warn('R2 cleanup failed after DB error', ...)` is
 * emitted with the supplied `warnContext` (e.g. "content-thumbnail",
 * "user-avatar").
 *
 * `keys` is `string[]` rather than `VariantKeys` because it once served a
 * 1-key SVG flow as well; every surviving caller passes
 * `[keys.sm, keys.md, keys.lg]`.
 */
export async function withDbUpdateOrphanCleanup<T>(
  params: {
    keys: string[];
    imageType: OrphanedImageType;
    entityId: string;
    entityType: OrphanedEntityType;
    r2: R2Service;
    obs: Pick<Logger, 'warn'>;
    orphanedFileService: OrphanedFileService | undefined;
    warnContext: string;
    /** Extra fields to include in the warn payload (e.g. creatorId). */
    warnExtras?: Record<string, unknown>;
  },
  dbUpdateFn: () => Promise<T>
): Promise<T> {
  const {
    keys,
    imageType,
    entityId,
    entityType,
    r2,
    obs,
    orphanedFileService,
    warnContext,
    warnExtras,
  } = params;

  try {
    return await dbUpdateFn();
  } catch (error) {
    const cleanupResults = await Promise.allSettled(
      keys.map((key) => r2.delete(key))
    );

    // Track any failed cleanups as orphans
    const failedKeys = keys.filter(
      (_, i) => cleanupResults[i]?.status === 'rejected'
    );
    if (failedKeys.length > 0) {
      if (orphanedFileService) {
        await orphanedFileService.recordOrphanedFiles(
          failedKeys.map((r2Key) => ({
            r2Key,
            imageType,
            entityId,
            entityType,
          }))
        );
      } else {
        obs.warn('R2 cleanup failed after DB error', {
          context: warnContext,
          resourceId: entityId,
          ...(warnExtras ?? {}),
          r2Keys: failedKeys,
        });
      }
    }
    throw error;
  }
}
