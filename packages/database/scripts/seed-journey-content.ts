/**
 * Seed REAL authored content onto a fixture journey sales page.
 *
 * WHY THIS EXISTS. `seed-portals.ts` creates the journey, its stages and its
 * practices, and the page-builder then renders sections whose props were never
 * authored — so every renderer falls through to `section-catalog.ts`
 * `defaultProps` and the page reads as scaffolding: "A headline that names the
 * promise", "A common question?", "A short, specific testimonial in their
 * words". Two arrays were worse than scaffolding, holding hand-typed test input
 * (`["wrEWFWEF", "IUHIUHIU", ...]`).
 *
 * That is not a cosmetic problem. The eight page-builder LOOKS
 * (`design-vocabulary.ts`) are judged by eye, and a look cannot be judged on
 * placeholder copy and zero imagery: of the nine design axes, `media` has five
 * values and NONE of them can do anything on a page that renders no image at
 * all — including `media: bleed`, one of only four axes that uniquely identify
 * Candlelit. Measured before this script: 0 `<img>`, 0 `<video>`, 0 `<picture>`
 * across all 9 sections, in all 8 looks.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never overwrites a prop whose stored
 * value differs from the catalogue default — an author's real words always win.
 * Pass `--force` to overwrite anyway. The gibberish arrays are the one
 * exception: they are matched by shape (see `isGibberish`) and always replaced,
 * because no author meant them.
 *
 * IMAGERY IS THE THIN PART, and honestly so. The fixture org owns exactly one
 * on-brief photograph — the `portal-tending-the-grief` cover, a torso with a
 * fine-line tattoo — plus a mural and a rail of clothes hangers that suit a
 * somatic-practice brand not at all. So this sets the hero still and leaves
 * `signature_image_key` NULL rather than dressing the page in stock that
 * actively fights it. Real atmosphere for these sections belongs in the
 * `ShaderHero` system the org brand already configures
 * (`--brand-shader-preset: flow`) and which no page-builder component mounts.
 *
 * Usage (from the monorepo root):
 *   pnpm --filter @codex/database db:seed:journey-content
 *   pnpm --filter @codex/database db:seed:journey-content -- --org=of-blood-and-bones
 *   pnpm --filter @codex/database db:seed:journey-content -- --dry-run
 *   pnpm --filter @codex/database db:seed:journey-content -- --force
 *
 * Idempotent: re-running writes the same values and reports 0 changes.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq, isNull, sql } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env.dev') });

const { dbWs } = await import('../src');
const {
  courses,
  landingPages,
  mediaItems,
  organizations,
  organizationMemberships,
} = await import('../src/schema');

// ── FLAGS ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
const has = (name: string): boolean => argv.includes(`--${name}`);

const ORG_SLUG = flag('org') ?? 'of-blood-and-bones';
const PAGE_SLUG = flag('page') ?? 'bone-deep';
const DRY_RUN = has('dry-run');
const FORCE = has('force');

/**
 * The catalogue defaults this script is allowed to replace. Anything stored that
 * is NOT in this set is an author's own words and is left alone (unless
 * `--force`). Kept as a literal set rather than imported from `apps/web`,
 * because `@codex/database` must not depend on the web app.
 */
const CATALOGUE_DEFAULTS = new Set(
  [
    'A headline that names the promise',
    'A sub-line that expands on it in a sentence or two.',
    'Your eyebrow',
    'Get started',
    'Describe the problem or longing this journey speaks to — in their words, not yours.',
    'Not insight — practice. Name the change this journey makes possible.',
    'A short bio that establishes credibility and warmth.',
    'A short, specific testimonial in their words.',
    'Another testimonial that speaks to a different fear.',
    'A third that names a concrete result.',
    'First L.',
    'Second L.',
    'Third L.',
    'member',
    'new member',
    'months in',
    'A common question?',
    'Another question?',
    'One more?',
    'A clear, reassuring answer.',
    'Another answer.',
    'One more answer.',
    '',
  ].map((s) => s.trim())
);

