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
 *
 * No `--org` seeds ALL THREE fixture orgs below, not just the first. CI's
 * E2E Web job runs this once, argumentless, right after `db:seed` (Codex-5ryz3:
 * the journeys suites hardcode fixtures on every one of the trio, and a default
 * that stopped after the first org left studio-alpha/studio-beta with no
 * portals). `--org=<slug>` still seeds exactly one for targeted re-runs.
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
  landingPages,
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
  /**
   * The page-kit v2 Style this portal's sell page renders in
   * (`docs/design/landing-builder/01-contract.md` §2/§3, BINDING). Each of
   * the four portals gets a DIFFERENT one on purpose (WP-9b) — four
   * identical-looking seeded pages would prove nothing about how the Styles
   * actually differ.
   */
  style: 'bold' | 'clean' | 'soft' | 'cinematic';
  stages: [StageSpec, StageSpec, StageSpec];
  /** How many of this portal's practices are marked complete. */
  completions: number;
  /** `course_enrollments.source` — drives the access badge on the card. */
  source: 'grant' | 'course_subscription' | 'course_purchase';
  /** One-off price in GBP pence, or null for "included". */
  priceCents: number | null;
  /**
   * Promote this portal into the org landing page's "Editor's picks" carousel
   * (`landing_pages.featured`). Only a couple are featured — a carousel where
   * every portal is a pick shows nothing about how curation reads.
   */
  featured?: boolean;
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
    style: 'cinematic',
    stages: [
      { name: 'Arriving', gloss: 'Settling into the body you actually have.' },
      { name: 'Listening', gloss: 'What the tissue says before language.' },
      { name: 'Staying', gloss: 'The practice of not leaving.' },
    ],
    completions: 0,
    source: 'grant',
    priceCents: null,
    featured: true,
  },
  {
    slug: 'tending-the-grief',
    title: 'Tending the Grief',
    kicker: 'For the weight you carry',
    lede: 'Grief is not a problem to be solved. These practices make room for it to move.',
    style: 'clean',
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
    style: 'bold',
    stages: [
      { name: 'The near ones', gloss: 'Parents, and their weather.' },
      { name: 'The far ones', gloss: 'Names you were never told.' },
      { name: 'The thread forward', gloss: 'What you choose to carry.' },
    ],
    completions: 3,
    source: 'course_purchase',
    priceCents: 4900,
    featured: true,
  },
  {
    slug: 'return-to-the-shoreline',
    title: 'Return to the Shoreline',
    kicker: 'A closing rite',
    lede: 'For the end of a long walk — marking what happened, and coming back up into ordinary light.',
    style: 'soft',
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

/**
 * The orgs the e2e journeys fixtures span — kept in step with
 * `JOURNEY_FIXTURES` in apps/web/e2e/helpers/journeys.ts. Order matters only
 * for log readability; each org draws practices from its OWN published
 * content, so seeding one never starves another.
 */
const FIXTURE_ORGS = ['of-blood-and-bones', 'studio-alpha', 'studio-beta'];

function parseOrgSlug(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--org='));
  return arg ? arg.slice('--org='.length) : undefined;
}

async function main(): Promise<void> {
  // `[slug]`, NOT the bare string. `parseOrgSlug()` returns `string | undefined`
  // and `FIXTURE_ORGS` is `string[]`, so `?? ` widened to `string | string[]` —
  // and because `for…of` accepts BOTH, this typechecked and then iterated the
  // slug one CHARACTER at a time. `--org=of-blood-and-bones` failed with
  // `No organization with slug "o"`, so the flag had never worked; only the
  // no-argument path (which gets the real array) did.
  const parsed = parseOrgSlug();
  const orgs = parsed ? [parsed] : FIXTURE_ORGS;
  for (const orgSlug of orgs) {
    await seedOrgPortals(orgSlug);
  }
}

async function seedOrgPortals(orgSlug: string): Promise<void> {
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

    // Retitle the PAGE too. Renaming only the course left the landing rail still
    // advertising the junk name, because `listPublishedJourneys` reads
    // `landingPages.title`, not `courses.title` — the card and the sell page it
    // opens disagreed. Scoped to this org's page for the same slug; `sections`
    // is left alone (a human may have authored this one in the builder).
    const [renamedPage] = await dbWs
      .update(landingPages)
      .set({ title: 'The Long Descent', updatedAt: new Date() })
      .where(
        and(
          eq(landingPages.organizationId, org.id),
          eq(landingPages.slug, 'pricing-smoke-test'),
          isNull(landingPages.deletedAt)
        )
      )
      .returning({ id: landingPages.id });

    console.log(
      `  ✎ retitled "${junk.title}" → "The Long Descent"` +
        (renamedPage ? ' (course + page)' : ' (course only — no page found)')
    );
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

    // Runs for BOTH branches, and that is the point: the earlier version of this
    // script created no page at all, so a re-run against courses it had already
    // seeded is exactly the case that has to backfill one. Reconciling (rather
    // than inserting inside `createPortal`) is what makes the fix reach rows that
    // already exist.
    await reconcilePage(org.id, userId, courseId, spec);
    await reconcileCover(courseId, spec);
    await reconcileEnrollment(userId, org.id, courseId, spec);
    await reconcileCompletions(userId, courseId, spec.completions);
  }

  console.log(`\n✓ Done. Sign in as the owner of "${org.name}" to see them.\n`);
}

