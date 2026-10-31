-- Media delete keeps the files for 30 days (Codex-6sbn1). ADDITIVE: two
-- nullable columns and one partial index; old code never reads them, so this
-- applies safely before the workers deploy. No backfill: rows soft-deleted
-- before this lost their files to the old immediate sweep, and keep
-- files_purge_after NULL so the purge never lists them.
--
-- Hand-ordered. Numbered 0121: plan access (Codex-2hxff.91) took 0120.

-- 1. When the purge may remove the files (set by the delete to deleted_at +
--    30 days; support may move it), and when the purge claimed the row
--    (restore is refused from then on).
ALTER TABLE "media_items" ADD COLUMN "files_purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "files_purged_at" timestamp with time zone;--> statement-breakpoint

-- 2. The purge's due list: deleted, files kept, window set.
CREATE INDEX "idx_media_items_files_purge_due" ON "media_items" USING btree ("files_purge_after") WHERE "media_items"."deleted_at" IS NOT NULL AND "media_items"."files_purged_at" IS NULL AND "media_items"."files_purge_after" IS NOT NULL;
