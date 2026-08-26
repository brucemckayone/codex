/**
 * ContentService — `courseOnly` catalogue exclusion (Codex-0biug).
 *
 * A course-only practice is reachable ONLY through a course entitlement
 * (SPEC §6.1). Before this fix, nothing set `content.courseOnly` and nothing
 * filtered on it, so a paid course's whole curriculum was listed in the org's
 * PUBLIC catalogue as free, browsable content and streamable anonymously at each
 * practice's standalone `/content/[slug]` URL.
 *
 * This suite pins the two halves of the projection contract, which pull in
 * OPPOSITE directions and are easy to get wrong together:
 *
 *   • CATALOGUE reads (`listPublic` without a slug, `list` with `scope:'browse'`)
 *     must EXCLUDE gated practices — a public catalogue must not advertise them.
 *   • The BY-SLUG read (`listPublic({ slug })`) must still RETURN them. That read
 *     backs the content DETAIL page, which needs the row in order to render the
 *     "part of a course" state implied by the resolver's `deny('course_only')`.
 *     Excluding it there would turn a correct paywall into a 404 and break every
 *     deep link into a practice.
 *   • The STUDIO scope must still show them — a creator has to be able to see and
 *     manage their own gated practices.
 *
 * Access itself is decided by the entitlement resolver, never by these
 * projections; hiding a row from a catalogue is a DISCOVERY concern. Both layers
 * are required, which is why the resolver-side gating is tested separately in
 * `@codex/access` (`course-curriculum-editor.integration.test.ts`).
 *
 * Isolation: rows carry a per-test token in the title and every assertion
 * filters by it, so a shared branch needs no inter-test cleanup.
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentService } from '../content-service';

function uniqueToken(): string {
  return `t${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

describe('ContentService — courseOnly catalogue exclusion (Codex-0biug)', () => {
  let db: Database;
  let service: ContentService;
  let creatorId: string;
  let orgId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new ContentService({ db, environment: 'test' });

    const [firstCreator] = await seedTestUsers(db, 1);
    if (!firstCreator) throw new Error('failed to seed creator');
    creatorId = firstCreator;

    const [org] = await db
      .insert(organizations)
      .values({ name: 'CourseOnly Org', slug: createUniqueSlug('co-org') })
      .returning({ id: organizations.id });
    if (!org) throw new Error('failed to create org');
    orgId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  /** A published content row, gated or not. Returns its id AND slug. */
  async function seedPractice(opts: {
    title: string;
    courseOnly: boolean;
  }): Promise<{ id: string; slug: string }> {
    const slug = createUniqueSlug('practice');
    const [row] = await db
      .insert(content)
      .values({
        creatorId,
        organizationId: orgId,
        title: opts.title,
        slug,
        contentType: 'written',
        status: 'published',
        publishedAt: new Date(),
        courseOnly: opts.courseOnly,
      })
      .returning({ id: content.id, slug: content.slug });
    if (!row) throw new Error('failed to seed practice');
    return { id: row.id, slug: row.slug };
  }

  it('listPublic EXCLUDES a gated practice from the catalogue but still returns the open one', async () => {
    const token = uniqueToken();
    const gated = await seedPractice({
      title: `Gated ${token}`,
      courseOnly: true,
    });
    const open = await seedPractice({
      title: `Open ${token}`,
      courseOnly: false,
    });

    const result = await service.listPublic({
      orgId,
      page: 1,
      limit: 100,
      sort: 'newest',
    });
    const ids = result.items.map((i) => i.id);

    // Asserted in BOTH directions so the test can fail if the predicate is
    // dropped OR if it over-filters and hides everything.
    expect(ids).not.toContain(gated.id);
    expect(ids).toContain(open.id);
  });

  it('listPublic BY SLUG still returns a gated practice — the detail page must render a paywall, not a 404', async () => {
    const token = uniqueToken();
    const gated = await seedPractice({
      title: `Deep link ${token}`,
      courseOnly: true,
    });

    const result = await service.listPublic({
      orgId,
      page: 1,
      limit: 10,
      sort: 'newest',
      slug: gated.slug,
    });

    expect(result.items.map((i) => i.id)).toContain(gated.id);
  });

  it("list(scope:'browse') EXCLUDES a gated practice", async () => {
    const token = uniqueToken();
    const gated = await seedPractice({
      title: `Browse gated ${token}`,
      courseOnly: true,
    });
    const open = await seedPractice({
      title: `Browse open ${token}`,
      courseOnly: false,
    });

    const result = await service.list(
      creatorId,
      { organizationId: orgId },
      { page: 1, limit: 100 },
      { scope: 'browse' }
    );
    const ids = result.items.map((i) => i.id);

    expect(ids).not.toContain(gated.id);
    expect(ids).toContain(open.id);
  });

  it("list(scope:'studio') STILL SHOWS a gated practice — the creator must be able to manage it", async () => {
    const token = uniqueToken();
    const gated = await seedPractice({
      title: `Studio gated ${token}`,
      courseOnly: true,
    });

    const result = await service.list(
      creatorId,
      { organizationId: orgId },
      { page: 1, limit: 100 },
      { scope: 'studio' }
    );

    expect(result.items.map((i) => i.id)).toContain(gated.id);
  });
});
