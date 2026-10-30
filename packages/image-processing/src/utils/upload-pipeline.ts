/**
 * Upload Pipeline Helpers
 *
 * Shared building blocks for the raster still pipelines inside
 * `ImageProcessingService` — `processContentThumbnail`, `processUserAvatar`,
 * `processCategoryCover`, `processCourseCover`, `processCourseHero`,
 * `processCourseSignature` and `processPageImage`. (An eighth,
 * `processOrgLogo`, was removed in Codex-z520h: it was a second org-logo
 * implementation with no call sites.)
 *
 * ## Every upload writes a NEW folder (Codex-kk9nv.5)
 *
 * A still's files live at `{base}/{w}x{h}-{8 hex}/{sm,md,lg,xl}.webp`: the
 * picture's upright size and a nonce, so no two uploads share a key. The row
 * stores that folder (or the URL of its `lg`), so the size travels with the
 * address and no column has to hold it (owner, 2026-10-21: "why do we bake
 * this into the tables? shouldnt it be prat of the file name").
 *
 * Fresh keys make every failure the easy case, because nothing references a
 * folder until the row is written:
 *
 *   - a put that fails part way deletes whatever landed, and the row and the
 *     picture it addresses are untouched;
 *   - a row write that fails deletes all four files;
 *   - once the row points at the new folder, the folder it used to address is
 *     deleted in the same request (owner: "Inline, same request").
 *
 * Only a delete that itself fails writes an orphan row, for the existing
 * sweep. No file is ever overwritten, so every one is cached as immutable.
 *
 * Before kk9nv.5 a still's files sat directly under `{base}` at fixed keys, and
 * a re-upload overwrote them in place. That is why no failure path could
 * delete anything then (Codex-r85jo.2): the keys a failed upload had written
 * were the keys the row still addressed. Those files stay where they are until
 * the backfill, and replacing one deletes it like any other old folder
 * ({@link ownedStillFolder} recognises both shapes).
 *
 * The cost of fresh keys: nothing overwrites an old folder any more, so every
 * path that drops a reference to one must delete it, or it is kept forever.
 */
import type { R2Service } from '@codex/cloudflare-clients';
import { R2_IMMUTABLE_OBJECT_CACHE_CONTROL } from '@codex/constants';
import {
  messageForLog,
  type OrphanedEntityType,
  type OrphanedImageType,
} from '@codex/database';
import type { Logger } from '@codex/observability';
import { InternalServiceError } from '@codex/service-errors';
import { readStillFolderName, stillFolderName } from '@codex/validation';
import type {
  OrphanedFileService,
  RecordOrphanInput,
} from '../orphaned-file-service';

/** R2 keys for the three base sizes; every still also has `xl` ({@link StillKeys}). */
export interface VariantKeys {
  sm: string;
  md: string;
  lg: string;
}

/**
 * Every file a still keeps (Codex-kk9nv.5): its three sizes and `xl` at
 * min(1600, width). The upload as it came is NOT kept: in the public assets
 * bucket it would serve the photo's raw EXIF, GPS included, at a URL anyone
 * can derive from a served one (owner, 2026-10-21: "Defer originals").
 */
export interface StillKeys extends VariantKeys {
  xl: string;
}

/**
 * Every key in a still's folder (`categories/{id}/cover/{w}x{h}-{nonce}`,
 * `avatars/{userId}`, ...). One definition, so the upload that writes the
 * objects and the cleanup that deletes them can never disagree on a key.
 */
export function stillVariantKeys(folder: string): StillKeys {
  return {
    sm: `${folder}/sm.webp`,
    md: `${folder}/md.webp`,
    lg: `${folder}/lg.webp`,
    xl: `${folder}/xl.webp`,
  };
}

/**
 * Every key in a set as a flat list, for the cleanup paths. A list that named
 * only sm/md/lg would leak `xl` on every delete.
 */
export function variantKeyList(keys: StillKeys): string[] {
  return [keys.sm, keys.md, keys.lg, keys.xl];
}

/** A new folder for one upload under `base`: `{base}/{w}x{h}-{8 hex}`. */
export function newStillFolder(
  base: string,
  size: { width: number; height: number }
): string {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  return `${base}/${stillFolderName(size, nonce)}`;
}

/** A variant's file name at the end of a stored URL. */
const VARIANT_FILE = /\/(?:sm|md|lg|xl)\.webp$/;

/**
 * The folder a stored address names, but only if it is one of `base`'s own:
 * `base` itself (an upload from before kk9nv.5) or `{base}/{w}x{h}-{nonce}`.
 * Anything else is null: no address, a video's poster, a URL on another host,
 * or another entity's picture set by hand. So no cleanup can delete a file
 * this entity does not own.
 *
 * `address` is a key column's value, or, given `publicBase`, the CDN URL of
 * one of the folder's files (`{publicBase}/{folder}/lg.webp`).
 */
