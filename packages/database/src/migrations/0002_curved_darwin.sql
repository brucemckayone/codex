CREATE TABLE IF NOT EXISTS "content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"organization_id" uuid,
	"media_item_id" uuid,
	"title" varchar(500) NOT NULL,
	"slug" varchar(500) NOT NULL,
	"description" text,
	"content_type" varchar(50) NOT NULL,
	"thumbnail_url" text,
	"content_body" text,
	"category" varchar(100),
	"tags" jsonb DEFAULT '[]'::jsonb,
	"visibility" varchar(50) DEFAULT 'purchased_only' NOT NULL,
	"price_cents" integer,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"purchase_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "check_content_status" CHECK ("content"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "check_content_visibility" CHECK ("content"."visibility" IN ('public', 'private', 'members_only', 'purchased_only')),
	CONSTRAINT "check_content_type" CHECK ("content"."content_type" IN ('video', 'audio', 'written')),
	CONSTRAINT "check_price_non_negative" CHECK ("content"."price_cents" IS NULL OR "content"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"media_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'uploading' NOT NULL,
	"r2_key" varchar(500) NOT NULL,
	"file_size_bytes" bigint,
	"mime_type" varchar(100),
	"duration_seconds" integer,
	"width" integer,
	"height" integer,
	"hls_master_playlist_key" varchar(500),
	"thumbnail_key" varchar(500),
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "check_media_status" CHECK ("media_items"."status" IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')),
	CONSTRAINT "check_media_type" CHECK ("media_items"."media_type" IN ('video', 'audio'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"logo_url" text,
	"website_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content" ADD CONSTRAINT "content_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content" ADD CONSTRAINT "content_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "media_items" ADD CONSTRAINT "media_items_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_creator_id" ON "content" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_organization_id" ON "content" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_media_item_id" ON "content" USING btree ("media_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_slug_org" ON "content" USING btree ("slug","organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_status" ON "content" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_published_at" ON "content" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_category" ON "content" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_content_slug_per_org" ON "content" USING btree ("slug","organization_id") WHERE "content"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_unique_content_slug_personal" ON "content" USING btree ("slug","creator_id") WHERE "content"."organization_id" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_items_creator_id" ON "media_items" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_items_status" ON "media_items" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_media_items_type" ON "media_items" USING btree ("creator_id","media_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_organizations_slug" ON "organizations" USING btree ("slug");