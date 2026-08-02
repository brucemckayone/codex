/**
 * Seed PORTALS (courses/journeys) into an existing organization.
 *
 * ## Why this is a separate, additive script
 *
 * `db:seed` (seed-data.ts) TRUNCATES the application tables and rebuilds the
 * world. That is the wrong tool for "give this org more portals so the library
 * looks realistic" — it would destroy the org being worked on. This script only
 * INSERTS, never truncates, and is idempotent: a portal whose slug already
 * exists is left alone and only its enrollment/progress state is reconciled.
 *
 * ## What it produces
 *
 * Four portals whose progress states deliberately span every card and badge
 * variant the library renders, because a shelf of four identical "0%" portals
 * proves nothing about the UI:
 *
 *   | Portal                   | Progress   | Enrollment source   | Exercises            |
 *   |--------------------------|------------|---------------------|----------------------|
 *   | Bone Deep                | untouched  | grant               | 0% bar, "included"   |
 *   | Tending the Grief        | 1 of 4     | course_subscription | early bar, "via sub" |
 *   | Ancestral Threads        | 3 of 4     | course_purchase     | mid bar, "purchased" |
 *   | Return to the Shoreline  | complete   | course_purchase     | 100% + "Completed"   |
 *
 * Practices are drawn from the org's EXISTING published content rather than
 * newly created, so no media/R2/transcode fixtures are needed — the covers and
 * thumbnails already resolve through dev-cdn.
 *
 * Each portal gets a DISTINCT set of practices. `practice_completions` is
 * UNIQUE on `(user_id, content_id)`, so a practice shared between two portals
 * would be completed in both at once and the progress states above would not
 * hold.
 *
 * Usage (from the monorepo root):
 *   pnpm --filter @codex/database db:seed:portals
 *   pnpm --filter @codex/database db:seed:portals -- --org=of-blood-and-bones
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.resolve(__dirname, '../../../.env.dev') });

import { dbWs } from '../src';
import {
  content,
  courseEnrollments,
  courseStages,
  courses,
  entitlements,
  organizationMemberships,
  organizations,
  practiceCompletions,
  stagePractices,
} from '../src/schema';

/** Practices attached per portal. */
const PRACTICES_PER_PORTAL = 4;

interface StageSpec {
  name: string;
  gloss: string;
}

interface PortalSpec {
  slug: string;
  title: string;
  kicker: string;
  lede: string;
  stages: [StageSpec, StageSpec, StageSpec];
  /** How many of this portal's practices are marked complete. */
  completions: number;
  /** `course_enrollments.source` — drives the access badge on the card. */
  source: 'grant' | 'course_subscription' | 'course_purchase';
  /** One-off price in GBP pence, or null for "included". */
  priceCents: number | null;
}

/**
 * Voiced for Of Blood & Bones — ancestral healing, somatic practice and sacred
 * bodywork on the Stonehaven shoreline. Generic "Course 1/2/3" titles would not
 * show whether the cards hold real editorial copy at real lengths.
 */
