ALTER TABLE "content" ADD COLUMN "access_type" varchar(50) DEFAULT 'free' NOT NULL;--> statement-breakpoint
-- Data migration: derive access_type from existing visibility + priceCents + minimumTierId
UPDATE "content" SET "access_type" = CASE
  WHEN "minimum_tier_id" IS NOT NULL THEN 'subscribers'
  WHEN "price_cents" IS NOT NULL AND "price_cents" > 0 THEN 'paid'
  WHEN "visibility" = 'members_only' THEN 'members'
  ELSE 'free'
END;--> statement-breakpoint
CREATE INDEX "idx_content_access_type" ON "content" USING btree ("access_type");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "check_content_access_type" CHECK ("content"."access_type" IN ('free', 'paid', 'subscribers', 'members'));