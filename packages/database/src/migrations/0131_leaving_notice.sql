CREATE TABLE "content_leaving_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"round" timestamp (3) with time zone NOT NULL,
	"state" varchar(20) DEFAULT 'due' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_reason" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_content_leaving_notices_kind" CHECK ("content_leaving_notices"."kind" IN ('leaving', 'reminder', 'staying', 'removed')),
	CONSTRAINT "check_content_leaving_notices_state" CHECK ("content_leaving_notices"."state" IN ('due', 'sent', 'failed', 'unknown', 'cancelled', 'abandoned')),
	CONSTRAINT "check_content_leaving_notices_reason" CHECK ("content_leaving_notices"."last_reason" IS NULL OR "content_leaving_notices"."last_reason" IN ('refused', 'skipped', 'no_address', 'unknown')),
	CONSTRAINT "check_content_leaving_notices_attempts" CHECK ("content_leaving_notices"."attempts" >= 0),
	CONSTRAINT "check_content_leaving_notices_sent" CHECK (("content_leaving_notices"."state" IN ('sent')) = ("content_leaving_notices"."sent_at" IS NOT NULL)),
	CONSTRAINT "check_content_leaving_notices_tried" CHECK ("content_leaving_notices"."state" NOT IN ('failed', 'unknown', 'abandoned') OR ("content_leaving_notices"."attempts" > 0 AND "content_leaving_notices"."last_reason" IS NOT NULL)),
	CONSTRAINT "check_content_leaving_notices_cancelled" CHECK ("content_leaving_notices"."state" NOT IN ('cancelled') OR "content_leaving_notices"."kind" IN ('leaving', 'reminder', 'staying'))
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "leaves_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "owners_can_download" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "content_leaving_notices" ADD CONSTRAINT "content_leaving_notices_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_leaving_notices" ADD CONSTRAINT "content_leaving_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_content_leaving_notices_person" ON "content_leaving_notices" USING btree ("content_id","kind","round","user_id");--> statement-breakpoint
CREATE INDEX "idx_content_leaving_notices_open" ON "content_leaving_notices" USING btree ("created_at","id") WHERE "content_leaving_notices"."state" IN ('due', 'failed', 'unknown');--> statement-breakpoint
CREATE INDEX "idx_content_leaving_notices_user" ON "content_leaving_notices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_content_leaving" ON "content" USING btree ("leaves_at") WHERE "content"."leaves_at" IS NOT NULL AND "content"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "check_content_leaving_not_published" CHECK ("content"."leaves_at" IS NULL OR "content"."status" <> 'published');--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "check_content_leaving_not_scheduled" CHECK ("content"."leaves_at" IS NULL OR "content"."publish_requested_at" IS NULL);