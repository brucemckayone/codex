/**
 * ContentService.listPublic — Category Filter Integration Tests
 *
 * Covers the public "Browse by topic" filter path added in WP-3:
 * - `category` filters the public list to content tagged with that category
 *   slug via the content_categories ⋈ categories membership subquery;
 * - the filter is SPACE-SCOPED — a same-slug category in a DIFFERENT org must
 *   NOT leak that org's content into this org's list (IDOR / cross-tenant
 *   guard, asserted unconditionally per implement/tests-must-be-able-to-fail);
 * - omitting `category` is backward-compatible (returns all published items).
 *
 * Database Isolation:
 * - neon-testing ephemeral branch per file. Rows are isolated by embedding a
 *   per-test token in the CATEGORY slug, and every assertion filters by that
 *   token'd category — so unrelated rows in the shared branch never interfere.
 *
 * NOTE: DB-run is env-deferred in the current sandbox (no reachable test DB);
 * the suite is written to pass against a real Neon test branch.
 */

import { randomUUID } from 'node:crypto';
import {
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CategoriesService } from '../categories-service';
import { ContentService } from '../content-service';

/** Unique, slug-safe token so a test's categories/content never collide. */
function uniqueToken(): string {
  return `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('ContentService.listPublic — category filter', () => {
  let db: Database;
  let content_service: ContentService;
  let categoriesService: CategoriesService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    content_service = new ContentService({ db, environment: 'test' });
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

  /** Insert a published, free content row and return its id. */
  async function seedPublishedContent(params: {
    organizationId: string;
    title: string;
  }): Promise<string> {
    const [row] = await db
      .insert(content)
      .values({
        creatorId,
        organizationId: params.organizationId,
        title: params.title,
        slug: createUniqueSlug('cat-filter'),
        contentType: 'written',
        accessType: 'free',
        status: 'published',
        publishedAt: new Date(),
      })
      .returning();
    return row.id;
  }

  it('returns only content tagged with the requested category slug', async () => {
    const token = uniqueToken();

    const fiction = await categoriesService.create(
      { name: `Fiction ${token}` },
      { creatorId, organizationId: orgAId }
    );
    const poetry = await categoriesService.create(
      { name: `Poetry ${token}` },
      { creatorId, organizationId: orgAId }
    );

    const inFiction = await seedPublishedContent({
      organizationId: orgAId,
      title: `Fiction piece ${token}`,
    });
    const inPoetry = await seedPublishedContent({
      organizationId: orgAId,
      title: `Poetry piece ${token}`,
    });

    await db.insert(contentCategories).values([
      { contentId: inFiction, categoryId: fiction.id },
      { contentId: inPoetry, categoryId: poetry.id },
    ]);

    const result = await content_service.listPublic({
      orgId: orgAId,
      page: 1,
      limit: 20,
      sort: 'newest',
      category: fiction.slug,
    });

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(inFiction);
    // Unconditional: the poetry item MUST be absent — proves the JOIN filters.
    expect(ids).not.toContain(inPoetry);
  });

  it('is space-scoped: a same-slug category in another org does not leak its content', async () => {
    const token = uniqueToken();
    const name = `Shared ${token}`;

    // Same display name → same base slug, but in two different orgs.
    const catA = await categoriesService.create(
      { name },
      { creatorId, organizationId: orgAId }
    );
    const catB = await categoriesService.create(
      { name },
      { creatorId, organizationId: orgBId }
    );
    expect(catA.slug).toBe(catB.slug); // per-space uniqueness → identical slug

    const contentA = await seedPublishedContent({
      organizationId: orgAId,
      title: `A ${token}`,
    });
    const contentB = await seedPublishedContent({
      organizationId: orgBId,
      title: `B ${token}`,
    });
    await db.insert(contentCategories).values([
      { contentId: contentA, categoryId: catA.id },
      { contentId: contentB, categoryId: catB.id },
    ]);

    const result = await content_service.listPublic({
      orgId: orgAId,
      page: 1,
      limit: 20,
      sort: 'newest',
      category: catA.slug,
    });

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(contentA);
    // Unconditional cross-tenant guard: org B's identically-slugged category
    // MUST NOT surface org B's content in org A's list.
    expect(ids).not.toContain(contentB);
  });

  it('returns published items unfiltered when category is omitted', async () => {
    const token = uniqueToken();
    const category = await categoriesService.create(
      { name: `Optional ${token}` },
      { creatorId, organizationId: orgAId }
    );
    const tagged = await seedPublishedContent({
      organizationId: orgAId,
      title: `Tagged ${token}`,
    });
    await db
      .insert(contentCategories)
      .values({ contentId: tagged, categoryId: category.id });

    const filtered = await content_service.listPublic({
      orgId: orgAId,
      page: 1,
      limit: 20,
      sort: 'newest',
      category: category.slug,
    });
    const unfiltered = await content_service.listPublic({
      orgId: orgAId,
      page: 1,
      limit: 50,
      sort: 'newest',
    });

    expect(filtered.items.map((i) => i.id)).toContain(tagged);
    // Unfiltered path still reaches the row (category filter is purely additive).
    expect(unfiltered.items.map((i) => i.id)).toContain(tagged);
  });
});
