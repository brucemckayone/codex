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
 *       master), and its creator is still on the course org's TEAM: an
 *       active owner, admin or creator ({@link creatorIsMember}). Nothing
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
 *
 * An org's intro film (Codex-376dl, the film on its landing page) follows the
 * same rule ({@link resolveIntroFilm}): the slot is `branding_settings`
 * instead of a course, (a) becomes "a live org", and the film must be a video.
 * It reads these same predicates, never a copy, so a change to what counts as
 * paid reaches both kinds of film at once.
 */

import { CONTENT_STATUS, MEDIA_STATUS, MEDIA_TYPES } from '@codex/constants';
import { CREATOR_LIST_ROLES } from '@codex/database';
import {
  brandingSettings,
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
 * Rule (c)'s media half, for the outer query's `media_items` row: not deleted,
 * `ready`, video or audio, with an HLS master.
 */
function filmReady(): SQL {
  return sql`(
    ${mediaItems.deletedAt} IS NULL
    AND ${mediaItems.status} = ${MEDIA_STATUS.READY}
    AND ${mediaItems.hlsMasterPlaylistKey} IS NOT NULL
    AND ${mediaItems.mediaType} IN (${MEDIA_TYPES.VIDEO}, ${MEDIA_TYPES.AUDIO})
  )`;
}

/**
 * Rule (c)'s membership half: the outer `media_items` row's creator is an
 * ACTIVE member of the TEAM of `organizationId` (a value, or the joined
 * `courses.organization_id` column): an owner, admin or creator, the set the
 * platform lists as an org's creators (`CREATOR_LIST_ROLES`).
 *
 * Narrower than `assertMediaItemsInOrg`, which admits any active role, on
 * purpose. `member` and `subscriber` are CUSTOMER rows: a paying subscriber
 * holds an active `subscriber` membership, and subscribing re-activates a
 * removed member's row as one (`upsertSubscriberMembership`). Admitting them
 * would stream a departed creator's still-slotted film in full again the day
 * they subscribe, so they fail closed. The write side is left as it is (an
 * owner decision); a film it lets through still shows only its public preview.
 */
function creatorIsMember(
  db: AccessQueryClient,
  organizationId: string | SQLWrapper
): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, mediaItems.creatorId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, 'active'),
          inArray(organizationMemberships.role, [...CREATOR_LIST_ROLES])
        )
      )
  );
}

/**
 * Rules (b) and (c) for the outer query's `media_items` row: its FULL film may
 * stream from a sell slot of a course in `organizationId`. Rule (a) is the
 * caller's: it has read the course whose slot holds the media. The minter
 * projects the same three parts one by one, to log which refused.
 *
 * Raw `sql`, as `library.ts` composes its scopes: drizzle's `and()` is typed
 * `SQL | undefined`, and this is a predicate every caller relies on whole.
 */
export function fullFilmEligible(
  db: AccessQueryClient,
  organizationId: string | SQLWrapper
): SQL {
  return sql`(
    ${filmReady()}
    AND ${creatorIsMember(db, organizationId)}
    AND NOT ${paidUse(db)}
  )`;
}

/** A predicate as a strict boolean column: NULL (an absent row) reads false. */
function asFlag(predicate: SQL): SQL<boolean> {
  return sql<boolean>`CASE WHEN ${predicate} THEN true ELSE false END`;
}

/**
 * Why the minter refused a film, for its log line only: the caller still
 * answers the same `null` for every one.
 *   - `no-course`: no published, non-deleted course of a live org by that id
 *     in that org (a draft, a deleted course or org, another org's id);
 *   - `empty-slot`: the course has no film in that slot;
 *   - `not-ready`: the media is deleted, not `ready`, or has no HLS master;
 *   - `creator-not-member`: its creator is not on the org's team (left,
 *     never joined, or holds only a customer-side `member`/`subscriber` row);
 *   - `paid-use`: content that is anything but plainly free uses it.
 */
export type CourseFilmRefusal =
  | 'no-course'
  | 'empty-slot'
  | 'not-ready'
  | 'creator-not-member'
  | 'paid-use';

export type CourseFilmResolution =
  | { ok: true; creatorId: string; mediaId: string }
  | { ok: false; reason: CourseFilmRefusal };

/**
 * The film a press asked for, when its full stream may be minted: ONE
 * statement, the course under rule (a) with its slot's media LEFT-joined and
 * {@link fullFilmEligible}'s three parts projected one by one, so the one
 * round trip also says which part refused. It mints only when all three hold,
 * exactly the conjunction `fullFilmEligible` is.
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
      ready: asFlag(filmReady()),
      member: asFlag(creatorIsMember(db, courses.organizationId)),
      paid: asFlag(paidUse(db)),
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
  // `=== true` / `!== false`, not truthiness: only the predicate's own
  // answer mints, and anything unexpected refuses.
  if (row.ready !== true) return { ok: false, reason: 'not-ready' };
  if (row.member !== true) return { ok: false, reason: 'creator-not-member' };
  if (row.paid !== false) return { ok: false, reason: 'paid-use' };
  return { ok: true, creatorId: row.creatorId, mediaId: row.mediaId };
}

/**
 * Why an org's intro film may not stream in full. `CourseFilmRefusal`'s
 * reasons, with `no-org` for `no-course` and two more:
 *   - `not-video`: the media is audio. The studio picks only video, but a pick
 *     saved before it checked may be audio, and the landing plays a film.
 *   - `failed`: its transcode failed, so it will never be ready. `not-ready`
 *     would tell the studio to wait for it.
 *
 * A pick whose media was DELETED is an `empty-slot`: the film is gone from
 * the library, so the studio offers the picker again instead of naming it.
 */