const PORTALS: PortalSpec[] = [
  {
    slug: 'bone-deep',
    title: 'Bone Deep',
    kicker: 'A four-practice descent',
    lede: 'Where the body keeps what the mind has agreed to forget. Slow work, close to the bone.',
    stages: [
      { name: 'Arriving', gloss: 'Settling into the body you actually have.' },
      { name: 'Listening', gloss: 'What the tissue says before language.' },
      { name: 'Staying', gloss: 'The practice of not leaving.' },
    ],
    completions: 0,
    source: 'grant',
    priceCents: null,
  },
  {
    slug: 'tending-the-grief',
    title: 'Tending the Grief',
    kicker: 'For the weight you carry',
    lede: 'Grief is not a problem to be solved. These practices make room for it to move.',
    stages: [
      { name: 'Naming', gloss: 'Saying the thing plainly.' },
      { name: 'Holding', gloss: 'Company for what cannot be fixed.' },
      { name: 'Letting move', gloss: 'Grief as water, not stone.' },
    ],
    completions: 1,
    source: 'course_subscription',
    priceCents: null,
  },
  {
    slug: 'ancestral-threads',
    title: 'Ancestral Threads',
    kicker: 'Meeting the lineage that made you',
    lede: 'Every body is an inheritance. This is a way of asking what you were handed, and what you will hand on.',
    stages: [
      { name: 'The near ones', gloss: 'Parents, and their weather.' },
      { name: 'The far ones', gloss: 'Names you were never told.' },
      { name: 'The thread forward', gloss: 'What you choose to carry.' },
    ],
    completions: 3,
    source: 'course_purchase',
    priceCents: 4900,
  },
  {
    slug: 'return-to-the-shoreline',
    title: 'Return to the Shoreline',
    kicker: 'A closing rite',
    lede: 'For the end of a long walk — marking what happened, and coming back up into ordinary light.',
    stages: [
      { name: 'Looking back', gloss: 'What the walking changed.' },
      { name: 'Marking it', gloss: 'A rite so the body knows it ended.' },
      { name: 'Coming up', gloss: 'Re-entry, gently.' },
    ],
    completions: PRACTICES_PER_PORTAL,
    source: 'course_purchase',
    priceCents: 3500,
  },
];

function parseOrgSlug(): string {
  const arg = process.argv.find((a) => a.startsWith('--org='));
  return arg ? arg.slice('--org='.length) : 'of-blood-and-bones';
}

async function main(): Promise<void> {
  const orgSlug = parseOrgSlug();
  console.log(`\n▸ Seeding portals into "${orgSlug}"\n`);

  const org = await dbWs.query.organizations.findFirst({
    where: and(
      eq(organizations.slug, orgSlug),
      isNull(organizations.deletedAt)
    ),
    columns: { id: true, name: true },
  });
  if (!org) throw new Error(`No organization with slug "${orgSlug}"`);

  // The portal owner is the org's owner: `courses.creator_id` is NOT NULL and
  // FK-restricted, and the same user is who we seed enrollments/progress for so
  // the library shelf has something to show when signed in as them.
  const owner = await dbWs.query.organizationMemberships.findFirst({
    where: and(
      eq(organizationMemberships.organizationId, org.id),
      eq(organizationMemberships.role, 'owner'),
      eq(organizationMemberships.status, 'active')
    ),
    columns: { userId: true },
  });
  if (!owner) throw new Error(`"${orgSlug}" has no active owner membership`);
  const userId = owner.userId;

  // ── 1. Retitle any junk placeholder portal ───────────────────────────
  //
  // The SLUG is deliberately left alone. It appears in unit-test fixtures and in
  // a conformance doc, and renaming it would churn those for no user-visible
  // gain — the offensive part is the title the library card renders.
  const junk = await dbWs.query.courses.findFirst({
    where: and(
      eq(courses.organizationId, org.id),
      eq(courses.slug, 'pricing-smoke-test')
    ),
    columns: { id: true, title: true },
  });
  if (junk) {
    await dbWs
      .update(courses)
      .set({
        title: 'The Long Descent',
        kicker: 'A twelve-practice descent',
        lede: 'Bone, breath and smoke — twelve practices for coming all the way down into the body.',
        updatedAt: new Date(),
      })
      .where(eq(courses.id, junk.id));
    console.log(`  ✎ retitled "${junk.title}" → "The Long Descent"`);
  }

  // ── 2. Pick practices from content not already in a portal ───────────
  const alreadyAttached = await dbWs
    .select({ contentId: stagePractices.contentId })
    .from(stagePractices);
  const attachedIds = alreadyAttached.map((r) => r.contentId);

  const available = await dbWs
    .select({ id: content.id, title: content.title })
    .from(content)
    .where(
      and(
        eq(content.organizationId, org.id),
        eq(content.status, 'published'),
        isNull(content.deletedAt),
        attachedIds.length > 0 ? notInArray(content.id, attachedIds) : sql`true`
      )
    )
    // Deterministic so re-runs and fresh runs choose the same practices.
    .orderBy(asc(content.createdAt), asc(content.id));

  // Which of the four already exist? Fetched once, both to size the warning
  // below against the portals actually being CREATED (a full re-run needs no
  // practices at all, so "not enough content" would be a false alarm) and to
  // save a per-portal round trip in the loop.
  const existingSlugs = new Set(
    (
      await dbWs
        .select({ slug: courses.slug })
        .from(courses)
        .where(
          and(
            eq(courses.organizationId, org.id),
            inArray(
              courses.slug,
              PORTALS.map((p) => p.slug)
            )
          )
        )
    ).map((r) => r.slug)
  );

  const toCreate = PORTALS.filter((p) => !existingSlugs.has(p.slug));
  const needed = toCreate.length * PRACTICES_PER_PORTAL;
  if (needed > 0 && available.length < needed) {
    console.log(
      `  ! only ${available.length} unattached published items for ${needed} slots — ` +
        `portals will get fewer practices each`
    );
  }

  // ── 3. Create each portal ────────────────────────────────────────────
  let cursor = 0;
  for (const spec of PORTALS) {
    // Existence is checked BEFORE drawing from the practice pool. On a re-run
    // every practice is already attached, so the pool is empty — and consuming
    // it first meant an existing portal was skipped for "no practices left"
    // and never had its enrollment/progress reconciled. Only a portal that is
    // actually being CREATED needs practices.
    let courseId: string;
    if (existingSlugs.has(spec.slug)) {
      const existing = await dbWs.query.courses.findFirst({
        where: and(
          eq(courses.organizationId, org.id),
          eq(courses.slug, spec.slug)
        ),
        columns: { id: true },
      });
      if (!existing) throw new Error(`Portal ${spec.slug} vanished mid-run`);
      courseId = existing.id;
      console.log(`  = ${spec.title}: already present, reconciling state only`);
    } else {
      const slice = available.slice(cursor, cursor + PRACTICES_PER_PORTAL);
      cursor += slice.length;
      if (slice.length === 0) {
        console.log(`  – ${spec.title}: no practices left to attach, skipped`);
        continue;
      }
      courseId = await createPortal(org.id, userId, spec, slice);
      console.log(
        `  + ${spec.title}: 3 stages, ${slice.length} practices ` +
          `(${slice.map((c) => c.title).join(', ')})`
      );
    }

    await reconcileCover(courseId, spec);
    await reconcileEnrollment(userId, org.id, courseId, spec);
    await reconcileCompletions(userId, courseId, spec.completions);
  }

  console.log(`\n✓ Done. Sign in as the owner of "${org.name}" to see them.\n`);
}

