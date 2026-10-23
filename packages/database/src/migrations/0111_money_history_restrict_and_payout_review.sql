-- Codex-2hxff.23 / .48 / .19. The runner applies this file as ONE implicit
-- transaction, and each DROP CONSTRAINT holds an ACCESS EXCLUSIVE lock on
-- the table the FK points at (users, organizations, courses, subscriptions)
-- until the file commits. If a long transaction is open on one of them, the
-- migration fails after 5s and rolls back whole, rather than queueing every
-- sign-in and org read behind it; re-run it once the database is quiet.
-- Every FK re-added below was already enforced on the same columns, so the
-- validating scans cannot fail.
SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "course_subscriptions" DROP CONSTRAINT "course_subscriptions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "course_subscriptions" DROP CONSTRAINT "course_subscriptions_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_customer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "payouts_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "payouts" DROP CONSTRAINT "payouts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pending_payouts" DROP CONSTRAINT "pending_payouts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "pending_payouts" DROP CONSTRAINT "pending_payouts_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "pending_payouts" DROP CONSTRAINT "pending_payouts_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "creator_org_agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "last_error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "last_error_type" varchar(64);--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "needs_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_subscriptions" ADD CONSTRAINT "course_subscriptions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_creator_org_agreement_id_creator_organization_agreements_id_fk" FOREIGN KEY ("creator_org_agreement_id") REFERENCES "public"."creator_organization_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "pending_payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "pending_payouts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_payouts" ADD CONSTRAINT "pending_payouts_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_payouts_needs_review" ON "payouts" USING btree ("needs_review_at") WHERE "payouts"."needs_review_at" IS NOT NULL AND "payouts"."status" = 'failed';--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "check_payouts_failure_count_nonnegative" CHECK ("payouts"."failure_count" >= 0);--> statement-breakpoint
RESET lock_timeout;
