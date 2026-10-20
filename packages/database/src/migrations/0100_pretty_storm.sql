CREATE TABLE "payout_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"cause_type" varchar(16) NOT NULL,
	"cause_id" varchar(255) NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"stripe_reversal_id" varchar(255),
	"attempt" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "check_payout_reversals_amount_positive" CHECK ("payout_reversals"."amount_cents" > 0),
	CONSTRAINT "check_payout_reversals_cause_type" CHECK ("payout_reversals"."cause_type" IN ('refund', 'dispute')),
	CONSTRAINT "check_payout_reversals_kind" CHECK ("payout_reversals"."kind" IN ('transfer_reversal', 'pending_reduction', 'retained_fee', 'cancellation')),
	CONSTRAINT "check_payout_reversals_status" CHECK ("payout_reversals"."status" IN ('pending', 'done', 'failed', 'debt')),
	CONSTRAINT "check_payout_reversals_attempt_non_negative" CHECK ("payout_reversals"."attempt" >= 0)
);
--> statement-breakpoint
DROP INDEX "uq_refund_reviews_open_per_payout";--> statement-breakpoint
ALTER TABLE "refund_reviews" ALTER COLUMN "purchase_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD COLUMN "payout_reversal_id" uuid;--> statement-breakpoint
ALTER TABLE "payout_reversals" ADD CONSTRAINT "payout_reversals_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payout_reversals_per_cause" ON "payout_reversals" USING btree ("payout_id","cause_type","cause_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payout_reversals_stripe_reversal_id" ON "payout_reversals" USING btree ("stripe_reversal_id") WHERE "payout_reversals"."stripe_reversal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payout_reversals_failed" ON "payout_reversals" USING btree ("attempted_at") WHERE "payout_reversals"."status" = 'failed';--> statement-breakpoint
CREATE INDEX "idx_payout_reversals_payout" ON "payout_reversals" USING btree ("payout_id");--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "refund_reviews_payout_reversal_id_payout_reversals_id_fk" FOREIGN KEY ("payout_reversal_id") REFERENCES "public"."payout_reversals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refund_reviews_per_reversal" ON "refund_reviews" USING btree ("payout_reversal_id") WHERE "refund_reviews"."payout_reversal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_refund_reviews_open" ON "refund_reviews" USING btree ("payout_id") WHERE "refund_reviews"."resolved_at" IS NULL;