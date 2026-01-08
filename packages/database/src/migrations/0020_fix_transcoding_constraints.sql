-- Drop old constraint restricted to 1 attempt
ALTER TABLE "media_items" DROP CONSTRAINT "check_max_transcoding_attempts";

-- Add new constraint allowing up to 3 attempts
ALTER TABLE "media_items" ADD CONSTRAINT "check_max_transcoding_attempts" CHECK ("media_items"."transcoding_attempts" >= 0 AND "media_items"."transcoding_attempts" <= 3);

-- Add index for efficient polling/retry queries
CREATE INDEX IF NOT EXISTS "idx_media_items_transcoding_status" ON "media_items" ("status", "transcoding_attempts");
