-- Journey sections · F-B2 — `landing_pages.design` + the Candlelit backfill.
--
-- Contract: `docs/design/journey-sections/02-axis-contract.md` A3. The DDL is
-- drizzle-generated (`pnpm db:generate`); the backfill below is appended BY HAND
-- because drizzle infers schema, never data, and the two MUST ship as one
-- migration.
--
-- WHY THE BACKFILL IS IN THIS MIGRATION AND NOT A LATER ONE:
-- `SECTION_DESIGN_DEFAULTS` deliberately describes a neutral page, NOT today's
-- cinematic look — a creator with no design opinion should not inherit a niche
-- aesthetic. That makes this backfill load-bearing: the moment a section starts
-- reading its `--jp-*` axes, any page left with `design IS NULL` would render at
-- those neutral defaults and visibly change for real visitors. Writing Candlelit
-- (research §4.1 — the bundle that describes today's page) in the SAME step
-- removes the window in which that is possible, so `design IS NULL` can never
-- occur for a pre-existing page.
--
-- UNVERIFIED BET, STATED AS ONE: "Candlelit reproduces today's page exactly" is
-- the research's assertion and it is NOT yet verifiable — no section consumes the
-- axes yet (F-B1 shipped the CSS; the seven component worktrees wire the reads).
-- Each worktree verifies it for its own type. If Candlelit turns out not to
-- reproduce a section's current appearance, the fix is to ADJUST THE CANDLELIT
-- BUNDLE — never to edit page data, which is a creator's own content.
--
-- IDEMPOTENT (`design IS NULL` is in the predicate) and safe to re-run.
-- Deliberately UNSCOPED by `deleted_at` and by `status`: a soft-deleted page can
-- be restored and a draft can be published, so the invariant is about every row
-- that existed before this column, not just the live ones.
--
-- New pages get the SIGNAL bundle (research §4.8) instead, written explicitly by
-- `CourseJourneyService.createJourney` (amendment A21) — not by a column DEFAULT,
-- so the value a page is born with is visible in the service code that creates it.
ALTER TABLE "landing_pages" ADD COLUMN "design" jsonb;
--> statement-breakpoint
UPDATE "landing_pages"
SET "design" = '{
  "width": "narrow",
  "density": "airy",
  "surface": "media",
  "edge": "none",
  "align": "center",
  "type": "monumental",
  "accent": "glow",
  "motion": "drift",
  "media": "bleed"
}'::jsonb
WHERE "design" IS NULL;