/**
 * Ensure the portal has a PUBLISHED `course`-type landing page bound to it.
 *
 * Idempotent by (org, slug): an existing page is updated in place rather than
 * duplicated, because `landing_pages.slug` is unique per org over non-deleted
 * rows — a blind insert on a re-run would violate that partial index. Updating
 * also repairs a page whose title has drifted from its course, which is how the
 * pre-existing `pricing-smoke-test` portal ended up advertising a junk name on
 * the landing rail: `listPublishedJourneys` returns `landingPages.title`, and
 * only the COURSE had been retitled.
 *
 * `sections` is rewritten every run so a copy change here reaches already-seeded
 * rows. Safe precisely because these are seed-owned demo pages — never call this
 * against a page a human has edited.
 */
async function reconcilePage(
  organizationId: string,
  creatorId: string,
  courseId: string,
  spec: PortalSpec
): Promise<void> {
  const existing = await dbWs.query.landingPages.findFirst({
    where: and(
      eq(landingPages.organizationId, organizationId),
      eq(landingPages.slug, spec.slug),
      isNull(landingPages.deletedAt)
    ),
    columns: { id: true },
  });

  const shared = {
    pageType: 'course' as const,
    title: spec.title,
    status: 'published' as const,
    publishedAt: new Date(),
    featured: spec.featured ?? false,
    subjectType: 'course' as const,
    subjectId: courseId,
    sections: buildSections(spec),
    // The page-kit v2 STYLE (`docs/design/landing-builder/01-contract.md`
    // §2/§3, BINDING; WP-9b) — each portal's OWN choice (see `PortalSpec.style`),
    // not a single shared bundle. This used to be one legacy nine-axis bundle
    // (Candlelit, research §4.1) copied onto every seeded page, which is exactly
    // the kind of uniformity that proves nothing about how the Styles differ.
    // Explicit rather than left absent so a re-seeded page shows a SELECTED
    // Style in the builder's Style tab instead of a picker that looks dead over
    // a page rendering at the `bold` default (A21).
    design: { style: spec.style } as const,
  };

  if (existing) {
    await dbWs
      .update(landingPages)
      .set(shared)
      .where(eq(landingPages.id, existing.id));
    return;
  }

  await dbWs.insert(landingPages).values({
    organizationId,
    creatorId,
    slug: spec.slug,
    ...shared,
  });
}

/**
 * The shared guide identity behind every Of Blood & Bones portal — one
 * creator, so the `instructor` section reads as the same voice across all
 * four pages rather than four unrelated bios.
 */
const GUIDE_NAME = 'Nell Ashworth';
const GUIDE_ROLE = 'Somatic guide, Of Blood & Bones';
const GUIDE_BIO_OPENING =
  'I have spent fifteen years learning what the body already knows — in studios, in hospices, and on the shoreline where I now teach.';
const GUIDE_CREDENTIALS = [
  'Fifteen years in somatic and ancestral practice',
  'Trained in craniosacral work and grief tending',
  'Living and teaching on the Stonehaven shoreline',
];

/**
 * Per-portal, per-section v2 COPY (contract §2 prop keys) — WP-9b. Bespoke,
 * not interpolated: `spec.kicker`/`spec.lede` already carry the portal's own
 * voice and are reused verbatim for the hero (see `buildSections`), but
 * everything below is written FOR this specific page, because "genuinely
 * good, specific copy" is the point of a seed a real owner will look at —
 * generic copy generated from `spec.title` alone was the exact failure mode
 * `seed-journey-content.ts`'s own header describes ("reads as scaffolding").
 */
