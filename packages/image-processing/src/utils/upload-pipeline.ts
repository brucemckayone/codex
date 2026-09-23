/**
 * Upload Pipeline Helpers
 *
 * Shared building blocks for the near-identical raster image pipelines inside
 * `ImageProcessingService` — `processContentThumbnail`, `processUserAvatar`,
 * `processCategoryCover`, `processCourseCover`, `processCourseHero` and
 * `processCourseSignature`. (A seventh, `processOrgLogo`, was removed in
 * Codex-z520h: it was a second org-logo implementation with no call sites.)
 *
 * Three helpers:
 *
 *   - `uploadImageVariants` — `Promise.allSettled` puts of 3 WebP variants with
 *     the canonical R2 options literal; on partial failure, deletes NOTHING,
 *     logs the rejected keys with their reasons, and throws
 *     `InternalServiceError`.
 *
 *   - `withDbUpdateOrphanCleanup` — wraps a database update; if the update
 *     throws, cleans up the supplied keys ONLY when the caller says nothing
 *     referenced them yet, records any failed deletes via `OrphanedFileService`
 *     (or warns when not configured), and rethrows the original error. Works
 *     for both 3-variant raster and 1-key SVG flows.
 *
 *   - `recordOrphansOrLog` — the one guarded way to write orphan records from a
 *     failure path; a failed insert is logged, never thrown (Codex-r85jo.3).
 *
 * ## Why neither helper may roll back by deleting a replaced key (Codex-r85jo.2)
 *
 * Every key this package builds is a pure function of `(entityId, size)` — no
 * nonce, no hash, no timestamp — so a re-upload OVERWRITES IN PLACE at the key
 * the database row already addresses. Compensating deletes were written under
 * the opposite premise (the retired docblock claimed "variants get unique
 * filenames per upload"), and under unique keys they are a correct rollback of
 * objects nothing references. Under deterministic keys they destroy live data.
 *
 * R2 `put` is atomic per object, so after a partial failure every key is in
 * exactly one state — a SUCCEEDED key holds the new bytes and its prior bytes
 * are already gone; a REJECTED key still holds its prior bytes INTACT. So no
 * deletion subset restores the prior state, and deleting "only the keys that
 * rejected" is the WORST option because it targets precisely the objects still
 * worth keeping. Doing nothing is self-healing: the succeeded keys hold new
 * bytes at URLs the row already points at, so nothing 404s, and a retry re-puts
 * all three at the same keys and converges.
 *
 * `withDbUpdateOrphanCleanup` is the one place a delete stays correct, and only
 * conditionally: on a FIRST upload the puts landed but the row never recorded
 * them, so the objects are genuine orphans. The helper cannot tell a first
 * upload from a replacement — the CALLER holds the row it is about to
 * overwrite, so it passes `keysAlreadyReferenced`.
 */
import type { R2Service } from '@codex/cloudflare-clients';
import { R2_OVERWRITTEN_OBJECT_CACHE_CONTROL } from '@codex/constants';
import type { OrphanedEntityType, OrphanedImageType } from '@codex/database';
import type { Logger } from '@codex/observability';
import { InternalServiceError } from '@codex/service-errors';
import type {
  OrphanedFileService,
  RecordOrphanInput,
} from '../orphaned-file-service';

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
 * On any rejection this deletes NOTHING — see the module docblock for why no
 * deletion subset can restore the prior state on deterministic keys. The
 * rejected keys and their R2 reasons go to `obs.error`, and the thrown error
 * names the affected VARIANTS (`sm`/`md`/`lg`) and the `failureLabel`.
 *
 * ## Where the failure detail is allowed to go
 *
 * `mapErrorToResponse` assigns `details: error.context` VERBATIM into the
 * response body for any `ServiceError`, so a thrown error is a client-facing
 * surface, not a log line. R2 rejection reasons (error codes, bucket
 * identifiers, request ids) therefore stay in `obs.error` and never reach the
 * error object.
 *
 * The thrown type is `InternalServiceError` (500), not `ValidationError` (400):
 * nothing about a failed R2 put is a problem with the user's input, and telling
 * them it is makes them retry with a different image forever while the failure
 * never appears in 5xx-rate monitoring.
 */
