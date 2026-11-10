/**
 * Orphaned File Service
 *
 * Manages tracking and cleanup of orphaned R2 image files.
 * Works with OrphanedFileCleanupDO (Durable Object) for periodic batch cleanup.
 */

import type {
  DatabaseClient,
  OrphanedEntityType,
  OrphanedImageType,
  OrphanStatus,
} from '@codex/database';

import {
  and,
  eq,
  gt,
  inArray,
  isFailedQuery,
  lt,
  messageForLog,
  type SQL,
  schema,
  sql,
  whereNotDeleted,
} from '@codex/database';
import { BaseService } from '@codex/service-errors';
import {
  getContentThumbnailBaseKey,
  getUserAvatarBaseKey,
} from '@codex/transcoding';
import { uuidSchema } from '@codex/validation';
import { pageIdOfPageImageKey } from './page-image-keys';
import { CALLER_OWNED_STILL_BASE } from './still-bases';
import { stillVariantKeys, variantKeyList } from './utils/upload-pipeline';

/**
 * Each sized still, by image type: the base its folders sit under for one
 * entity, and its `row`: the table that entity is a row of and the column that
 * addresses the folder. A content thumbnail's base starts with its creator's
 * id, which an orphan row does not record, so that segment is taken from the
 * folder; the rest must still be this content's.
 *
 * `row` is read when a sweep asks, not when this module loads: everything that
 * imports this package would otherwise touch `schema` on load, and a test that
 * mocks `@codex/database` without it (ecom-api's webhook handlers) fails
 * before it runs.
 */
const STILL_OWNER = {
  avatar: {
    base: (userId: string) => getUserAvatarBaseKey(userId),
    row: () => ({ table: schema.users, column: schema.users.avatarUrl }),
  },
  content_thumbnail: {
    base: (contentId: string, folder: string) =>
      getContentThumbnailBaseKey(folder.split('/', 1)[0] ?? '', contentId),
    row: () => ({ table: schema.content, column: schema.content.thumbnailUrl }),
  },
  category_cover: {
    base: CALLER_OWNED_STILL_BASE.category_cover,
    row: () => ({
      table: schema.categories,
      column: schema.categories.coverImageKey,
    }),
  },
  course_cover: {
    base: CALLER_OWNED_STILL_BASE.course_cover,
    row: () => ({
      table: schema.courses,
      column: schema.courses.coverImageKey,
    }),
  },
  course_hero: {
    base: CALLER_OWNED_STILL_BASE.course_hero,
    row: () => ({ table: schema.courses, column: schema.courses.heroImageKey }),
  },
  course_signature: {
    base: CALLER_OWNED_STILL_BASE.course_signature,
    row: () => ({
      table: schema.courses,
      column: schema.courses.signatureImageKey,
    }),
  },
} as const;

type SizedStillType = keyof typeof STILL_OWNER;

function isSizedStillType(type: OrphanedImageType): type is SizedStillType {
  return Object.hasOwn(STILL_OWNER, type);
}

/**
 * `column` addresses `folder`: a key that is the folder itself, or the URL of
 * a file in it. The trailing slash on both sides stops one nonce matching a
 * longer one.
 */
function addressesFolder(
  column: Parameters<typeof eq>[0],
  folder: string
): SQL {
  return sql`strpos(${column} || '/', ${`${folder}/`}) > 0`;
}

export interface RecordOrphanInput {
  r2Key: string;
  imageType: OrphanedImageType;
  entityId?: string;
  entityType?: OrphanedEntityType;
  fileSizeBytes?: number;
}

export interface OrphanedFileRecord {
  id: string;
  r2Key: string;
  imageType: OrphanedImageType;
  originalEntityId: string | null;
  originalEntityType: OrphanedEntityType | null;
  orphanedAt: Date;
  cleanupAttempts: number;
  lastAttemptAt: Date | null;
  status: OrphanStatus;
  errorMessage: string | null;
  fileSizeBytes: number | null;
}