const PAGE_COPY: Record<
  string,
  {
    hero: { ctaLabel: string; note: string };
    problem: {
      eyebrow: string;
      heading: string;
      body: string;
      points: [string, string, string];
    };
    transformation: {
      heading: string;
      beforeLabel: string;
      afterLabel: string;
      before: [string, string, string];
      after: [string, string, string];
    };
    benefits: {
      heading: string;
      items: [
        { title: string; detail: string },
        { title: string; detail: string },
        { title: string; detail: string },
      ];
    };
    curriculum: { heading: string; body: string };
    instructor: { bridge: string; quote: string };
    pricing: { heading: string; body: string; ctaLabel: string; note?: string };
    faq: {
      items: [
        { question: string; answer: string },
        { question: string; answer: string },
        { question: string; answer: string },
      ];
      contactLabel: string;
      contactHref: string;
    };
    cta: { heading: string; body: string; ctaLabel: string; note: string };
  }
> = {
  'bone-deep': {
    hero: {
      ctaLabel: 'Begin the descent',
      note: 'Four practices. Go as slowly as the work asks.',
    },
    problem: {
      eyebrow: 'Why this exists',
      heading: 'You have already tried to think your way out of it',
      body: 'The tightness in your jaw, the guard in your shoulders, the breath that never quite finishes — none of that moved when you understood it better. It moves when you go where it lives.',
      points: [
        'You can explain your patterns and still be run by them',
        'Rest arrives and the body does not believe it is safe yet',
        'You have done the talking. The tissue is still waiting.',
      ],
    },
    transformation: {
      heading: 'From holding to arriving',
      beforeLabel: 'Where you are now',
      afterLabel: 'Four practices in',
      before: [
        'Bracing that runs quietly all day',
        'A body you manage rather than live in',
        'Calm that never reaches past the neck',
      ],
      after: [
        'A first exhale that actually finishes',
        'A body that tells you what it needs',
        'Calm that reaches all the way down',
      ],
    },
    benefits: {
      heading: 'What the descent includes',
      items: [
        {
          title: 'Three stages, one practice',
          detail: 'Arriving, listening, staying — each one built on the last.',
        },
        {
          title: 'Four guided sessions',
          detail: 'Slow, close-focus practice you can return to at any depth.',
        },
        {
          title: 'No pace to keep',
          detail:
            'Stay in a stage as long as it asks. Nothing here is timed against you.',
        },
      ],
    },
    curriculum: {
      heading: 'How the descent unfolds',
      body: 'Arriving settles you into the body you actually have today. Listening asks what the tissue says before language reaches it. Staying is the practice of not leaving once it gets uncomfortable.',
    },
    instructor: {
      bridge:
        'Bone Deep is the practice I return to myself, on the days the ground feels unfamiliar.',
      quote:
        'The body remembers what the mind was never told. Go slowly enough and it will tell you.',
    },
    pricing: {
      heading: 'Join Bone Deep',
      body: 'However you join, all four practices open at once, at whatever pace the work asks of you.',
      ctaLabel: 'Begin the descent',
    },
    faq: {
      items: [
        {
          question: 'Do I need any experience with somatic work?',
          answer:
            'None. Arriving starts from wherever your body is today — that is the whole first stage.',
        },
        {
          question: 'How long does each practice take?',
          answer:
            'Twenty to thirty minutes, unhurried. Give it a room where you will not be interrupted.',
        },
        {
          question: 'What if it brings something up?',
          answer:
            'That is not a wrong turn — it is what Staying is for. Go at the pace that lets you keep breathing.',
        },
      ],
      contactLabel: 'Ask before you begin',
      contactHref: 'mailto:hello@ofbloodandbones.test',
    },
    cta: {
      heading: 'The ground is still there. Go find it.',
      body: 'Begin whenever you are ready — the four practices wait for you exactly as they are.',
      ctaLabel: 'Begin the descent',
      note: 'No countdown. Start when it is time.',
    },
  },
  'tending-the-grief': {
    hero: {
      ctaLabel: 'Begin tending',
      note: 'Come as you are. There is no version of grief that disqualifies you.',
    },
    problem: {
      eyebrow: 'What grief actually asks for',
      heading: 'You have been told to move on. Nothing here asks that.',
      body: 'Most of what passes for grief support is a push toward closure. This is the opposite: practices built to keep company with what will not resolve on schedule.',
      points: [
        'You are exhausted from performing "fine"',
        'Nobody around you seems to know what to say any more',
        'You want somewhere to put it down, even briefly',
      ],
    },
    transformation: {
      heading: 'From carrying alone to being held',
      beforeLabel: 'Where grief sits now',
      afterLabel: 'With these practices',
      before: [
        'Grief carried silently, on your own',
        'A weight you brace against daily',
        'No language for what this actually is',
      ],
      after: [
        'A regular place to set it down',
        'Company for what cannot be fixed',
        'Words that finally fit the shape of it',
      ],
    },
    benefits: {
      heading: "What's included",
      items: [
        {
          title: 'Three stages of tending',
          detail:
            'Naming, holding, and letting move — no fixed timeline between them.',
        },
        {
          title: 'Four guided practices',
          detail: 'Short enough for a hard week, honest enough for a long one.',
        },
        {
          title: 'Return whenever grief does',
          detail: 'Grief is not linear, and neither is access to this.',
        },
      ],
    },
    curriculum: {
      heading: 'How tending unfolds',
      body: 'Naming says the thing plainly, without softening it. Holding offers company for what cannot be fixed. Letting move treats grief as water, not stone — something that is allowed to travel.',
    },
    instructor: {
      bridge:
        'Tending the Grief comes from sitting with more grief than I expected to, and learning what actually helps.',
      quote:
        'Grief tended is not grief gone. It is grief that finally has somewhere to stand.',
    },
    pricing: {
      heading: 'Join Tending the Grief',
      body: 'Every stage opens as soon as you begin — go at whatever pace tending asks.',
      ctaLabel: 'Begin tending',
    },
    faq: {
      items: [
        {
          question: 'Is this therapy?',
          answer:
            'No. It is a practice, not a treatment — a good companion to therapy, not a replacement for it.',
        },
        {
          question: "What if I'm not ready to feel this?",
          answer:
            'Naming starts small, on purpose. You only go as deep as a session that day can hold.',
        },
        {
          question: 'Can I come back to this months from now?',
          answer:
            'Yes. Grief does not follow a syllabus, and neither does access to this.',
        },
      ],
      contactLabel: 'Write to us first',
      contactHref: 'mailto:hello@ofbloodandbones.test',
    },
    cta: {
      heading: 'You do not have to carry this alone today',
      body: 'Begin whenever tending is what the day calls for.',
      ctaLabel: 'Begin tending',
      note: 'Pause or return any time — nothing here is timed against you.',
    },
  },
  'ancestral-threads': {
    hero: {
      ctaLabel: 'Take up the thread',
      note: 'Three stages back, one stage forward.',
    },
    problem: {
      eyebrow: 'What you inherited',
      heading: 'Some of what you carry was never yours to begin with',
      body: 'A temper, a silence, a way of flinching before anything has happened — patterns like these are rarely invented. They are handed down, usually without a word, and they can be met instead of just repeated.',
      points: [
        'You react in ways that feel older than you are',
        'Family stories thin out right where they matter most',
        'You want to choose what you pass on, not just repeat it',
      ],
    },
    transformation: {
      heading: 'From repeating to choosing',
      beforeLabel: 'What gets handed down unexamined',
      afterLabel: 'What Ancestral Threads makes possible',
      before: [
        'Patterns you repeat without noticing',
        'A lineage that stays a rumour',
        'Weather passed on with no name',
      ],
      after: [
        'Patterns you can finally see and meet',
        'A lineage you have actually looked at',
        'A choice about what continues',
      ],
    },
    benefits: {
      heading: "What's included",
      items: [
        {
          title: 'Three stages of lineage work',
          detail:
            'The near ones, the far ones, and the thread you carry forward.',
        },
        {
          title: 'Four practices for tracing inheritance',
          detail:
            'Structured enough to hold difficult material, open enough to fit your own family.',
        },
        {
          title: 'A record you keep',
          detail:
            'Notes and reflections that are yours to return to, long after the course ends.',
        },
      ],
    },
    curriculum: {
      heading: 'How the thread unfolds',
      body: 'It begins with the near ones: parents, and their weather. Then the far ones, the names you were never told. Last, the thread forward: what you choose, deliberately, to carry.',
    },
    instructor: {
      bridge:
        'Ancestral Threads started as my own attempt to trace what I had inherited without asking for it.',
      quote:
        'You did not invent your patterns. You inherited them — and you can meet them.',
    },
    pricing: {
      heading: 'Join Ancestral Threads',
      body: 'A one-off payment opens the whole lineage practice, once and for good.',
      ctaLabel: 'Take up the thread',
      note: 'One payment. Yours to keep and return to.',
    },
    faq: {
      items: [
        {
          question: 'What if I know very little about my family history?',
          answer:
            'The far ones is built for exactly that gap. Not knowing names is itself part of what the practice works with.',
        },
        {
          question: 'Is this genealogy research?',
          answer:
            'No records, no archives — this is felt and somatic, not documentary. What surfaces is impression, not proof.',
        },
        {
          question: 'What if my family history is difficult?',
          answer:
            'Most are. Each stage lets you go only as close as feels workable, and no practice requires contact with anyone living.',
        },
      ],
      contactLabel: 'Ask a question first',
      contactHref: 'mailto:hello@ofbloodandbones.test',
    },
    cta: {
      heading: 'The thread is still in your hands',
      body: 'Begin tracing what you were handed — and decide, deliberately, what you hand on.',
      ctaLabel: 'Take up the thread',
      note: 'One payment, no deadline to finish.',
    },
  },
  'return-to-the-shoreline': {
    hero: {
      ctaLabel: 'Walk to the shoreline',
      note: 'A short practice for the end of something long.',
    },
    problem: {
      eyebrow: "What's missing at the end",
      heading: 'Most journeys end without ending',
      body: 'You finish the retreat, the therapy block, the hard year — and then Monday just starts again, as if nothing happened. Nothing marks the change, so the body files it as unfinished.',
      points: [
        'A long chapter closed with no ceremony at all',
        'You feel different but nothing around you acknowledges it',
        "Ordinary life resumed before you'd actually landed",
      ],
    },
    transformation: {
      heading: 'From unfinished to arrived',
      beforeLabel: 'How most endings land',
      afterLabel: 'After the shoreline',
      before: [
        'A change nobody marked',
        'Re-entry that felt too sudden',
        'A body still braced for what just ended',
      ],
      after: [
        'An ending your body actually registers',
        'A gentler return to ordinary days',
        'Room to arrive before you are asked to perform',
      ],
    },
    benefits: {
      heading: "What's included",
      items: [
        {
          title: 'Three short stages',
          detail:
            'Looking back, marking it, and coming up — walked in one sitting or spread over days.',
        },
        {
          title: 'Four closing practices',
          detail:
            'Gentle enough for whatever you are closing, specific enough to actually help.',
        },
        {
          title: 'A rite you can repeat',
          detail:
            'Return to Return to the Shoreline at the end of the next long thing, too.',
        },
      ],
    },
    curriculum: {
      heading: 'How the closing rite unfolds',
      body: 'Looking back asks what the walking actually changed. Marking it is a rite so the body knows it ended. Coming up is re-entry, gently, back into ordinary light.',
    },
    instructor: {
      bridge:
        'I built Return to the Shoreline because every other course I taught ended and just... stopped.',
      quote: 'An ending done well is not the same as an ending rushed.',
    },
    pricing: {
      heading: 'Join Return to the Shoreline',
      body: 'A short, complete rite — use it once, or at the end of every long chapter.',
      ctaLabel: 'Walk to the shoreline',
      note: 'One payment, yours to repeat.',
    },
    faq: {
      items: [
        {
          question: 'What kind of ending is this for?',
          answer:
            'Any of them — a course, a grief, a relationship, a hard year. The rite does not need to know which.',
        },
        {
          question: 'How long does it take?',
          answer:
            'Under an hour in total, across three short stages. Some people walk it in one sitting.',
        },
        {
          question: 'Can I use this more than once?',
          answer:
            'Yes — that is the design. Come back to it at the close of the next long thing, too.',
        },
      ],
      contactLabel: 'Ask before you begin',
      contactHref: 'mailto:hello@ofbloodandbones.test',
    },
    cta: {
      heading: 'Let this one actually end',
      body: 'Walk the three stages, and come back up into ordinary light on purpose.',
      ctaLabel: 'Walk to the shoreline',
      note: 'One payment, yours to repeat.',
    },
  },
};

