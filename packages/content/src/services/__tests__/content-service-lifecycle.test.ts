/**
 * ContentService — the status tabs' `lifecycle` filter (Codex-a6ofh.3.6)
 *
 * The studio list's tabs ask where a piece is in its life: a draft never
 * live, on sale, or off sale (once live and not on sale now: archived, or a
 * draft again, its buyers keeping it). Covered:
 * - each lifecycle lists exactly the pieces `contentLifecycle` (the rule the
 *   rows are labelled by) puts there, and the total counts that same set;
 * - another creator's pieces and a deleted piece are never listed;
 * - a draft here is the "Needs you" draft (`isDraft`), so a tab and a chip
 *   agree;
 * - a browse list, which spans creators, refuses it.
 *
 * Each test seeds its own creator, so its lists are exact.
 */

import {
  CONTENT_LIFECYCLE,
  CONTENT_LIFECYCLES,
  CONTENT_STATUS,
  type ContentLifecycle,
  contentLifecycle,
} from '@codex/constants';
import {
  content,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import {
  createTestContentInput,
  createTestMembershipInput,
  createTestOrganizationInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewContent } from '../../types';
import { ContentService } from '../content-service';

const ONCE = new Date('2026-10-01T00:00:00Z');

/** Every pairing of status and publishedAt a row can hold. */
const SHAPES = [
  { status: CONTENT_STATUS.DRAFT, publishedAt: null },
  // Unpublishing keeps publishedAt: its buyers keep it.
  { status: CONTENT_STATUS.DRAFT, publishedAt: ONCE },
  { status: CONTENT_STATUS.PUBLISHED, publishedAt: ONCE },
  // A legacy live row can lack publishedAt; its status still says it is out.
  { status: CONTENT_STATUS.PUBLISHED, publishedAt: null },
  // Only catalogue-departure.ts archives, with or without publishedAt.
  { status: CONTENT_STATUS.ARCHIVED, publishedAt: ONCE },
  { status: CONTENT_STATUS.ARCHIVED, publishedAt: null },
] as const;

describe('ContentService — lifecycle (Codex-a6ofh.3.6)', () => {
  let db: Database;
  let service: ContentService;

  beforeAll(() => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function newCreator(): Promise<string> {
    const [id] = await seedTestUsers(db, 1);
    return id;
  }

  async function piece(
    creatorId: string,
    overrides: Partial<NewContent> = {}
  ): Promise<string> {
    const row = takeFirst(
      await db
        .insert(content)
        .values(createTestContentInput(creatorId, overrides))
        .returning({ id: content.id })
    );
    return row.id;
  }

  /** The ids a lifecycle lists, sorted, and the total it counts. */
  async function listed(
    creatorId: string,
    lifecycle: ContentLifecycle
  ): Promise<{ ids: string[]; total: number }> {
    const page = await service.list(
      creatorId,
      { lifecycle },
      { page: 1, limit: 100 }
    );
    return {
      ids: page.items.map((row) => row.id).sort(),
      total: page.pagination.total,
    };
  }

  it('lists each piece under the lifecycle its row reads as, and counts that set', async () => {
    const creatorId = await newCreator();
    const seeded: { id: string; lifecycle: ContentLifecycle }[] = [];
    for (const shape of SHAPES) {
      seeded.push({
        id: await piece(creatorId, shape),
        lifecycle: contentLifecycle(shape),
      });
    }
    // Never listed: a deleted piece, and another creator's.
    await piece(creatorId, {
      status: CONTENT_STATUS.DRAFT,
      publishedAt: ONCE,
      deletedAt: new Date(),
    });
    await piece(await newCreator(), {
      status: CONTENT_STATUS.ARCHIVED,
      publishedAt: ONCE,
    });

    for (const lifecycle of CONTENT_LIFECYCLES) {
      const want = seeded
        .filter((row) => row.lifecycle === lifecycle)
        .map((row) => row.id)
        .sort();
      // Every tab has pieces here, so an empty list can't pass by accident.
      expect(want.length).toBeGreaterThan(0);
      expect(await listed(creatorId, lifecycle)).toEqual({
        ids: want,
        total: want.length,
      });
    }
  });

  it('a draft is the "Needs you" draft: never live, so an unpublished one is off sale', async () => {
    const creatorId = await newCreator();
    const fresh = await piece(creatorId);
    const unpublished = await piece(creatorId, { publishedAt: ONCE });

    expect((await listed(creatorId, CONTENT_LIFECYCLE.DRAFT)).ids).toEqual([
      fresh,
    ]);
    expect((await listed(creatorId, CONTENT_LIFECYCLE.OFF_SALE)).ids).toEqual([
      unpublished,
    ]);
    // The stored status still files both as drafts.
    const drafts = await service.list(
      creatorId,
      { status: CONTENT_STATUS.DRAFT },
      { page: 1, limit: 10 }
    );
    expect(drafts.pagination.total).toBe(2);
  });

  it('narrows within an org like any other filter', async () => {
    const creatorId = await newCreator();
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    await db
      .insert(organizationMemberships)
      .values(
        createTestMembershipInput(org.id, creatorId, { role: 'creator' })
      );
    const inOrg = await piece(creatorId, {
      organizationId: org.id,
      status: CONTENT_STATUS.ARCHIVED,
    });
    await piece(creatorId, { status: CONTENT_STATUS.ARCHIVED });

    const page = await service.list(
      creatorId,
      { lifecycle: CONTENT_LIFECYCLE.OFF_SALE, organizationId: org.id },
      { page: 1, limit: 10 }
    );
    expect(page.items.map((row) => row.id)).toEqual([inOrg]);
  });

  it('refuses a lifecycle on a browse list, which spans creators', async () => {
    const creatorId = await newCreator();
    const org = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    await expect(
      service.list(
        creatorId,
        { organizationId: org.id, lifecycle: CONTENT_LIFECYCLE.OFF_SALE },
        { page: 1, limit: 10 },
        { scope: 'browse' }
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
