ALTER TABLE "media_items" ADD COLUMN "transcoding_error_code" varchar(50);--> statement-breakpoint
-- Backfill uploaded_at (Codex-l2c48.3). The only app writer is
-- MediaService.markAsReady (the READY time), and only tests call it: the
-- RunPod webhook marks rows ready through TranscodingService. So it is NULL on
-- production rows (checked 2026-10-23); seed scripts do set it. The
-- maintenance cron (Codex-l2c48.5) gives up on an upload 24 h after
-- uploaded_at, so:
--   uploaded: waiting now (often stranded by the old dispatch). now() gives
--             each one a full 24 h under the new pipeline, which re-dispatches
--             it, instead of an already-expired clock that would fail it on
--             the cron's first run.
--   others:   created_at, the closest value there is, never later than the
--             real upload.
-- Rows still `uploading` keep NULL (not uploaded), as do deleted rows.
-- updated_at is left alone on purpose: the cron reads it to find stale rows.
-- Uploads that complete on the old worker between this migration and the
-- worker deploy are NULL again, so the cron must COALESCE(uploaded_at,
-- created_at); this backfill does not close that.
UPDATE "media_items"
SET "uploaded_at" = CASE WHEN "status" = 'uploaded' THEN now() ELSE "created_at" END
WHERE "uploaded_at" IS NULL
  AND "status" <> 'uploading'
  AND "deleted_at" IS NULL;--> statement-breakpoint
-- A failed row always carries a code, so NULL keeps one meaning ("nothing went
-- wrong"). Rows that failed before codes existed get INFRA_ERROR: the cause is
-- unknown, and transcoding_error keeps the detail.
UPDATE "media_items"
SET "transcoding_error_code" = 'INFRA_ERROR'
WHERE "status" = 'failed'
  AND "transcoding_error_code" IS NULL;
