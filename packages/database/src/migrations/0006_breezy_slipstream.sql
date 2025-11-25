CREATE TABLE "creator_organization_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_fee_percentage" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_org_agreement_unique" UNIQUE("creator_id","organization_id","effective_from"),
	CONSTRAINT "check_org_fee_percentage" CHECK ("creator_organization_agreements"."organization_fee_percentage" >= 0 AND "creator_organization_agreements"."organization_fee_percentage" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "organization_platform_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"platform_fee_percentage" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_org_platform_fee_percentage" CHECK ("organization_platform_agreements"."platform_fee_percentage" >= 0 AND "organization_platform_agreements"."platform_fee_percentage" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "platform_fee_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_fee_percentage" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_platform_fee_percentage" CHECK ("platform_fee_config"."platform_fee_percentage" >= 0 AND "platform_fee_config"."platform_fee_percentage" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "platform_fee_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "organization_fee_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "creator_payout_cents" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "platform_agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "creator_org_agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "purchased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "refund_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "stripe_refund_id" varchar(255);--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "creator_organization_agreements_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "creator_organization_agreements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_platform_agreements" ADD CONSTRAINT "organization_platform_agreements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_creator_org_agreement_creator_id" ON "creator_organization_agreements" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_creator_org_agreement_org_id" ON "creator_organization_agreements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_creator_org_agreement_effective" ON "creator_organization_agreements" USING btree ("effective_from","effective_until");--> statement-breakpoint
CREATE INDEX "idx_org_platform_agreement_org_id" ON "organization_platform_agreements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_platform_agreement_effective" ON "organization_platform_agreements" USING btree ("effective_from","effective_until");--> statement-breakpoint
CREATE INDEX "idx_platform_fee_config_effective" ON "platform_fee_config" USING btree ("effective_from","effective_until");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_platform_agreement_id_organization_platform_agreements_id_fk" FOREIGN KEY ("platform_agreement_id") REFERENCES "public"."organization_platform_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_creator_org_agreement_id_creator_organization_agreements_id_fk" FOREIGN KEY ("creator_org_agreement_id") REFERENCES "public"."creator_organization_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_purchases_purchased_at" ON "purchases" USING btree ("purchased_at");--> statement-breakpoint
CREATE INDEX "idx_purchases_platform_agreement" ON "purchases" USING btree ("platform_agreement_id");--> statement-breakpoint
CREATE INDEX "idx_purchases_creator_org_agreement" ON "purchases" USING btree ("creator_org_agreement_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchase_customer_content_unique" UNIQUE("customer_id","content_id");--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_platform_fee_positive" CHECK ("purchases"."platform_fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_org_fee_positive" CHECK ("purchases"."organization_fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_creator_payout_positive" CHECK ("purchases"."creator_payout_cents" >= 0);--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "check_revenue_split_equals_total" CHECK ("purchases"."amount_paid_cents" = "purchases"."platform_fee_cents" + "purchases"."organization_fee_cents" + "purchases"."creator_payout_cents");