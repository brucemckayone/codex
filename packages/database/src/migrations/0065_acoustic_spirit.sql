ALTER TABLE "payouts" DROP CONSTRAINT "check_payouts_status";--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "check_payouts_type";--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "check_payouts_paid_invariant";--> statement-breakpoint
ALTER TABLE "payouts" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "source_type" varchar(16) DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payouts_purchase" ON "payouts" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "idx_payouts_org_source_created" ON "payouts" USING btree ("organization_id","source_type","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_source" CHECK ("payouts"."source_type" IN ('purchase', 'subscription'));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_user_required" CHECK (("payouts"."payout_type" = 'platform_fee') OR ("payouts"."user_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_status" CHECK ("payouts"."status" IN ('paid', 'pending', 'failed', 'reversed'));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_type" CHECK ("payouts"."payout_type" IN ('platform_fee', 'organization_fee', 'creator_payout', 'creator_payout_to_owner'));--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_paid_invariant" CHECK (("payouts"."status" NOT IN ('paid', 'reversed')) OR (("payouts"."stripe_transfer_id" IS NOT NULL OR "payouts"."stripe_charge_id" IS NOT NULL) AND "payouts"."resolved_at" IS NOT NULL));