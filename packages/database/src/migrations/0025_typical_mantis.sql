ALTER TABLE "media_items" DROP CONSTRAINT "status_ready_requires_keys";--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "hls_preview_key" varchar(500);--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "waveform_key" varchar(500);--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "waveform_image_key" varchar(500);--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "runpod_job_id" varchar(255);--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "transcoding_error" text;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "transcoding_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "transcoding_priority" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "mezzanine_key" varchar(500);--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "mezzanine_status" varchar(50);--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "ready_variants" jsonb;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "loudness_integrated" integer;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "loudness_peak" integer;--> statement-breakpoint
ALTER TABLE "media_items" ADD COLUMN "loudness_range" integer;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "check_mezzanine_status" CHECK ("media_items"."mezzanine_status" IS NULL OR "media_items"."mezzanine_status" IN ('pending', 'processing', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "check_transcoding_priority" CHECK ("media_items"."transcoding_priority" >= 0 AND "media_items"."transcoding_priority" <= 4);--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "status_ready_requires_keys" CHECK ("media_items"."status" != 'ready' OR (
        "media_items"."hls_master_playlist_key" IS NOT NULL
        AND "media_items"."duration_seconds" IS NOT NULL
        AND (
          ("media_items"."media_type" = 'video' AND "media_items"."thumbnail_key" IS NOT NULL)
          OR ("media_items"."media_type" = 'audio' AND "media_items"."waveform_key" IS NOT NULL)
        )
      ));