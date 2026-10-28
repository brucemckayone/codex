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
 *   (a) it sits in a sell slot of a PUBLISHED, non-deleted course of a live
 *       org (`resolveCourseFilm`; the sell preview's own course read);
 *   (b) NO non-deleted content row that is anything but plainly free uses it,
 *       through `content.media_item_id` ({@link paidUse});
 *   (c) the media is ready (not deleted, `ready`, video or audio, with an HLS
 *       master), and its creator is still an ACTIVE member of the course's
 *       org, the boundary `assertMediaItemsInOrg` writes against. Nothing
 *       clears a slot when a member leaves, so the read asks again.
 *
 * (b) and (c) are {@link fullFilmEligible}, the ONE predicate the sell
 * preview's advisory `fullFilm` flag and the public minter (the authoritative
 * check, run on every press) both apply. (b) is DERIVED on every read:
 * nothing marks a media item promo or paid, and a stored marker could go
 * stale; derived, attaching the film to a paid item later stops the full
 * stream at the next press, with nothing to write here.
 *
 * The studio's note under a film slot reads (b) alone
 * ({@link findPreviewOnlyMedia}): it says why a film is cut, and a paid use is
 * the only reason it names.
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
  isNull,
  type SQL,
  type SQLWrapper,
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
 * Rules (b) and (c) for the outer query's `media_items` row: its FULL film may
 * stream from a sell slot of a course in `organizationId` (a value, or the
 * joined `courses.organization_id` column). Rule (a) is the caller's: it has
 * read the course whose slot holds the media.
 *
 * Raw `sql`, as `library.ts` composes its scopes: drizzle's `and()` is typed
 * `SQL | undefined`, and this is a predicate every caller relies on whole.
 */
export function fullFilmEligible(
  db: AccessQueryClient,
  organizationId: string | SQLWrapper
): SQL {
  const activeMember = exists(
    db
      .select({ one: sql`1` })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, mediaItems.creatorId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active')
        )
      )
  );
  return sql`(
    ${mediaItems.deletedAt} IS NULL
    AND ${mediaItems.status} = ${MEDIA_STATUS.READY}
    AND ${mediaItems.hlsMasterPlaylistKey} IS NOT NULL
    AND ${mediaItems.mediaType} IN (${MEDIA_TYPES.VIDEO}, ${MEDIA_TYPES.AUDIO})
    AND ${activeMember}
    AND NOT ${paidUse(db)}
  )`;
}

/**
 * Why the minter refused a film, for its log line only: the caller still
 * answers the same `null` for every one.
 *   - `no-course`: no published, non-deleted course of a live org by that id
 *     in that org (a draft, a deleted course or org, another org's id);
 *   - `empty-slot`: the course has no film in that slot;
 *   - `not-eligible`: the film fails {@link fullFilmEligible} (a paid use,
 *     media not ready, a creator who has left).
 */
export type CourseFilmRefusal = 'no-course' | 'empty-slot' | 'not-eligible';

export type CourseFilmResolution =
  | { ok: true; creatorId: string; mediaId: string }
  | { ok: false; reason: CourseFilmRefusal };

/**
 * The film a press asked for, when its full stream may be minted: ONE
 * statement, the course under rule (a) with its slot's media LEFT-joined and
 * {@link fullFilmEligible} projected, so the one round trip also says which
 * part refused.
 *
 * `organizationId` comes from the browser, so it is a CONSISTENCY filter, not
 * an authorisation input: it can only narrow, and the course→org join is the
 * check. A caller naming another org gets `no-course`, like any missing course.
 */
export async function resolveCourseFilm(
  db: AccessQueryClient,
  input: { organizationId: string; courseId: string; film: SalesFilm }
): Promise<CourseFilmResolution> {
  const [row] = await db
    .select({
      mediaId: mediaItems.id,
      creatorId: mediaItems.creatorId,
      eligible: sql<boolean>`CASE WHEN ${fullFilmEligible(
        db,
        courses.organizationId
      )} THEN true ELSE false END`,
    })
    .from(courses)
    .innerJoin(organizations, eq(organizations.id, courses.organizationId))
    .leftJoin(mediaItems, eq(mediaItems.id, SALES_FILM_COLUMNS[input.film]))
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

  if (!row) return { ok: false, reason: 'no-course' };
  if (!row.mediaId || !row.creatorId)
    return { ok: false, reason: 'empty-slot' };
  // `=== true`, not truthiness: only the predicate's own true mints.
  if (row.eligible !== true) return { ok: false, reason: 'not-eligible' };
  return { ok: true, creatorId: row.creatorId, mediaId: row.mediaId };
}

/**
 * The films the studio's panel can show that rule (b) cuts to the preview:
 * the note under a film slot. The outer set is only what a picker can hold
 * there, this course's film slots and, given `viewerId`, the viewer's own
 * library (the picker lists the viewer's media). `paidUse` inside it stays
 * unscoped, so a paid use anywhere still names the film: it fails closed.
 *
 * Media only, whatever slot holds it, so a film the viewer picked but has not
 * saved is named too.
 */
export async function findPreviewOnlyMedia(
  db: AccessQueryClient,
  input: { organizationId: string; courseId: string; viewerId?: string }
): Promise<string[]> {
  const inThisCourse = exists(
    db
      .select({ one: sql`1` })
      .from(courses)
      .where(
        and(
          eq(courses.id, input.courseId),
          eq(courses.organizationId, input.organizationId),
          isNull(courses.deletedAt),
          sql`${mediaItems.id} IN (${courses.introVideoMediaId}, ${courses.previewVideoMediaId}, ${courses.guideVideoMediaId})`
        )
      )
  );
  // Raw `sql`, not `or()`: `or()` is `SQL | undefined`, and `and()` would
  // drop it without a word, which here would widen the set to every media.
  const reach = input.viewerId
    ? sql`(${mediaItems.creatorId} = ${input.viewerId} OR ${inThisCourse})`
    : inThisCourse;

  const rows = await db
    .selectDistinct({ id: mediaItems.id })
    .from(mediaItems)
    .where(and(isNull(mediaItems.deletedAt), reach, paidUse(db)));

  return rows.map((row) => row.id);
}
