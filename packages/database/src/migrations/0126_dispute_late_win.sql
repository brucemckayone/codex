ALTER TABLE "disputes" ADD COLUMN "late_won_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "lost_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "late_win_refund_id" varchar(255);--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "buyer_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_late_won_status" CHECK ("disputes"."late_won_at" IS NULL OR "disputes"."status" = 'won');--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_late_win_refund" CHECK ("disputes"."late_win_refund_id" IS NULL OR "disputes"."late_won_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_lost_applied" CHECK ("disputes"."lost_applied_at" IS NULL OR "disputes"."late_won_at" IS NOT NULL);