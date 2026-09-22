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
 * `Cache-Control` stored on every image object this package writes.
 *
 * EVERY KEY THIS PACKAGE WRITES IS DETERMINISTIC AND IS OVERWRITTEN IN PLACE.
 * `getContentThumbnailKey(creatorId, contentId, size)`,
 * `getUserAvatarKey(userId, size)`, `getOrgLogoKey(orgId, size)` and the
 * inline `categories/{id}/cover/{size}.webp`,
 * `courses/{id}/{cover,hero,signature}/{size}.webp` keys are all a pure
 * function of the entity id and the size — no timestamp, no uuid, no content
 * hash anywhere in the package. Re-uploading writes NEW BYTES AT THE SAME KEY,
 * which `processContentThumbnail`'s own docblock states as a deliberate
 * invariant ("re-uploading a thumbnail OVERWRITES at the same keys"), and the
 * public URL is `${r2PublicUrlBase}/${key}` with no version query and no hash.
 *
 * SO THE OBJECT IS NOT IMMUTABLE AND MUST NOT SAY IT IS. This value used to be
 * `public, max-age=31536000, immutable`, justified by a comment claiming
 * "variants get unique filenames per upload" — the opposite of what the key
 * builders do. Under RFC 8246 `immutable` tells a cache it MUST NOT revalidate
 * for the whole freshness window, not even on a user-initiated reload, so a
 * replaced image kept serving the OLD bytes for up to a year with no purge
 * path (Codex-p3rre). It was latent only because production had no uploaded
 * images yet.
 *
 * WHY `max-age=3600, must-revalidate` AND DELIBERATELY NO `s-maxage`:
 *
 * - `must-revalidate` is the exact inverse of the directive removed: past one
 *   hour a cache MUST ask R2 before reusing a stored copy. R2 answers a
 *   conditional GET with a 304, so an unchanged image costs headers rather
 *   than bytes and a replaced one is picked up on the first request after the
 *   window. This is the directive the invariant actually needs — the old bytes
 *   stop being servable, rather than merely becoming "stale".
 * - 3600s is the browser window this platform has already chosen twice for the
 *   same bytes: `CACHE_PRESETS.asset` (the worker/proxy path over these
 *   objects) declares `max-age=3600`, and the production assets bucket
 *   declares `browserTtl: 3600` in `.github/config/r2-infrastructure.json`.
 *   Matching it keeps the stored header and the infrastructure in agreement
 *   instead of contradicting each other.
 * - NO `s-maxage`. `CACHE_PRESETS.asset` pairs its 3600s browser window with a
 *   24h shared one, and its stated licence for the asymmetry is that the bytes
 *   are CONTENT-ADDRESSED ("the key encodes the bytes, so a stored copy is
 *   never stale"). That argument is precisely what is false here, so the
 *   longer shared window is not available to these objects. With no
 *   `s-maxage`, a shared cache falls back to `max-age`, so one hour bounds
 *   every cache rather than just the browser.
 *
 * The objects are public and viewer-invariant, so `public` is correct and no
 * viewer can be served another's bytes; what is bounded here is how long a
 * SUPERSEDED image stays servable, not who may see it.
 *
 * OUT OF SCOPE HERE: the production assets bucket also carries a Cloudflare
 * cache rule (`cacheEverything`, `edgeTtl: 86400`) which can override what an
 * object declares at the edge. That is bucket infrastructure, not R2 object
 * metadata, and this constant cannot reach it.
 */
const DETERMINISTIC_IMAGE_CACHE_CONTROL =
  'public, max-age=3600, must-revalidate';

/** Canonical R2 put options for raster (WebP) image variants. */
const IMAGE_VARIANT_PUT_OPTIONS = {
  contentType: 'image/webp',
  cacheControl: DETERMINISTIC_IMAGE_CACHE_CONTROL,
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