/**
 * The sell-page body for a seeded portal — a full v2 page (`docs/design/
 * landing-builder/01-contract.md` §2/§3, BINDING; WP-9b): v2 section types,
 * v2 prop keys, no legacy axes, and NO `variant` — every layout is left unset
 * so it resolves from the portal's own Style (`PortalSpec.style`), which is
 * the whole point of seeding four DIFFERENT Styles rather than one shared
 * bundle.
 *
 * WHY A PAGE AT ALL: a portal is a COURSE plus a published `course`-type LANDING
 * PAGE, and the public rails are built from the page, not the course.
 * `listPublishedJourneys` — which feeds the org landing "Editor's picks" and the
 * portals rail — selects `from(landingPages)`, and `listEnrolledJourneys`
 * INNER JOINs it. So a course seeded without a page is invisible on every
 * landing surface no matter how complete its curriculum is. (Only
 * `listPublishedCourses`, the /explore rail, left-joins and shows it anyway,
 * which is why this gap looked like it worked.)
 *
 * Copy is bespoke per portal (`PAGE_COPY`), not interpolated from a single
 * template. Codex-maf0y exists because placeholder section copy on a
 * published page gets served to real visitors — demo data that reads as real,
 * specific copy is the whole point of this seed, and genuinely good copy is
 * what the owner will actually look at.
 *
 * NO testimonials section: the type's `items[]` are "merged after live
 * testimonials" (contract §2), and no `courseTestimonials` rows exist for
 * these portals — an authored decoration with nothing live behind it would
 * misrepresent what the page can show.
 *
 * NO `offers[]` on pricing and NO price/cadence claims in its copy — price and
 * cadence come only from the live offer (contract principles); a seeded
 * `courses.priceCents` (or its absence) is what actually drives the CTA a
 * visitor sees, and the framing text here stays honest against either state.
 */
