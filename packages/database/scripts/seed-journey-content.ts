/**
 * Attach real MEDIA onto a fixture journey sales page.
 *
 * WHY THIS EXISTS (narrowed, WP-9b). This script used to do two jobs: overlay
 * hand-authored section COPY onto whatever placeholder props
 * `seed-portals.ts` had seeded, and wire up the one on-brief hero still image
 * plus whatever video/audio media the fixture org owns. The COPY half is gone
 * — `seed-portals.ts` now writes complete, specific, v2 section props for
 * every seeded portal directly (contract `docs/design/landing-builder/
 * 01-contract.md` §2/§3), so there is no scaffolding left here to replace.
 * Keeping a copy-overlay keyed by section `type` around anyway would have
 * been actively dangerous: `hero` and `faq` are the two v2 type NAMES that
 * are also LEGACY type names (contract Appendix A.1's "hero/faq trap"), so a
 * legacy-keyed `COPY['hero']` (`headline`/`sub`/`button`/`trust`, …) would
 * have matched a genuinely-v2 `hero` section by type string and written
 * those legacy-named keys in ALONGSIDE the real v2 `heading`/`body`/
 * `ctaLabel`/`note` — a page that looks v2 while quietly carrying dead
 * legacy props no renderer reads. Simpler and safer to drop the mechanism
 * now that nothing needs it, rather than re-key it for a job it no longer has.
 *
 * WHAT'S LEFT: attaching MEDIA `seed-portals.ts` cannot set for itself,
 * because it never touches R2 or `media_items` — it only writes the
 * `landing_pages`/`courses` rows. This script points the hero still
 * (`courses.heroImageKey`) at the org's one on-brief photograph, and attaches
 * whatever ready video/audio the org owns so the clip-bearing sections stop
 * rendering an empty frame.
 *
 * IMAGERY IS THE THIN PART, and honestly so. The fixture org owns exactly one
 * on-brief photograph — the `portal-tending-the-grief` cover, a torso with a
 * fine-line tattoo — plus a mural and a rail of clothes hangers that suit a
 * somatic-practice brand not at all. So this sets the hero still and leaves
 * everything else alone rather than dressing the page in stock that actively
 * fights it. Real atmosphere for these sections belongs in the `ShaderHero`
 * system the org brand already configures (`--brand-shader-preset: flow`)
 * and which no page-builder component mounts.
 *
 * Usage (from the monorepo root):
 *   pnpm --filter @codex/database db:seed:journey-content
 *   pnpm --filter @codex/database db:seed:journey-content -- --org=of-blood-and-bones
 *   pnpm --filter @codex/database db:seed:journey-content -- --page=bone-deep
 *   pnpm --filter @codex/database db:seed:journey-content -- --dry-run
 *   pnpm --filter @codex/database db:seed:journey-content -- --force
 *
 * Idempotent: re-running attaches the same media and reports 0 changes.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { and, eq, isNull } from 'drizzle-orm';

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
  for (const [k, v] of Object.entries(mediaUpdates))
    console.log(`  course.${k} → ${v}`);
  console.log(`\n  ${Object.keys(mediaUpdates).length} media attachment(s)`);

  if (DRY_RUN) {
    console.log('  --dry-run: nothing written\n');
    return;
  }
  if (!course || Object.keys(mediaUpdates).length === 0) {
    console.log('  already seeded — nothing to do\n');
    return;
  }

  await dbWs.update(courses).set(mediaUpdates).where(eq(courses.id, course.id));

  console.log('  written\n');
}

await main();
process.exit(0);
