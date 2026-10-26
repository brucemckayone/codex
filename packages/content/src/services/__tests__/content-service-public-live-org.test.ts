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
import {
  categories,
  content,
  contentCategories,
  organizations,
} from '@codex/database/schema';
import { ValidationError } from '@codex/service-errors';
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
  const ids = { liveOrg: '', deletedOrg: '', personal: '', followerOnly: '' };
  let liveOrgId = '';
  let topicSlug = '';
  let personalTopicId = '';
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
    organizationId: string | null,
    gate: { isFree?: boolean; isFollowerGated?: boolean } = {}
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
        contentBody: `article body ${token}`,
        status: 'published',
        publishedAt: new Date(),
        ...gate,
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

    liveOrgId = await seedOrg(null);
    const inLiveOrg = await seedPublished(liveOrgId);
    ids.liveOrg = inLiveOrg.id;
    liveOrgSlug = inLiveOrg.slug;
    ids.followerOnly = (
      await seedPublished(liveOrgId, { isFree: false, isFollowerGated: true })
    ).id;
    // A topic on the live-org piece, for the enrichment case. Deleting the
    // org in afterAll cascades to it and to its membership row.
    topicSlug = `topic-${token}`;
    const [topic] = await db
      .insert(categories)
      .values({
        creatorId,
        organizationId: liveOrgId,
        name: `Topic ${token}`,
        slug: topicSlug,
      })
      .returning({ id: categories.id });
    if (!topic) throw new Error('failed to create topic');
    await db
      .insert(contentCategories)
      .values({ contentId: ids.liveOrg, categoryId: topic.id });
    deletedOrgId = await seedOrg(new Date());
    const inDeletedOrg = await seedPublished(deletedOrgId);
    ids.deletedOrg = inDeletedOrg.id;
    deletedOrgSlug = inDeletedOrg.slug;
    ids.personal = (await seedPublished(null)).id;
    // A personal topic on the personal piece: a creator read used to list it,
    // though nothing reads a creator read's topics. Not cascaded from any org.
    const [personalTopic] = await db
      .insert(categories)
      .values({
        creatorId,
        organizationId: null,
        name: `Personal ${token}`,
        slug: `personal-${token}`,
      })
      .returning({ id: categories.id });
    if (!personalTopic) throw new Error('failed to create personal topic');
    personalTopicId = personalTopic.id;
    await db
      .insert(contentCategories)
      .values({ contentId: ids.personal, categoryId: personalTopicId });
  });

  afterAll(async () => {
    await db
      .delete(categories)
      .where(inArray(categories.id, [personalTopicId]));
    await db.delete(content).where(inArray(content.id, Object.values(ids)));
    await db.delete(organizations).where(inArray(organizations.id, orgIds));
    await teardownTestDatabase();
  });

  const read = (scope: {
    orgId?: string;
    creatorId?: string;
    slug?: string;
    category?: string;
  }) =>
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
    // The positive control: the same read of a live org lists its pieces.
    expect(await listed({ orgId: liveOrgId })).toEqual(
      expect.arrayContaining([ids.liveOrg, ids.followerOnly])
    );
    expect(await listed({ orgId: deletedOrgId })).toEqual([]);
  });

  // Only the org landing reads topic slugs, and a topic is an org's: a creator
  // read (their profile, never KV-cached) skips the query.
  it("an org read carries its pieces' topics; a creator read skips them", async () => {
    const byOrg = (await read({ orgId: liveOrgId })).items.find(
      (item) => item.id === ids.liveOrg
    );
    const byCreator = (await read({ creatorId })).items;

    expect(byOrg?.categorySlugs).toEqual([topicSlug]);
    // The personal piece is tagged too, so an empty list here means the
    // query was skipped, not that nothing matched.
    expect(byCreator.map((item) => item.id)).toContain(ids.personal);
    for (const item of byCreator) {
      expect(item.categorySlugs).toEqual([]);
    }
  });

  it('the browse catalogue of a deleted org lists nothing', async () => {
    const { items } = await service.list(
      creatorId,
      { organizationId: deletedOrgId, status: 'published', search: token },
      { page: 1, limit: 50 },
      { scope: 'browse' }
    );

    expect(items).toEqual([]);
  });

  // The route refuses this too; the service fails closed for any other caller.
  it('refuses a category with no org to scope it', async () => {
    await expect(
      read({ creatorId, category: 'fiction' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('the anonymous list carries no creator email', async () => {
    const { items } = await read({ creatorId });

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.creator).toBeDefined();
      expect(item.creator).not.toHaveProperty('email');
    }
  });

  // A catalogue read serialises into anonymous HTML, and it lists gated rows
  // alongside free ones. The follower-only row is the one that matters.
  it('a catalogue read carries no body, gated or free', async () => {
    const { items } = await read({ creatorId });

    expect(items.map((item) => item.id)).toContain(ids.followerOnly);
    for (const item of items) {
      expect(item.contentBody).toBeNull();
      expect(item.contentBodyJson).toBeNull();
    }
  });

  // The positive control: the detail page renders a free piece's article from
  // this read, so a strip that also emptied it would pass the case above.
  it('a by-slug read of a free piece keeps its body', async () => {
    const { items } = await read({ creatorId, slug: liveOrgSlug });

    expect(items).toHaveLength(1);
    expect(items[0]?.contentBody).toBe(`article body ${token}`);
  });

  // Two literal calls, not one helper taking the scope: each scope has its own
  // `list` signature and row type, and a run-time scope matches neither.
  const browseFilters = () => ({
    organizationId: liveOrgId,
    status: 'published' as const,
    search: token,
  });

  // Browse answers any signed-in viewer, entitled or not.
  it('the browse catalogue carries no body and no creator email', async () => {
    const { items } = await service.list(
      creatorId,
      browseFilters(),
      { page: 1, limit: 50 },
      { scope: 'browse' }
    );

    expect(items.map((item) => item.id)).toContain(ids.followerOnly);
    for (const item of items) {
      expect(item.contentBody).toBeNull();
      expect(item.contentBodyJson).toBeNull();
      expect(item.creator).not.toHaveProperty('email');
    }
  });

  it("the studio list keeps the creator's own bodies and email", async () => {
    const { items } = await service.list(
      creatorId,
      browseFilters(),
      { page: 1, limit: 50 },
      { scope: 'studio' }
    );
    const followerOnly = items.find((item) => item.id === ids.followerOnly);

    expect(followerOnly?.contentBody).toBe(`article body ${token}`);
    expect(followerOnly?.creator).toHaveProperty('email');
  });
});