export interface CleanupStats {
  processed: number;
  deleted: number;
  failed: number;
  /** Kept, terminally: a live reference, or left for a person to review. */
  retained: number;
  remaining: number;
}

/**
 * Maximum cleanup attempts before marking as failed
 */
const MAX_CLEANUP_ATTEMPTS = 3;

/**
 * Default batch size for cleanup operations
 */
const DEFAULT_BATCH_SIZE = 50;

/**
 * How long a `page_image` orphan waits before the sweep may act on it.
 *
 * A page-image row is a CANDIDATE, not a verdict: it is written when an image
 * is uploaded and again when a save drops it, and the sweep deletes the object
 * only if no page references it by then ({@link
 * OrphanedFileService.isPageImageReferenced}). The wait keeps that check from
 * running while a reference is still on its way back — an undo in the editor,
 * or an edit to a PUBLISHED page, which autosave never writes and which
 * reaches the row only when the creator publishes it. A week of unused bytes
 * costs next to nothing; deleting an image a page is about to show costs the
 * creator their page.
 */
export const PAGE_IMAGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a cover staged for Update waits before the sweep may act on it
 * (Codex-a6ofh.2.5). A stage is recorded the moment it is made, and its row
 * names it only once the creator presses Update, which may be hours later.
 * Only a stage's rows wait ({@link STAGED_COVER_NOTE}): any other cover
 * orphan is swept as before.
 */
export const STAGED_COVER_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long before the sweep may act on a stage Update stops taking it, so
 * the two never meet on one folder: the sweep deletes a folder's files one
 * key at a time.
 */
const STAGE_CLAIM_MARGIN_MS = 60 * 60 * 1000;

/**
 * What a stage's rows say, in the column that otherwise holds a cleanup's
 * last failure or a retention's reason: it marks them as a stage's, so its
 * grace, Update's claim and a later stage's retiring find them and nothing
 * else. A failed attempt overwrites it only after the grace, when the sweep
 * owns the row anyway.
 */
const STAGED_COVER_NOTE = 'Cover staged for Update (Codex-a6ofh.2.5)';

/**
 * Whether a live row still addresses a sized still folder (Codex-kk9nv.13).
 * The owning row is found by the orphan's own type and entity id, and only a
 * live one counts: a deleted entity's stills go with it (Codex-kk9nv.14).
 *
 * A sized folder is never re-written, so this, not the re-upload check, is
 * what decides it. It matters when a write committed but reported failure:
 * the upload then discards a folder its row does point at, and if that
 * delete also fails the sweep must not finish the job.
 *
 * An orphan is placed only when its folder sits under its own type's base
 * for its own entity (`STILL_OWNER`), so a row whose key and entity or type
 * disagree is never decided by another row or another column: a cover row
 * pointing into the course's hero folder must not read the cover column,
 * find nothing, and delete a live hero. And only when the id is a uuid
 * wherever the owning id is one, so the lookup cannot throw.
 *
 * @param db - The database to read the owning row from
 * @param folder - The folder the orphaned object sits in
 * @returns `null` when the orphan cannot be placed (no entity id, a type
 *   with no sized still, a folder outside that type's base for the id, or an
 *   id that is not the owning column's type), so the caller decides it some
 *   other way
 */
export async function isStillFolderReferenced(
  db: DatabaseClient,
  orphan: Pick<OrphanedFileRecord, 'imageType' | 'originalEntityId'>,
  folder: string
): Promise<boolean | null> {
  const { imageType, originalEntityId: entityId } = orphan;
  if (!entityId || !isSizedStillType(imageType)) return null;
  const owner = STILL_OWNER[imageType];
  if (!folder.startsWith(`${owner.base(entityId, folder)}/`)) return null;
  const textId = imageType === 'avatar';
  if (!textId && !uuidSchema.safeParse(entityId).success) return null;

  const { table, column } = owner.row();
  const references = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.id, entityId),
        whereNotDeleted(table),
        addressesFolder(column, folder)
      )
    )
    .limit(1);
  return references.length > 0;
}

