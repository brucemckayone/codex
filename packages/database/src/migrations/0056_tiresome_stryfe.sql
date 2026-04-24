ALTER TABLE "organizations" ADD COLUMN "primary_connect_account_user_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_primary_connect_account_user_id_users_id_fk" FOREIGN KEY ("primary_connect_account_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: for each org, pick the oldest active Connect account as the
-- canonical owner. Prefers 'active' status, then falls back to the oldest
-- row by created_at. Runs once on migrate; future onboarding writes the
-- column directly so this is the only place this heuristic applies.
UPDATE "organizations" o
SET "primary_connect_account_user_id" = (
  SELECT sca."user_id"
  FROM "stripe_connect_accounts" sca
  WHERE sca."organization_id" = o."id"
  ORDER BY
    CASE WHEN sca."status" = 'active' THEN 0 ELSE 1 END,
    sca."created_at" ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM "stripe_connect_accounts" sca
  WHERE sca."organization_id" = o."id"
);