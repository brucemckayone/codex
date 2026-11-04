-- Price moves (Codex-2hxff.85, .86): the durable record of who still has to be
-- told about a new tier or course-plan price. EXPAND ONLY: two new tables, no
-- change to any existing table, so old code never reads them and this applies
-- safely before the workers deploy. No backfill: a fan-out before the deploy
-- either finished or was alerted, and anyone it held is found with the Stripe
-- search in docs/payments/subscriptions.md.
--
-- price_changes is one Studio save per interval that changed; one running or
-- stopped change per tier (or plan) and interval. subscription_price_moves is
-- one subscriber per change; ecom-api's hourly step claims due and notified
-- rows. Every CHECK is written so it never evaluates to NULL. FKs RESTRICT:
-- money history outlives its user, tier and plan (all soft-deleted).
--
-- The runner applies this file as ONE implicit transaction, and each FK from
-- the two new tables holds a SHARE ROW EXCLUSIVE lock on its parent
-- (organizations, users, subscription_tiers, course_subscription_plans,
-- subscriptions, course_subscriptions) until the file commits: writes to
-- those wait, reads don't. lock_timeout bounds only the WAIT for each lock: if
-- a long transaction is open on one of those tables, the migration fails
-- after 5s and rolls back whole, instead of holding a queue of sign-ups and
-- subscription and organisation writes behind its own wait; re-run it once
-- the database is quiet (as 0111). The new tables are empty, so validating
-- the FKs is instant.
SET lock_timeout = '5s';--> statement-breakpoint

