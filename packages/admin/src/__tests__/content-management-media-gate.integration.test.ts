/**
 * The admin publish holds ContentService.publish's media gate (Codex-6sbn1,
 * Codex-vmi6m): a draft keeps its link to a deleted media item, and must not
 * go live on it, nor on another creator's item. The media is read FOR KEY
 * SHARE, so a media delete running at the same moment is ordered against the
 * publish.
 *
 * DB-backed; every row it writes is its own and is deleted in afterAll.
 */

import { CONTENT_STATUS } from '@codex/constants';
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
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MediaDeletedError } from '../errors';
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

  async function seedDraft(mediaItemId: string): Promise<string> {
    return takeFirst(
      await db
        .insert(contentTable)
        .values({
          creatorId,
          organizationId: orgId,
          mediaItemId,
          title: 'Media gate film',
          slug: createUniqueSlug('media-gate'),
          contentType: 'video',
          status: CONTENT_STATUS.DRAFT,
          priceCents: 0,
        })
        .returning({ id: contentTable.id })
    ).id;
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
});
