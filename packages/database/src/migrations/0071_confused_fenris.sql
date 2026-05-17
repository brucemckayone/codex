CREATE TABLE "agreement_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" text NOT NULL,
	"revenue_type" varchar(32) NOT NULL,
	"parent_proposal_id" uuid,
	"round_number" integer NOT NULL,
	"proposed_by_user_id" text NOT NULL,
	"proposed_by_role" varchar(16) NOT NULL,
	"proposed_creator_share_percent" integer NOT NULL,
	"proposed_term_months" integer,
	"proposed_effective_from" timestamp with time zone NOT NULL,
	"note" text,
	"status" varchar(16) NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by_user_id" text,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_agreement_proposals_revenue_type" CHECK ("agreement_proposals"."revenue_type" IN ('subscription', 'content_purchase')),
	CONSTRAINT "check_agreement_proposals_proposed_by_role" CHECK ("agreement_proposals"."proposed_by_role" IN ('owner', 'creator')),
	CONSTRAINT "check_agreement_proposals_status" CHECK ("agreement_proposals"."status" IN ('open', 'accepted', 'declined', 'countered', 'withdrawn', 'superseded')),
	CONSTRAINT "check_agreement_proposals_share_bps" CHECK ("agreement_proposals"."proposed_creator_share_percent" >= 0 AND "agreement_proposals"."proposed_creator_share_percent" <= 10000),
	CONSTRAINT "check_agreement_proposals_round_positive" CHECK ("agreement_proposals"."round_number" >= 1),
	CONSTRAINT "check_agreement_proposals_term_positive" CHECK ("agreement_proposals"."proposed_term_months" IS NULL OR "agreement_proposals"."proposed_term_months" > 0)
);
--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" DROP CONSTRAINT "creator_org_agreement_unique";--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD COLUMN "revenue_type" varchar(32) DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD COLUMN "terminated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD COLUMN "terminated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD COLUMN "termination_reason" text;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD COLUMN "current_proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "agreement_proposals" ADD CONSTRAINT "agreement_proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_proposals" ADD CONSTRAINT "agreement_proposals_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_proposals" ADD CONSTRAINT "agreement_proposals_parent_proposal_id_agreement_proposals_id_fk" FOREIGN KEY ("parent_proposal_id") REFERENCES "public"."agreement_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_proposals" ADD CONSTRAINT "agreement_proposals_proposed_by_user_id_users_id_fk" FOREIGN KEY ("proposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_proposals" ADD CONSTRAINT "agreement_proposals_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agreement_proposals_thread" ON "agreement_proposals" USING btree ("organization_id","creator_id","revenue_type");--> statement-breakpoint
CREATE INDEX "idx_agreement_proposals_creator_status" ON "agreement_proposals" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "idx_agreement_proposals_org_status" ON "agreement_proposals" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "creator_organization_agreements_terminated_by_user_id_users_id_fk" FOREIGN KEY ("terminated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "creator_organization_agreements_current_proposal_id_agreement_proposals_id_fk" FOREIGN KEY ("current_proposal_id") REFERENCES "public"."agreement_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_creator_org_agreement_active_lookup" ON "creator_organization_agreements" USING btree ("organization_id","creator_id","revenue_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_creator_org_agreement_active_per_type" ON "creator_organization_agreements" USING btree ("organization_id","creator_id","revenue_type") WHERE "creator_organization_agreements"."status" = 'active';--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "creator_org_agreement_unique" UNIQUE("creator_id","organization_id","effective_from","revenue_type");--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "check_creator_org_agreement_revenue_type" CHECK ("creator_organization_agreements"."revenue_type" IN ('subscription', 'content_purchase'));--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "check_creator_org_agreement_status" CHECK ("creator_organization_agreements"."status" IN ('active', 'terminated', 'expired'));--> statement-breakpoint
ALTER TABLE "creator_organization_agreements" ADD CONSTRAINT "check_creator_org_agreement_terminated_shape" CHECK (("creator_organization_agreements"."status" = 'terminated') = ("creator_organization_agreements"."terminated_at" IS NOT NULL));