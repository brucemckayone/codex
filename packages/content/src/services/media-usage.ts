/**
 * Where a media item is used (Codex-6sbn1): ONE lookup over every place a
 * media id can be held. The library chip (`MediaItemService.list`), the
 * "where" list (`getUsage`), the delete guard and the daily file purge all
 * read it, so they can never disagree about whether an item is in use.
 *
 * A use is LIVE (it blocks a delete, and the purge) when someone other than
 * the creator can watch it:
 * - content that is published, or was ever released (`published_at` set):
 *   people who bought it keep it after it goes off sale (owner, round 2);
 * - a published course, in an org that isn't deleted;
 * - an org's intro video, always, while the org isn't deleted.
 * Anything else is a DRAFT use: a delete goes ahead after a warning, and the
 * draft keeps its link to the deleted item, so a restore heals it.
 *
 * Never cached: this is the guard, and a stale "not in use" would let a
 * delete through.
 */

import {
  brandingSettings,
  content,
  courses,
  landingPages,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import type {
  MediaUsage,
  MediaUsageCounts,
  MediaUse,
  MediaUseLink,
  MediaUseLiveReason,
  MediaUseSlot,
} from '@codex/shared-types';
import { inArray, type SQL, sql } from 'drizzle-orm';
import {
  MediaInUseError,
  MediaUsageChangedError,
  type MediaUseCounts,
} from '../errors';

/** `MediaUsage.uses` names at most this many; `total` is the truth. */
export const MEDIA_USES_CAP = 50;

/**
 * Every column with a foreign key to `media_items.id`, and whether a use
 * through it counts. A schema test walks every table and fails on a media
 * FK missing here, so a new column can't slip past the guard.
 */
export const MEDIA_REFERENCE_COLUMNS: Readonly<
  Record<string, 'blocking' | { ignored: string }>
> = {
  'content.media_item_id': 'blocking',
  'courses.intro_video_media_id': 'blocking',
  'courses.preview_video_media_id': 'blocking',
  'courses.guide_video_media_id': 'blocking',
  'courses.hero_media_id': 'blocking',
  'branding_settings.intro_video_media_item_id': 'blocking',
  'courses.signature_media_id': {
    ignored:
      'Retired slot (Codex-61zsk.47): never read for the sign-off, and no picker offers it. Counting it would make an item impossible to delete, with nowhere to clear it.',
  },
  'course_testimonials.avatar_media_id': {
    ignored: 'Nothing in the packages or the web app reads or writes it.',
  },
};

/** Media ids held in JSON, with no foreign key: listed by hand. */
export const MEDIA_JSON_REFERENCES = ['courses.guide.portraitMediaId'] as const;

/** A JSON value is cast to uuid only when it is one: a bad value never fails the query. */
const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/** One use, as the lookup returns it. */
export interface MediaUseRow {
  media_id: string;
  source: 'content' | 'course' | 'org_intro';
  slot: MediaUseSlot;
  /** The content's, the course's or (org intro) the org's id. */
  owner_id: string;
  title: string;
  content_type: string | null;
  org_id: string | null;
  org_name: string | null;
  org_slug: string | null;
  /** The content's or course's creator; null for an org intro. */
  owner_user: string | null;
  live: boolean;
  live_reason: MediaUseLiveReason | null;
  /** A course's landing page (the Studio route's id); null otherwise. */
  page_id: string | null;
  /** The caller's ACTIVE role in the use's org, or null. */
  caller_role: string | null;
}

/**
 * Anything that runs a raw statement: the registry's client, or a
 * transaction (the delete runs the lookup inside its own). Its rows are
 * typed by the statement that names them, below.
 */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/**
 * The rows, one per use, of every live reference to one of `mediaIds`.
 * Soft-deleted content and courses are not uses, nor are courses and intro
 * videos of a deleted org (nobody can reach them). The course columns have
 * no indexes: one lateral unpivot reads `courses` once, not once per id.
 */
function usesQuery(mediaIds: readonly string[]): SQL {
  const ids = [...mediaIds];
  return sql`
    SELECT ${content.mediaItemId} AS media_id, 'content'::text AS source,
           'media'::text AS slot, ${content.id} AS owner_id, ${content.title}::text AS title,
           ${content.contentType}::text AS content_type,
           ${content.organizationId} AS org_id, ${organizations.name}::text AS org_name,
           ${organizations.slug}::text AS org_slug, ${content.creatorId}::text AS owner_user,
           (${content.status} = 'published' OR ${content.publishedAt} IS NOT NULL) AS live,
           CASE WHEN ${content.status} = 'published' THEN 'published'
                WHEN ${content.publishedAt} IS NOT NULL THEN 'bought' END AS live_reason,
           NULL::uuid AS page_id
      FROM ${content}
      LEFT JOIN ${organizations} ON ${organizations.id} = ${content.organizationId}
     WHERE ${inArray(content.mediaItemId, ids)} AND ${content.deletedAt} IS NULL
    UNION ALL
    SELECT s.media_id, 'course'::text, s.slot, ${courses.id}, ${courses.title}::text,
           NULL::text, ${courses.organizationId}, ${organizations.name}::text,
           ${organizations.slug}::text, ${courses.creatorId}::text,
           (${courses.status} = 'published'),
           CASE WHEN ${courses.status} = 'published' THEN 'published' END,
           lp.id
      FROM ${courses}
      JOIN ${organizations} ON ${organizations.id} = ${courses.organizationId}
                           AND ${organizations.deletedAt} IS NULL
     CROSS JOIN LATERAL (VALUES
           ('intro'::text, ${courses.introVideoMediaId}),
           ('reel', ${courses.previewVideoMediaId}),
           ('guide_video', ${courses.guideVideoMediaId}),
           ('hero', ${courses.heroMediaId}),
           ('guide_portrait',
             CASE WHEN ${courses.guide}->>'portraitMediaId' ~ ${UUID_PATTERN}
                  THEN (${courses.guide}->>'portraitMediaId')::uuid END)
         ) AS s(slot, media_id)
      LEFT JOIN LATERAL (
           SELECT ${landingPages.id} AS id FROM ${landingPages}
            WHERE ${landingPages.subjectType} = 'course'
              AND ${landingPages.subjectId} = ${courses.id}
              AND ${landingPages.organizationId} = ${courses.organizationId}
              AND ${landingPages.deletedAt} IS NULL
            ORDER BY ${landingPages.createdAt} DESC, ${landingPages.id}
            LIMIT 1
         ) lp ON true
     WHERE ${inArray(sql`s.media_id`, ids)} AND ${courses.deletedAt} IS NULL
    UNION ALL
    SELECT ${brandingSettings.introVideoMediaItemId}, 'org_intro'::text, 'org_intro'::text,
           ${organizations.id}, ${organizations.name}::text, NULL::text,
           ${organizations.id}, ${organizations.name}::text, ${organizations.slug}::text,
           NULL::text, true, 'always', NULL::uuid
      FROM ${brandingSettings}
      JOIN ${organizations} ON ${organizations.id} = ${brandingSettings.organizationId}
     WHERE ${inArray(brandingSettings.introVideoMediaItemId, ids)}
       AND ${organizations.deletedAt} IS NULL`;
}

/**
 * Every use of `mediaIds`, with the caller's active role in each use's org
 * (it decides what the caller may see named, and change). One statement.
 */
export async function readMediaUses(
  db: SqlExecutor,
  mediaIds: readonly string[],
  callerId: string
): Promise<MediaUseRow[]> {
  if (mediaIds.length === 0) return [];
  const result = await db.execute(sql`
    SELECT u.*, m.role AS caller_role
      FROM (${usesQuery(mediaIds)}) u
      LEFT JOIN ${organizationMemberships} m
        ON m.organization_id = u.org_id
       AND m.user_id = ${callerId}
       AND m.status = 'active'`);
  return result.rows as MediaUseRow[];
}

/**
 * How many places use each of `mediaIds`, and how many of them are live: the
 * library chip. ONE statement for a whole page, never one per tile. An id
 * nothing uses is absent from the map.
 */
export async function countMediaUses(
  db: SqlExecutor,
  mediaIds: readonly string[]
): Promise<Map<string, MediaUsageCounts>> {
  const counts = new Map<string, MediaUsageCounts>();
  if (mediaIds.length === 0) return counts;
  const result = await db.execute(sql`
    SELECT u.media_id, count(*)::int AS total,
           (count(*) FILTER (WHERE u.live))::int AS live
      FROM (${usesQuery(mediaIds)}) u
     GROUP BY u.media_id`);
  const rows = result.rows as {
    media_id: string;
    total: number;
    live: number;
  }[];
  for (const row of rows) {
    counts.set(row.media_id, {
      total: Number(row.total),
      live: Number(row.live),
    });
  }
  return counts;
}

const SOURCE_ORDER: Record<MediaUseRow['source'], number> = {
  content: 0,
  course: 1,
  org_intro: 2,
};

function isOrgManager(role: string | null): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * A use's title goes out only when the caller could already see it: they
 * own it, it is live (published titles are public), or they run its org.
 */
function isNamed(row: MediaUseRow, callerId: string): boolean {
  return (
    row.owner_user === callerId || row.live || isOrgManager(row.caller_role)
  );
}

/**
 * Where the caller can swap in another item, or null ("Ask an admin"):
 * their own content, or a course page or the brand of an org they run.
 */
function linkFor(row: MediaUseRow, callerId: string): MediaUseLink | null {
  if (row.source === 'content') {
    return row.owner_user === callerId
      ? { to: 'content', contentId: row.owner_id, orgSlug: row.org_slug }
      : null;
  }
  if (!isOrgManager(row.caller_role) || !row.org_slug) return null;
  if (row.source === 'course') {
    return row.page_id
      ? { to: 'journey', pageId: row.page_id, orgSlug: row.org_slug }
      : null;
  }
  return { to: 'brand', orgSlug: row.org_slug };
}

function toUse(row: MediaUseRow, callerId: string): MediaUse {
  return {
    kind:
      row.source === 'org_intro'
        ? 'intro'
        : row.source === 'course'
          ? 'course'
          : row.content_type === 'audio'
            ? 'audio'
            : 'film',
    slot: row.slot,
    live: row.live,
    liveReason: row.live ? row.live_reason : null,
    title: row.title,
    orgName: row.org_name,
    link: linkFor(row, callerId),
  };
}

/** The two numbers a refusal carries. */
export function countLiveAndDrafts(
  rows: readonly MediaUseRow[]
): MediaUseCounts {
  const live = rows.filter((row) => row.live).length;
  return { live, drafts: rows.length - live };
}

/**
 * An opaque digest of the set of uses, named or not: the same uses in any
 * order give the same value, and any use added, removed or gone live changes
 * it. Not a secret: it only tells the delete whether the list the dialog
 * showed is still the list.
 */
export async function mediaUsageFingerprint(
  rows: readonly MediaUseRow[]
): Promise<string> {
  const lines = rows
    .map(
      (row) => `${row.source}|${row.owner_id}|${row.slot}|${row.live ? 1 : 0}`
    )
    .sort();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(lines.join('\n'))
  );
  return [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The rows of one item, shaped for the dialog and the popover: live first,
 * then drafts, capped; a use the caller can't see is counted in `hidden`
 * and named nowhere.
 */
export async function summariseMediaUsage(
  rows: readonly MediaUseRow[],
  callerId: string
): Promise<MediaUsage> {
  const { live, drafts } = countLiveAndDrafts(rows);
  const named = rows
    .filter((row) => isNamed(row, callerId))
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) ||
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        a.title.localeCompare(b.title) ||
        a.owner_id.localeCompare(b.owner_id) ||
        a.slot.localeCompare(b.slot)
    );
  return {
    total: rows.length,
    live,
    drafts,
    hidden: rows.length - named.length,
    uses: named.slice(0, MEDIA_USES_CAP).map((row) => toUse(row, callerId)),
    fingerprint: await mediaUsageFingerprint(rows),
  };
}

/**
 * The delete guard, in its fixed order: any live use refuses with
 * `MEDIA_IN_USE`; otherwise a fingerprint that doesn't match, or none while
 * drafts use the item, refuses with `MEDIA_USAGE_CHANGED`. Nothing using it
 * and no fingerprint goes through, so an API caller that never asked is not
 * broken.
 */
export async function assertMediaDeletable(
  rows: readonly MediaUseRow[],
  sentFingerprint: string | undefined
): Promise<void> {
  const counts = countLiveAndDrafts(rows);
  if (counts.live > 0) throw new MediaInUseError(counts);
  if (sentFingerprint === undefined) {
    if (counts.drafts > 0) throw new MediaUsageChangedError(counts);
    return;
  }
  if (sentFingerprint !== (await mediaUsageFingerprint(rows))) {
    throw new MediaUsageChangedError(counts);
  }
}
