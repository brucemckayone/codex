CREATE TABLE "pending_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'gbp' NOT NULL,
	"reason" varchar(100) NOT NULL,
	"resolved_at" timestamp with time zone,
	"stripe_transfer_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_pending_payout_positive" CHECK ("pending_payouts"."amount_cents" > 0),
	CONSTRAINT "check_pending_payout_reason" CHECK ("pending_payouts"."reason" IN ('connect_not_ready', 'connect_restricted', 'transfer_failed'))
);
--> statement-breakpoint
CREATE TABLE "stripe_connect_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"stripe_account_id" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'onboarding' NOT NULL,
	"charges_enabled" boolean DEFAULT false NOT NULL,
	"payouts_enabled" boolean DEFAULT false NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_connect_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id"),
	CONSTRAINT "uq_stripe_connect_user_org" UNIQUE("user_id","organization_id"),
	CONSTRAINT "check_connect_status" CHECK ("stripe_connect_accounts"."status" IN ('onboarding', 'active', 'restricted', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "subscription_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"price_monthly" integer NOT NULL,
	"price_annual" integer NOT NULL,
	"stripe_product_id" varchar(255),
	"stripe_price_monthly_id" varchar(255),
	"stripe_price_annual_id" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_subscription_tiers_org_sort" UNIQUE("organization_id","sort_order"),
	CONSTRAINT "check_tier_price_monthly_positive" CHECK ("subscription_tiers"."price_monthly" >= 0),
	CONSTRAINT "check_tier_price_annual_positive" CHECK ("subscription_tiers"."price_annual" >= 0),
	CONSTRAINT "check_tier_sort_order_positive" CHECK ("subscription_tiers"."sort_order" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"stripe_subscription_id" varchar(255) NOT NULL,
	"stripe_customer_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"billing_interval" varchar(10) NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"amount_cents" integer NOT NULL,
	"platform_fee_cents" integer DEFAULT 0 NOT NULL,
	"organization_fee_cents" integer DEFAULT 0 NOT NULL,
	"creator_payout_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id"),
	CONSTRAINT "check_subscription_status" CHECK ("subscriptions"."status" IN ('active', 'past_due', 'cancelling', 'cancelled', 'incomplete')),
	CONSTRAINT "check_billing_interval" CHECK ("subscriptions"."billing_interval" IN ('month', 'year')),
	CONSTRAINT "check_sub_amount_positive" CHECK ("subscriptions"."amount_cents" >= 0),
	CONSTRAINT "check_sub_platform_fee_positive" CHECK ("subscriptions"."platform_fee_cents" >= 0),
	CONSTRAINT "check_sub_org_fee_positive" CHECK ("subscriptions"."organization_fee_cents" >= 0),
	CONSTRAINT "check_sub_creator_payout_positive" CHECK ("subscriptions"."creator_payout_cents" >= 0),
	CONSTRAINT "check_sub_revenue_split_equals_total" CHECK ("subscriptions"."amount_cents" = "subscriptions"."platform_fee_cents" + "subscriptions"."organization_fee_cents" + "subscriptions"."creator_payout_cents")
);
--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "minimum_tier_id" uuid;--> statement-breakpoint
ALTER TABLE "feature_settings" ADD COLUMN "enable_subscriptions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "pending_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "pending_payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "pending_payouts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "stripe_connect_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_connect_accounts" ADD CONSTRAINT "stripe_connect_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_tiers" ADD CONSTRAINT "subscription_tiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pending_payouts_user_id" ON "pending_payouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pending_payouts_org_id" ON "pending_payouts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_pending_payouts_unresolved" ON "pending_payouts" USING btree ("user_id","resolved_at");--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_org_id" ON "stripe_connect_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_user_id" ON "stripe_connect_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_stripe_connect_stripe_id" ON "stripe_connect_accounts" USING btree ("stripe_account_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_tiers_org_id" ON "subscription_tiers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_subscription_tiers_org_active" ON "subscription_tiers" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_org_id" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_tier_id" ON "subscriptions" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_stripe_id" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_org_status" ON "subscriptions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_org" ON "subscriptions" USING btree ("user_id","organization_id");--> statement-breakpoint
ALTER TABLE "content" ADD CONSTRAINT "content_minimum_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("minimum_tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_minimum_tier" ON "content" USING btree ("minimum_tier_id");