export type IntroFilmRefusal =
  | 'no-org'
  | 'empty-slot'
  | 'not-ready'
  | 'failed'
  | 'not-video'
  | 'creator-not-member'
  | 'paid-use';

/** The intro's media, as the landing and the studio draw it. */
export interface IntroFilmMedia {
  mediaId: string;
  creatorId: string;
  title: string;
  thumbnailKey: string | null;
  hlsPreviewKey: string | null;
  durationSeconds: number | null;
}

/**
 * The org's intro film and whether its FULL stream may be minted. `film` is
 * there whenever the slot holds media, refused or not, so a caller can still
 * draw a refused film's public preview (a paid use) or name what went wrong
 * (the studio).
 */
export type IntroFilmResolution =
  | { ok: true; film: IntroFilmMedia }
  | { ok: false; reason: IntroFilmRefusal; film: IntroFilmMedia | null };

/**
 * An org's intro film under the sales-film rule, as {@link resolveCourseFilm}
 * resolves a course's: ONE statement, the org with its intro media LEFT-joined
 * and each part of {@link fullFilmEligible} projected one by one, plus the
 * video check. The minter, the public org info and the studio all read it, so
 * each answers the same.
 */
export async function resolveIntroFilm(
  db: AccessQueryClient,
  organizationId: string
): Promise<IntroFilmResolution> {
  const [row] = await db
    .select({
      mediaId: mediaItems.id,
      creatorId: mediaItems.creatorId,
      title: mediaItems.title,
      thumbnailKey: mediaItems.thumbnailKey,
      hlsPreviewKey: mediaItems.hlsPreviewKey,
      durationSeconds: mediaItems.durationSeconds,
      status: mediaItems.status,
      ready: asFlag(filmReady()),
      video: asFlag(sql`${mediaItems.mediaType} = ${MEDIA_TYPES.VIDEO}`),
      member: asFlag(creatorIsMember(db, organizations.id)),
      paid: asFlag(paidUse(db)),
    })
    .from(organizations)
    .leftJoin(
      brandingSettings,
      eq(brandingSettings.organizationId, organizations.id)
    )
    // A deleted pick joins nothing, so it reads as an empty slot.
    .leftJoin(
      mediaItems,
      and(
        eq(mediaItems.id, brandingSettings.introVideoMediaItemId),
        isNull(mediaItems.deletedAt)
      )
    )
    .where(
      and(eq(organizations.id, organizationId), isNull(organizations.deletedAt))
    )
    .limit(1);

  if (!row) return { ok: false, reason: 'no-org', film: null };
  if (!row.mediaId || !row.creatorId || row.title === null) {
    return { ok: false, reason: 'empty-slot', film: null };
  }
  const film: IntroFilmMedia = {
    mediaId: row.mediaId,
    creatorId: row.creatorId,
    title: row.title,
    thumbnailKey: row.thumbnailKey,
    hlsPreviewKey: row.hlsPreviewKey,
    durationSeconds: row.durationSeconds,
  };
  // As resolveCourseFilm: only the predicate's own answer mints.
  if (row.status === MEDIA_STATUS.FAILED) {
    return { ok: false, reason: 'failed', film };
  }
  if (row.ready !== true) return { ok: false, reason: 'not-ready', film };
  if (row.video !== true) return { ok: false, reason: 'not-video', film };
  if (row.member !== true) {
    return { ok: false, reason: 'creator-not-member', film };
  }
  if (row.paid !== false) return { ok: false, reason: 'paid-use', film };
  return { ok: true, film };
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
  // UNCORRELATED: the course's three film ids are read once (an InitPlan),
  // so `id = ANY(...)` and `creator_id = $viewer` are both index arms (the
  // pkey and `idx_media_items_creator_id`, a BitmapOr) instead of a scan of
  // `media_items` that tests every row against the course. No course row
  // (another org's id, a deleted course) is `= ANY(NULL)`: no row matches.
  // The `::uuid[]` cast is load-bearing: without it Postgres reads
  // `ANY((SELECT ...))` as `ANY (subquery)` and compares uuid with uuid[].
  const inThisCourse = sql`${mediaItems.id} = ANY((
    SELECT ARRAY[${courses.introVideoMediaId}, ${courses.previewVideoMediaId}, ${courses.guideVideoMediaId}]
    FROM ${courses}
    WHERE ${courses.id} = ${input.courseId}
      AND ${courses.organizationId} = ${input.organizationId}
      AND ${courses.deletedAt} IS NULL
  )::uuid[])`;
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
