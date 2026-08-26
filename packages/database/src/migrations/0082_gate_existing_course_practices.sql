-- Codex-0biug — BACKFILL: gate course practices linked before the fix landed.
--
-- Data-only migration (no schema change, so there is nothing for drizzle to
-- infer — scaffolded with `drizzle-kit generate --custom` so the journal entry
-- and filename stay tool-generated).
--
-- WHY: a practice linked into a curriculum kept the DEFAULT access policy, and
-- `ContentService.create` derives `is_free = true` when no other flag is set.
-- That flag set reaches the terminal `grant('free')` in access-decision.ts, so
-- every such practice in a paid journey was anonymously streamable at its
-- standalone /content/[slug] URL and listed in the org's public catalogue as
-- free content. `CourseJourneyService.saveCurriculum` now sets `course_only` on
-- link, but that only heals a curriculum when the creator next SAVES it. This
-- closes the gap for curricula already persisted.
--
-- THE PREDICATE MIRRORS THE SERVICE EXACTLY (course-journey-service.ts step 5).
-- It gates ONLY content with no deliberately-configured standalone path. Content
-- that is independently purchasable, tier-gated, follower-gated or team-only
-- already has its own paywall, and selling it BOTH standalone and inside a
-- course is a legitimate creator choice this must not silently revoke.
--
-- Measured on dev data before writing this: of 12 linked practices on the one
-- affected course, 7 matched (gated) and 5 were deliberate standalone products
-- totalling ~£90 that a blanket `SET course_only = true` would have destroyed.
-- That is the entire reason this is a filtered UPDATE and not a bulk one.
--
-- `is_free` is deliberately left ALONE: the resolver checks `course_only` FIRST
-- and it suppresses every standalone path regardless of the other flags, so
-- `is_free` can no longer grant access — and it still drives display badges.
--
-- IDEMPOTENT (`course_only = false` is in the predicate) and safe to re-run.
-- NOT REVERSIBLE BY DATA ALONE: afterwards a gated row is indistinguishable from
-- one a creator gated deliberately, so a rollback means restoring a snapshot,
-- not flipping the flag back wholesale.

UPDATE "content" AS c
SET "course_only" = true
WHERE c."course_only" = false
  AND c."deleted_at" IS NULL
  -- No deliberately-configured standalone path (the vulnerable default shape).
  AND c."is_purchasable" = false
  AND c."included_in_tier_id" IS NULL
  AND c."is_follower_gated" = false
  AND c."is_team_only" = false
  -- Reachable as a practice of a LIVE course. Scoped through non-deleted stages
  -- and courses so a soft-deleted curriculum never gates content that is no
  -- longer part of anything.
  AND EXISTS (
    SELECT 1
    FROM "stage_practices" sp
    JOIN "course_stages" cs
      ON cs."id" = sp."stage_id" AND cs."deleted_at" IS NULL
    JOIN "courses" crs
      ON crs."id" = cs."course_id" AND crs."deleted_at" IS NULL
    WHERE sp."content_id" = c."id"
  );
