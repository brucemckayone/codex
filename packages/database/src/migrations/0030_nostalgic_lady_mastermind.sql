CREATE TABLE "notification_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email_marketing" boolean DEFAULT true NOT NULL,
	"email_transactional" boolean DEFAULT true NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_settings" ADD COLUMN "twitter_url" text;--> statement-breakpoint
ALTER TABLE "contact_settings" ADD COLUMN "youtube_url" text;--> statement-breakpoint
ALTER TABLE "contact_settings" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "contact_settings" ADD COLUMN "tiktok_url" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;