/**
 * A stage's rows for one piece that nothing has decided yet, as conditions
 * to spread into `and()`: never an `and()` of their own, whose type admits
 * `undefined`, which an outer `and()` would drop without a word.
 */
function stagedCoverRows(contentId: string): SQL[] {
  const t = schema.orphanedImageFiles;
  return [
    eq(t.imageType, 'content_thumbnail'),
    eq(t.originalEntityId, contentId),
    eq(t.status, 'pending'),
    eq(t.errorMessage, STAGED_COVER_NOTE),
  ];
}

/** The note a stage's rows take once an Update applies it. */
const STAGE_APPLIED_NOTE = 'Applied by Update';
/** The note a stage's rows take once a later stage replaces it: still pending, so the sweep's at once. */
const STAGE_REPLACED_NOTE = 'Replaced by a later stage';

/**
 * Why a sent cover was not taken, so the PATCH kept the stored one: it was
 * `applied` by an earlier Update, `replaced` by a later stage, `too_old`
 * (in the sweep's reach, or acted on by it: any row it has failed on reads
 * so, a stage's or not, since a failed attempt writes over the note), or
 * `not_a_stage` (nothing staged for this piece there). A stage is recorded
 * whole, in one insert, so a part of one is the sweep's work, and too old.
 */
type StagedCoverRefusal = 'applied' | 'replaced' | 'too_old' | 'not_a_stage';

/**
 * Take a cover staged for this piece's Update, for the PATCH that applies
 * it (Codex-a6ofh.2.5). It is taken only whole: all four of its keys still
 * a stage's and undecided, and young enough that the sweep is not yet
 * acting on it. Its rows are then marked retained, so a stage applies once:
 * a stale form re-sending it after a later cover replaced it (and its files
 * were deleted) takes nothing, and the stored cover stays (Codex-kk9nv.5).
 * Why one was refused is {@link stagedCoverRefusal}'s, read after the PATCH.
 *
 * The rows are locked first, so a later stage retiring this one waits for
 * the PATCH and then finds them decided. Inside the PATCH's transaction: if
 * it rolls back, so does the claim. The keys are asked for by name, which
 * the r2_key index finds.
 */
export async function claimStagedCover(
  db: Pick<DatabaseClient, 'select' | 'update'>,
  contentId: string,
  folder: string,
  now: Date = new Date()
): Promise<boolean> {
  const t = schema.orphanedImageFiles;
  const keys = variantKeyList(stillVariantKeys(folder));
  const takenBefore = new Date(
    now.getTime() - STAGED_COVER_GRACE_MS + STAGE_CLAIM_MARGIN_MS
  );
  const rows = await db
    .select({ id: t.id, r2Key: t.r2Key })
    .from(t)
    .where(
      and(
        inArray(t.r2Key, keys),
        ...stagedCoverRows(contentId),
        gt(t.orphanedAt, takenBefore)
      )
    )
    .for('update');
  if (new Set(rows.map((row) => row.r2Key)).size < keys.length) return false;
  await db
    .update(t)
    .set({ status: 'retained', errorMessage: STAGE_APPLIED_NOTE })
    .where(
      inArray(
        t.id,
        rows.map((row) => row.id)
      )
    );
  return true;
}

/**
 * Why {@link claimStagedCover} refused this folder: from its rows for this
 * piece, whatever their state. For the log, so read once the PATCH is done
 * and never inside it, where a failed read would fail the Update.
 */
export async function stagedCoverRefusal(
  db: Pick<DatabaseClient, 'select'>,
  contentId: string,
  folder: string
): Promise<StagedCoverRefusal> {
  const t = schema.orphanedImageFiles;
  const keys = variantKeyList(stillVariantKeys(folder));
  const rows = await db
    .select({ note: t.errorMessage, attempts: t.cleanupAttempts })
    .from(t)
    .where(
      and(
        inArray(t.r2Key, keys),
        eq(t.imageType, 'content_thumbnail'),
        eq(t.originalEntityId, contentId)
      )
    );
  if (rows.some((row) => row.note === STAGE_APPLIED_NOTE)) return 'applied';
  if (rows.some((row) => row.note === STAGE_REPLACED_NOTE)) return 'replaced';
  // Still a stage's, but past what Update takes: too near the sweep, or
  // part-way through it (each row is swept alone; a failed attempt writes
  // its error over the note).
  if (rows.some((row) => row.note === STAGED_COVER_NOTE || row.attempts > 0)) {
    return 'too_old';
  }
  return 'not_a_stage';
}

