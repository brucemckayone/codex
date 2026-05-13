CREATE TABLE "revenue_model_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"platform_fee_percent" integer NOT NULL,
	"subscription_org_fee_percent" integer NOT NULL,
	"min_platform_fee_cents" integer NOT NULL,
	"min_transfer_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"updated_by" text,
	CONSTRAINT "check_revenue_model_singleton" CHECK ("revenue_model_config"."id" = 'singleton'),
	CONSTRAINT "check_revenue_model_platform_fee_percent" CHECK ("revenue_model_config"."platform_fee_percent" >= 0 AND "revenue_model_config"."platform_fee_percent" <= 10000),
	CONSTRAINT "check_revenue_model_subscription_org_fee_percent" CHECK ("revenue_model_config"."subscription_org_fee_percent" >= 0 AND "revenue_model_config"."subscription_org_fee_percent" <= 10000),
	CONSTRAINT "check_revenue_model_min_platform_fee_cents" CHECK ("revenue_model_config"."min_platform_fee_cents" >= 0),
	CONSTRAINT "check_revenue_model_min_transfer_cents" CHECK ("revenue_model_config"."min_transfer_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "revenue_model_config" ADD CONSTRAINT "revenue_model_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;