/** Insert the course, its three stages, and the stage→practice links. */
async function createPortal(
  organizationId: string,
  creatorId: string,
  spec: PortalSpec,
  practices: Array<{ id: string; title: string }>
): Promise<string> {
  return await dbWs.transaction(async (tx) => {
    // Cover is set afterwards by `reconcileCover` — deriving it shells out to
    // wrangler, and holding a DB transaction open across subprocess calls is a
    // good way to turn a slow copy into a lock-timeout.
    const [course] = await tx
      .insert(courses)
      .values({
        organizationId,
        creatorId,
        slug: spec.slug,
        title: spec.title,
        kicker: spec.kicker,
        lede: spec.lede,
        status: 'published',
        publishedAt: new Date(),
        priceCents: spec.priceCents,
      })
      .returning({ id: courses.id });
    if (!course) throw new Error(`Failed to insert course ${spec.slug}`);

    const stageRows = await tx
      .insert(courseStages)
      .values(
        spec.stages.map((stage, i) => ({
          courseId: course.id,
          name: stage.name,
          gloss: stage.gloss,
          sortOrder: i + 1,
        }))
      )
      .returning({ id: courseStages.id, sortOrder: courseStages.sortOrder });

    // Spread practices across the stages, front-loading the remainder so EVERY
    // stage holds at least one: four practices over three stages gives 2/1/1,
    // which reads like a progression, where a naive `i % stageCount` or a
    // `floor(i / perStage)` split leaves the last stage empty.
    const ordered = [...stageRows].sort((a, b) => a.sortOrder - b.sortOrder);
    const base = Math.floor(practices.length / ordered.length);
    const remainder = practices.length % ordered.length;

    const links: Array<{
      stageId: string;
      contentId: string;
      sortOrder: number;
    }> = [];
    let next = 0;
    for (const [stageIndex, stage] of ordered.entries()) {
      const take = base + (stageIndex < remainder ? 1 : 0);
      for (let n = 0; n < take; n++) {
        const practice = practices[next];
        if (!practice) break;
        next++;
        links.push({
          stageId: stage.id,
          contentId: practice.id,
          sortOrder: n,
        });
      }
    }

    await tx.insert(stagePractices).values(links);
    return course.id;
  });
}