export class OrphanedFileService extends BaseService {
  /**
   * Record an orphaned file for deferred cleanup
   *
   * Called when R2 cleanup fails after a database operation,
   * or when an entity is deleted and its images need cleanup.
   */
  async recordOrphanedFile(input: RecordOrphanInput): Promise<string> {
    const records = await this.db
      .insert(schema.orphanedImageFiles)
      .values({
        r2Key: input.r2Key,
        imageType: input.imageType,
        originalEntityId: input.entityId,
        originalEntityType: input.entityType,
        fileSizeBytes: input.fileSizeBytes,
        status: 'pending',
        orphanedAt: new Date(),
      })
      .returning();

    const record = records[0];
    if (!record) {
      throw new Error('Failed to insert orphaned file record');
    }

    this.obs.info('Orphaned file recorded', {
      orphanId: record.id,
      r2Key: input.r2Key,
      imageType: input.imageType,
      entityId: input.entityId,
      entityType: input.entityType,
    });

    return record.id;
  }

  /**
   * Record multiple orphaned files in a single transaction
   *
   * Used when deleting multiple variants (sm, md, lg) at once.
   */
  async recordOrphanedFiles(inputs: RecordOrphanInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];

    const records = await this.db
      .insert(schema.orphanedImageFiles)
      .values(
        inputs.map((input) => ({
          r2Key: input.r2Key,
          imageType: input.imageType,
          originalEntityId: input.entityId,
          originalEntityType: input.entityType,
          fileSizeBytes: input.fileSizeBytes,
          status: 'pending' as const,
          orphanedAt: new Date(),
        }))
      )
      .returning();

    const ids = records.map((r) => r.id);

    this.obs.info('Multiple orphaned files recorded', {
      count: ids.length,
      r2Keys: inputs.map((i) => i.r2Key),
    });

