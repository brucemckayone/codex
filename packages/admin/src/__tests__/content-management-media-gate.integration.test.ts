/**
 * The admin publish holds ContentService.publish's media gate (Codex-6sbn1,
 * Codex-vmi6m): a draft keeps its link to a deleted media item, and must not
 * go live on it, nor on another creator's item. The media is read FOR KEY
 * SHARE, so a media delete running at the same moment is ordered against the
 * publish.
 *
 * Since Codex-a6ofh.2.1 both paths call one `assertPublishable`, so the admin
 * publish also refuses what a creator's would: no media, an empty article, a
 * piece for sale under £1, and a creator no longer on the org's team.
 *
 * DB-backed; every row it writes is its own and is deleted in afterAll.
 */

import { CONTENT_STATUS } from '@codex/constants';
import { MediaDeletedError, ThumbnailMediaDeletedError } from '@codex/content';
import {
  content as contentTable,
  mediaItems,
  organizations,
} from '@codex/database/schema';
import { NotFoundError } from '@codex/service-errors';
import {
  createTestMediaItemInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  joinTeam,
  seedTestUsers,
  setTeamMembership,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getMediaThumbnailPrefix } from '@codex/transcoding';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminContentManagementService } from '../services/content-management-service';

describe('AdminContentManagementService.publishContent media gate', () => {
  let db: Database;
  let service: AdminContentManagementService;
  let creatorId: string;
  let otherId: string;
  let orgId: string;
  const mediaIds: string[] = [];

  async function seedMedia(
    owner: string,
    overrides: Partial<typeof mediaItems.$inferInsert> = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(mediaItems)
        .values(
          createTestMediaItemInput(owner, { status: 'ready', ...overrides })
        )
        .returning({ id: mediaItems.id })
    );
    mediaIds.push(row.id);
    return row.id;
  }

  async function seedContent(
    values: Partial<typeof contentTable.$inferInsert>
  ): Promise<string> {
    return takeFirst(
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: orgId,
          title: 'Media gate film',
          slug: createUniqueSlug('media-gate'),
          contentType: 'video',
          status: CONTENT_STATUS.DRAFT,
          priceCents: 0,
          ...values,
        })
        .returning({ id: contentTable.id })
    ).id;
  }

  function seedDraft(
    mediaItemId: string,
    thumbnailUrl: string | null = null
  ): Promise<string> {
    return seedContent({ mediaItemId, thumbnailUrl });
  }

  async function statusOf(id: string) {
    const [row] = await db
      .select({ status: contentTable.status })
      .from(contentTable)
      .where(eq(contentTable.id, id));
    return row?.status;
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new AdminContentManagementService({ db, environment: 'test' });
    [creatorId, otherId] = await seedTestUsers(db, 2);
    orgId = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning({ id: organizations.id })
    ).id;
    // The creator is on the team: publish checks it (Codex-a6ofh.2.1).
    await joinTeam(db, orgId, creatorId);
  });

  afterAll(async () => {
    if (db) {
      await db
        .delete(contentTable)
        .where(eq(contentTable.organizationId, orgId));
      await db.delete(organizations).where(eq(organizations.id, orgId));
      if (mediaIds.length > 0) {
        await db.delete(mediaItems).where(inArray(mediaItems.id, mediaIds));
      }
    }
    await teardownTestDatabase();
  });

  it('refuses a draft whose media was deleted, with the MEDIA_DELETED code', async () => {
    const film = await seedMedia(creatorId, { deletedAt: new Date() });
    const draft = await seedDraft(film);

    const refusal = await service
      .publishContent(orgId, draft)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(MediaDeletedError);
    expect((refusal as MediaDeletedError).context).toEqual({
      contentId: draft,
      code: 'MEDIA_DELETED',
    });
    expect(await statusOf(draft)).toBe(CONTENT_STATUS.DRAFT);
  });

  it("refuses a draft whose thumbnail is a frame of the creator's deleted video, as ContentService.publish does (Codex-tqvmx)", async () => {
    const film = await seedMedia(creatorId);
    const gone = await seedMedia(creatorId, { deletedAt: new Date() });
    const kept = await seedMedia(creatorId);
    const frameOf = (mediaId: string) =>
      `https://cdn-assets.example/${getMediaThumbnailPrefix(creatorId, mediaId)}1920x1080-0a1b2c3d/lg.webp`;

    const draft = await seedDraft(film, frameOf(gone));
    const refusal = await service
      .publishContent(orgId, draft)
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ThumbnailMediaDeletedError);
    expect((refusal as ThumbnailMediaDeletedError).context).toEqual({
      contentId: draft,
      code: 'THUMBNAIL_MEDIA_DELETED',
    });
    expect(await statusOf(draft)).toBe(CONTENT_STATUS.DRAFT);

    // A frame of a video still in the library, or of the one it plays.
    for (const thumbnailUrl of [frameOf(kept), frameOf(film)]) {
      const ok = await seedDraft(film, thumbnailUrl);
      await service.publishContent(orgId, ok);
      expect(await statusOf(ok)).toBe(CONTENT_STATUS.PUBLISHED);
    }
  });

  it("refuses a draft holding another creator's media", async () => {
    const theirs = await seedMedia(otherId);
    const draft = await seedDraft(theirs);

    await expect(service.publishContent(orgId, draft)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(await statusOf(draft)).toBe(CONTENT_STATUS.DRAFT);
  });

  it('a publish that starts while a media delete holds the row waits on its locking read, then refuses', async () => {
    const film = await seedMedia(creatorId);
    const draft = await seedDraft(film);
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding = (_pid: number) => {};
    const held = new Promise<number>((resolve) => {
      holding = resolve;
    });

    // MediaItemService.delete's shape: the row FOR UPDATE, then soft-deleted.
    const deleting = db.transaction(async (tx) => {
      await tx
        .select({ id: mediaItems.id })
        .from(mediaItems)
        .where(eq(mediaItems.id, film))
        .for('update');
      const pid = await tx.execute(sql`SELECT pg_backend_pid() AS pid`);
      holding(Number((pid.rows[0] as { pid: number }).pid));
      await released;
      await tx
        .update(mediaItems)
        .set({ deletedAt: new Date() })
        .where(eq(mediaItems.id, film));
    });
    const deleter = await held;

    const publishing = service.publishContent(orgId, draft);
    // Release only once the publish is blocked BY the delete (a probe, not
    // a timer): a wait for a pool connection is not a lock wait.
    let settled = false;
    publishing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    let early = 'neither after 10 s';
    for (let i = 0; i < 400 && early === 'neither after 10 s'; i++) {
      const blocked = await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE ${deleter} = ANY(pg_blocking_pids(pid))`);
      if (settled) early = 'finished';
      else if (Number((blocked.rows[0] as { n: number }).n) > 0)
        early = 'waiting';
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    release();
    await deleting;

    expect(early).toBe('waiting');
    await expect(publishing).rejects.toBeInstanceOf(MediaDeletedError);
    expect(await statusOf(draft)).toBe(CONTENT_STATUS.DRAFT);
  });

  // ── The rest of the shared gate (Codex-a6ofh.2.1) ─────────────────────────

  it.each([
    ['a video with no media', { mediaItemId: null }, 'MEDIA_REQUIRED'],
    [
      'an article with nothing written',
      { contentType: 'written', contentBody: null },
      'BODY_REQUIRED',
    ],
    [
      'a piece for sale with no price',
      {
        contentType: 'written',
        contentBody: 'Body',
        isPurchasable: true,
        priceCents: null,
      },
      'PRICE_REQUIRED',
    ],
  ] as const)('refuses %s, with the code ContentService.publish gives', async (_case, values, code) => {
    const draft = await seedContent(values);

    await expect(service.publishContent(orgId, draft)).rejects.toMatchObject({
      statusCode: 422,
      context: { code },
    });
    expect(await statusOf(draft)).toBe(CONTENT_STATUS.DRAFT);
  });

  it('refuses media still processing, with MEDIA_NOT_READY', async () => {
    const film = await seedMedia(creatorId, { status: 'transcoding' });
    const draft = await seedDraft(film);

    await expect(service.publishContent(orgId, draft)).rejects.toMatchObject({
      statusCode: 422,
      context: { code: 'MEDIA_NOT_READY' },
    });
  });

  it("refuses a draft whose creator has left the org's team", async () => {
    const draft = await seedContent({
      contentType: 'written',
      contentBody: 'Body',
    });
    await setTeamMembership(db, orgId, creatorId, { status: 'inactive' });
    try {
      await expect(service.publishContent(orgId, draft)).rejects.toMatchObject({
        statusCode: 403,
        context: { code: 'NOT_ON_ORG_TEAM' },
      });
      expect(await statusOf(draft)).toBe(CONTENT_STATUS.DRAFT);
    } finally {
      await setTeamMembership(db, orgId, creatorId, { status: 'active' });
    }

    // Back on the team, the same draft goes live.
    await service.publishContent(orgId, draft);
    expect(await statusOf(draft)).toBe(CONTENT_STATUS.PUBLISHED);
  });

  // Codex-a6ofh.2.7: a creator's publish-when-ready schedule ends when the
  // piece goes live, whichever path publishes it.
  it("an admin publish clears a scheduled draft's schedule and blocked reason", async () => {
    const draft = await seedContent({
      mediaItemId: await seedMedia(creatorId),
      publishRequestedAt: new Date('2026-11-01T00:00:00Z'),
      publishBlockedReason: 'CREATOR_CONNECT_REQUIRED',
    });

    await service.publishContent(orgId, draft);

    const [row] = await db
      .select({
        status: contentTable.status,
        publishRequestedAt: contentTable.publishRequestedAt,
        publishBlockedReason: contentTable.publishBlockedReason,
      })
      .from(contentTable)
      .where(eq(contentTable.id, draft));
    expect(row).toEqual({
      status: CONTENT_STATUS.PUBLISHED,
      publishRequestedAt: null,
      publishBlockedReason: null,
    });
  });
});
