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
--
-- The runner applies this file as ONE implicit transaction, and each ADD
-- COLUMN or ADD CONSTRAINT holds an ACCESS EXCLUSIVE lock on subscriptions or
-- course_subscriptions (the FK a SHARE ROW EXCLUSIVE one on
-- subscription_tiers) until the file commits. lock_timeout bounds only the
-- WAIT for each lock: if a long transaction is open on one of those tables,
-- the migration fails after 5s and rolls back whole, instead of holding a
-- queue of access checks and account reads behind its own wait; re-run it
-- once the database is quiet (as 0111). Once the locks are held, reads still
-- wait for the CHECK's validating scan, which takes well under a second at
-- production's size and cannot fail: every row's new columns are NULL.
SET lock_timeout = '5s';--> statement-breakpoint

ALTER TABLE "course_subscriptions" ADD COLUMN "amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_tier_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "held_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("pending_tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_pending_tier" ON "subscriptions" USING btree ("pending_tier_id","pending_tier_from") WHERE "subscriptions"."pending_tier_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "check_subscription_pending_move" CHECK (("subscriptions"."pending_tier_id" IS NULL) = ("subscriptions"."pending_tier_from" IS NULL) AND ("subscriptions"."pending_tier_id" IS NULL) = ("subscriptions"."held_amount_cents" IS NULL));--> statement-breakpoint
RESET lock_timeout;