/**
 * ContentService — Category Tagging (WP-5)
 *
 * Covers the WRITE path that makes the topic taxonomy live: assigning
 * `content_categories` join rows when content is created/updated.
 * - create writes the provided join set inside the content transaction;
 * - update REPLACES (not appends) the set, and leaves it untouched when
 *   `categoryIds` is omitted from a partial update;
 * - IDOR guard: a category from a DIFFERENT org space cannot be attached —
 *   the assignment is rejected (ValidationError) and, on update, the whole
 *   transaction rolls back so the content row is unchanged too. The foreign
 *   category is seeded for real and the rejection asserted unconditionally
 *   (implement/tests-must-be-able-to-fail);
 * - get surfaces `categoryIds` for edit-mode pre-population.
 *
 * Database Isolation:
 * - neon-testing ephemeral branch per file. Each test creates its own
 *   categories/content, so rows never collide across the shared branch.
 *
 * NOTE: DB-run is env-deferred in the current sandbox (no reachable test DB);
 * the suite is written to pass against a real Neon test branch.
 */

import { randomUUID } from 'node:crypto';
import {
  categories,
  content,
  contentCategories,
  organizations,
} from '@codex/database/schema';
import {
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors';
import { CategoriesService } from '../categories-service';
import { ContentService } from '../content-service';

/** Unique, slug-safe token so a test's categories/content never collide. */
function uniqueToken(): string {
  return `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('ContentService — category tagging (WP-5)', () => {
  let db: Database;
  let contentService: ContentService;
  let categoriesService: CategoriesService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    contentService = new ContentService({ db, environment: 'test' });
    categoriesService = new CategoriesService({ db, environment: 'test' });

    const [firstCreator] = await seedTestUsers(db, 1);
    creatorId = firstCreator;

    const [orgA] = await db
      .insert(organizations)
      .values(createTestOrganizationInput())
      .returning();
    const [orgB] = await db
      .insert(organizations)
      .values(createTestOrganizationInput())
      .returning();
    orgAId = orgA.id;
    orgBId = orgB.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** Create a written (media-free) content item in org A. */
  async function createOrgAContent(categoryIds?: string[]) {
    return contentService.create(
      {
        title: `Content ${uniqueToken()}`,
        slug: createUniqueSlug('cat-content'),
        contentType: 'written',
        contentBody: 'This is the written content body.',
        organizationId: orgAId,
        ...(categoryIds ? { categoryIds } : {}),
      },
      creatorId
    );
  }

  /** Create a category in the given org space. */
  async function createCategory(name: string, organizationId: string) {
    return categoriesService.create({ name }, { creatorId, organizationId });
  }

  /** Sorted membership ids for a content item. */
  async function membershipIds(contentId: string): Promise<string[]> {
    const rows = await db
      .select({ categoryId: contentCategories.categoryId })
      .from(contentCategories)
      .where(eq(contentCategories.contentId, contentId));
    return rows.map((r) => r.categoryId).sort();
  }

  it('writes content_categories join rows on create', async () => {
    const token = uniqueToken();
    const catA = await createCategory(`A ${token}`, orgAId);
    const catB = await createCategory(`B ${token}`, orgAId);

    const created = await createOrgAContent([catA.id, catB.id]);

    expect(await membershipIds(created.id)).toEqual([catA.id, catB.id].sort());
  });

  it('creates no join rows when categoryIds is omitted', async () => {
    const created = await createOrgAContent();
    expect(await membershipIds(created.id)).toEqual([]);
  });

  it('REPLACES (not appends) the join set on update', async () => {
    const token = uniqueToken();
    const catA = await createCategory(`A ${token}`, orgAId);
    const catB = await createCategory(`B ${token}`, orgAId);
    const catC = await createCategory(`C ${token}`, orgAId);

    const created = await createOrgAContent([catA.id, catB.id]);
    await contentService.update(
      created.id,
      { categoryIds: [catB.id, catC.id] },
      creatorId
    );

    expect(await membershipIds(created.id)).toEqual([catB.id, catC.id].sort());
  });

  it('clears all memberships when update sets categoryIds to []', async () => {
    const catA = await createCategory(`A ${uniqueToken()}`, orgAId);
    const created = await createOrgAContent([catA.id]);

    await contentService.update(created.id, { categoryIds: [] }, creatorId);

    expect(await membershipIds(created.id)).toEqual([]);
  });

  it('leaves memberships untouched when categoryIds is omitted on update', async () => {
    const catA = await createCategory(`A ${uniqueToken()}`, orgAId);
    const created = await createOrgAContent([catA.id]);

    await contentService.update(
      created.id,
      { title: `Renamed ${uniqueToken()}` },
      creatorId
    );

    expect(await membershipIds(created.id)).toEqual([catA.id]);
  });

  it('rejects assigning a category from a different org space (IDOR) on create', async () => {
    // A real category, but owned by org B — must not be attachable to org A
    // content. Rejection is asserted unconditionally.
    const foreign = await createCategory(`Foreign ${uniqueToken()}`, orgBId);

    await expect(createOrgAContent([foreign.id])).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('rejects an out-of-space category on update and rolls the content write back', async () => {
    const token = uniqueToken();
    const catA = await createCategory(`A ${token}`, orgAId);
    const foreign = await createCategory(`Foreign ${token}`, orgBId);

    const created = await createOrgAContent([catA.id]);
    const originalTitle = created.title;

    await expect(
      contentService.update(
        created.id,
        { title: `Should not persist ${token}`, categoryIds: [foreign.id] },
        creatorId
      )
    ).rejects.toBeInstanceOf(ValidationError);

    // Transaction rolled back: title unchanged AND membership set unchanged.
    const [row] = await db
      .select()
      .from(content)
      .where(eq(content.id, created.id));
    expect(row?.title).toBe(originalTitle);
    expect(await membershipIds(created.id)).toEqual([catA.id]);
  });

  it('surfaces categoryIds via get for edit-mode pre-population', async () => {
    const token = uniqueToken();
    const catA = await createCategory(`A ${token}`, orgAId);
    const catB = await createCategory(`B ${token}`, orgAId);

    const created = await createOrgAContent([catA.id, catB.id]);
    const fetched = await contentService.get(created.id, creatorId);

    expect(fetched?.categoryIds?.slice().sort()).toEqual(
      [catA.id, catB.id].sort()
    );
  });

  it('rejects an out-of-space category on create and does not persist the content row', async () => {
    // Symmetric to the update-rollback test: a foreign (org B) category on
    // create must abort the whole transaction so no content row survives.
    const slug = createUniqueSlug('cat-idor-create');
    const foreign = await createCategory(`Foreign ${uniqueToken()}`, orgBId);

    await expect(
      contentService.create(
        {
          title: `Content ${uniqueToken()}`,
          slug,
          contentType: 'written',
          contentBody: 'This is the written content body.',
          organizationId: orgAId,
          categoryIds: [foreign.id],
        },
        creatorId
      )
    ).rejects.toBeInstanceOf(ValidationError);

    const rows = await db
      .select({ id: content.id })
      .from(content)
      .where(eq(content.slug, slug));
    expect(rows.length).toBe(0);
  });

  it('rejects a soft-deleted category', async () => {
    // A live category that is then soft-deleted must no longer be assignable —
    // the IDOR guard filters `deleted_at IS NULL`.
    const token = uniqueToken();
    const doomed = await createCategory(`Doomed ${token}`, orgAId);
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, doomed.id));

    await expect(createOrgAContent([doomed.id])).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});
