CREATE TABLE "content_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"access_type" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"amount_paid_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_playback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "video_playback_user_id_content_id_unique" UNIQUE("user_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_playback" ADD CONSTRAINT "video_playback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_playback" ADD CONSTRAINT "video_playback_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_access_user_id" ON "content_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_content_access_content_id" ON "content_access" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_customer_id" ON "purchases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_content_id" ON "purchases" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_video_playback_user_id" ON "video_playback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_video_playback_content_id" ON "video_playback" USING btree ("content_id");