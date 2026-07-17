/**
 * CategoriesService.listPublicForOrg — Integration Tests
 *
 * Covers the PUBLIC "Browse by topic" feed added in WP-3 (backs
 * GET /api/content/public/categories):
 * - returns ORG-space categories that have ≥1 PUBLISHED, non-deleted content
 *   item — a draft-only or empty topic is excluded (no dead-end cards);
 * - is org-scoped — another org's categories never leak (cross-tenant guard,
 *   asserted unconditionally);
 * - ordered by sortOrder then name (the curator's landing order).
 *
 * Database Isolation: neon-testing ephemeral branch per file; per-test token in
 * category names keeps assertions independent of other rows in the branch.
 *
 * NOTE: DB-run is env-deferred in the current sandbox (no reachable test DB);
 * written to pass against a real Neon test branch.
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

function uniqueToken(): string {
  return `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('CategoriesService.listPublicForOrg', () => {
  let db: Database;
  let service: CategoriesService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new CategoriesService({ db, environment: 'test' });

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

  async function seedContent(params: {
    organizationId: string;
    status: 'draft' | 'published';
  }): Promise<string> {
    const [row] = await db
      .insert(content)
      .values({
        creatorId,
        organizationId: params.organizationId,
        title: `Item ${randomUUID().slice(0, 8)}`,
        slug: createUniqueSlug('cat-public'),
        contentType: 'written',
        accessType: 'free',
        status: params.status,
        publishedAt: params.status === 'published' ? new Date() : null,
      })
      .returning();
    return row.id;
  }

  it('returns only categories with ≥1 published item (excludes draft-only and empty)', async () => {
    const token = uniqueToken();

    const withPublished = await service.create(
      { name: `Published ${token}` },
      { creatorId, organizationId: orgAId }
    );
    const draftOnly = await service.create(
      { name: `DraftOnly ${token}` },
      { creatorId, organizationId: orgAId }
    );
    const empty = await service.create(
      { name: `Empty ${token}` },
      { creatorId, organizationId: orgAId }
    );

    const publishedItem = await seedContent({
      organizationId: orgAId,
      status: 'published',
    });
    const draftItem = await seedContent({
      organizationId: orgAId,
      status: 'draft',
    });
    await db.insert(contentCategories).values([
      { contentId: publishedItem, categoryId: withPublished.id },
      { contentId: draftItem, categoryId: draftOnly.id },
    ]);

    const rows = await service.listPublicForOrg(orgAId);
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(withPublished.id);
    // Unconditional: draft-only and empty topics MUST be absent.
    expect(ids).not.toContain(draftOnly.id);
    expect(ids).not.toContain(empty.id);
  });

  it('is org-scoped — another org’s categories never leak', async () => {
    const token = uniqueToken();

    const inA = await service.create(
      { name: `A ${token}` },
      { creatorId, organizationId: orgAId }
    );
    const inB = await service.create(
      { name: `B ${token}` },
      { creatorId, organizationId: orgBId }
    );

    const itemA = await seedContent({
      organizationId: orgAId,
      status: 'published',
    });
    const itemB = await seedContent({
      organizationId: orgBId,
      status: 'published',
    });
    await db.insert(contentCategories).values([
      { contentId: itemA, categoryId: inA.id },
      { contentId: itemB, categoryId: inB.id },
    ]);

    const rows = await service.listPublicForOrg(orgAId);
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(inA.id);
    expect(ids).not.toContain(inB.id);
  });

  it('orders by sortOrder then name', async () => {
    const token = uniqueToken();

    // sortOrder ties broken by name asc → expected order: Alpha(1), Zeta(1), Mid(2)
    const zeta = await service.create(
      { name: `${token} Zeta`, sortOrder: 1 },
      { creatorId, organizationId: orgAId }
    );
    const alpha = await service.create(
      { name: `${token} Alpha`, sortOrder: 1 },
      { creatorId, organizationId: orgAId }
    );
    const mid = await service.create(
      { name: `${token} Mid`, sortOrder: 2 },
      { creatorId, organizationId: orgAId }
    );

    for (const category of [zeta, alpha, mid]) {
      const item = await seedContent({
        organizationId: orgAId,
        status: 'published',
      });
      await db
        .insert(contentCategories)
        .values({ contentId: item, categoryId: category.id });
    }

    const rows = await service.listPublicForOrg(orgAId);
    const ordered = rows
      .filter((r) => r.name.startsWith(token))
      .map((r) => r.id);

    expect(ordered).toEqual([alpha.id, zeta.id, mid.id]);
  });
});