export function ownedStillFolder(
  address: string | null | undefined,
  base: string,
  publicBase?: string
): string | null {
  if (!address) return null;

  let folder = address;
  if (publicBase !== undefined) {
    const prefix = `${publicBase}/`;
    if (!folder.startsWith(prefix) || !VARIANT_FILE.test(folder)) return null;
    folder = folder.slice(prefix.length).replace(VARIANT_FILE, '');
  }

  if (folder === base) return folder;
  if (!folder.startsWith(`${base}/`)) return null;
  return readStillFolderName(folder.slice(base.length + 1)) ? folder : null;
}

/** WebP buffers for the four variants. Internal helper — service.ts passes a
 * structurally-matching object and never imports the named type, so this
 * stays unexported. */
interface VariantBuffers {
  sm: Uint8Array;
  md: Uint8Array;
  lg: Uint8Array;
  xl: Uint8Array;
}

/**
 * Canonical R2 put options for raster (WebP) image variants.
 *
 * The `Cache-Control` is `R2_IMMUTABLE_OBJECT_CACHE_CONTROL` from
 * `@codex/constants`, NOT a value written here. Every key this function is
 * given is new: a still's fresh folder or a page image's fresh uuid. So the
 * bytes at a URL never change, and a cache may keep them for a year (owner,
 * 2026-10-21: "Cache forever"). The reasoning lives beside the constant.
 */
const IMAGE_VARIANT_PUT_OPTIONS = {
  contentType: 'image/webp',
  cacheControl: R2_IMMUTABLE_OBJECT_CACHE_CONTROL,
} as const;

/**
 * Upload the four WebP variants to R2 in parallel via `Promise.allSettled`.
 *
 * On any rejection this throws and deletes nothing itself: the caller
 * discards the folder, because only it knows the orphan classification a
 * failed delete must be recorded under. The rejected keys and their R2
 * reasons go to `obs.error`, and the thrown error names the affected VARIANTS
 * (`sm`/`md`/`lg`/`xl`) and the `failureLabel`.
 *
 * ## Where the failure detail is allowed to go
 *
 * `mapErrorToResponse` sends a `ServiceError`'s message VERBATIM, and its
 * context as `details` for a 4xx (a 5xx's is logged instead, Codex-adcgb), so
 * a thrown error is a client-facing surface, not a log line. R2 rejection
 * reasons (error codes, bucket identifiers, request ids) therefore stay in
 * `obs.error` and never reach the error object.
 *
 * The thrown type is `InternalServiceError` (500), not `ValidationError` (400):
 * nothing about a failed R2 put is a problem with the user's input, and telling
 * them it is makes them retry with a different image forever while the failure
 * never appears in 5xx-rate monitoring.
 */
export async function uploadImageVariants(params: {
  keys: StillKeys;
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
    {
      size: 'sm',
      key: keys.sm,
      body: variants.sm,
      options: IMAGE_VARIANT_PUT_OPTIONS,
    },
    {
      size: 'md',
      key: keys.md,
      body: variants.md,
      options: IMAGE_VARIANT_PUT_OPTIONS,
    },
    {
      size: 'lg',
      key: keys.lg,
      body: variants.lg,
      options: IMAGE_VARIANT_PUT_OPTIONS,
    },
    {
      size: 'xl',
      key: keys.xl,
      body: variants.xl,
      options: IMAGE_VARIANT_PUT_OPTIONS,
    },
  ];

  const uploadResults = await Promise.allSettled(
    targets.map((target) => r2.put(target.key, target.body, {}, target.options))
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

/** Which still a set of keys belongs to, as an orphan row records it. */
export interface StillOrphanTarget {
  imageType: OrphanedImageType;
  entityType: OrphanedEntityType;
  entityId: string;
}

/**
 * Delete a still's files, recording any delete that fails as an orphan for
 * the `OrphanedFileCleanupDO` sweep, and NEVER throw.
 *
 * Every caller has its own outcome to deliver once this returns: rethrow the
 * failure that made the files unwanted, or hand back the picture that
 * replaced them. A failed delete is bookkeeping for that outcome, not part of
 * it. When no orphan service is configured, one `obs.warn` names the keys
 * instead.
 */
export async function deleteStillFiles(params: {
  keys: string[];
  target: StillOrphanTarget;
  r2: R2Service;
  obs: Pick<Required<Logger>, 'warn' | 'error'>;
  orphanedFileService: OrphanedFileService | undefined;
  context: string;
}): Promise<void> {
  const { keys, target, r2, obs, orphanedFileService, context } = params;

  const results = await Promise.allSettled(keys.map((key) => r2.delete(key)));
  const failedKeys = keys.filter((_, i) => results[i]?.status === 'rejected');
  if (failedKeys.length === 0) return;

  if (!orphanedFileService) {
    obs.warn('R2 still delete failed, no orphan service', {
      context,
      resourceId: target.entityId,
      r2Keys: failedKeys,
    });
    return;
  }

  // Guarded: when this runs because a DB write just failed, the two failures
  // are correlated, and an unguarded rejection here would REPLACE the cause the
  // caller is about to rethrow (Codex-r85jo.3 F7).
  await recordOrphansOrLog(
    orphanedFileService,
    failedKeys.map((r2Key) => ({ r2Key, ...target })),
    obs,
    context
  );
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
      // The driver's reason: the insert's own message carries every key.
      error: messageForLog(recordError),
    });
  }
}