export async function uploadImageVariants(params: {
  keys: VariantKeys;
  variants: VariantBuffers;
  r2: R2Service;
  failureLabel: string;
  obs: Pick<Required<Logger>, 'error'>;
}): Promise<void> {
  const { keys, variants, r2, failureLabel, obs } = params;

  // Zipped rather than indexed so a rejection can be paired back to its key
  // and size without an index assertion (`noNonNullAssertion` is an error in
  // production source, and on a sparse-looking lookup it hides a real hole).
  const targets = [
    { size: 'sm', key: keys.sm, body: variants.sm },
    { size: 'md', key: keys.md, body: variants.md },
    { size: 'lg', key: keys.lg, body: variants.lg },
  ] as const;

  const uploadResults = await Promise.allSettled(
    targets.map((target) =>
      r2.put(target.key, target.body, {}, IMAGE_VARIANT_PUT_OPTIONS)
    )
  );

  const rejected = targets.flatMap((target, i) => {
    const result = uploadResults[i];
    return result?.status === 'rejected'
      ? [{ ...target, reason: String(result.reason) }]
      : [];
  });

  if (rejected.length === 0) {
    return;
  }

  obs.error('R2 image variant upload failed', {
    context: failureLabel,
    failedCount: rejected.length,
    totalCount: targets.length,
    // Keys and reasons are safe HERE and only here — this is the redacted
    // observability channel, not the response body.
    failures: rejected.map((f) => ({ key: f.key, reason: f.reason })),
  });

  throw new InternalServiceError(
    `${failureLabel} upload failed: ${rejected.length} of ${targets.length} variant(s) failed (${rejected
      .map((f) => f.size)
      .join(', ')})`,
    { failedVariants: rejected.map((f) => f.size) }
  );
}

/**
 * Run a DB update; on failure, clean up the supplied R2 keys and rethrow —
 * but ONLY when `keysAlreadyReferenced` is false.
 *
 * That flag is the whole correctness of this function (Codex-r85jo.2). By the
 * time control reaches the catch, the puts have SUCCEEDED, so the keys hold the
 * new bytes:
 *
 *   - `keysAlreadyReferenced: false` — a FIRST upload. The row never recorded
 *     these keys, nothing addresses the objects, and they leak forever unless
 *     deleted. Cleanup runs. This is the case the function exists for.
 *   - `keysAlreadyReferenced: true` — a REPLACEMENT. The keys are deterministic,
 *     so the row STILL addresses them and they now hold the new image. Deleting
 *     turns a live image into a 404, and the prior bytes are already gone
 *     (overwritten), so there is nothing to restore. Cleanup is skipped and the
 *     original error still propagates.
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
    obs: Pick<Required<Logger>, 'warn' | 'error'>;
    orphanedFileService: OrphanedFileService | undefined;
    warnContext: string;
    /**
     * Did the row already address these exact keys before this update? The
     * caller holds the row being overwritten, so only it can answer. `true`
     * suppresses the cleanup — see the docblock above.
     */
    keysAlreadyReferenced: boolean;
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
    keysAlreadyReferenced,
    warnExtras,
  } = params;

  try {
    return await dbUpdateFn();
  } catch (error) {
    if (keysAlreadyReferenced) {
      throw error;
    }

    const cleanupResults = await Promise.allSettled(
      keys.map((key) => r2.delete(key))
    );

    // Track any failed cleanups as orphans
    const failedKeys = keys.filter(
      (_, i) => cleanupResults[i]?.status === 'rejected'
    );
    if (failedKeys.length > 0) {
      if (orphanedFileService) {
        // Guarded: this insert runs BECAUSE a DB write just failed, so the two
        // failures are correlated. Unguarded, its rejection would REPLACE
        // `error` below and the caller would see the bookkeeping fault instead
        // of the cause (Codex-r85jo.3 F7).
        await recordOrphansOrLog(
          orphanedFileService,
          failedKeys.map((r2Key) => ({
            r2Key,
            imageType,
            entityId,
            entityType,
          })),
          obs,
          warnContext
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

/**
 * Record orphaned R2 keys for the `OrphanedFileCleanupDO` sweep, and NEVER
 * throw.
 *
 * Every caller reaches this from a failure path — a DB write that just
 * rejected, or R2 deletes that just rejected — and each has its own outcome to
 * deliver: rethrow the original DB error, or carry on and clear the row. The
 * orphan insert is bookkeeping for that outcome, not part of it, so a rejection
 * here must never replace it (Codex-r85jo.3 F7). The keys are logged at error
 * level on failure because that log line is then the ONLY surviving record of
 * the objects: nothing else can name them.
 */
export async function recordOrphansOrLog(
  orphanedFileService: OrphanedFileService,
  inputs: RecordOrphanInput[],
  obs: Pick<Required<Logger>, 'error'>,
  context: string
): Promise<void> {
  try {
    await orphanedFileService.recordOrphanedFiles(inputs);
  } catch (recordError) {
    obs.error('Failed to record orphaned R2 files; keys are untracked', {
      context,
      r2Keys: inputs.map((i) => i.r2Key),
      error:
        recordError instanceof Error
          ? recordError.message
          : String(recordError),
    });
  }
}
