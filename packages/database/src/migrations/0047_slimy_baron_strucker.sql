CREATE TABLE "organization_followers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content" DROP CONSTRAINT "check_content_access_type";--> statement-breakpoint
ALTER TABLE "organization_followers" ADD CONSTRAINT "organization_followers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_followers" ADD CONSTRAINT "organization_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_org_follower" ON "organization_followers" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_followers_org" ON "organization_followers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_followers_user" ON "organization_followers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "check_content_access_type" CHECK ("content"."access_type" IN ('free', 'paid', 'subscribers', 'members', 'followers', 'team'));