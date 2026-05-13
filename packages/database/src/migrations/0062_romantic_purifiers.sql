CREATE TABLE "fee_config_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"scope_org_id" uuid,
	"scope_creator_id" text,
	"column_name" text NOT NULL,
	"old_value" text,
	"new_value" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_fee_config_audit_scope" CHECK ("fee_config_audit_log"."scope" IN ('platform', 'org', 'override')),
	CONSTRAINT "check_fee_config_audit_scope_org_id" CHECK (("fee_config_audit_log"."scope" = 'platform' AND "fee_config_audit_log"."scope_org_id" IS NULL AND "fee_config_audit_log"."scope_creator_id" IS NULL)
        OR ("fee_config_audit_log"."scope" = 'org' AND "fee_config_audit_log"."scope_org_id" IS NOT NULL AND "fee_config_audit_log"."scope_creator_id" IS NULL)
        OR ("fee_config_audit_log"."scope" = 'override' AND "fee_config_audit_log"."scope_org_id" IS NOT NULL AND "fee_config_audit_log"."scope_creator_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fee_config_org" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"platform_fee_percent" integer,
	"org_fee_percent" integer,
	"min_platform_fee_cents" integer,
	"min_transfer_cents" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "check_org_platform_fee_percent_bps" CHECK ("fee_config_org"."platform_fee_percent" IS NULL OR ("fee_config_org"."platform_fee_percent" >= 0 AND "fee_config_org"."platform_fee_percent" <= 10000)),
	CONSTRAINT "check_org_org_fee_percent_bps" CHECK ("fee_config_org"."org_fee_percent" IS NULL OR ("fee_config_org"."org_fee_percent" >= 0 AND "fee_config_org"."org_fee_percent" <= 10000)),
	CONSTRAINT "check_org_min_platform_fee_non_negative" CHECK ("fee_config_org"."min_platform_fee_cents" IS NULL OR "fee_config_org"."min_platform_fee_cents" >= 0),
	CONSTRAINT "check_org_min_transfer_non_negative" CHECK ("fee_config_org"."min_transfer_cents" IS NULL OR "fee_config_org"."min_transfer_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_config_org_creator" (
	"organization_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"platform_fee_percent" integer,
	"org_fee_percent" integer,
	"min_platform_fee_cents" integer,
	"min_transfer_cents" integer,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "fee_config_org_creator_pkey" PRIMARY KEY("organization_id","creator_id"),
	CONSTRAINT "check_override_platform_fee_percent_bps" CHECK ("fee_config_org_creator"."platform_fee_percent" IS NULL OR ("fee_config_org_creator"."platform_fee_percent" >= 0 AND "fee_config_org_creator"."platform_fee_percent" <= 10000)),
	CONSTRAINT "check_override_org_fee_percent_bps" CHECK ("fee_config_org_creator"."org_fee_percent" IS NULL OR ("fee_config_org_creator"."org_fee_percent" >= 0 AND "fee_config_org_creator"."org_fee_percent" <= 10000)),
	CONSTRAINT "check_override_min_platform_fee_non_negative" CHECK ("fee_config_org_creator"."min_platform_fee_cents" IS NULL OR "fee_config_org_creator"."min_platform_fee_cents" >= 0),
	CONSTRAINT "check_override_min_transfer_non_negative" CHECK ("fee_config_org_creator"."min_transfer_cents" IS NULL OR "fee_config_org_creator"."min_transfer_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_config_platform" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"platform_fee_percent" integer NOT NULL,
	"subscription_org_fee_percent" integer NOT NULL,
	"one_off_org_fee_percent" integer NOT NULL,
	"min_platform_fee_cents" integer NOT NULL,
	"min_transfer_cents" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "check_fee_config_platform_singleton" CHECK ("fee_config_platform"."id" = 'singleton'),
	CONSTRAINT "check_platform_fee_percent_bps" CHECK ("fee_config_platform"."platform_fee_percent" >= 0 AND "fee_config_platform"."platform_fee_percent" <= 10000),
	CONSTRAINT "check_subscription_org_fee_percent_bps" CHECK ("fee_config_platform"."subscription_org_fee_percent" >= 0 AND "fee_config_platform"."subscription_org_fee_percent" <= 10000),
	CONSTRAINT "check_one_off_org_fee_percent_bps" CHECK ("fee_config_platform"."one_off_org_fee_percent" >= 0 AND "fee_config_platform"."one_off_org_fee_percent" <= 10000),
	CONSTRAINT "check_min_platform_fee_non_negative" CHECK ("fee_config_platform"."min_platform_fee_cents" >= 0),
	CONSTRAINT "check_min_transfer_non_negative" CHECK ("fee_config_platform"."min_transfer_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pending_payouts" DROP CONSTRAINT "check_pending_payout_reason";--> statement-breakpoint
ALTER TABLE "fee_config_audit_log" ADD CONSTRAINT "fee_config_audit_log_scope_org_id_organizations_id_fk" FOREIGN KEY ("scope_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_audit_log" ADD CONSTRAINT "fee_config_audit_log_scope_creator_id_users_id_fk" FOREIGN KEY ("scope_creator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_audit_log" ADD CONSTRAINT "fee_config_audit_log_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_org" ADD CONSTRAINT "fee_config_org_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_org" ADD CONSTRAINT "fee_config_org_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_org_creator" ADD CONSTRAINT "fee_config_org_creator_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_org_creator" ADD CONSTRAINT "fee_config_org_creator_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_org_creator" ADD CONSTRAINT "fee_config_org_creator_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_platform" ADD CONSTRAINT "fee_config_platform_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fee_config_audit_scope" ON "fee_config_audit_log" USING btree ("scope","changed_at");--> statement-breakpoint
CREATE INDEX "idx_fee_config_audit_org" ON "fee_config_audit_log" USING btree ("scope_org_id");--> statement-breakpoint
CREATE INDEX "idx_fee_config_audit_creator" ON "fee_config_audit_log" USING btree ("scope_creator_id");--> statement-breakpoint
CREATE INDEX "idx_fee_config_audit_changed_by" ON "fee_config_audit_log" USING btree ("changed_by");--> statement-breakpoint
CREATE INDEX "idx_fee_config_org_creator_org" ON "fee_config_org_creator" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_fee_config_org_creator_creator" ON "fee_config_org_creator" USING btree ("creator_id");--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "check_pending_payout_reason" CHECK ("pending_payouts"."reason" IN ('connect_not_ready', 'connect_restricted', 'transfer_failed', 'min_transfer_floor'));