-- Leaving yearly billing waits for the year's end (Codex-2hxff.97). ADDITIVE:
-- three nullable columns and one CHECK; old code never reads them, so this
-- applies safely before the workers deploy. No backfill: no change of billing
-- can wait before .97 ships.
--
-- A waiting change of billing rides 0122's waiting move (pending_tier_id,
-- pending_tier_from, held_amount_cents; the tier is the current one when only
-- the billing changes) plus the interval it lands on and the first bill after
-- it, both or neither (check_subscription_pending_billing). Every branch of
-- that CHECK is a boolean, so it never evaluates to NULL. stripe_schedule_id
-- mirrors subscription.schedule and has no CHECK: it lingers past the renewal
-- until the release that follows it.

ALTER TABLE "subscriptions" ADD COLUMN "pending_billing_interval" varchar(10);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "stripe_schedule_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "check_subscription_pending_billing" CHECK (("subscriptions"."pending_billing_interval" IS NULL) = ("subscriptions"."pending_amount_cents" IS NULL) AND ("subscriptions"."pending_billing_interval" IS NULL OR "subscriptions"."pending_tier_id" IS NOT NULL) AND ("subscriptions"."pending_billing_interval" IS NULL OR ("subscriptions"."pending_billing_interval" IN ('month', 'year') AND "subscriptions"."pending_billing_interval" <> "subscriptions"."billing_interval")) AND ("subscriptions"."pending_amount_cents" IS NULL OR "subscriptions"."pending_amount_cents" >= 0));