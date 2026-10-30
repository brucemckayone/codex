-- Plan access by ticks (Codex-2hxff.91). ADDITIVE: old code keeps reading and
-- writing content.included_in_tier_id only, so this applies safely before the
-- workers deploy. Hand-ordered: drizzle-kit emitted the composite FKs before
-- the parent unique index `uq_content_id_org` they need (as 0080 notes), and
-- knows nothing of the trigger or the backfill.
--
-- Numbered 0120: #664 took 0119 for the held payout-copy migration.

-- 1. The composite-FK target. content.id is the PK, so this is redundant for
--    uniqueness, exactly as uq_courses_id_org / uq_subscription_tiers_id_org.
CREATE UNIQUE INDEX "uq_content_id_org" ON "content" USING btree ("id","organization_id");--> statement-breakpoint

-- 2. The ticks: one row per (content, tier), both pinned to ONE organisation.
CREATE TABLE "content_tier_access" (
	"content_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "content_tier_access_content_id_tier_id_pk" PRIMARY KEY("content_id","tier_id")
);
--> statement-breakpoint
ALTER TABLE "content_tier_access" ADD CONSTRAINT "fk_content_tier_access_content_org" FOREIGN KEY ("content_id","organization_id") REFERENCES "public"."content"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_tier_access" ADD CONSTRAINT "fk_content_tier_access_tier_org" FOREIGN KEY ("tier_id","organization_id") REFERENCES "public"."subscription_tiers"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_tier_access_tier_content" ON "content_tier_access" USING btree ("tier_id","content_id");--> statement-breakpoint
CREATE INDEX "idx_content_tier_access_org_id" ON "content_tier_access" USING btree ("organization_id");--> statement-breakpoint

-- 3. The subscribers-only switch. Gated with no tick = CLOSED, never free.
ALTER TABLE "content" ADD COLUMN "is_tier_gated" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 4. Moving content to another organisation (a PATCH, or the SET NULL of an
--    org hard delete) would trip the composite FK (ON UPDATE NO ACTION). The
--    service refuses the move while gated; this backstop sweeps the ticks for
--    the paths that bypass it. The switch stays on, so the moved row is closed
--    (or orgless-denied), never free. Beside trigger_unpublish_on_org_delete
--    (0004), which proves user triggers fire on that cascade.
CREATE OR REPLACE FUNCTION sweep_content_tier_access_on_org_change() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM content_tier_access WHERE content_id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER trigger_sweep_tier_access_on_org_change
  BEFORE UPDATE OF organization_id ON content
  FOR EACH ROW WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION sweep_content_tier_access_on_org_change();--> statement-breakpoint

-- 5. Backfill the switch on EVERY row with a tier, orgless rows included: they
--    are denied today (`orgless_tier_gate`), and with the switch on and no tick
--    they stay denied. Excluding them would flip them to the free fallthrough.
UPDATE "content" SET "is_tier_gated" = true WHERE "included_in_tier_id" IS NOT NULL;--> statement-breakpoint

-- 6. Backfill the ticks to reproduce the DECISION (what /stream serves today):
--    every live tier of the CONTENT's org at or above the gating tier's
--    sort_order, inactive tiers included. No filter on x.deleted_at (the
--    decision has none). Joining t on the CONTENT's org keeps a cross-org x
--    from aborting on the composite FK.
INSERT INTO "content_tier_access" ("content_id", "tier_id", "organization_id")
SELECT c."id", t."id", c."organization_id"
  FROM "content" c
  JOIN "subscription_tiers" x ON x."id" = c."included_in_tier_id"
  JOIN "subscription_tiers" t ON t."organization_id" = c."organization_id"
                             AND t."deleted_at" IS NULL
                             AND t."sort_order" >= x."sort_order"
 WHERE c."organization_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 7. Course ticks on soft-deleted tiers were never swept (no access effect:
--    such a tier has no live subscriber). Sweep them once; deleteTier sweeps
--    both tick tables from now on.
DELETE FROM "course_tier_access" cta USING "subscription_tiers" t
 WHERE t."id" = cta."tier_id" AND t."deleted_at" IS NOT NULL;
