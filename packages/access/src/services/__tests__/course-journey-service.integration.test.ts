/**
 * CourseJourneyService.listPublishedCourses — the /explore discovery rail read
 * (Codex-2pryk.3.9 · SPEC §8.5).
 *
 * Runs against live Postgres (LOCAL_PROXY) so the org-scope + status + soft-delete
 * WHERE clause and the `publishedAt DESC` ordering are exercised for real. The
 * invariant under test: ONLY published, non-deleted courses of the REQUESTED org
 * surface — a draft, an archived, a soft-deleted, or another org's course must
 * never leak into a public discovery card.
 *
 * Falsifiability: every assertion is unconditional against a seeded fixture whose
 * shape (draft / deleted / cross-org rows present) would fail the test if the
 * service dropped any clause of its scope.
 */

import { courses, organizations } from '@codex/database/schema';
import {
  createUniqueSlug,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CourseJourneyService } from '../course-journey-service';

describe('CourseJourneyService.listPublishedCourses (SPEC §8.5)', () => {
  let db: Database;
  let svc: CourseJourneyService;
  let creatorId: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    svc = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);

    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Journeys Org A', slug: createUniqueSlug('journeys-a') })
      .returning({ id: organizations.id });
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Journeys Org B', slug: createUniqueSlug('journeys-b') })
      .returning({ id: organizations.id });
    if (!orgA || !orgB) throw new Error('failed to create orgs');
    orgAId = orgA.id;
    orgBId = orgB.id;

    await db.insert(courses).values([
      // Org A — PUBLISHED, newer (should sort FIRST).
      {
        organizationId: orgAId,
        creatorId,
        slug: createUniqueSlug('a-newer'),
        title: 'A Newer Journey',
        kicker: 'A guided descent',
        lede: 'Return to the body.',
        guide: {
          name: 'Alex Creator',
          bio: null,
          portraitMediaId: null,
          quote: null,
        },
        status: 'published',
        publishedAt: new Date('2026-06-01T00:00:00.000Z'),
        priceCents: 4900,
      },
      // Org A — PUBLISHED, older, no guide, not sold standalone (null price).
      {
        organizationId: orgAId,
        creatorId,
        slug: createUniqueSlug('a-older'),
        title: 'A Older Journey',
        kicker: null,
        lede: null,
        status: 'published',
        publishedAt: new Date('2026-05-01T00:00:00.000Z'),
        priceCents: null,
      },
      // Org A — DRAFT (must be excluded).
      {
        organizationId: orgAId,
        creatorId,
        slug: createUniqueSlug('a-draft'),
        title: 'A Draft Journey',
        status: 'draft',
        priceCents: 4900,
      },
      // Org A — PUBLISHED but SOFT-DELETED (must be excluded).
      {
        organizationId: orgAId,
        creatorId,
        slug: createUniqueSlug('a-deleted'),
        title: 'A Deleted Journey',
        status: 'published',
        publishedAt: new Date('2026-06-15T00:00:00.000Z'),
        priceCents: 4900,
        deletedAt: new Date('2026-06-16T00:00:00.000Z'),
      },
      // Org B — PUBLISHED (different org, must be excluded from org A's rail).
      {
        organizationId: orgBId,
        creatorId,
        slug: createUniqueSlug('b-published'),
        title: 'B Published Journey',
        status: 'published',
        publishedAt: new Date('2026-06-10T00:00:00.000Z'),
        priceCents: 4900,
      },
    ]);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('returns ONLY published, non-deleted courses of the requested org', async () => {
    const cards = await svc.listPublishedCourses(orgAId);
    const titles = cards.map((c) => c.title);

    expect(titles).toEqual(['A Newer Journey', 'A Older Journey']);
    // Explicit exclusions — the scope's three failure modes.
    expect(titles).not.toContain('A Draft Journey');
    expect(titles).not.toContain('A Deleted Journey');
    expect(titles).not.toContain('B Published Journey');
  });

  it('orders most-recently-published first', async () => {
    const cards = await svc.listPublishedCourses(orgAId);
    expect(cards[0]?.title).toBe('A Newer Journey');
    expect(cards[1]?.title).toBe('A Older Journey');
  });

  it('projects the card summary fields (guide name from the guide jsonb)', async () => {
    const cards = await svc.listPublishedCourses(orgAId);
    const newer = cards.find((c) => c.title === 'A Newer Journey');
    expect(newer).toMatchObject({
      title: 'A Newer Journey',
      kicker: 'A guided descent',
      lede: 'Return to the body.',
      guideName: 'Alex Creator',
      priceCents: 4900,
    });
    expect(newer?.slug).toBeTruthy();
    expect(newer?.id).toBeTruthy();

    // Nullable columns pass through as null (no guide → null guideName).
    const older = cards.find((c) => c.title === 'A Older Journey');
    expect(older).toMatchObject({
      kicker: null,
      lede: null,
      guideName: null,
      priceCents: null,
    });
  });

  it('returns [] for an org with no published courses', async () => {
    const cards = await svc.listPublishedCourses(orgBId);
    // Org B has exactly one published course; a fresh org has none.
    const [freshOrg] = await db
      .insert(organizations)
      .values({ name: 'Empty Org', slug: createUniqueSlug('journeys-empty') })
      .returning({ id: organizations.id });
    if (!freshOrg) throw new Error('failed to create org');
    expect(await svc.listPublishedCourses(freshOrg.id)).toEqual([]);
    // Sanity: org B still surfaces its single published course.
    expect(cards).toHaveLength(1);
  });
});
