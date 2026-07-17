/**
 * Categories Service Tests
 *
 * Covers the per-space topic taxonomy service:
 * - create (slug derivation, collision suffixing, Unicode, per-space scope,
 *   empty-slug rejection)
 * - list (space-scoped, sortOrder→name ordering, pagination, IDOR isolation)
 * - get / update / softDelete (ownership + soft-delete semantics)
 * - reorder (transactional; rolls back on a foreign/absent id)
 *
 * IDOR guard (implement/tests-must-be-able-to-fail): a category owned by a
 * DIFFERENT creator is seeded directly, and the assertions that it is absent
 * from this creator's list/get are UNCONDITIONAL — they will fail if the
 * scoping regresses.
 *
 * Database Isolation:
 * - Uses neon-testing for an ephemeral branch per test file.
 * - Tests share the branch, so listing assertions isolate their own rows via a
 *   unique per-test token embedded in the category name + `search` filter.
 */

import { randomUUID } from 'node:crypto';
import { categories, organizations } from '@codex/database/schema';
import {
  createTestOrganizationInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CategoryNotFoundError, ValidationError } from '../../errors';
import { CategoriesService } from '../categories-service';

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

/** Unique, slug-safe, searchable token to isolate a test's rows in the shared branch. */
function uniqueToken(): string {
  return `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('CategoriesService', () => {
  let db: Database;
  let service: CategoriesService;
  let creatorId: string;
  let otherCreatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new CategoriesService({ db, environment: 'test' });

    const userIds = await seedTestUsers(db, 2);
    [creatorId, otherCreatorId] = userIds;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('create', () => {
    it('derives a slug from the name and defaults sortOrder to 0', async () => {
      const token = uniqueToken();
      const result = await service.create(
        { name: `Deep Sea Diving ${token}` },
        { creatorId }
      );

      expect(result.id).toBeDefined();
      expect(result.creatorId).toBe(creatorId);
      expect(result.organizationId).toBeNull();
      expect(result.name).toBe(`Deep Sea Diving ${token}`);
      expect(result.slug).toBe(`deep-sea-diving-${token}`);
      expect(result.sortOrder).toBe(0);
    });

    it('suffixes the slug on collision within a space', async () => {
      const token = uniqueToken();
      const name = `News ${token}`;

      const first = await service.create({ name }, { creatorId });
      const second = await service.create({ name }, { creatorId });
      const third = await service.create({ name }, { creatorId });

      expect(first.slug).toBe(`news-${token}`);
      expect(second.slug).toBe(`news-${token}-2`);
      expect(third.slug).toBe(`news-${token}-3`);
    });

    it('derives a Unicode-aware slug (accented letters preserved)', async () => {
      const token = uniqueToken();
      const result = await service.create(
        { name: `Café Del Mar ${token}` },
        { creatorId }
      );

      expect(result.slug).toBe(`café-del-mar-${token}`);
    });

    it('scopes slug uniqueness per resolved space (same slug in personal + org)', async () => {
      const [organization] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const token = uniqueToken();
      const name = `Topic ${token}`;

      const personal = await service.create({ name }, { creatorId });
      const orgScoped = await service.create(
        { name },
        { creatorId, organizationId: organization.id }
      );

      // Different spaces → each gets the base slug (no suffix).
      expect(personal.slug).toBe(`topic-${token}`);
      expect(orgScoped.slug).toBe(`topic-${token}`);
      expect(personal.organizationId).toBeNull();
      expect(orgScoped.organizationId).toBe(organization.id);
    });

    it('rejects a name with no alphanumeric characters (empty slug)', async () => {
      await expect(
        service.create({ name: '!!!' }, { creatorId })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('list', () => {
    it('lists a personal space ordered by sortOrder then name, paginated', async () => {
      const token = uniqueToken();

      // sortOrder ties broken by name asc → expected order: Alpha(1), Gamma(1), Beta(2)
      await service.create(
        { name: `${token} Beta`, sortOrder: 2 },
        { creatorId }
      );
      await service.create(
        { name: `${token} Alpha`, sortOrder: 1 },
        { creatorId }
      );
      await service.create(
        { name: `${token} Gamma`, sortOrder: 1 },
        { creatorId }
      );

      const page1 = await service.list({
        creatorId,
        page: 1,
        limit: 2,
        search: token,
      });

      expect(page1.pagination.total).toBe(3);
      expect(page1.pagination.totalPages).toBe(2);
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].name).toBe(`${token} Alpha`);
      expect(page1.items[1].name).toBe(`${token} Gamma`);

      const page2 = await service.list({
        creatorId,
        page: 2,
        limit: 2,
        search: token,
      });

      expect(page2.items).toHaveLength(1);
      expect(page2.items[0].name).toBe(`${token} Beta`);
    });

    it('does NOT return categories owned by a different creator (IDOR)', async () => {
      const token = uniqueToken();

      // This creator's own category in their personal space.
      const mine = await service.create(
        { name: `${token} Mine` },
        { creatorId }
      );

      // A REAL category owned by a DIFFERENT creator, seeded directly.
      const [foreign] = await db
        .insert(categories)
        .values({
          creatorId: otherCreatorId,
          organizationId: null,
          name: `${token} Theirs`,
          slug: `${token}-theirs`,
        })
        .returning();

      const result = await service.list({
        creatorId,
        page: 1,
        limit: 50,
        search: token,
      });

      // Unconditional: the foreign row MUST be absent, mine MUST be present.
      expect(result.items.some((c) => c.id === foreign.id)).toBe(false);
      expect(result.items.some((c) => c.id === mine.id)).toBe(true);
    });
  });

  describe('get', () => {
    it('returns the category for its owner', async () => {
      const created = await service.create(
        { name: `Get ${uniqueToken()}` },
        { creatorId }
      );

      const result = await service.get(created.id, { creatorId });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
    });

    it('returns null for a non-existent id', async () => {
      const result = await service.get(MISSING_ID, { creatorId });
      expect(result).toBeNull();
    });

    it('returns null for a category owned by a different creator (IDOR)', async () => {
      const token = uniqueToken();
      const [foreign] = await db
        .insert(categories)
        .values({
          creatorId: otherCreatorId,
          organizationId: null,
          name: `${token} Foreign`,
          slug: `${token}-foreign`,
        })
        .returning();

      const result = await service.get(foreign.id, { creatorId });

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('updates fields while keeping the slug stable', async () => {
      const token = uniqueToken();
      const created = await service.create(
        { name: `Original ${token}`, description: 'old' },
        { creatorId }
      );

      const updated = await service.update(
        created.id,
        { name: `Renamed ${token}`, description: 'new' },
        { creatorId }
      );

      expect(updated.name).toBe(`Renamed ${token}`);
      expect(updated.description).toBe('new');
      // Slug is derived once at create and stays stable across renames.
      expect(updated.slug).toBe(created.slug);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime()
      );
    });

    it('throws CategoryNotFoundError when updating a different creator category', async () => {
      const token = uniqueToken();
      const [foreign] = await db
        .insert(categories)
        .values({
          creatorId: otherCreatorId,
          organizationId: null,
          name: `${token} Foreign`,
          slug: `${token}-foreign`,
        })
        .returning();

      await expect(
        service.update(foreign.id, { name: 'Hacked' }, { creatorId })
      ).rejects.toThrow(CategoryNotFoundError);
    });
  });

  describe('softDelete', () => {
    it('soft-deletes so the category is no longer retrievable', async () => {
      const created = await service.create(
        { name: `Delete ${uniqueToken()}` },
        { creatorId }
      );

      await service.softDelete(created.id, { creatorId });

      const result = await service.get(created.id, { creatorId });
      expect(result).toBeNull();

      // Row still exists with deletedAt set (soft delete, not hard delete).
      const [row] = await db
        .select({ deletedAt: categories.deletedAt })
        .from(categories)
        .where(eq(categories.id, created.id));
      expect(row.deletedAt).not.toBeNull();
    });

    it('throws CategoryNotFoundError when deleting a different creator category', async () => {
      const token = uniqueToken();
      const [foreign] = await db
        .insert(categories)
        .values({
          creatorId: otherCreatorId,
          organizationId: null,
          name: `${token} Foreign`,
          slug: `${token}-foreign`,
        })
        .returning();

      await expect(
        service.softDelete(foreign.id, { creatorId })
      ).rejects.toThrow(CategoryNotFoundError);
    });
  });

  describe('organization space (org-owned taxonomy)', () => {
    it('isolates list by organization and rejects cross-org mutation', async () => {
      const [orgA] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();
      const [orgB] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const token = uniqueToken();
      const inA = await service.create(
        { name: `${token} InA` },
        { creatorId, organizationId: orgA.id }
      );
      const inB = await service.create(
        { name: `${token} InB` },
        { creatorId, organizationId: orgB.id }
      );

      // Org A's list contains only org A's category.
      const listA = await service.list({
        creatorId,
        organizationId: orgA.id,
        page: 1,
        limit: 50,
        search: token,
      });
      expect(listA.items.some((c) => c.id === inA.id)).toBe(true);
      expect(listA.items.some((c) => c.id === inB.id)).toBe(false);

      // Org scoping BOUNDS mutations too: org A space cannot touch org B's row.
      await expect(
        service.update(
          inB.id,
          { name: 'Hacked' },
          { creatorId, organizationId: orgA.id }
        )
      ).rejects.toThrow(CategoryNotFoundError);
    });

    it('shares org categories across creators (authored by X, visible to Y)', async () => {
      const [org] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const token = uniqueToken();
      // Authored by creatorId (X).
      const shared = await service.create(
        { name: `${token} Shared` },
        { creatorId, organizationId: org.id }
      );

      // Listed in otherCreatorId (Y)'s context for the SAME org — must appear.
      const listY = await service.list({
        creatorId: otherCreatorId,
        organizationId: org.id,
        page: 1,
        limit: 50,
        search: token,
      });
      expect(listY.items.some((c) => c.id === shared.id)).toBe(true);
    });

    it('lets a different org actor update/reorder/softDelete an org category', async () => {
      const [org] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const token = uniqueToken();
      // Both authored by X.
      const a = await service.create(
        { name: `${token} A` },
        { creatorId, organizationId: org.id }
      );
      const b = await service.create(
        { name: `${token} B` },
        { creatorId, organizationId: org.id }
      );

      // Y is a DIFFERENT actor in the same org (org-owned management).
      const yScope = { creatorId: otherCreatorId, organizationId: org.id };

      const updated = await service.update(
        a.id,
        { name: `${token} A2` },
        yScope
      );
      expect(updated.name).toBe(`${token} A2`);

      await service.reorder([b.id, a.id], yScope);
      const listed = await service.list({
        ...yScope,
        page: 1,
        limit: 50,
        search: token,
      });
      const order = listed.items
        .filter((c) => [a.id, b.id].includes(c.id))
        .map((c) => c.id);
      expect(order).toEqual([b.id, a.id]);

      await service.softDelete(b.id, yScope);
      expect(await service.get(b.id, yScope)).toBeNull();
    });

    it('cascade-deletes org categories on org delete without a personal-slug collision', async () => {
      // Regression (Codex-dr57r.21): categories.organizationId is ON DELETE
      // CASCADE (mirrors `content`), NOT set null. A same-slug personal
      // category exists for the SAME creator, so a set-null FK would orphan the
      // org row into the personal space and violate
      // idx_unique_category_slug_personal (Postgres 23505). This assertion is
      // unconditional and fails without the cascade fix.
      const [org] = await db
        .insert(organizations)
        .values(createTestOrganizationInput())
        .returning();

      const token = uniqueToken();
      const name = `Topic ${token}`;

      // Personal + org-scoped categories share slug + creator, differing only
      // by organizationId (distinct spaces → both keep the base slug).
      const personal = await service.create({ name }, { creatorId });
      const orgScoped = await service.create(
        { name },
        { creatorId, organizationId: org.id }
      );
      expect(personal.slug).toBe(orgScoped.slug);
      expect(personal.organizationId).toBeNull();
      expect(orgScoped.organizationId).toBe(org.id);

      // Deleting the org must NOT throw: the org category cascade-deletes
      // rather than being set-null'd into the colliding personal slug.
      await db.delete(organizations).where(eq(organizations.id, org.id));

      // (a) the org category row is gone (cascaded with its org).
      const orgRows = await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, orgScoped.id));
      expect(orgRows).toHaveLength(0);

      // (c) the personal same-slug category survives, still personal + live.
      const personalRows = await db
        .select({
          id: categories.id,
          organizationId: categories.organizationId,
          deletedAt: categories.deletedAt,
        })
        .from(categories)
        .where(eq(categories.id, personal.id));
      expect(personalRows).toHaveLength(1);
      expect(personalRows[0].organizationId).toBeNull();
      expect(personalRows[0].deletedAt).toBeNull();
    });
  });

  describe('reorder', () => {
    it('assigns sortOrder to match the given order', async () => {
      const token = uniqueToken();
      const a = await service.create({ name: `${token} A` }, { creatorId });
      const b = await service.create({ name: `${token} B` }, { creatorId });
      const c = await service.create({ name: `${token} C` }, { creatorId });

      // New order: C, A, B
      await service.reorder([c.id, a.id, b.id], { creatorId });

      const listed = await service.list({
        creatorId,
        page: 1,
        limit: 50,
        search: token,
      });

      const ordered = listed.items
        .filter((cat) => [a.id, b.id, c.id].includes(cat.id))
        .map((cat) => cat.id);

      expect(ordered).toEqual([c.id, a.id, b.id]);
    });

    it('rolls back all sortOrder changes if any id is foreign/absent', async () => {
      const owned = await service.create(
        { name: `Reorder ${uniqueToken()}`, sortOrder: 5 },
        { creatorId }
      );

      // Second id matches no owned row → throws → whole transaction rolls back.
      await expect(
        service.reorder([owned.id, MISSING_ID], { creatorId })
      ).rejects.toThrow(CategoryNotFoundError);

      // The owned category's sortOrder must be UNCHANGED (rollback), not 0.
      const after = await service.get(owned.id, { creatorId });
      expect(after?.sortOrder).toBe(5);
    });
  });
});
