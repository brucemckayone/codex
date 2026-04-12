ALTER TABLE "users" DROP CONSTRAINT "users_username_unique";--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_slug_unique";--> statement-breakpoint
ALTER TABLE "subscription_tiers" DROP CONSTRAINT "uq_subscription_tiers_org_sort";--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT "check_content_visibility";--> statement-breakpoint
DROP INDEX "idx_unique_content_slug_per_org";--> statement-breakpoint
DROP INDEX "idx_unique_content_slug_personal";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_username" ON "users" USING btree ("username") WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_org_slug" ON "organizations" USING btree ("slug") WHERE "organizations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_purchases_customer_status_content" ON "purchases" USING btree ("customer_id","status","content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subscription_tiers_org_sort" ON "subscription_tiers" USING btree ("organization_id","sort_order") WHERE "subscription_tiers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_active_subscription_per_user_org" ON "subscriptions" USING btree ("user_id","organization_id") WHERE "subscriptions"."status" IN ('active', 'past_due', 'cancelling');--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_content_slug_per_org" ON "content" USING btree ("slug","organization_id") WHERE "content"."organization_id" IS NOT NULL AND "content"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_content_slug_personal" ON "content" USING btree ("slug","creator_id") WHERE "content"."organization_id" IS NULL AND "content"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "content" DROP COLUMN "visibility";