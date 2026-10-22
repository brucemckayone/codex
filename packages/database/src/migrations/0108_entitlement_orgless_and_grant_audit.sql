ALTER TABLE "entitlements" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "granted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "revoked_by_user_id" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;