/**
 * Which course sales films may stream in FULL (owner P10, 2026-10-28: "Full
 * film unless it's paid").
 *
 * A sales film is an ordinary `media_items` row the creator picks for a sell
 * slot, and it may be the very media of a paid practice (SPEC §10). Every
 * media item's 30-second preview is public; its full HLS master sits in the
 * private bucket, reachable only through a short-lived signed token. So a
 * film's full stream may be minted only when ALL of these hold:
 *
 *   (a) it sits in a sell slot of a PUBLISHED, non-deleted course of that org
 *       (`resolveCourseFilm`; the sell preview's own course read);
 *   (b) NO non-deleted content row that is anything but plainly free uses it,
 *       through `content.media_item_id` ({@link paidUse});
 *   (c) the media is ready: not deleted, `ready`, video or audio, with an HLS
 *       master ({@link findFullFilmMedia}).
 *
 * (b) is DERIVED on every read. Nothing marks a media item promo or paid, and
 * a stored marker could go stale; derived, attaching the film to a paid item
 * later stops the full stream at the next press, with nothing to write here.
 *
 * Three readers, one rule: the sell preview's advisory `fullFilm` flag, the
 * public minter (the authoritative check, run on every press), and the
 * studio's note under a film slot ({@link findPaidMediaInOrg}).
 */

import { CONTENT_STATUS, MEDIA_STATUS, MEDIA_TYPES } from '@codex/constants';
import {
  content,
  courses,
  mediaItems,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import type { SalesFilm } from '@codex/validation';
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  not,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AccessQueryClient } from './content-access/entitlements-resolver';

/** The course column behind each film a press can ask for. */
const SALES_FILM_COLUMNS = {
  intro: courses.introVideoMediaId,
  reel: courses.previewVideoMediaId,
  guide: courses.guideVideoMediaId,
} as const satisfies Record<SalesFilm, unknown>;

/**
 * A content row that is anything but plainly free: the negation of
 * `isPublicContent` (`@codex/constants`), gate for gate. Keep the two in step,
 * and both in step with `decideContentAccess`.
 *
 * Every conjunct is `IS TRUE` / `IS NOT TRUE` / `IS NULL` / a COALESCE, so none
 * can be NULL. A NULL inside `NOT (…)` would make the whole test NULL, and the
 * row would read as no paid use: fail OPEN. The flag columns are NOT NULL
 * today; this stays right if one stops being.
 */
function gatedContent(): SQL {
  return sql`NOT (
    ${content.isFree} IS TRUE
    AND ${content.isPurchasable} IS NOT TRUE
    AND COALESCE(${content.priceCents}, 0) <= 0
    AND ${content.includedInTierId} IS NULL
    AND ${content.isFollowerGated} IS NOT TRUE
    AND ${content.isTeamOnly} IS NOT TRUE
    AND ${content.courseOnly} IS NOT TRUE
  )`;
}

/**
 * Rule (b), for the outer query's `media_items` row: a non-deleted content row
 * that is anything but plainly free uses it.
 *
 * Drafts and archived rows count: a paid practice in draft is published later
 * with the same gates, and an off-sale one still has buyers.
 *
 * NOT narrowed by organisation or creator, on purpose. A paid use anywhere (the
 * creator's own profile, another org) is still a paid lesson, and a narrower
 * read could only miss one, which fails open. The read returns nothing about
 * that content row; it only removes the media from the caller's set.
 */
function paidUse(db: AccessQueryClient): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(content)
      .where(
        and(
          eq(content.mediaItemId, mediaItems.id),
          isNull(content.deletedAt),
          gatedContent()
        )
      )
  );
}

/**
 * Of `mediaIds`, the ones whose FULL film may stream under rules (b) and (c),
 * each mapped to its creator (the first segment of its R2 HLS key). Rule (a)
 * is the caller's: it has read the course whose slots hold these ids.
 */
export async function findFullFilmMedia(
  db: AccessQueryClient,
  mediaIds: readonly string[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(mediaIds)];
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({ id: mediaItems.id, creatorId: mediaItems.creatorId })
    .from(mediaItems)
    .where(
      and(
        inArray(mediaItems.id, wanted),
        isNull(mediaItems.deletedAt),
        eq(mediaItems.status, MEDIA_STATUS.READY),
        isNotNull(mediaItems.hlsMasterPlaylistKey),
        inArray(mediaItems.mediaType, [MEDIA_TYPES.VIDEO, MEDIA_TYPES.AUDIO]),
        not(paidUse(db))
      )
    );

  return new Map(rows.map((row) => [row.id, row.creatorId]));
}

/**
 * The film a press asked for, when its full stream may be minted: rule (a) on
 * the course row, then {@link findFullFilmMedia}. `null` for every refusal
 * alike (no such course in that org, a draft or deleted course, a deleted org,
 * an empty slot, a paid use, media not ready), so the caller can say nothing
 * about why.
 */
export async function resolveCourseFilm(
  db: AccessQueryClient,
  input: { organizationId: string; courseId: string; film: SalesFilm }
): Promise<{ creatorId: string; mediaId: string } | null> {
  const [course] = await db
    .select({ mediaId: SALES_FILM_COLUMNS[input.film] })
    .from(courses)
    .innerJoin(organizations, eq(organizations.id, courses.organizationId))
    .where(
      and(
        eq(courses.id, input.courseId),
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, CONTENT_STATUS.PUBLISHED),
        isNull(courses.deletedAt),
        // A signed stream, so the org is asked too (Codex-7ncbh): a deleted
        // organisation's course is gone, whatever its own row says.
        isNull(organizations.deletedAt)
      )
    )
    .limit(1);

  const mediaId = course?.mediaId;
  if (!mediaId) return null;

  const creatorId = (await findFullFilmMedia(db, [mediaId])).get(mediaId);
  return creatorId ? { creatorId, mediaId } : null;
}

/**
 * The media this org's sell slots may hold (an active member's, the boundary
 * `assertMediaItemsInOrg` writes against) that rule (b) cuts to the preview:
 * the studio's note under a film slot. Media only, whatever slot holds it, so
 * a film picked but not yet saved is named too.
 */
export async function findPaidMediaInOrg(
  db: AccessQueryClient,
  organizationId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: mediaItems.id })
    .from(mediaItems)
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.userId, mediaItems.creatorId),
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.status, 'active')
      )
    )
    .where(and(isNull(mediaItems.deletedAt), paidUse(db)));

  return rows.map((row) => row.id);
}