/**
 * Hand-typed keyboard mash left in the fixture by manual testing.
 *
 * CALIBRATED AGAINST THE ACTUAL STRINGS, because the obvious heuristics do not
 * survive contact with them. A first version of this used "few vowels" and
 * "many case changes" and matched NEITHER: `IUHIUHIU` is 75% vowels, and
 * `wrEWFWEF` has exactly one case change (`r`→`E`, then an unbroken run of
 * capitals). Both would have been silently treated as real copy, and the only
 * reason that surfaced is that `--dry-run` printed no `points` line.
 *
 * So the rule is now two things that can be checked by eye:
 *
 *  1. An explicit set of the literals actually present. Zero false positives,
 *     and a new mash simply gets added here — a seed fixture is a closed world.
 *  2. A repeated-trigram shape, which is what mash produced by rolling the same
 *     fingers actually looks like: `IUHL`+`IUHL`, `IUH`+`IUH`. This generalises
 *     without ever matching a real bullet, because a real bullet is a phrase
 *     with spaces and is rejected before the shape test runs.
 *
 * A single word IS a legitimate bullet ("Breathe"), which is exactly why there
 * is no "one token is suspicious" rule here.
 */
const KNOWN_MASH: ReadonlySet<string> = new Set([
  'wrEWFWEF',
  'IUHIUHIU',
  'IUHIUHIUHLIUG',
  'IUHLIUHIL',
  'IUHLIUHLIUH',
]);

function hasRepeatedTrigram(s: string): boolean {
  const u = s.toUpperCase();
  for (let i = 0; i + 3 <= u.length; i++) {
    const tri = u.slice(i, i + 3);
    if (u.indexOf(tri, i + 3) !== -1) return true;
  }
  return false;
}

function isGibberish(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (KNOWN_MASH.has(s)) return true;
  // A phrase is never mash. Only a bare letters-only token is a candidate.
  if (s.includes(' ') || s.length < 6 || !/^[A-Za-z]+$/.test(s)) return false;
  return hasRepeatedTrigram(s);
}

/**
 * The authored copy, in the fixture brand's established voice — spare, second
 * person, somatic, em-dashed. Sampled from the props the fixture already had in
 * that voice ("Not insight — practice", "a pace the body sets", "settle one
 * ground before the next opens") so the seeded lines and the surviving ones read
 * as one writer.
 *
 * Keyed by section `type`, then prop key. `points` is an array prop.
 */
const COPY: Record<string, Record<string, string | string[]>> = {
  hero: {
    eyebrow: 'An eight-week descent',
    headline: 'Come home to the body that carried you here',
    accent: 'at the pace it sets',
    sub: 'Slow, unhurried practice — breath, weight, attention. For people who have read enough about the nervous system and want something to actually shift.',
    felt: 'No fixing. No performance. Just contact.',
    button: 'Begin the descent',
    trust: 'Free to start · leave whenever you need to',
  },
  turn: {
    body: 'Not insight — practice. You stop managing the body from the outside and start listening from inside it.',
    points: [
      'Notice the bracing before it becomes pain',
      'Let weight land instead of holding it up',
      'Stay in contact when it turns uncomfortable',
    ],
  },
  ache: {
    body: 'You have done the reading. You can explain your own patterns to anyone who asks. And still, at the end of the day, the jaw is set and nothing has moved.',
    points: [
      'You understand it perfectly and feel it not at all',
      'Rest is something you believe you have to earn',
      'You leave your body to get through the day',
    ],
  },
  proof: {
    q1: 'I stopped treating rest as a reward. That alone changed how I sleep.',
    n1: 'Marguerite R.',
    c1: 'eight weeks in',
    q2: 'I expected another course to fall behind on. It met me at the pace I actually had.',
    n2: 'Tomas L.',
    c2: 'new member',
    q3: 'The bracing in my jaw is something I can feel now — before it becomes a headache.',
    n3: 'Ines K.',
    c3: 'four months in',
  },
  guide: {
    body: 'Twelve years of somatic practice, and a decade before that of getting it wrong in a body that would not cooperate. I teach the version I needed.',
    quote:
      'The body is not a problem to be solved. It is the one place you have never left.',
  },
  faq: {
    q1: 'I have no flexibility and no experience. Is this for me?',
    a1: 'Yes. Nothing here asks for range or strength — only attention. Every practice has a version that happens lying down.',
    q2: 'How much time does it take?',
    a2: 'Twenty minutes a day, and one longer practice a week. Miss a week and the path waits where you left it.',
    q3: "What if I don't feel anything?",
    a3: 'That is a common starting point, not a failure. The first ground is entirely about rebuilding sensation.',
  },
  invite: {
    button: 'Begin the descent',
  },
};

