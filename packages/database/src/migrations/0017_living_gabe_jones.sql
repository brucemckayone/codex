CREATE TYPE "public"."template_scope" AS ENUM('global', 'organization', 'creator');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"scope" "template_scope" NOT NULL,
	"organization_id" uuid,
	"creator_id" text,
	"created_by" text,
	"subject" varchar(500) NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text NOT NULL,
	"description" text,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_templates_org_id" ON "email_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_email_templates_creator_id" ON "email_templates" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_email_templates_scope" ON "email_templates" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "idx_email_templates_status" ON "email_templates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_template_global" ON "email_templates" USING btree ("name") WHERE "email_templates"."scope" = 'global' AND "email_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_template_org" ON "email_templates" USING btree ("name","organization_id") WHERE "email_templates"."scope" = 'organization' AND "email_templates"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_template_creator" ON "email_templates" USING btree ("name","creator_id") WHERE "email_templates"."scope" = 'creator' AND "email_templates"."deleted_at" IS NULL;