CREATE TABLE "organization_ownership_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"offered_by_user_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"withdrawn_reason" varchar(32),
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_ownership_offer_status" CHECK ("organization_ownership_offers"."status" IN ('open', 'accepted', 'declined', 'withdrawn', 'expired')),
	CONSTRAINT "check_ownership_offer_withdrawn_reason" CHECK (("organization_ownership_offers"."status" = 'withdrawn') = ("organization_ownership_offers"."withdrawn_reason" IS NOT NULL) AND ("organization_ownership_offers"."withdrawn_reason" IS NULL OR "organization_ownership_offers"."withdrawn_reason" IN ('owner_cancelled', 'recipient_ineligible', 'support_reassigned'))),
	CONSTRAINT "check_ownership_offer_not_self" CHECK ("organization_ownership_offers"."recipient_user_id" <> "organization_ownership_offers"."offered_by_user_id")
);
--> statement-breakpoint
CREATE TABLE "organization_ownership_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"source" varchar(16) NOT NULL,
	"offer_id" uuid,
	CONSTRAINT "check_ownership_period_source" CHECK ("organization_ownership_periods"."source" IN ('created', 'transfer', 'support', 'backfill')),
	CONSTRAINT "check_ownership_period_order" CHECK ("organization_ownership_periods"."ended_at" IS NULL OR "organization_ownership_periods"."ended_at" >= "organization_ownership_periods"."started_at")
);
--> statement-breakpoint
ALTER TABLE "organization_ownership_offers" ADD CONSTRAINT "organization_ownership_offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ownership_offers" ADD CONSTRAINT "organization_ownership_offers_offered_by_user_id_users_id_fk" FOREIGN KEY ("offered_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ownership_offers" ADD CONSTRAINT "organization_ownership_offers_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ownership_periods" ADD CONSTRAINT "organization_ownership_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ownership_periods" ADD CONSTRAINT "organization_ownership_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_ownership_periods" ADD CONSTRAINT "organization_ownership_periods_offer_id_organization_ownership_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."organization_ownership_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ownership_offers_one_open" ON "organization_ownership_offers" USING btree ("organization_id") WHERE "organization_ownership_offers"."status" = 'open';--> statement-breakpoint
CREATE INDEX "idx_ownership_offers_recipient_open" ON "organization_ownership_offers" USING btree ("recipient_user_id") WHERE "organization_ownership_offers"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ownership_periods_one_open" ON "organization_ownership_periods" USING btree ("organization_id") WHERE "organization_ownership_periods"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_ownership_periods_org_started" ON "organization_ownership_periods" USING btree ("organization_id","started_at");--> statement-breakpoint
-- Codex-2hxff.2 — one owner per organisation.
-- R1: an organisation with more than one ACTIVE owner keeps its earliest-joined
-- one (today's money resolver tiebreak, so nobody's payouts change) and the
-- rest become admins. Must run before the unique index below can be created.
UPDATE "organization_memberships" AS m
SET "role" = 'admin', "updated_at" = now()
WHERE m."role" = 'owner'
  AND m."status" = 'active'
  AND m."id" <> (
    SELECT m2."id"
    FROM "organization_memberships" AS m2
    WHERE m2."organization_id" = m."organization_id"
      AND m2."role" = 'owner'
      AND m2."status" = 'active'
    ORDER BY m2."created_at" ASC, m2."id" ASC
    LIMIT 1
  );--> statement-breakpoint
CREATE UNIQUE INDEX "uq_org_memberships_one_active_owner" ON "organization_memberships" USING btree ("organization_id") WHERE "organization_memberships"."role" = 'owner' AND "organization_memberships"."status" = 'active';--> statement-breakpoint
-- Backfill: one open ownership period per organisation that has an active
-- owner, from the organisation's creation. Organisations with no active owner
-- get none (report R2 — support reassigns them); their money is pending today.
INSERT INTO "organization_ownership_periods" ("organization_id", "user_id", "started_at", "source")
SELECT o."id", m."user_id", o."created_at", 'backfill'
FROM "organizations" AS o
JOIN "organization_memberships" AS m
  ON m."organization_id" = o."id"
 AND m."role" = 'owner'
 AND m."status" = 'active';
