-- This migration was created before 0025 (which adds transcoding_attempts column)
-- and 0026 (which adds the constraint). Skip if constraint/column doesn't exist.
-- The constraint will be properly set up by 0026 and fixed by 0027.

DO $$
BEGIN
    -- Only attempt to modify constraint if it exists (for previously migrated databases)
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'check_max_transcoding_attempts'
        AND table_name = 'media_items'
    ) THEN
        ALTER TABLE "media_items" DROP CONSTRAINT "check_max_transcoding_attempts";
        ALTER TABLE "media_items" ADD CONSTRAINT "check_max_transcoding_attempts"
            CHECK ("media_items"."transcoding_attempts" >= 0 AND "media_items"."transcoding_attempts" <= 3);
    END IF;

    -- Only create index if column exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'media_items'
        AND column_name = 'transcoding_attempts'
    ) THEN
        CREATE INDEX IF NOT EXISTS "idx_media_items_transcoding_status"
            ON "media_items" ("status", "transcoding_attempts");
    END IF;
END $$;
