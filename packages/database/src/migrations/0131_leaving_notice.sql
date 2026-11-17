CREATE TABLE "content_leaving_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"round" timestamp with time zone NOT NULL,
	"state" varchar(20) DEFAULT 'due' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_content_leaving_notices_kind" CHECK ("content_leaving_notices"."kind" IN ('leaving', 'reminder', 'staying', 'removed')),
	CONSTRAINT "check_content_leaving_notices_state" CHECK ("content_leaving_notices"."state" IN ('due', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "check_content_leaving_notices_attempts" CHECK ("content_leaving_notices"."attempts" >= 0),
	CONSTRAINT "check_content_leaving_notices_sent" CHECK (("content_leaving_notices"."state" = 'sent') = ("content_leaving_notices"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "leaves_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "owners_can_download" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "content_leaving_notices" ADD CONSTRAINT "content_leaving_notices_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_leaving_notices" ADD CONSTRAINT "content_leaving_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_content_leaving_notices_person" ON "content_leaving_notices" USING btree ("content_id","user_id","kind","round");--> statement-breakpoint
CREATE INDEX "idx_content_leaving_notices_open" ON "content_leaving_notices" USING btree ("state","created_at") WHERE "content_leaving_notices"."state" IN ('due', 'failed');--> statement-breakpoint
CREATE INDEX "idx_content_leaving_notices_content" ON "content_leaving_notices" USING btree ("content_id","kind");--> statement-breakpoint
CREATE INDEX "idx_content_leaving" ON "content" USING btree ("leaves_at") WHERE "content"."leaves_at" IS NOT NULL AND "content"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "check_content_leaving_not_published" CHECK ("content"."leaves_at" IS NULL OR "content"."status" <> 'published');