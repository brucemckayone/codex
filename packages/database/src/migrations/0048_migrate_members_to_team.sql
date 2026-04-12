-- Data migration: convert all content with access_type='members' to 'team'
-- This is safe because the backend already handles both values identically
-- (both route to the management-only access check)
UPDATE "content" SET "access_type" = 'team' WHERE "access_type" = 'members';

--> statement-breakpoint

-- Narrow the CHECK constraint to remove deprecated 'members' value
ALTER TABLE "content" DROP CONSTRAINT IF EXISTS "check_content_access_type";

--> statement-breakpoint

ALTER TABLE "content" ADD CONSTRAINT "check_content_access_type"
  CHECK ("content"."access_type" IN ('free', 'paid', 'followers', 'subscribers', 'team'));