function buildSections(spec: PortalSpec) {
  const copy = PAGE_COPY[spec.slug];
  if (!copy) {
    throw new Error(
      `buildSections: no v2 copy authored for portal "${spec.slug}"`
    );
  }

  return [
    {
      id: crypto.randomUUID(),
      type: 'hero',
      name: 'Hero',
      enabled: true,
      props: {
        eyebrow: spec.kicker,
        heading: spec.title,
        body: spec.lede,
        ctaLabel: copy.hero.ctaLabel,
        note: copy.hero.note,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'problem',
      name: 'The problem',
      enabled: true,
      props: {
        eyebrow: copy.problem.eyebrow,
        heading: copy.problem.heading,
        body: copy.problem.body,
        points: copy.problem.points,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'transformation',
      name: 'Before and after',
      enabled: true,
      props: {
        heading: copy.transformation.heading,
        beforeLabel: copy.transformation.beforeLabel,
        afterLabel: copy.transformation.afterLabel,
        before: copy.transformation.before,
        after: copy.transformation.after,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'benefits',
      name: "What's included",
      enabled: true,
      props: {
        heading: copy.benefits.heading,
        items: copy.benefits.items,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'curriculum',
      name: 'Curriculum',
      enabled: true,
      props: {
        heading: copy.curriculum.heading,
        body: copy.curriculum.body,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'instructor',
      name: 'About you',
      enabled: true,
      props: {
        heading: 'Meet your guide',
        body: `${GUIDE_BIO_OPENING} ${copy.instructor.bridge}`,
        name: GUIDE_NAME,
        role: GUIDE_ROLE,
        credentials: GUIDE_CREDENTIALS,
        quote: copy.instructor.quote,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'pricing',
      name: 'Pricing',
      enabled: true,
      props: {
        heading: copy.pricing.heading,
        body: copy.pricing.body,
        ctaLabel: copy.pricing.ctaLabel,
        ...(copy.pricing.note ? { note: copy.pricing.note } : {}),
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'faq',
      name: 'Questions',
      enabled: true,
      props: {
        items: copy.faq.items,
        contactLabel: copy.faq.contactLabel,
        contactHref: copy.faq.contactHref,
      },
    },
    {
      id: crypto.randomUUID(),
      type: 'cta',
      name: 'Call to action',
      enabled: true,
      props: {
        heading: copy.cta.heading,
        body: copy.cta.body,
        ctaLabel: copy.cta.ctaLabel,
        note: copy.cta.note,
      },
    },
  ];
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