/**
 * The local R2 bucket the dev workers actually read.
 *
 * `wrangler dev` binds `preview_bucket_name`, NOT `bucket_name` — so objects
 * written to `codex-assets-production` are invisible to dev-cdn even though the
 * upload reports success. See `workers/dev-cdn/wrangler.jsonc`.
 */
const DEV_R2_BUCKET = process.env.SEED_R2_BUCKET ?? 'codex-assets-test';
const R2_PERSIST_PATH = path.resolve(__dirname, '../../../.wrangler/state');

/**
 * Produce a `courses.cover_image_key` that will actually resolve.
 *
 * `resolveCourseCoverUrl` builds `${base}/${coverImageKey}/md.webp`, so the key
 * must be a variant DIRECTORY prefix, not a file path. Most of this org's
 * content stores a file-style thumbnail (`…/thumbnails/<slug>/thumb.jpg`), and
 * using that verbatim yields `…/thumb.jpg/md.webp` — a 404, which renders as a
 * broken image rather than falling back to the card's brand gradient.
 *
 * So: when the source thumbnail is already a variant prefix, reuse it. When it
 * is file-style, COPY the object to a portal-owned variant path so the `/md.webp`
 * the resolver demands exists. Returns null if neither is possible, which is the
 * card's designed no-cover path.
 */
async function deriveCoverKey(
  contentId: string,
  portalSlug: string
): Promise<string | null> {
  const [row] = await dbWs
    .select({ thumbnailUrl: content.thumbnailUrl })
    .from(content)
    .where(eq(content.id, contentId));
  const url = row?.thumbnailUrl;
  if (!url) return null;

  // Strip the CDN origin to get the raw R2 key.
  const base = process.env.R2_PUBLIC_URL_BASE?.replace(/\/+$/, '');
  const sourceKey =
    base && url.startsWith(base)
      ? url.slice(base.length + 1)
      : url.match(/^https?:\/\/[^/]+\/(.+)$/)?.[1];
  if (!sourceKey) return null;

  // Already a generated variant set — the prefix is exactly what we want.
  if (sourceKey.endsWith('/md.webp')) {
    return sourceKey.slice(0, -'/md.webp'.length);
  }

  // File-style: copy it into a variant path this portal owns.
  const ownerPrefix = sourceKey.split('/')[0];
  if (!ownerPrefix) return null;
  const coverKey = `${ownerPrefix}/media-thumbnails/portal-${portalSlug}`;

  try {
    const tmp = path.join(
      os.tmpdir(),
      `codex-portal-cover-${portalSlug}-${process.pid}`
    );
    run(
      `npx wrangler r2 object get "${DEV_R2_BUCKET}/${sourceKey}" --file "${tmp}" --local --persist-to "${R2_PERSIST_PATH}"`
    );
    run(
      `npx wrangler r2 object put "${DEV_R2_BUCKET}/${coverKey}/md.webp" --file "${tmp}" --content-type image/jpeg --local --persist-to "${R2_PERSIST_PATH}"`
    );
    fs.rmSync(tmp, { force: true });
    return coverKey;
  } catch (error) {
    // A cover is a nice-to-have; the card has a designed gradient fallback. Never
    // fail the whole seed over it, and never leave a key that would 404.
    console.log(
      `    (no cover for ${portalSlug}: ${error instanceof Error ? error.message.split('\n')[0] : error})`
    );
    return null;
  }
}

