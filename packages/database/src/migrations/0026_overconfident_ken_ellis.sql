ALTER TABLE "media_items" ALTER COLUMN "transcoding_error" SET DATA TYPE varchar(2000);--> statement-breakpoint
CREATE INDEX "idx_media_items_runpod_job_id" ON "media_items" USING btree ("runpod_job_id");--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "check_max_transcoding_attempts" CHECK ("media_items"."transcoding_attempts" >= 0 AND "media_items"."transcoding_attempts" <= 1);