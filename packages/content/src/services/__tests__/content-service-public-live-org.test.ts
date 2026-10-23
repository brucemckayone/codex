/**
 * ContentService — a public read with no org in the filter lists only content
 * whose org is live (Codex-osuqt).
 *
 * A creator's public profile reads `listPublic({ creatorId })`, and /discover
 * reads it with no scope at all. An org-scoped read names a live org (the org
 * layout 404s a deleted one), but these two have nothing that proves the
 * content's org still exists. Deleting an org soft-deletes only the org row,
 * so its content stays `published`, and before this the profile listed it,
 * with a card linking into an org that now 404s. Personal content has no org
 * and is kept.
 *
 * Isolation: titles carry a per-run token that every read searches by. The
 * rows are deleted in afterAll, because a no-org read is whole-table and would
 * otherwise list them in another suite's run.
 */

import { randomUUID } from 'node:crypto';
import { content, organizations } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

describe('ContentService.listPublic — no org in the filter (Codex-osuqt)', () => {
  const token = `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  const orgIds: string[] = [];
  const ids = { liveOrg: '', deletedOrg: '', personal: '' };
  let deletedOrgId = '';
  let deletedOrgSlug = '';
  let liveOrgSlug = '';

  async function seedOrg(deletedAt: Date | null): Promise<string> {
    const [org] = await db
      .insert(organizations)
      .values({
        name: `Live-org ${token}`,
        slug: createUniqueSlug('live-org'),
        deletedAt,
      })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgIds.push(org.id);
    return org.id;
  }

  async function seedPublished(
    organizationId: string | null
  ): Promise<{ id: string; slug: string }> {
    const slug = createUniqueSlug('piece');
    const [row] = await db
      .insert(content)
      .values({
        creatorId,
        organizationId,
        title: `Piece ${token}`,
        slug,
        contentType: 'written',
        status: 'published',
        publishedAt: new Date(),
      })
      .returning({ id: content.id });
    if (!row) throw new Error('failed to create content');
    return { id: row.id, slug };
  }

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });

    const [creator] = await seedTestUsers(db, 1);
    if (!creator) throw new Error('failed to seed creator');
    creatorId = creator;

    const inLiveOrg = await seedPublished(await seedOrg(null));
    ids.liveOrg = inLiveOrg.id;
    liveOrgSlug = inLiveOrg.slug;
    deletedOrgId = await seedOrg(new Date());
    const inDeletedOrg = await seedPublished(deletedOrgId);
    ids.deletedOrg = inDeletedOrg.id;
    deletedOrgSlug = inDeletedOrg.slug;
    ids.personal = (await seedPublished(null)).id;
  });

  afterAll(async () => {
    await db.delete(content).where(inArray(content.id, Object.values(ids)));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
    await teardownTestDatabase();
  });

  const read = (scope: { orgId?: string; creatorId?: string; slug?: string }) =>
    service.listPublic({
      ...scope,
      page: 1,
      limit: 50,
      sort: 'newest',
      search: token,
    });

  const listed = async (scope: {
    orgId?: string;
    creatorId?: string;
    slug?: string;
  }) => (await read(scope)).items.map((item) => item.id);

  it("a creator's profile lists their live-org and personal content, not a deleted org's", async () => {
    const found = await listed({ creatorId });

    expect(found).toEqual(expect.arrayContaining([ids.liveOrg, ids.personal]));
    expect(found).not.toContain(ids.deletedOrg);
  });

  it("/discover (no scope) leaves out a deleted org's content too", async () => {
    const found = await listed({});

    expect(found).toEqual(expect.arrayContaining([ids.liveOrg, ids.personal]));
    expect(found).not.toContain(ids.deletedOrg);
  });

  it("a creator's detail-page lookup by slug finds a live piece, not a deleted org's", async () => {
    // The positive control: without it an always-empty slug lookup would pass.
    expect(await listed({ creatorId, slug: liveOrgSlug })).toEqual([
      ids.liveOrg,
    ]);
    expect(await listed({ creatorId, slug: deletedOrgSlug })).toEqual([]);
  });

  it('an org-scoped read of a deleted org lists nothing to a direct API client', async () => {
    expect(await listed({ orgId: deletedOrgId })).toEqual([]);
  });

  it('the anonymous list carries no creator email', async () => {
    const { items } = await read({ creatorId });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.creator).toBeDefined();
      expect(item.creator).not.toHaveProperty('email');
    }
  });
});