function run(command: string): void {
  execSync(command, { stdio: 'pipe' });
}

/**
 * Point the portal's cover at a key that resolves, using its FIRST practice's
 * artwork.
 *
 * Runs on every pass, including for portals that already existed, because an
 * earlier version of this script wrote file-style keys that 404 through
 * `resolveCourseCoverUrl`'s `/md.webp` suffix — re-running must repair those
 * rather than leave broken images behind. The copy is idempotent (same source,
 * same destination key).
 */
async function reconcileCover(
  courseId: string,
  spec: PortalSpec
): Promise<void> {
  const [firstPractice] = await dbWs
    .select({ contentId: stagePractices.contentId })
    .from(stagePractices)
    .innerJoin(courseStages, eq(courseStages.id, stagePractices.stageId))
    .where(
      and(eq(courseStages.courseId, courseId), isNull(courseStages.deletedAt))
    )
    .orderBy(asc(courseStages.sortOrder), asc(stagePractices.sortOrder))
    .limit(1);
  if (!firstPractice) return;

  const coverImageKey = await deriveCoverKey(
    firstPractice.contentId,
    spec.slug
  );
  await dbWs
    .update(courses)
    .set({ coverImageKey, updatedAt: new Date() })
    .where(eq(courses.id, courseId));
}

/** Enrollment + entitlement, both idempotent on their unique constraints. */
async function reconcileEnrollment(
  userId: string,
  organizationId: string,
  courseId: string,
  spec: PortalSpec
): Promise<void> {
  const completedAt =
    spec.completions >= PRACTICES_PER_PORTAL ? new Date() : null;

  await dbWs
    .insert(courseEnrollments)
    .values({
      userId,
      courseId,
      source: spec.source,
      lastActivityAt: spec.completions > 0 ? new Date() : null,
      completedAt,
    })
    .onConflictDoNothing();

  // `uq_entitlement_live_course` is partial (WHERE revoked_at IS NULL AND
  // course_id IS NOT NULL), so onConflictDoNothing needs the same target
  // predicate to match that index.
  await dbWs
    .insert(entitlements)
    .values({ userId, organizationId, courseId, source: spec.source })
    .onConflictDoNothing({
      target: [entitlements.userId, entitlements.courseId, entitlements.source],
      where: and(
        isNull(entitlements.revokedAt),
        sql`${entitlements.courseId} IS NOT NULL`
      ),
    });
}

/**
 * Mark the first `count` of the portal's practices complete, and clear any
 * completions beyond that, so re-running the script converges on the declared
 * progress state instead of only ever ratcheting it upward.
 */
async function reconcileCompletions(
  userId: string,
  courseId: string,
  count: number
): Promise<void> {
  const practices = await dbWs
    .select({ contentId: stagePractices.contentId })
    .from(stagePractices)
    .innerJoin(courseStages, eq(courseStages.id, stagePractices.stageId))
    .where(
      and(eq(courseStages.courseId, courseId), isNull(courseStages.deletedAt))
    )
    .orderBy(asc(courseStages.sortOrder), asc(stagePractices.sortOrder));

  const ids = practices.map((p) => p.contentId);
  if (ids.length === 0) return;

  const shouldBeComplete = ids.slice(0, count);
  const shouldNotBeComplete = ids.slice(count);

  if (shouldBeComplete.length > 0) {
    await dbWs
      .insert(practiceCompletions)
      .values(
        shouldBeComplete.map((contentId) => ({
          userId,
          contentId,
          source: 'manual' as const,
        }))
      )
      .onConflictDoNothing();
  }
  if (shouldNotBeComplete.length > 0) {
    await dbWs
      .delete(practiceCompletions)
      .where(
        and(
          eq(practiceCompletions.userId, userId),
          inArray(practiceCompletions.contentId, shouldNotBeComplete)
        )
      );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n✘ Portal seed failed:', error);
    process.exit(1);
  });
