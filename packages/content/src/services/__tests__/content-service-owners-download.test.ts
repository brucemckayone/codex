/**
 * ContentService.create stores `ownersCanDownload` (Codex-a6ofh.6, owner
 * N1-B): the create insert names each column, so a field the schema accepts
 * but the list leaves out is dropped without a word (as Codex-1g5lh.9's
 * shader pick was). Sent off, it is stored off; left out, the switch's
 * default, on.
 *
 * Database: a real Postgres (the throwaway lane database locally, the CI
 * branch in CI). Every row it makes is its own, and deleted in afterAll.
 */

import { content } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

describe('ContentService.create: ownersCanDownload', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  const contentIds: string[] = [];

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    if (contentIds.length > 0) {
      await db.delete(content).where(inArray(content.id, contentIds));
    }
    await teardownTestDatabase();
  });

  async function created(ownersCanDownload?: boolean) {
    const row = await service.create(
      {
        title: 'Download switch',
        slug: createUniqueSlug('owners-download'),
        contentType: 'written',
        contentBody: 'Body text',
        priceCents: 0,
        tags: [],
        ...(ownersCanDownload === undefined ? {} : { ownersCanDownload }),
      },
      creatorId
    );
    contentIds.push(row.id);
    return takeFirst(
      await db
        .select({ ownersCanDownload: content.ownersCanDownload })
        .from(content)
        .where(eq(content.id, row.id))
    );
  }

  it('stores it off when the create sends it off', async () => {
    expect((await created(false)).ownersCanDownload).toBe(false);
  });

  it('stores it on when the create leaves it out', async () => {
    expect((await created()).ownersCanDownload).toBe(true);
  });
});
