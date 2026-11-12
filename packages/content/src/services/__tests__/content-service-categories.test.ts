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
import { CacheType } from '@codex/cache';
import { CONTENT_MAX_CATEGORIES } from '@codex/constants';
import {
  categories,
  content,
  contentCategories,
  organizationMemberships,
  organizations,
} from '@codex/database/schema';
import {
  createTestMembershipInput,
  createTestOrganizationInput,
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  takeFirst,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

    const orgA = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    const orgB = takeFirst(
      await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning()
    );
    orgAId = orgA.id;
    orgBId = orgB.id;

    // Content is filed into org A only, so the creator is on org A's team
    // (Codex-ocal6). Org B just supplies the out-of-space categories.
    await db
      .insert(organizationMemberships)
      .values(
        createTestMembershipInput(orgAId, creatorId, { role: 'creator' })
      );
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
        tags: [],
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
          tags: [],
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

  // ── The studio list by category, and its rows' names (Codex-a6ofh.3.3) ──

  /** One studio list page of the creator's org A content, its rows named. */
  async function listOrgA(filters: Record<string, string> = {}) {
    return contentService.list(
      creatorId,
      { organizationId: orgAId, ...filters },
      { page: 1, limit: 100 },
      { withCategories: true }
    );
  }

  it('lists a piece in three categories once, and counts it once', async () => {
    const token = uniqueToken();
    const cats = await Promise.all(
      ['A', 'B', 'C'].map((n) => createCategory(`${n} ${token}`, orgAId))
    );
    const piece = await createOrgAContent(cats.map((c) => c.id));

    for (const cat of cats) {
      const page = await listOrgA({ categoryId: cat.id });
      expect(page.items.map((row) => row.id)).toEqual([piece.id]);
      expect(page.pagination.total).toBe(1);
    }
  });

  it('a category files only its own pieces', async () => {
    const token = uniqueToken();
    const kept = await createCategory(`Kept ${token}`, orgAId);
    const other = await createCategory(`Other ${token}`, orgAId);
    const inKept = await createOrgAContent([kept.id]);
    await createOrgAContent([other.id]);
    await createOrgAContent();

    const page = await listOrgA({ categoryId: kept.id });
    expect(page.items.map((row) => row.id)).toEqual([inKept.id]);
  });

  it('a soft-deleted category files nothing, and names no row', async () => {
    const token = uniqueToken();
    const doomed = await createCategory(`Doomed ${token}`, orgAId);
    const kept = await createCategory(`Kept ${token}`, orgAId);
    const piece = await createOrgAContent([doomed.id, kept.id]);
    await db
      .update(categories)
      .set({ deletedAt: new Date() })
      .where(eq(categories.id, doomed.id));

    expect((await listOrgA({ categoryId: doomed.id })).items).toEqual([]);
    const row = (await listOrgA()).items.find((r) => r.id === piece.id);
    expect(row?.categories).toEqual([{ id: kept.id, name: kept.name }]);
  });

  it('each studio row names its live categories in their order, [] for none', async () => {
    const token = uniqueToken();
    const second = await createCategory(`Second ${token}`, orgAId);
    const first = await createCategory(`First ${token}`, orgAId);
    await db
      .update(categories)
      .set({ sortOrder: 1 })
      .where(eq(categories.id, second.id));
    await db
      .update(categories)
      .set({ sortOrder: 0 })
      .where(eq(categories.id, first.id));
    const filed = await createOrgAContent([second.id, first.id]);
    const unfiled = await createOrgAContent();

    const rows = (await listOrgA()).items;
    expect(rows.find((r) => r.id === filed.id)?.categories).toEqual([
      { id: first.id, name: first.name },
      { id: second.id, name: second.name },
    ]);
    expect(rows.find((r) => r.id === unfiled.id)?.categories).toEqual([]);
  });

  it('names no row unless asked: the badges and pickers skip the query', async () => {
    const cat = await createCategory(`Unasked ${uniqueToken()}`, orgAId);
    const piece = await createOrgAContent([cat.id]);

    const page = await contentService.list(
      creatorId,
      { organizationId: orgAId },
      { page: 1, limit: 100 }
    );
    const row = page.items.find((r) => r.id === piece.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('categories');
  });

  // /explore's topic filter sends a category SLUG (Codex-a6ofh.3.3): it was
  // matched against the legacy free-text column, which no topic slug held.
  it('a category slug filters by the real categories, in the org given', async () => {
    const token = uniqueToken();
    const topic = await createCategory(`Topic ${token}`, orgAId);
    const piece = await createOrgAContent([topic.id]);
    await createOrgAContent();

    const page = await listOrgA({ category: topic.slug });
    expect(page.items.map((row) => row.id)).toEqual([piece.id]);
    // Another org's list holds none of org A's pieces under that slug.
    const elsewhere = await contentService.list(
      creatorId,
      { organizationId: orgBId, category: topic.slug },
      { page: 1, limit: 100 }
    );
    expect(elsewhere.items).toEqual([]);
  });

  // ── Adding categories, keeping the set (Codex-a6ofh.3.3) ───────────────

  it('adds to the set, keeping what the piece had', async () => {
    const token = uniqueToken();
    const had = await createCategory(`Had ${token}`, orgAId);
    const added = await createCategory(`Added ${token}`, orgAId);
    const piece = await createOrgAContent([had.id]);

    const result = await contentService.addCategories(piece.id, creatorId, [
      added.id,
    ]);

    expect([...result.categoryIds].sort()).toEqual([had.id, added.id].sort());
    expect(result.organizationId).toBe(orgAId);
    expect(result.hasBeenLive).toBe(false);
    expect(await membershipIds(piece.id)).toEqual([had.id, added.id].sort());
  });

  it('bumps the org’s topic list only once the piece has been live', async () => {
    const invalidate = vi.fn(async (_key: string) => undefined);
    const watched = new ContentService({ db, environment: 'test' });
    watched.setCache({ invalidate } as unknown as Parameters<
      ContentService['setCache']
    >[0]);
    const token = uniqueToken();
    const onDraft = await createCategory(`On draft ${token}`, orgAId);
    const onLive = await createCategory(`On live ${token}`, orgAId);
    const piece = await createOrgAContent();

    // A never-live draft is on no public topic list.
    await watched.addCategories(piece.id, creatorId, [onDraft.id]);
    expect(invalidate).not.toHaveBeenCalled();

    await watched.publish(piece.id, creatorId);
    invalidate.mockClear();
    await watched.addCategories(piece.id, creatorId, [onLive.id]);
    expect(invalidate).toHaveBeenCalledWith(CacheType.CATEGORIES(orgAId));
  });

  it('adding a category it has is a no-op, kept once', async () => {
    const token = uniqueToken();
    const cat = await createCategory(`Once ${token}`, orgAId);
    const piece = await createOrgAContent([cat.id]);

    await contentService.addCategories(piece.id, creatorId, [cat.id, cat.id]);

    expect(await membershipIds(piece.id)).toEqual([cat.id]);
  });

  it('refuses another org’s category and adds nothing', async () => {
    const token = uniqueToken();
    const ours = await createCategory(`Ours ${token}`, orgAId);
    const theirs = await createCategory(`Theirs ${token}`, orgBId);
    const piece = await createOrgAContent();

    await expect(
      contentService.addCategories(piece.id, creatorId, [ours.id, theirs.id])
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      context: { invalidCategoryIds: [theirs.id] },
    });
    expect(await membershipIds(piece.id)).toEqual([]);
  });

  it('refuses a piece that is not the caller’s, as not found', async () => {
    const token = uniqueToken();
    const cat = await createCategory(`Cat ${token}`, orgAId);
    const piece = await createOrgAContent();
    const [stranger] = await seedTestUsers(db, 1);

    await expect(
      contentService.addCategories(piece.id, stranger, [cat.id])
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      context: { contentId: piece.id, code: 'CONTENT_NOT_FOUND' },
    });
    expect(await membershipIds(piece.id)).toEqual([]);
  });

  it('refuses past the limit in all, and adds none of them', async () => {
    const max = CONTENT_MAX_CATEGORIES;
    const token = uniqueToken();
    const cats = await Promise.all(
      Array.from({ length: max + 1 }, (_, i) =>
        createCategory(`Cap ${i} ${token}`, orgAId)
      )
    );
    const piece = await createOrgAContent(
      cats.slice(0, max - 1).map((c) => c.id)
    );

    // One short of the limit, plus one: allowed.
    await contentService.addCategories(piece.id, creatorId, [
      cats[max - 1]!.id,
    ]);
    // At the limit, plus one: refused, and nothing is written.
    await expect(
      contentService.addCategories(piece.id, creatorId, [cats[max]!.id])
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', context: { max } });
    expect(await membershipIds(piece.id)).toHaveLength(max);
  });
});