    return ids;
  }

  /**
   * Record a cover staged for a piece's Update (Codex-a6ofh.2.5): its keys,
   * marked as a stage's, so they wait out {@link STAGED_COVER_GRACE_MS} and
   * Update can take them ({@link claimStagedCover}).
   */
  async recordStagedCover(
    contentId: string,
    keys: readonly string[],
    stagedAt: Date = new Date()
  ): Promise<string[]> {
    const records = await this.db
      .insert(schema.orphanedImageFiles)
      .values(
        keys.map((r2Key) => ({
          r2Key,
          imageType: 'content_thumbnail' as const,
          originalEntityId: contentId,
          originalEntityType: 'content' as const,
          status: 'pending' as const,
          errorMessage: STAGED_COVER_NOTE,
          orphanedAt: stagedAt,
        }))
      )
      .returning();
    return records.map((record) => record.id);
  }

  /**
   * Hand a piece's stages recorded before `stagedAt` (a new stage's own
   * time) to the sweep, and return them for the caller to delete at once
   * (Codex-a6ofh.2.5): a piece holds one staged cover at a time, and staging
   * never fills the sweep. One statement, and only the note changes: an
   * Update can no longer take them, their grace ends, and they stay pending
   * until their files are gone ({@link markReplacedStagesDeleted}), as any
   * orphan does. So whatever happens after this, even a retire that fails
   * to answer yet commits, the sweep finishes it, and no row says deleted
   * while its files remain.
   *
   * Only stages still undecided and in their grace: one an Update has taken
   * (whose rows it locks) is never among them, and an older one is the
   * sweep's already. Strictly before: two stages sent together each replace
   * only what came before them, so the later one stays whichever finishes
   * first.
   */
  async retireStagedCovers(
    contentId: string,
    stagedAt: Date
  ): Promise<{ id: string; r2Key: string }[]> {
    const t = schema.orphanedImageFiles;
    const inGrace = new Date(stagedAt.getTime() - STAGED_COVER_GRACE_MS);
    const replaced = await this.db
      .update(t)
      .set({ errorMessage: STAGE_REPLACED_NOTE })
      .where(
        and(
          ...stagedCoverRows(contentId),
          gt(t.orphanedAt, inGrace),
          lt(t.orphanedAt, stagedAt)
        )
      )
      .returning();
    return replaced.map(({ id, r2Key }) => ({ id, r2Key }));
  }

  /**
   * Mark replaced stages deleted once their files are gone, as the sweep
   * marks its own: only this piece's rows that a retire handed over and the
   * sweep has not since decided.
   */
  async markReplacedStagesDeleted(
    contentId: string,
    ids: readonly string[]
  ): Promise<void> {
    if (ids.length === 0) return;
    const t = schema.orphanedImageFiles;
    await this.db
      .update(t)
      .set({ status: 'deleted', lastAttemptAt: new Date() })
      .where(
        and(
          inArray(t.id, ids),
          eq(t.imageType, 'content_thumbnail'),
          eq(t.originalEntityId, contentId),
          eq(t.status, 'pending'),
          eq(t.errorMessage, STAGE_REPLACED_NOTE)
        )
      );
  }

  /**
   * Get pending orphans for cleanup
   *
   * Orders by orphanedAt (oldest first) to ensure FIFO processing.
   * Only returns orphans with attempts < MAX_CLEANUP_ATTEMPTS, a
   * `page_image` orphan only once {@link PAGE_IMAGE_GRACE_MS} has passed,
   * and a staged cover only once {@link STAGED_COVER_GRACE_MS} has.
   */
  async getPendingOrphans(
    limit: number = DEFAULT_BATCH_SIZE,
    now: Date = new Date()
  ): Promise<OrphanedFileRecord[]> {
    const pageImagesDueBefore = new Date(now.getTime() - PAGE_IMAGE_GRACE_MS);
    const stagesDueBefore = new Date(now.getTime() - STAGED_COVER_GRACE_MS);
    const orphans = await this.db
      .select()
      .from(schema.orphanedImageFiles)
      .where(
        and(
          eq(schema.orphanedImageFiles.status, 'pending'),
          lt(schema.orphanedImageFiles.cleanupAttempts, MAX_CLEANUP_ATTEMPTS),
          // A `sql` fragment, not `or(...)`: drizzle types `or()` as
          // `SQL | undefined`, and `and()` drops an undefined argument
          // silently, which here would sweep page images with no wait.
          sql`(${schema.orphanedImageFiles.imageType} <> 'page_image' OR ${schema.orphanedImageFiles.orphanedAt} < ${pageImagesDueBefore})`,
          sql`(${schema.orphanedImageFiles.errorMessage} IS DISTINCT FROM ${STAGED_COVER_NOTE} OR ${schema.orphanedImageFiles.orphanedAt} < ${stagesDueBefore})`
        )
      )
      .orderBy(schema.orphanedImageFiles.orphanedAt)
      .limit(limit);

    return orphans as OrphanedFileRecord[];
  }

  /**
   * Whether any landing page still references a page image — the check the
   * sweep makes before it deletes one, and the only authority on it.
   *
   * The save-time diff that queues a page image cannot be: undo re-adds a key
   * after the save that dropped it, a duplicated page renders its source's
   * keys, and two overlapping saves diff against the same old row. So the
   * question is asked again, of the rows as they are now, immediately before
   * the delete.
   *
   * Searches the pages of the org that owns the key's page (the page id is
   * part of the key), because that is where a legitimate reference can be:
   * the page itself, or a page duplicated from it. Soft-deleted pages count,
   * since a restore brings their images back. A key pasted into another org's
   * page does not keep the image alive, and never gets it deleted either:
   * only its own org's pages decide.
   *
   * @param baseKey - The base key a block stores (`ImageRef.key`), not an
   *   object key
   * @returns `true` when a page references it, and for a key whose page
   *   cannot be read from it — a key this service cannot place is kept
   */
  async isPageImageReferenced(baseKey: string): Promise<boolean> {
    const pageId = pageIdOfPageImageKey(baseKey);
    if (!pageId) return true;

    const owningOrg = this.db
      .select({ organizationId: schema.landingPages.organizationId })
      .from(schema.landingPages)
      .where(eq(schema.landingPages.id, pageId));

    const references = await this.db
      .select({ id: schema.landingPages.id })
      .from(schema.landingPages)
      .where(
        and(
          inArray(schema.landingPages.organizationId, owningOrg),
          sql`strpos(${schema.landingPages.sections}::text, ${baseKey}) > 0`
        )
      )
      .limit(1);

    return references.length > 0;
  }

  /** {@link isStillFolderReferenced}, on this service's database. */
  isStillFolderReferenced(
    orphan: Pick<OrphanedFileRecord, 'imageType' | 'originalEntityId'>,
    folder: string
  ): Promise<boolean | null> {
    return isStillFolderReferenced(this.db, orphan, folder);
  }

  /**
   * Which of these page-image objects an upload minted (Codex-61zsk.17).
   *
   * A save nominates the objects behind each key it drops, and a key is only
   * text in `sections`: a manager can write any string of the minted shape
   * and drop it, and every nomination lands in the one queue all tenants'
   * cleanup shares. An upload records its objects here as it stores them
   * (`ImageProcessingService`), and a row is never removed, only marked, so
   * an object with a `page_image` row of any status is one an upload made.
   * Only those are worth a nomination; a fabricated key has none.
   *
   * @param r2Keys - Object keys (`pageImageObjectKeys`), not base keys
   * @returns The subset of `r2Keys` with a `page_image` row
   */
  async mintedPageImageObjects(r2Keys: string[]): Promise<Set<string>> {
    if (r2Keys.length === 0) return new Set();
    const rows = await this.db
      .selectDistinct({ r2Key: schema.orphanedImageFiles.r2Key })
      .from(schema.orphanedImageFiles)
      .where(
        and(
          eq(schema.orphanedImageFiles.imageType, 'page_image'),
          inArray(schema.orphanedImageFiles.r2Key, r2Keys)
        )
      );
    return new Set(rows.map((row) => row.r2Key));
  }

  /**
   * Nominate the page-image objects a save dropped: one pending row per
   * object, however often it is dropped (Codex-61zsk.17).
   *
   * An object already pending (its upload's row, or an earlier drop's) has
   * that row's wait restarted, not a second row added. So a page toggled in
   * and out of an image queues it once, not once per save, and the sweep
   * waits {@link PAGE_IMAGE_GRACE_MS} after the LAST drop: appended, the
   * upload's own pending row came due a week after the upload however
   * recently the image was dropped.
   *
   * @param inputs - One per object key (`pageImageObjectKeys`)
   * @returns How many objects had their pending row restarted, and how many
   *   rows were added
   */
  async nominatePageImageObjects(
    inputs: RecordOrphanInput[]
  ): Promise<{ restarted: number; added: number }> {
    if (inputs.length === 0) return { restarted: 0, added: 0 };
    const restarted = await this.db
      .update(schema.orphanedImageFiles)
      .set({ orphanedAt: new Date() })
      .where(
        and(
          eq(schema.orphanedImageFiles.imageType, 'page_image'),
          eq(schema.orphanedImageFiles.status, 'pending'),
          inArray(
            schema.orphanedImageFiles.r2Key,
            inputs.map((input) => input.r2Key)
          )
        )
      )
      // Whole rows: on the http|ws union `returning` takes no field map.
      .returning();
    const pending = new Set(restarted.map((row) => row.r2Key));
    const added = await this.recordOrphanedFiles(
      inputs.filter((input) => !pending.has(input.r2Key))
    );
    return { restarted: pending.size, added: added.length };
  }

  /**
   * Mark an orphan as successfully deleted
   */
  async markDeleted(id: string): Promise<void> {
    await this.db
      .update(schema.orphanedImageFiles)
      .set({
        status: 'deleted',
        lastAttemptAt: new Date(),
      })
      .where(eq(schema.orphanedImageFiles.id, id));

    this.obs.info('Orphaned file deleted', { orphanId: id });
  }

  /**
   * Record a failed cleanup attempt
   *
   * Increments attempt counter and records error message.
   * If max attempts reached, marks as 'failed' for manual review.
   *
   * The log line says {@link messageForLog}'s message, and so does the row,
   * except for a failed query: its own message is only its SQL and
   * parameters, which the row keeps for whoever reviews it, with the driver's
   * reason after them. Those parameters can hold a user id, so the log never
   * carries them (Codex-kk9nv.13). Both texts come from the error itself, so
   * no caller can hand the log the wrong one.
   */
  async recordFailedAttempt(id: string, error: unknown): Promise<void> {
    const logged = messageForLog(error);
    const recorded = isFailedQuery(error)
      ? `${error.message}\ncause: ${logged}`
      : logged;
    // Use atomic increment to prevent race conditions
    const updated = await this.db
      .update(schema.orphanedImageFiles)
      .set({
        cleanupAttempts: sql`${schema.orphanedImageFiles.cleanupAttempts} + 1`,
        lastAttemptAt: new Date(),
        errorMessage: recorded,
      })
      .where(eq(schema.orphanedImageFiles.id, id))
      .returning();

    const record = updated[0];

    // If we've hit max attempts, mark as failed
    if (record && record.cleanupAttempts >= MAX_CLEANUP_ATTEMPTS) {
      await this.db
        .update(schema.orphanedImageFiles)
        .set({ status: 'failed' })
        .where(eq(schema.orphanedImageFiles.id, id));

      this.obs.warn('Orphaned file cleanup failed permanently', {
        orphanId: id,
        attempts: record.cleanupAttempts,
        error: logged,
      });
    } else {
      this.obs.warn('Orphaned file cleanup attempt failed', {
        orphanId: id,
        attempts: record?.cleanupAttempts ?? 0,
        error: logged,
      });
    }
  }

  /**
   * Get cleanup statistics
   */
  async getStats(): Promise<CleanupStats> {
    const results = await this.db
      .select({
        pending: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'pending')`,
        deleted: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'deleted')`,
        failed: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'failed')`,
        retained: sql<number>`COUNT(*) FILTER (WHERE ${schema.orphanedImageFiles.status} = 'retained')`,
      })
      .from(schema.orphanedImageFiles);

    const stats = results[0] ?? {
      pending: 0,
      deleted: 0,
      failed: 0,
      retained: 0,
    };

    return {
      processed: Number(stats.deleted) + Number(stats.failed),
      deleted: Number(stats.deleted),
      failed: Number(stats.failed),
      retained: Number(stats.retained),
      remaining: Number(stats.pending),
    };
  }

  /**
   * Mark orphan as retained (keep for audit/investigation)
   */
  async markRetained(id: string, reason?: string): Promise<void> {
    await this.db
      .update(schema.orphanedImageFiles)
      .set({
        status: 'retained',
        errorMessage: reason ?? 'Marked for retention',
      })
      .where(eq(schema.orphanedImageFiles.id, id));

    this.obs.info('Orphaned file marked for retention', {
      orphanId: id,
      reason,
    });
  }

  /**
   * Get failed orphans for manual review
   */
  async getFailedOrphans(limit: number = 100): Promise<OrphanedFileRecord[]> {
    const orphans = await this.db
      .select()
      .from(schema.orphanedImageFiles)
      .where(eq(schema.orphanedImageFiles.status, 'failed'))
      .orderBy(schema.orphanedImageFiles.orphanedAt)
      .limit(limit);

    return orphans as OrphanedFileRecord[];
  }
}
