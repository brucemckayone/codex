/**
 * What an old link to a removed piece answers (Codex-a6ofh.6.7, LN9b):
 * `ContentService.removedPiece`. The detail pages answer 410 for a piece that
 * was published once at that key and then removed, and say its owners were
 * emailed only when it left with notice (owner, 2026-11-24).
 *
 * Real DB. Every row hangs off this file's own users and organisations.
 */

import { CONTENT_STATUS } from '@codex/constants';
import { content, organizations } from '@codex/database/schema';
import {
  createTestContentInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewContent } from '../../types';
import { ContentService } from '../content-service';

const released = new Date('2026-01-01T00:00:00Z');
const removedOn = new Date('2026-11-01T00:00:00Z');

/** Live once, then deleted: an immediate delete, or a takedown. */
const REMOVED: Partial<NewContent> = {
  status: CONTENT_STATUS.ARCHIVED,
  publishedAt: released,
  deletedAt: removedOn,
};

/** Left after its notice: the day-30 delete keeps the leave date. */
const LEFT_WITH_NOTICE: Partial<NewContent> = {
  ...REMOVED,
  offSaleAt: new Date('2026-10-01T00:00:00Z'),
  leavesAt: removedOn,
  leavingByCreator: true,
};

describe('ContentService.removedPiece (Codex-a6ofh.6.7)', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
    [orgId, otherOrgId] = await Promise.all([newOrg(), newOrg()]);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function newOrg(): Promise<string> {
    return takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning({ id: organizations.id })
    ).id;
  }

  /** A piece at a fresh slug, in `organizationId` (null: personal). */
  async function piece(
    shape: Partial<NewContent>,
    organizationId: string | null = orgId
  ): Promise<string> {
    const slug = createUniqueSlug('removed');
    await db
      .insert(content)
      .values(
        createTestContentInput(creatorId, { slug, organizationId, ...shape })
      );
    return slug;
  }

  it('a piece that left with notice is removed, with notice', async () => {
    const slug = await piece(LEFT_WITH_NOTICE);
    expect(await service.removedPiece({ orgId, slug })).toEqual({
      removed: true,
      leftWithNotice: true,
    });
  });

  it('a takedown or an immediate delete is removed, without notice', async () => {
    const slug = await piece(REMOVED);
    expect(await service.removedPiece({ orgId, slug })).toEqual({
      removed: true,
      leftWithNotice: false,
    });
  });

  it('a draft deleted before it was ever published was never at a link', async () => {
    const slug = await piece({
      status: CONTENT_STATUS.DRAFT,
      publishedAt: null,
      deletedAt: removedOn,
    });
    expect((await service.removedPiece({ orgId, slug })).removed).toBe(false);
  });

  it('a piece not deleted is not removed, live or leaving', async () => {
    const live = await piece({
      status: CONTENT_STATUS.PUBLISHED,
      publishedAt: released,
    });
    const leaving = await piece({
      ...LEFT_WITH_NOTICE,
      deletedAt: null,
      leavesAt: new Date(Date.now() + 86_400_000),
    });
    for (const slug of [live, leaving]) {
      expect((await service.removedPiece({ orgId, slug })).removed).toBe(false);
    }
  });

  it("another org's removed piece at the slug is not this org's", async () => {
    const slug = await piece(LEFT_WITH_NOTICE, otherOrgId);
    expect((await service.removedPiece({ orgId, slug })).removed).toBe(false);
  });

  it("a personal key finds a personal piece, never an org's", async () => {
    const personal = await piece(LEFT_WITH_NOTICE, null);
    const inOrg = await piece(LEFT_WITH_NOTICE);
    expect(await service.removedPiece({ creatorId, slug: personal })).toEqual({
      removed: true,
      leftWithNotice: true,
    });
    expect(
      (await service.removedPiece({ creatorId, slug: inOrg })).removed
    ).toBe(false);
  });

  it('of several removed pieces at one slug, the latest decides', async () => {
    const slug = await piece(LEFT_WITH_NOTICE);
    await db.insert(content).values(
      createTestContentInput(creatorId, {
        slug,
        organizationId: orgId,
        ...REMOVED,
        deletedAt: new Date('2026-11-20T00:00:00Z'),
      })
    );
    expect(await service.removedPiece({ orgId, slug })).toEqual({
      removed: true,
      leftWithNotice: false,
    });
  });
});
