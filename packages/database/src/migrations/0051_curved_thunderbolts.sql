-- Drizzle-generated migration: catches up snapshot chain + adds pricing page columns
-- Some statements may already exist from prior manual migrations (0049-0051);
-- IF NOT EXISTS / IF EXISTS guards make this safe to re-run.

ALTER TABLE "content" DROP CONSTRAINT IF EXISTS "check_content_access_type";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN IF NOT EXISTS "shader_preset" varchar(50);--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN IF NOT EXISTS "shader_config" jsonb;--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN IF NOT EXISTS "hero_layout" varchar(20) DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "branding_settings" ADD COLUMN IF NOT EXISTS "pricing_faq" text;--> statement-breakpoint
ALTER TABLE "subscription_tiers" ADD COLUMN IF NOT EXISTS "is_recommended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_org_published" ON "content" USING btree ("organization_id","status","published_at") WHERE "content"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_creator_org_published" ON "content" USING btree ("creator_id","organization_id","status") WHERE "content"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_org_memberships_org_active_role" ON "organization_memberships" USING btree ("organization_id","status","role") WHERE "organization_memberships"."status" = 'active';--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "check_content_access_type" CHECK ("content"."access_type" IN ('free', 'paid', 'followers', 'subscribers', 'team'));
