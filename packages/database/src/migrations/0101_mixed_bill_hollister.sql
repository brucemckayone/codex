CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_refund_id" varchar(255) NOT NULL,
	"stripe_charge_id" varchar(255) NOT NULL,
	"purchase_id" uuid,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(16) NOT NULL,
	"reason" varchar(64),
	"failure_reason" varchar(64),
	"stripe_created_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"resolution" varchar(32),
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_refunds_amount_positive" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "check_refunds_status" CHECK ("refunds"."status" IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "check_refunds_resolution" CHECK ("refunds"."resolution" IS NULL OR ("refunds"."status" = 'failed' AND "refunds"."resolution" IN ('refunded_elsewhere', 'creators_repaid'))),
	CONSTRAINT "check_refunds_resolved_pair" CHECK (("refunds"."resolved_at" IS NULL AND "refunds"."resolution" IS NULL) OR ("refunds"."resolved_at" IS NOT NULL AND "refunds"."resolution" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refunds_stripe_refund_id" ON "refunds" USING btree ("stripe_refund_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_purchase" ON "refunds" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "idx_refunds_failed_open" ON "refunds" USING btree ("created_at") WHERE "refunds"."status" = 'failed' AND "refunds"."resolved_at" IS NULL;