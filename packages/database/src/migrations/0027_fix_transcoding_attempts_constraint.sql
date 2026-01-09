-- Fix for migration 0026 which incorrectly set transcoding_attempts <= 1
-- Schema expects <= 3 to allow up to 3 retries
-- See: packages/database/src/schema/content.ts line 212-215

-- Drop the incorrect constraint from 0026
ALTER TABLE "media_items" DROP CONSTRAINT "check_max_transcoding_attempts";-->statement-breakpoint
-- Add correct constraint matching schema (allows 3 retries)
ALTER TABLE "media_items" ADD CONSTRAINT "check_max_transcoding_attempts" CHECK ("media_items"."transcoding_attempts" >= 0 AND "media_items"."transcoding_attempts" <= 3);
