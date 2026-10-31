-- Downgrades wait for the renewal (Codex-2hxff.16), and course subscriptions
-- record what they bill (Codex-2hxff.52). ADDITIVE: four nullable columns, one
-- FK, one partial index and one CHECK; old code never reads them, so this
-- applies safely before the workers deploy. No backfill on subscriptions: no
-- move can exist before .16 ships. course_subscriptions.amount_cents is filled
-- by the course webhooks and a one-off script after deploy; until then the
-- account card shows no price.
--
-- A waiting move is pending_tier_id + pending_tier_from + held_amount_cents,
-- all or none (check_subscription_pending_move). tier_id, and so access, stays
-- on the current tier until the renewal flips it. Tiers are soft-deleted, so
-- the RESTRICT FK never blocks a tier delete.

ALTER TABLE "course_subscriptions" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_tier_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "held_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("pending_tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_pending_tier" ON "subscriptions" USING btree ("pending_tier_id","pending_tier_from") WHERE "subscriptions"."pending_tier_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "check_subscription_pending_move" CHECK (("subscriptions"."pending_tier_id" IS NULL) = ("subscriptions"."pending_tier_from" IS NULL) AND ("subscriptions"."pending_tier_id" IS NULL) = ("subscriptions"."held_amount_cents" IS NULL));