CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
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
CREATE TABLE "media_items" (
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
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_membership_role" CHECK ("organization_memberships"."role" IN ('owner', 'admin', 'creator', 'subscriber', 'member')),
	CONSTRAINT "check_membership_status" CHECK ("organization_memberships"."status" IN ('active', 'inactive', 'invited'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
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
CREATE TABLE "test_table" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_table_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_items" ADD CONSTRAINT "media_items_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_creator_id" ON "content" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_content_organization_id" ON "content" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_content_media_item_id" ON "content" USING btree ("media_item_id");--> statement-breakpoint
CREATE INDEX "idx_content_slug_org" ON "content" USING btree ("slug","organization_id");--> statement-breakpoint
CREATE INDEX "idx_content_status" ON "content" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_content_published_at" ON "content" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_content_category" ON "content" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_content_slug_per_org" ON "content" USING btree ("slug","organization_id") WHERE "content"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_content_slug_personal" ON "content" USING btree ("slug","creator_id") WHERE "content"."organization_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_media_items_creator_id" ON "media_items" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_media_items_status" ON "media_items" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "idx_media_items_type" ON "media_items" USING btree ("creator_id","media_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_org_membership" ON "organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_org_id" ON "organization_memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_user_id" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_role" ON "organization_memberships" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_status" ON "organization_memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_organizations_slug" ON "organizations" USING btree ("slug");