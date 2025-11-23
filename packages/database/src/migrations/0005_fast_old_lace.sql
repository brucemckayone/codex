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
CREATE TABLE "content_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"access_type" varchar(50) NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_access_user_content_unique" UNIQUE("user_id","content_id"),
	CONSTRAINT "check_access_type" CHECK ("content_access"."access_type" IN ('purchased', 'subscription', 'complimentary', 'preview'))
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"amount_paid_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'usd' NOT NULL,
	"stripe_payment_intent_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "check_purchase_status" CHECK ("purchases"."status" IN ('pending', 'completed', 'refunded', 'failed')),
	CONSTRAINT "check_amount_positive" CHECK ("purchases"."amount_paid_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "video_playback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"content_id" uuid NOT NULL,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_playback_user_id_content_id_unique" UNIQUE("user_id","content_id")
);
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_access" ADD CONSTRAINT "content_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_playback" ADD CONSTRAINT "video_playback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_playback" ADD CONSTRAINT "video_playback_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_org_membership" ON "organization_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_org_id" ON "organization_memberships" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_user_id" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_role" ON "organization_memberships" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "idx_org_memberships_status" ON "organization_memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_content_access_user_id" ON "content_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_content_access_content_id" ON "content_access" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_content_access_organization_id" ON "content_access" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_customer_id" ON "purchases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_content_id" ON "purchases" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_organization_id" ON "purchases" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_stripe_payment_intent" ON "purchases" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_created_at" ON "purchases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_video_playback_user_id" ON "video_playback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_video_playback_content_id" ON "video_playback" USING btree ("content_id");