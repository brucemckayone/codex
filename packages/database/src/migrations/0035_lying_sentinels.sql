ALTER TABLE "purchases" ALTER COLUMN "currency" SET DEFAULT 'gbp';--> statement-breakpoint
ALTER TABLE "content" ADD COLUMN "content_body_json" jsonb;