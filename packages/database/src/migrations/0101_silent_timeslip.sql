CREATE TABLE "failed_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_refund_id" varchar(255) NOT NULL,
	"stripe_charge_id" varchar(255) NOT NULL,
	"purchase_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"failure_reason" varchar(64),
	"resolution" varchar(32),
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_failed_refunds_amount_positive" CHECK ("failed_refunds"."amount_cents" > 0),
	CONSTRAINT "check_failed_refunds_resolution" CHECK ("failed_refunds"."resolution" IS NULL OR "failed_refunds"."resolution" IN ('refunded_elsewhere', 'creators_repaid')),
	CONSTRAINT "check_failed_refunds_resolved_pair" CHECK (("failed_refunds"."resolved_at" IS NULL AND "failed_refunds"."resolution" IS NULL) OR ("failed_refunds"."resolved_at" IS NOT NULL AND "failed_refunds"."resolution" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "failed_refunds" ADD CONSTRAINT "failed_refunds_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_refunds" ADD CONSTRAINT "failed_refunds_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_failed_refunds_stripe_refund_id" ON "failed_refunds" USING btree ("stripe_refund_id");--> statement-breakpoint
CREATE INDEX "idx_failed_refunds_open" ON "failed_refunds" USING btree ("created_at") WHERE "failed_refunds"."resolved_at" IS NULL;