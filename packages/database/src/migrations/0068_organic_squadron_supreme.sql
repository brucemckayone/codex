CREATE TABLE "refund_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"payout_id" uuid NOT NULL,
	"creator_user_id" text NOT NULL,
	"attempted_reversal_cents" integer NOT NULL,
	"error_code" varchar(64) NOT NULL,
	"error_message" text,
	"resolution" varchar(32),
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_refund_reviews_amount_positive" CHECK ("refund_reviews"."attempted_reversal_cents" > 0),
	CONSTRAINT "check_refund_reviews_resolution" CHECK ("refund_reviews"."resolution" IS NULL OR "refund_reviews"."resolution" IN ('creator_absorbed', 'platform_absorbed', 'manually_reversed')),
	CONSTRAINT "check_refund_reviews_resolved_pair" CHECK (("refund_reviews"."resolved_at" IS NULL AND "refund_reviews"."resolution" IS NULL) OR ("refund_reviews"."resolved_at" IS NOT NULL AND "refund_reviews"."resolution" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "refund_reviews_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "refund_reviews_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "refund_reviews_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_reviews" ADD CONSTRAINT "refund_reviews_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;