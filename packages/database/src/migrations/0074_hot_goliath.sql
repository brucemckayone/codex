ALTER TABLE "stripe_connect_accounts" DROP CONSTRAINT "uq_stripe_connect_user_org";--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" DROP CONSTRAINT "stripe_connect_accounts_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "idx_stripe_connect_user_id";--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "stripe_connect_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "uq_stripe_connect_user" UNIQUE("user_id");