CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"subscription_id" uuid,
	"stripe_charge_id" varchar(255),
	"stripe_transfer_id" varchar(255),
	"transfer_group" varchar(255),
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'gbp' NOT NULL,
	"payout_type" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"reason" varchar(32),
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_payouts_amount_positive" CHECK ("payouts"."amount_cents" > 0),
	CONSTRAINT "check_payouts_status" CHECK ("payouts"."status" IN ('paid', 'pending', 'failed')),
	CONSTRAINT "check_payouts_reason" CHECK ("payouts"."reason" IS NULL OR "payouts"."reason" IN ('connect_not_ready', 'connect_restricted', 'transfer_failed', 'min_transfer_floor')),
	CONSTRAINT "check_payouts_type" CHECK ("payouts"."payout_type" IN ('organization_fee', 'creator_payout', 'creator_payout_to_owner')),
	CONSTRAINT "check_payouts_paid_invariant" CHECK (("payouts"."status" != 'paid') OR ("payouts"."stripe_transfer_id" IS NOT NULL AND "payouts"."resolved_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payouts_stripe_transfer_id" ON "payouts" USING btree ("stripe_transfer_id") WHERE "payouts"."stripe_transfer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payouts_org_created" ON "payouts" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_payouts_org_status_created" ON "payouts" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_payouts_pending" ON "payouts" USING btree ("user_id","organization_id","attempted_at") WHERE "payouts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_payouts_user_org_created" ON "payouts" USING btree ("user_id","organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_payouts_subscription" ON "payouts" USING btree ("subscription_id");