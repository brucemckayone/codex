CREATE TABLE "orphaned_image_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"r2_key" varchar(500) NOT NULL,
	"image_type" varchar(50) NOT NULL,
	"original_entity_id" varchar(255),
	"original_entity_type" varchar(50),
	"orphaned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"file_size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_image_type" CHECK ("orphaned_image_files"."image_type" IN ('avatar', 'logo', 'content_thumbnail', 'transcoding_artifact')),
	CONSTRAINT "check_entity_type" CHECK ("orphaned_image_files"."original_entity_type" IS NULL OR "orphaned_image_files"."original_entity_type" IN ('user', 'organization', 'content', 'media_item')),
	CONSTRAINT "check_orphan_status" CHECK ("orphaned_image_files"."status" IN ('pending', 'deleted', 'failed', 'retained')),
	CONSTRAINT "check_cleanup_attempts" CHECK ("orphaned_image_files"."cleanup_attempts" >= 0 AND "orphaned_image_files"."cleanup_attempts" <= 10)
);
--> statement-breakpoint
CREATE INDEX "idx_orphaned_files_status" ON "orphaned_image_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_orphaned_files_orphaned_at" ON "orphaned_image_files" USING btree ("orphaned_at");--> statement-breakpoint
CREATE INDEX "idx_orphaned_files_type_status" ON "orphaned_image_files" USING btree ("image_type","status");--> statement-breakpoint
CREATE INDEX "idx_orphaned_files_pending_cleanup" ON "orphaned_image_files" USING btree ("status","orphaned_at");