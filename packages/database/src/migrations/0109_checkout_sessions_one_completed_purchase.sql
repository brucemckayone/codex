CREATE TABLE "checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"content_id" uuid,
	"course_id" uuid,
	"amount_cents" integer NOT NULL,
	"stripe_session_id" varchar(255),
	"url" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_sessions_stripe_session_id_unique" UNIQUE("stripe_session_id"),
	CONSTRAINT "check_checkout_session_target_one" CHECK ((CASE WHEN "checkout_sessions"."content_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "checkout_sessions"."course_id" IS NULL THEN 0 ELSE 1 END) = 1),
	CONSTRAINT "check_checkout_session_status" CHECK ("checkout_sessions"."status" IN ('open', 'completed', 'expired')),
	CONSTRAINT "check_checkout_session_amount" CHECK ("checkout_sessions"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "duplicate_of_purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_checkout_sessions_customer_id" ON "checkout_sessions" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_checkout_sessions_open_customer_content" ON "checkout_sessions" USING btree ("customer_id","content_id") WHERE "checkout_sessions"."status" = 'open' AND "checkout_sessions"."content_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_checkout_sessions_open_customer_course" ON "checkout_sessions" USING btree ("customer_id","course_id") WHERE "checkout_sessions"."status" = 'open' AND "checkout_sessions"."course_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_duplicate_of_purchase_id_purchases_id_fk" FOREIGN KEY ("duplicate_of_purchase_id") REFERENCES "public"."purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchases_completed_customer_content" ON "purchases" USING btree ("customer_id","content_id") WHERE "purchases"."status" = 'completed' AND "purchases"."content_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_purchases_completed_customer_course" ON "purchases" USING btree ("customer_id","course_id") WHERE "purchases"."status" = 'completed' AND "purchases"."course_id" IS NOT NULL;