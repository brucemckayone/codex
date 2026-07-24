ALTER TABLE "course_tier_access" DROP CONSTRAINT "course_tier_access_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "course_tier_access" DROP CONSTRAINT "course_tier_access_tier_id_subscription_tiers_id_fk";
--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "content_id" DROP NOT NULL;--> statement-breakpoint
-- Add course_tier_access.organization_id nullable, backfill it from the owning
-- course, then enforce NOT NULL. The join table pre-dates this column (WP-1),
-- so a bare `ADD COLUMN ... NOT NULL` fails on existing rows. Backfilling from
-- the COURSE is the correct semantic (the org that owns the course); the tier
-- composite FK below then verifies the tier lives in that SAME org — any
-- pre-existing cross-org grant surfaces here as an FK violation (the N1
-- guarantee doing its job) rather than being silently admitted.
ALTER TABLE "course_tier_access" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "course_tier_access" cta SET "organization_id" = c."organization_id" FROM "courses" c WHERE cta."course_id" = c."id";--> statement-breakpoint
ALTER TABLE "course_tier_access" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "course_subscription_id" uuid;--> statement-breakpoint
-- Parent unique indexes MUST exist before the composite FKs that reference
-- them (Postgres requires a matching unique constraint/index on the referenced
-- columns at FK-creation time). drizzle-kit emitted the CREATE INDEX after the
-- ADD CONSTRAINT; reordered here so the migration applies cleanly.
CREATE UNIQUE INDEX "uq_courses_id_org" ON "courses" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_tiers_id_org" ON "subscription_tiers" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "course_tier_access" ADD CONSTRAINT "fk_course_tier_access_course_org" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tier_access" ADD CONSTRAINT "fk_course_tier_access_tier_org" FOREIGN KEY ("tier_id","organization_id") REFERENCES "public"."subscription_tiers"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_course_subscription_id_course_subscriptions_id_fk" FOREIGN KEY ("course_subscription_id") REFERENCES "public"."course_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_course_tier_access_org_id" ON "course_tier_access" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_course_id" ON "purchases" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entitlement_live_content" ON "entitlements" USING btree ("user_id","content_id","source") WHERE "entitlements"."revoked_at" IS NULL AND "entitlements"."content_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_entitlement_live_course" ON "entitlements" USING btree ("user_id","course_id","source") WHERE "entitlements"."revoked_at" IS NULL AND "entitlements"."course_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payouts_course_subscription" ON "payouts" USING btree ("course_subscription_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_purchase_target_one" CHECK ((CASE WHEN "purchases"."content_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "purchases"."course_id" IS NULL THEN 0 ELSE 1 END) = 1);--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_source_ref_one" CHECK ((CASE WHEN "payouts"."subscription_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "payouts"."purchase_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "payouts"."course_subscription_id" IS NULL THEN 0 ELSE 1 END) <= 1);
