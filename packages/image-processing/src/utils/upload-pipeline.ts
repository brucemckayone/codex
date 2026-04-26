/**
 * Upload Pipeline Helpers
 *
 * Shared building blocks for the three near-identical raster image pipelines
 * (`processContentThumbnail`, `processUserAvatar`, `processOrgLogo`) inside
 * `ImageProcessingService`, plus the SVG branch of `processOrgLogo`.
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
import type { OrphanedEntityType, OrphanedImageType } from '@codex/database';
import { ValidationError } from '@codex/service-errors';
import type { OrphanedFileService } from '../orphaned-file-service';

/**
 * Minimal structural type for the observability `warn` channel.
 *
 * We avoid a direct dependency on `@codex/observability` here because this
 * package doesn't otherwise import it (`BaseService` owns the concrete
 * `ObservabilityClient`). The structural type matches the relevant slice of
 * `ObservabilityClient.warn(message, context)`.
 */
interface ObsWarnSink {
  warn(message: string, context?: Record<string, unknown>): void;
}

/** R2 keys for the three size variants of a raster image. */
export interface VariantKeys {
  sm: string;
  md: string;
  lg: string;
}

/** WebP buffers for the three size variants. */
export interface VariantBuffers {
  sm: Uint8Array;
  md: Uint8Array;
  lg: Uint8Array;
}

/**
 * Canonical R2 put options for raster image variants.
 *
 * Variants get unique filenames per upload (sm/md/lg under a per-entity
 * folder) so they are safe to mark immutable for 1 year. SVG logos use a
 * different (shorter) cache policy because their filename is fixed.
 */
const IMAGE_VARIANT_PUT_OPTIONS = {
  contentType: 'image/webp',
  cacheControl: 'public, max-age=31536000, immutable',
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
 * "org-logo-raster", "org-logo-svg").
 *
 * `keys` is `string[]` to support both the raster (3 variants) and SVG (1
 * key) flows. Caller passes `[keys.sm, keys.md, keys.lg]` for raster.
 */
export async function withDbUpdateOrphanCleanup<T>(
  params: {
    keys: string[];
    imageType: OrphanedImageType;
    entityId: string;
    entityType: OrphanedEntityType;
    r2: R2Service;
    obs: ObsWarnSink;
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
