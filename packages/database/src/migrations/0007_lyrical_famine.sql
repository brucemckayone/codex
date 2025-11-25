ALTER TABLE "purchases" DROP CONSTRAINT "purchase_customer_content_unique";--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "platform_fee_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "organization_fee_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "creator_payout_cents" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "platform_fee_config" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;