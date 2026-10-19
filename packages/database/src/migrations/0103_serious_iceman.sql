CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_dispute_id" varchar(255) NOT NULL,
	"stripe_charge_id" varchar(255) NOT NULL,
	"purchase_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(32) NOT NULL,
	"reason" varchar(64),
	"stripe_created_at" timestamp with time zone NOT NULL,
	"outcome_applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_disputes_amount_positive" CHECK ("disputes"."amount_cents" > 0),
	CONSTRAINT "check_disputes_status" CHECK ("disputes"."status" IN ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented'))
);
--> statement-breakpoint
ALTER TABLE "payout_reversals" DROP CONSTRAINT "check_payout_reversals_status";--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "check_payouts_status";--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "check_payouts_user_required";--> statement-breakpoint
ALTER TABLE "refund_reviews" DROP CONSTRAINT "check_refund_reviews_resolution";--> statement-breakpoint
ALTER TABLE "payout_reversals" ADD COLUMN "repaid_by_payout_id" uuid;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_disputes_stripe_dispute_id" ON "disputes" USING btree ("stripe_dispute_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_purchase" ON "disputes" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_open_charge" ON "disputes" USING btree ("stripe_charge_id") WHERE "disputes"."status" NOT IN ('won', 'lost', 'warning_closed', 'prevented');--> statement-breakpoint
ALTER TABLE "payout_reversals" ADD CONSTRAINT "payout_reversals_repaid_by_payout_id_payouts_id_fk" FOREIGN KEY ("repaid_by_payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payout_reversals_repaid_by" ON "payout_reversals" USING btree ("repaid_by_payout_id") WHERE "payout_reversals"."repaid_by_payout_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_reversals" ADD CONSTRAINT "check_payout_reversals_status" CHECK ("payout_reversals"."status" IN ('pending', 'done', 'failed', 'debt', 'cancelled'));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_status" CHECK ("payouts"."status" IN ('paid', 'pending', 'failed', 'reversed', 'cancelled_by_refund', 'cancelled_by_dispute'));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_user_required" CHECK (("payouts"."payout_type" = 'platform_fee') OR ("payouts"."user_id" IS NOT NULL) OR (COALESCE("payouts"."reason" = 'no_owner', false) AND "payouts"."status" IN ('pending', 'cancelled_by_refund', 'cancelled_by_dispute') AND "payouts"."payout_type" IN ('organization_fee', 'creator_payout_to_owner')));--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "check_refund_reviews_resolution" CHECK ("refund_reviews"."resolution" IS NULL OR "refund_reviews"."resolution" IN ('creator_absorbed', 'platform_absorbed', 'manually_reversed', 'dispute_won'));