CREATE TABLE "course_subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"price_monthly" integer NOT NULL,
	"price_annual" integer NOT NULL,
	"stripe_product_id" varchar(255),
	"stripe_price_monthly_id" varchar(255),
	"stripe_price_annual_id" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "check_course_plan_price_monthly" CHECK ("course_subscription_plans"."price_monthly" >= 0),
	CONSTRAINT "check_course_plan_price_annual" CHECK ("course_subscription_plans"."price_annual" >= 0)
);
--> statement-breakpoint
CREATE TABLE "course_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"organization_id" uuid,
	"stripe_subscription_id" varchar(255) NOT NULL,
	"stripe_customer_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"billing_interval" varchar(10) NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "check_course_subscription_status" CHECK ("course_subscriptions"."status" IN ('active', 'past_due', 'cancelling', 'cancelled', 'incomplete', 'paused')),
	CONSTRAINT "check_course_subscription_billing_interval" CHECK ("course_subscriptions"."billing_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE "course_tier_access" (
	"course_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	CONSTRAINT "course_tier_access_course_id_tier_id_pk" PRIMARY KEY("course_id","tier_id")
);
--> statement-breakpoint
CREATE TABLE "course_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(30) NOT NULL,
	"last_activity_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(30) DEFAULT 'manual' NOT NULL,
	CONSTRAINT "check_practice_completion_source" CHECK ("practice_completions"."source" IN ('manual', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"content_id" uuid,
	"course_id" uuid,
	"source" varchar(30) NOT NULL,
	"source_ref" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "check_entitlement_resource_one" CHECK ((CASE WHEN "entitlements"."content_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "entitlements"."course_id" IS NULL THEN 0 ELSE 1 END) = 1),
	CONSTRAINT "check_entitlement_source" CHECK ("entitlements"."source" IN ('content_purchase', 'course_purchase', 'course_subscription', 'grant'))
);
--> statement-breakpoint
CREATE TABLE "course_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"gloss" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "course_testimonials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"author_name" varchar(255) NOT NULL,
	"author_context" varchar(255),
	"avatar_media_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(500) NOT NULL,
	"kicker" varchar(255),
	"lede" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"guide" jsonb,
	"intro_video_media_id" uuid,
	"preview_video_media_id" uuid,
	"guide_video_media_id" uuid,
	"price_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "check_course_status" CHECK ("courses"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "check_course_price_non_negative" CHECK ("courses"."price_cents" IS NULL OR "courses"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "landing_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"page_type" varchar(30) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(500) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"subject_type" varchar(30),
	"subject_id" uuid,
	"brand_overrides" jsonb,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "check_landing_page_status" CHECK ("landing_pages"."status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "stage_practices" (
	"stage_id" uuid NOT NULL,
	"content_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stage_practices_stage_id_content_id_pk" PRIMARY KEY("stage_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT "check_content_access_type";--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT "content_minimum_tier_id_subscription_tiers_id_fk";
--> statement-breakpoint
DROP INDEX "idx_content_minimum_tier";--> statement-breakpoint
DROP INDEX "idx_content_access_type";--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "is_free" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "is_purchasable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "included_in_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "course_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "is_follower_gated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "is_team_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "course_subscription_plans" ADD CONSTRAINT "course_subscription_plans_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_plan_id_course_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."course_subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tier_access" ADD CONSTRAINT "course_tier_access_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_tier_access" ADD CONSTRAINT "course_tier_access_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_completions" ADD CONSTRAINT "practice_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_completions" ADD CONSTRAINT "practice_completions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_stages" ADD CONSTRAINT "course_stages_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_testimonials" ADD CONSTRAINT "course_testimonials_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_testimonials" ADD CONSTRAINT "course_testimonials_avatar_media_id_media_items_id_fk" FOREIGN KEY ("avatar_media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_intro_video_media_id_media_items_id_fk" FOREIGN KEY ("intro_video_media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_preview_video_media_id_media_items_id_fk" FOREIGN KEY ("preview_video_media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_guide_video_media_id_media_items_id_fk" FOREIGN KEY ("guide_video_media_id") REFERENCES "public"."media_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_practices" ADD CONSTRAINT "stage_practices_stage_id_course_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."course_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_practices" ADD CONSTRAINT "stage_practices_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_course_sub_plans_course_id" ON "course_subscription_plans" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_course_sub_plans_course" ON "course_subscription_plans" USING btree ("course_id") WHERE "course_subscription_plans"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_course_subscriptions_user_id" ON "course_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_course_subscriptions_course_id" ON "course_subscriptions" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_course_subscriptions_plan_id" ON "course_subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_course_subscriptions_stripe_id" ON "course_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_active_course_subscription_per_user_course" ON "course_subscriptions" USING btree ("user_id","course_id") WHERE "course_subscriptions"."status" IN ('active', 'past_due', 'cancelling');--> statement-breakpoint
CREATE INDEX "idx_course_tier_access_tier_id" ON "course_tier_access" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "idx_course_enrollments_user_id" ON "course_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_course_enrollments_course_id" ON "course_enrollments" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_course_enrollment_user_course" ON "course_enrollments" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "idx_practice_completions_user_id" ON "practice_completions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_practice_completions_content_id" ON "practice_completions" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_practice_completion_user_content" ON "practice_completions" USING btree ("user_id","content_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_user_id" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_org_id" ON "entitlements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_content_id" ON "entitlements" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_course_id" ON "entitlements" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_user_content" ON "entitlements" USING btree ("user_id","content_id");--> statement-breakpoint
CREATE INDEX "idx_entitlements_user_course" ON "entitlements" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE INDEX "idx_course_stages_course_id" ON "course_stages" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_course_stages_course_sort" ON "course_stages" USING btree ("course_id","sort_order") WHERE "course_stages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_course_testimonials_course_id" ON "course_testimonials" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "idx_courses_org_id" ON "courses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_courses_creator_id" ON "courses" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_courses_org_status" ON "courses" USING btree ("organization_id","status","published_at") WHERE "courses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_courses_org_slug" ON "courses" USING btree ("organization_id","slug") WHERE "courses"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_landing_pages_org_id" ON "landing_pages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_landing_pages_creator_id" ON "landing_pages" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_landing_pages_subject" ON "landing_pages" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_landing_pages_org_status" ON "landing_pages" USING btree ("organization_id","status","published_at") WHERE "landing_pages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_landing_pages_org_slug" ON "landing_pages" USING btree ("organization_id","slug") WHERE "landing_pages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_stage_practices_content_id" ON "stage_practices" USING btree ("content_id");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_included_in_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("included_in_tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_included_in_tier" ON "content" USING btree ("included_in_tier_id");--> statement-breakpoint
ALTER TABLE "content" DROP COLUMN "access_type";--> statement-breakpoint
ALTER TABLE "content" DROP COLUMN "minimum_tier_id";