/**
 * Props that carry a FABRICATED value which permanently masks a real one, and so
 * must be REMOVED rather than rewritten. `guide.duration` is the `Codex-maf0y`
 * root cause: renderers resolve `p.duration ?? formatDuration(clip.durationSeconds)`
 * and the authored string wins, so a seeded '2:00' hides the probed duration
 * forever. The literals were dropped from `section-catalog.ts` `defaultProps`,
 * but EXISTING ROWS still hold them — a code fix cannot reach stored data.
 */
const DELETE_PROPS: Record<string, readonly string[]> = {
  guide: ['duration'],
  introVideo: ['duration'],
  reel: ['duration'],
};

interface Change {
  readonly section: string;
  readonly key: string;
  readonly from: string;
  readonly to: string;
}

async function main(): Promise<void> {
  const [org] = await dbWs
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, ORG_SLUG))
    .limit(1);
  if (!org) throw new Error(`No organization with slug "${ORG_SLUG}"`);

  const [page] = await dbWs
    .select({
      id: landingPages.id,
      title: landingPages.title,
      sections: landingPages.sections,
      subjectId: landingPages.subjectId,
    })
    .from(landingPages)
    .where(
      and(
        eq(landingPages.organizationId, org.id),
        eq(landingPages.slug, PAGE_SLUG),
        isNull(landingPages.deletedAt)
      )
    )
    .limit(1);
  if (!page) throw new Error(`No landing page "${PAGE_SLUG}" in ${ORG_SLUG}`);

  console.log(`\n${org.name} → "${page.title}" (${page.id})`);

  // ── SECTION PROPS ─────────────────────────────────────────────────────────
  const changes: Change[] = [];
  const sections = (page.sections ?? []) as Array<{
    type: string;
    props?: Record<string, unknown>;
  }>;

  for (const section of sections) {
    const copy = COPY[section.type];
    section.props ??= {};
    const props = section.props;

    for (const key of DELETE_PROPS[section.type] ?? []) {
      if (key in props) {
        changes.push({
          section: section.type,
          key,
          from: String(props[key]),
          to: '‹removed — unmasks the probed duration›',
        });
        delete props[key];
      }
    }

    if (!copy) continue;
    for (const [key, next] of Object.entries(copy)) {
      const current = props[key];

      if (Array.isArray(next)) {
        const arr = Array.isArray(current) ? current : [];
        // Replace the whole array when ANY member is keyboard mash, or when
        // every member is a catalogue default / empty.
        const mashed = arr.some(isGibberish);
        const allDefault =
          arr.length === 0 ||
          arr.every(
            (v) => typeof v === 'string' && CATALOGUE_DEFAULTS.has(v.trim())
          );
        if (mashed || allDefault || FORCE) {
          changes.push({
            section: section.type,
            key,
            from: JSON.stringify(arr).slice(0, 60),
            to: JSON.stringify(next).slice(0, 60),
          });
          props[key] = next;
        }
        continue;
      }

      const isReplaceable =
        current === undefined ||
        (typeof current === 'string' &&
          CATALOGUE_DEFAULTS.has(current.trim())) ||
        isGibberish(current);
      if (!isReplaceable && !FORCE) continue;
      if (current === next) continue;

      changes.push({
        section: section.type,
        key,
        from: String(current ?? '‹unset›').slice(0, 52),
        to: next.slice(0, 52),
      });
      props[key] = next;
    }
  }

  // ── HERO STILL ────────────────────────────────────────────────────────────
  // `courses.hero_image_key` is the documented FIRST rung of the hero-still
  // chain (`heroImageKey ?? heroMediaId`'s poster frame ?? the synthetic plate),
  // and it needs no video — which matters, because the fixture org owns one
  // video and its poster frame is a potted cactus.
  //
  // The key is stored WITHOUT the `/md.webp` leaf: `resolveCourseCoverUrl`
  // appends the variant. Verified against the running dev-cdn — the bare key
  // 404s and `<key>/md.webp` returns 146KB of image.
  const HERO_STILL_KEY =
    '4d675eb3e923d47695567467fd1017bb/media-thumbnails/portal-tending-the-grief';

  const [course] = page.subjectId
    ? await dbWs
        .select({
          id: courses.id,
          heroImageKey: courses.heroImageKey,
          guideVideoMediaId: courses.guideVideoMediaId,
          previewVideoMediaId: courses.previewVideoMediaId,
          introVideoMediaId: courses.introVideoMediaId,
        })
        .from(courses)
        .where(eq(courses.id, page.subjectId))
        .limit(1)
    : [];

  const mediaUpdates: Record<string, string> = {};
  if (course) {
    if (!course.heroImageKey || FORCE)
      mediaUpdates.heroImageKey = HERO_STILL_KEY;

    // Attach whatever ready media the org actually owns, so the clip-bearing
    // sections stop rendering an empty frame. `intro_video_media_id` accepts
    // audio (a reel/waveform is legitimate); the still slots accept video only.
    const owned = await dbWs
      .select({ id: mediaItems.id, mediaType: mediaItems.mediaType })
      .from(mediaItems)
      .innerJoin(
        organizationMemberships,
        eq(organizationMemberships.userId, mediaItems.creatorId)
      )
      .where(
        and(
          eq(organizationMemberships.organizationId, org.id),
          eq(mediaItems.status, 'ready')
        )
      );
    const video = owned.find((m) => m.mediaType === 'video');
    const audio = owned.find((m) => m.mediaType === 'audio');

    if (video && (!course.guideVideoMediaId || FORCE))
      mediaUpdates.guideVideoMediaId = video.id;
    if (video && (!course.previewVideoMediaId || FORCE))
      mediaUpdates.previewVideoMediaId = video.id;
    if (audio && (!course.introVideoMediaId || FORCE))
      mediaUpdates.introVideoMediaId = audio.id;
  }

  // ── REPORT ────────────────────────────────────────────────────────────────
  for (const c of changes)
    console.log(`  ${c.section}.${c.key}: "${c.from}" → "${c.to}"`);
  for (const [k, v] of Object.entries(mediaUpdates))
    console.log(`  course.${k} → ${v}`);
  console.log(
    `\n  ${changes.length} prop change(s), ${Object.keys(mediaUpdates).length} media attachment(s)`
  );

  if (DRY_RUN) {
    console.log('  --dry-run: nothing written\n');
    return;
  }
  if (changes.length === 0 && Object.keys(mediaUpdates).length === 0) {
    console.log('  already seeded — nothing to do\n');
    return;
  }

  // One transaction: the copy and the imagery are one authored state, and a page
  // with new copy but no still is not a state anyone asked for.
  await dbWs.transaction(async (tx) => {
    if (changes.length > 0) {
      await tx
        .update(landingPages)
        .set({ sections, updatedAt: sql`now()` })
        .where(eq(landingPages.id, page.id));
    }
    if (course && Object.keys(mediaUpdates).length > 0) {
      await tx
        .update(courses)
        .set(mediaUpdates)
        .where(eq(courses.id, course.id));
    }
  });

  console.log('  written\n');
}

await main();
process.exit(0);
