/**
 * A page save named by its revision (Codex-61zsk.18), against live Postgres.
 *
 * A builder save sends the WHOLE page, so two devices editing one page used
 * to overwrite each other, the last save winning. The builder now reads a
 * revision with the page and names it on each save, and a save made from a
 * copy that another save has moved on from is refused (412) with the newer
 * page left as it was. The row lock is what makes that hold for two saves
 * sent at once, so that case runs here against a real database, not a mock.
 *
 * The revision is a digest of what a page save writes, not `updated_at`: the
 * builder's own offer write and the studio's featured toggle stamp
 * `updated_at` too, and must not refuse the builder's next autosave.
 *
 * Each test seeds its own org, so the shared branch needs no cleanup between
 * tests. Nothing here queues an orphan row (no page images).
 */
import { randomUUID } from 'node:crypto';
import { landingPages, organizations } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

describe('A page save named by its revision (Codex-61zsk.18)', () => {
  let db: Database;
  let service: CourseJourneyService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A fresh org and an empty course page in it. */
  async function freshPage() {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Revision Org', slug: createUniqueSlug('revision') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create test org');
    const title = `Revision ${randomUUID().slice(0, 8)}`;
    const { id, slug } = await service.createJourney(org.id, creatorId, {
      title,
      pageType: 'course',
    });
    return { orgId: org.id, pageId: id, slug };
  }

  /** The page as the builder reads it. */
  async function read(orgId: string, pageId: string) {
    const page = await service.getJourneyForBuilder(orgId, pageId);
    if (!page?.revision) throw new Error('the page came back with no revision');
    return { ...page, revision: page.revision };
  }

  /** A whole-page save, as the builder sends one. */
  function save(
    page: { orgId: string; pageId: string; slug: string },
    title: string,
    revision?: string
  ) {
    return service.saveJourneyPage(page.orgId, {
      id: page.pageId,
      title,
      slug: page.slug,
      status: 'draft',
      sections: [],
      brandOverrides: null,
      ...(revision ? { revision } : {}),
    });
  }

  const refused = { statusCode: 412, code: 'PRECONDITION_FAILED' };

  it('reads a revision with the page; a save made from it lands and returns the next', async () => {
    const page = await freshPage();
    const before = await read(page.orgId, page.pageId);

    const saved = await save(page, 'Saved from the read', before.revision);

    expect(saved.revision).toMatch(/^[0-9a-f]{32}$/);
    expect(saved.revision).not.toBe(before.revision);
    const after = await read(page.orgId, page.pageId);
    expect(after.revision).toBe(saved.revision);
    expect(after.title).toBe('Saved from the read');
  });

  it('refuses a save made from a copy another save has moved on from, and keeps that save', async () => {
    const page = await freshPage();
    const { revision } = await read(page.orgId, page.pageId);

    await save(page, 'Device A', revision);
    await expect(save(page, 'Device B', revision)).rejects.toMatchObject(
      refused
    );

    expect((await read(page.orgId, page.pageId)).title).toBe('Device A');
  });

  // Two saves sent at once only race if both read the page before either
  // writes, and on a fast local database they need not: calibrated, this
  // test passed WITHOUT the row lock while it simply fired both. So a third
  // transaction holds the row first, and both saves start behind it. With the
  // lock each waits at its read and the second then reads the first's result;
  // without it both read the old page at once and both write.
  it('lets exactly one of two saves made from one revision land, though they arrive together', async () => {
    const page = await freshPage();
    const { revision } = await read(page.orgId, page.pageId);

    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    let holding = () => {};
    const isHeld = new Promise<void>((done) => {
      holding = done;
    });
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: landingPages.id })
        .from(landingPages)
        .where(eq(landingPages.id, page.pageId))
        .for('update');
      holding();
      await held;
    });
    await isHeld;
    const saves = [
      save(page, 'First device', revision),
      save(page, 'Second device', revision),
    ];
    // Long enough for both to reach the row: their read with the lock, their
    // write without it.
    await new Promise((done) => setTimeout(done, 500));
    release();
    await holder;
    const outcomes = await Promise.allSettled(saves);

    const landed = outcomes.filter((o) => o.status === 'fulfilled');
    const refusals = outcomes.filter((o) => o.status === 'rejected');
    expect(landed).toHaveLength(1);
    expect(refusals).toHaveLength(1);
    expect((refusals[0] as PromiseRejectedResult).reason).toMatchObject(
      refused
    );
    const winner = outcomes[0]?.status === 'fulfilled' ? 'First' : 'Second';
    expect((await read(page.orgId, page.pageId)).title).toBe(
      `${winner} device`
    );
  });

  it('is not moved by the builder’s own offer write or the studio’s featured toggle', async () => {
    const page = await freshPage();
    const { revision } = await read(page.orgId, page.pageId);

    await service.updateJourneyOffer(page.orgId, page.pageId, {
      tiersEnabled: false,
      subscriptionEnabled: false,
      subscriptionPriceCents: null,
      oneOffEnabled: true,
      oneOffPriceCents: 2400,
    });
    await service.setJourneyFeatured(page.orgId, page.pageId, true);

    expect((await read(page.orgId, page.pageId)).revision).toBe(revision);
    await expect(
      save(page, 'Saved after a price change', revision)
    ).resolves.toMatchObject({ revision: expect.any(String) });
  });

  it('writes a save that names no revision, as before', async () => {
    const page = await freshPage();
    const { revision } = await read(page.orgId, page.pageId);
    await save(page, 'Moved on', revision);

    await expect(save(page, 'Unchecked')).resolves.toMatchObject({
      revision: expect.any(String),
    });
    expect((await read(page.orgId, page.pageId)).title).toBe('Unchecked');
  });
});
