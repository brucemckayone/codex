CREATE TYPE "public"."email_send_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TABLE "email_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"creator_id" text,
	"template_name" varchar(100) NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"status" "email_send_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_audit_logs" ADD CONSTRAINT "email_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_audit_logs" ADD CONSTRAINT "email_audit_logs_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;