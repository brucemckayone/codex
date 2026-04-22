ALTER TABLE "purchases" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "stripe_dispute_id" varchar(255);