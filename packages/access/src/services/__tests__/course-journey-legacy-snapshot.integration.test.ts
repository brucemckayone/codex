/**
 * Legacy-content archive integration tests (Codex-61zsk review).
 *
 * The editor opens a legacy row through a read-time upgrade and saves the
 * upgraded form, which has no home for some authored content (contract
 * Appendix A.7 — `turn.points` among them). So the first page-kit save of a
 * LEGACY row must keep the row as it was, or one title edit deletes that
 * content for good. REAL Postgres, like the other course-journey suites.
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

/** A legacy composition whose three beats have no v2 destination. */
const LEGACY_SECTIONS = [
  {
    id: 'turn-1',
    type: 'turn',
    enabled: true,
    variant: 'arc',
    props: { heading: 'Three beats', points: ['Arrive', 'Stay', 'Return'] },
  },
];
const LEGACY_DESIGN = { edge: 'soft', density: 'airy' };

describe('Legacy page archive on the first page-kit save', () => {
  let db: Database;
  let journeys: CourseJourneyService;
  let creatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    journeys = new CourseJourneyService({ db, environment: 'test' });
    [creatorId] = await seedTestUsers(db, 1);
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  async function makePage() {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Legacy Org', slug: createUniqueSlug('legacy') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create test org');
    const title = `Legacy ${randomUUID().slice(0, 8)}`;
    const { id, slug } = await journeys.createJourney(org.id, creatorId, {
      title,
      pageType: 'course',
    });
    return { orgId: org.id, id, slug, title };
  }

  /** Rewrite a page's row into the shape the legacy builder stored. */
  async function makeLegacy(pageId: string, design: unknown) {
    await db
      .update(landingPages)
      .set({ sections: LEGACY_SECTIONS as never, design: design as never })
      .where(eq(landingPages.id, pageId));
  }

  function savePageKit(
    page: Awaited<ReturnType<typeof makePage>>,
    { withDesign = true }: { withDesign?: boolean } = {}
  ) {
    return journeys.saveJourneyPage(page.orgId, {
      id: page.id,
      title: page.title,
      slug: page.slug,
      status: 'draft',
      sections: [],
      brandOverrides: null,
      // `design` is optional on the save and absent means LEAVE ALONE, so a
      // save without it leaves the legacy design (and the row's legacy look)
      // in place.
      ...(withDesign ? { design: { style: 'bold' } as never } : {}),
    });
  }

  async function archiveOf(pageId: string) {
    const [row] = await db
      .select({ legacySnapshot: landingPages.legacySnapshot })
      .from(landingPages)
      .where(eq(landingPages.id, pageId));
    return row?.legacySnapshot ?? null;
  }

  it('keeps a legacy row as it was when a page-kit save replaces it', async () => {
    const page = await makePage();
    await makeLegacy(page.id, LEGACY_DESIGN);

    await savePageKit(page);

    const archive = await archiveOf(page.id);
    expect(archive).toMatchObject({
      sections: LEGACY_SECTIONS,
      design: LEGACY_DESIGN,
    });
    expect(typeof archive?.archivedAt).toBe('string');
  });

  it('treats a row with no design at all as legacy too', async () => {
    const page = await makePage();
    await makeLegacy(page.id, null);

    await savePageKit(page);

    expect(await archiveOf(page.id)).toMatchObject({
      sections: LEGACY_SECTIONS,
      design: null,
    });
  });

  it('never overwrites the archive, even while the row still looks legacy', async () => {
    const page = await makePage();
    await makeLegacy(page.id, LEGACY_DESIGN);
    // Saves that omit `design` leave the legacy design stored, so the row
    // still reads as legacy — the case where only the write-once rule stops
    // the second save archiving the ALREADY-UPGRADED sections over the first.
    await savePageKit(page, { withDesign: false });
    const first = await archiveOf(page.id);

    await savePageKit(page, { withDesign: false });

    expect(first).toMatchObject({ sections: LEGACY_SECTIONS });
    expect(await archiveOf(page.id)).toEqual(first);
  });

  it('archives nothing for a page made in the page kit', async () => {
    const page = await makePage();

    await savePageKit(page);

    expect(await archiveOf(page.id)).toBeNull();
  });
});
