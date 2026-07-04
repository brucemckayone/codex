CREATE TABLE "creator_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"current_step" text DEFAULT 'essentials' NOT NULL,
	"welcome_seen_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_onboarding" ADD CONSTRAINT "creator_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;