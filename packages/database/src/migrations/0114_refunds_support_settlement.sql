ALTER TABLE "refund_reviews" DROP CONSTRAINT "check_refund_reviews_resolution";--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payout_reversals_cause" ON "payout_reversals" USING btree ("cause_type","cause_id");--> statement-breakpoint
CREATE INDEX "idx_payouts_stripe_charge" ON "payouts" USING btree ("stripe_charge_id");--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "check_refund_reviews_resolution" CHECK ("refund_reviews"."resolution" IS NULL OR "refund_reviews"."resolution" IN ('creator_absorbed', 'platform_absorbed', 'manually_reversed', 'dispute_won', 'refund_failed'));