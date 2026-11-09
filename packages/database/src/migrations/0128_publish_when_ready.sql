ALTER TABLE "content" ADD COLUMN "publish_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "publish_blocked_reason" varchar(50);--> statement-breakpoint
CREATE INDEX "idx_content_publish_requested_media" ON "content" USING btree ("media_item_id") WHERE "content"."publish_requested_at" IS NOT NULL AND "content"."deleted_at" IS NULL;