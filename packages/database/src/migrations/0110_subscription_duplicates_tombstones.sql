ALTER TABLE "checkout_sessions" DROP CONSTRAINT "check_checkout_session_target_one";--> statement-breakpoint
DROP INDEX "uq_checkout_sessions_open_customer_course";--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD COLUMN "duplicate_of_course_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD COLUMN "duplicate_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "kind" varchar(20) DEFAULT 'purchase' NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD COLUMN "stripe_price_id" varchar(255);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "duplicate_of_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "duplicate_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_duplicate_of_course_subscription_id_course_subscriptions_id_fk" FOREIGN KEY ("duplicate_of_course_subscription_id") REFERENCES "public"."course_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_duplicate_of_subscription_id_subscriptions_id_fk" FOREIGN KEY ("duplicate_of_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_checkout_sessions_open_customer_org" ON "checkout_sessions" USING btree ("customer_id","organization_id") WHERE "checkout_sessions"."status" = 'open' AND "checkout_sessions"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_checkout_sessions_open_customer_course" ON "checkout_sessions" USING btree ("customer_id","course_id","kind") WHERE "checkout_sessions"."status" = 'open' AND "checkout_sessions"."course_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "check_checkout_session_kind" CHECK (("checkout_sessions"."kind" = 'purchase' AND "checkout_sessions"."organization_id" IS NULL AND "checkout_sessions"."stripe_price_id" IS NULL) OR ("checkout_sessions"."kind" = 'subscription' AND "checkout_sessions"."content_id" IS NULL AND "checkout_sessions"."stripe_price_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "check_checkout_session_target_one" CHECK ((CASE WHEN "checkout_sessions"."content_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "checkout_sessions"."course_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "checkout_sessions"."organization_id" IS NULL THEN 0 ELSE 1 END) = 1);