ALTER TABLE "course_subscriptions" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "course_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_course_subscription_id_course_subscriptions_id_fk" FOREIGN KEY ("course_subscription_id") REFERENCES "public"."course_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_disputes_subscription" ON "disputes" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "idx_disputes_course_subscription" ON "disputes" USING btree ("course_subscription_id");--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_one_source" CHECK (num_nonnulls("disputes"."purchase_id", "disputes"."subscription_id", "disputes"."course_subscription_id") <= 1);