CREATE TABLE "price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"tier_id" uuid,
	"course_subscription_plan_id" uuid,
	"interval" varchar(10) NOT NULL,
	"from_amount_cents" integer NOT NULL,
	"new_amount_cents" integer NOT NULL,
	"new_stripe_price_id" varchar(255) NOT NULL,
	"state" varchar(16) DEFAULT 'running' NOT NULL,
	"stopped_reason" varchar(64),
	"stopped_error_id" varchar(64),
	"stopped_at" timestamp with time zone,
	"restart_requested_at" timestamp with time zone,
	"restart_requested_by_user_id" text,
	"superseded_by_id" uuid,
	"superseded_at" timestamp with time zone,
	"total_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	CONSTRAINT "check_price_changes_kind" CHECK (("price_changes"."kind" = 'tier' AND "price_changes"."tier_id" IS NOT NULL AND "price_changes"."course_subscription_plan_id" IS NULL) OR ("price_changes"."kind" = 'course_plan' AND "price_changes"."course_subscription_plan_id" IS NOT NULL AND "price_changes"."tier_id" IS NULL)),
	CONSTRAINT "check_price_changes_interval" CHECK ("price_changes"."interval" IN ('month', 'year')),
	CONSTRAINT "check_price_changes_amounts" CHECK ("price_changes"."from_amount_cents" >= 0 AND "price_changes"."new_amount_cents" >= 0),
	CONSTRAINT "check_price_changes_state" CHECK ("price_changes"."state" IN ('running', 'done', 'stopped', 'superseded')),
	CONSTRAINT "check_price_changes_stopped_set" CHECK (("price_changes"."stopped_at" IS NULL) = ("price_changes"."stopped_reason" IS NULL) AND ("price_changes"."stopped_at" IS NULL) = ("price_changes"."stopped_error_id" IS NULL) AND ("price_changes"."state" <> 'stopped' OR "price_changes"."stopped_at" IS NOT NULL)),
	CONSTRAINT "check_price_changes_restart_pair" CHECK (("price_changes"."restart_requested_at" IS NULL) = ("price_changes"."restart_requested_by_user_id" IS NULL)),
	CONSTRAINT "check_price_changes_superseded_set" CHECK (("price_changes"."superseded_at" IS NULL) = ("price_changes"."superseded_by_id" IS NULL) AND ("price_changes"."state" = 'superseded') = ("price_changes"."superseded_at" IS NOT NULL)),
	CONSTRAINT "check_price_changes_done" CHECK ("price_changes"."state" <> 'done' OR "price_changes"."done_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "subscription_price_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_change_id" uuid NOT NULL,
	"subscription_id" uuid,
	"course_subscription_id" uuid,
	"stripe_subscription_id" varchar(255) NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" varchar(16) DEFAULT 'due' NOT NULL,
	"scheduled_kind" varchar(16),
	"skip_reason" varchar(32),
	"held_reason" varchar(32),
	"notice_at" timestamp with time zone,
	"effective_at" timestamp with time zone,
	"floor_from" timestamp with time zone,
	"source" varchar(24) DEFAULT 'price_change' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error" varchar(64),
	"alert_error_id" varchar(64),
	"retry_requested_at" timestamp with time zone,
	"retry_requested_by_user_id" text,
	"resolution" varchar(32),
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_price_moves_one_subscription" CHECK (num_nonnulls("subscription_price_moves"."subscription_id", "subscription_price_moves"."course_subscription_id") = 1),
	CONSTRAINT "check_price_moves_state" CHECK ("subscription_price_moves"."state" IN ('due', 'notified', 'scheduled', 'unchanged', 'skipped', 'held', 'superseded')),
	CONSTRAINT "check_price_moves_scheduled_kind" CHECK (("subscription_price_moves"."state" = 'scheduled') = ("subscription_price_moves"."scheduled_kind" IS NOT NULL) AND ("subscription_price_moves"."scheduled_kind" IS NULL OR "subscription_price_moves"."scheduled_kind" IN ('now', 'pending'))),
	CONSTRAINT "check_price_moves_skip_reason" CHECK (("subscription_price_moves"."state" = 'skipped') = ("subscription_price_moves"."skip_reason" IS NOT NULL) AND ("subscription_price_moves"."skip_reason" IS NULL OR "subscription_price_moves"."skip_reason" IN ('moving_away', 'other_interval', 'no_items', 'ended'))),
	CONSTRAINT "check_price_moves_held_reason" CHECK (("subscription_price_moves"."state" <> 'held' OR "subscription_price_moves"."held_reason" IS NOT NULL) AND ("subscription_price_moves"."held_reason" IS NULL OR "subscription_price_moves"."held_reason" IN ('no_address', 'notice_refused', 'notice_skipped', 'notice_unknown', 'move_refused', 'move_unknown', 'read_failed', 'same_amount_write_failed'))),
	CONSTRAINT "check_price_moves_told" CHECK (("subscription_price_moves"."state" NOT IN ('notified', 'scheduled') OR "subscription_price_moves"."notice_at" IS NOT NULL) AND ("subscription_price_moves"."state" <> 'scheduled' OR "subscription_price_moves"."effective_at" IS NOT NULL)),
	CONSTRAINT "check_price_moves_source" CHECK ("subscription_price_moves"."source" IN ('price_change', 'keep_current_plan')),
	CONSTRAINT "check_price_moves_attempts" CHECK ("subscription_price_moves"."attempts" >= 0),
	CONSTRAINT "check_price_moves_retry_pair" CHECK (("subscription_price_moves"."retry_requested_at" IS NULL) = ("subscription_price_moves"."retry_requested_by_user_id" IS NULL)),
	CONSTRAINT "check_price_moves_resolution" CHECK (("subscription_price_moves"."resolved_at" IS NULL) = ("subscription_price_moves"."resolution" IS NULL) AND ("subscription_price_moves"."resolution" IS NULL OR "subscription_price_moves"."resolution" IN ('moved_by_hand', 'not_needed', 'retried_ok')) AND ("subscription_price_moves"."resolution" IS NULL OR "subscription_price_moves"."resolution" = 'retried_ok' OR "subscription_price_moves"."resolution_note" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_tier_id_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."subscription_tiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_course_subscription_plan_id_course_subscription_plans_id_fk" FOREIGN KEY ("course_subscription_plan_id") REFERENCES "public"."course_subscription_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_restart_requested_by_user_id_users_id_fk" FOREIGN KEY ("restart_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_superseded_by_id_price_changes_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."price_changes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_price_change_id_price_changes_id_fk" FOREIGN KEY ("price_change_id") REFERENCES "public"."price_changes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_course_subscription_id_course_subscriptions_id_fk" FOREIGN KEY ("course_subscription_id") REFERENCES "public"."course_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_retry_requested_by_user_id_users_id_fk" FOREIGN KEY ("retry_requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_price_moves" ADD CONSTRAINT "subscription_price_moves_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_changes_live_tier" ON "price_changes" USING btree ("tier_id","interval") WHERE "price_changes"."tier_id" IS NOT NULL AND "price_changes"."state" IN ('running', 'stopped');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_changes_live_plan" ON "price_changes" USING btree ("course_subscription_plan_id","interval") WHERE "price_changes"."course_subscription_plan_id" IS NOT NULL AND "price_changes"."state" IN ('running', 'stopped');--> statement-breakpoint
CREATE INDEX "idx_price_changes_tier" ON "price_changes" USING btree ("tier_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_price_changes_plan" ON "price_changes" USING btree ("course_subscription_plan_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_moves_change_subscription" ON "subscription_price_moves" USING btree ("price_change_id","subscription_id") WHERE "subscription_price_moves"."subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_moves_change_course_subscription" ON "subscription_price_moves" USING btree ("price_change_id","course_subscription_id") WHERE "subscription_price_moves"."course_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_price_moves_claim" ON "subscription_price_moves" USING btree ("state","next_attempt_at") WHERE "subscription_price_moves"."state" IN ('due', 'notified');--> statement-breakpoint
CREATE INDEX "idx_price_moves_change_state" ON "subscription_price_moves" USING btree ("price_change_id","state");--> statement-breakpoint
CREATE INDEX "idx_price_moves_held_open" ON "subscription_price_moves" USING btree ("state") WHERE "subscription_price_moves"."state" = 'held' AND "subscription_price_moves"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_price_moves_subscription" ON "subscription_price_moves" USING btree ("subscription_id") WHERE "subscription_price_moves"."subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_price_moves_course_subscription" ON "subscription_price_moves" USING btree ("course_subscription_id") WHERE "subscription_price_moves"."course_subscription_id" IS NOT NULL;--> statement-breakpoint
RESET lock_timeout;