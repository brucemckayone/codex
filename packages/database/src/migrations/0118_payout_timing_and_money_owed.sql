CREATE TABLE "connect_balances" (
	"stripe_account_id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"manual_payouts_since" timestamp with time zone,
	"available_cents" integer,
	"pending_cents" integer,
	"checked_at" timestamp with time zone,
	"negative_since" timestamp with time zone,
	"negative_after" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"cleared_reason" varchar(16),
	"cleared_owed_cents" integer,
	"cleared_since" timestamp with time zone,
	"cleared_balance_cents" integer,
	"collected_owed_cents" integer,
	"collected_at" timestamp with time zone,
	"last_payout_id" varchar(255),
	"last_payout_cents" integer,
	"last_payout_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"failing_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_connect_balances_cleared_reason" CHECK ("connect_balances"."cleared_reason" IS NULL OR "connect_balances"."cleared_reason" IN ('recovered', 'stripe_collected')),
	CONSTRAINT "check_connect_balances_cleared_since" CHECK (("connect_balances"."cleared_since" IS NULL) = ("connect_balances"."cleared_at" IS NULL)),
	CONSTRAINT "check_connect_balances_cleared_balance" CHECK ("connect_balances"."cleared_balance_cents" IS NULL OR "connect_balances"."cleared_at" IS NOT NULL),
	CONSTRAINT "check_connect_balances_collected" CHECK (("connect_balances"."collected_owed_cents" IS NULL AND "connect_balances"."collected_at" IS NULL) OR ("connect_balances"."collected_owed_cents" IS NOT NULL AND "connect_balances"."collected_at" IS NOT NULL AND "connect_balances"."collected_owed_cents" > 0)),
	CONSTRAINT "check_connect_balances_negative_after" CHECK ("connect_balances"."negative_after" IS NULL OR ("connect_balances"."negative_since" IS NOT NULL AND "connect_balances"."negative_after" < "connect_balances"."negative_since"))
);
--> statement-breakpoint
CREATE TABLE "money_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(32) NOT NULL,
	"period_key" varchar(128) NOT NULL,
	"amount_cents" integer,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_money_notices_kind" CHECK ("money_notices"."kind" IN ('payouts_waiting', 'connect_needed_first', 'balance_below_zero', 'balance_recovered', 'balance_written_off'))
);
--> statement-breakpoint
CREATE TABLE "payee_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_reversal_id" uuid NOT NULL,
	"payout_id" uuid NOT NULL,
	"payee_user_id" text,
	"effect" varchar(16) NOT NULL,
	"amount_cents" integer,
	"stripe_reversal_id" varchar(255),
	"stripe_transfer_id" varchar(255),
	"settled_as" varchar(16) NOT NULL,
	"alert_error_id" uuid NOT NULL,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"resolution" varchar(16),
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" text,
	"resolution_note" text,
	"repay_payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_payee_credits_effect" CHECK ("payee_credits"."effect" IN ('reversal_landed', 'slice_cancelled', 'unverified', 'transfer_kept')),
	CONSTRAINT "check_payee_credits_amount" CHECK ("payee_credits"."effect" NOT IN ('reversal_landed', 'slice_cancelled') OR COALESCE("payee_credits"."amount_cents" > 0, false)),
	CONSTRAINT "check_payee_credits_settled_as" CHECK ("payee_credits"."settled_as" IN ('cancelled', 'debt', 'done')),
	CONSTRAINT "check_payee_credits_resolution" CHECK ("payee_credits"."resolution" IS NULL OR "payee_credits"."resolution" IN ('repaid', 'debt_collected', 'not_owed')),
	CONSTRAINT "check_payee_credits_resolved_pair" CHECK (("payee_credits"."resolved_at" IS NULL) = ("payee_credits"."resolution" IS NULL)),
	CONSTRAINT "check_payee_credits_repaid_link" CHECK (("payee_credits"."resolution" IS NOT DISTINCT FROM 'repaid') = ("payee_credits"."repay_payout_id" IS NOT NULL)),
	CONSTRAINT "check_payee_credits_owed_only" CHECK ("payee_credits"."resolution" IS NULL OR "payee_credits"."resolution" = 'not_owed' OR "payee_credits"."effect" IN ('reversal_landed', 'slice_cancelled')),
	CONSTRAINT "check_payee_credits_debt_only" CHECK ("payee_credits"."resolution" IS DISTINCT FROM 'debt_collected' OR "payee_credits"."settled_as" = 'debt')
);
--> statement-breakpoint
ALTER TABLE "connect_balances" ADD CONSTRAINT "connect_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_notices" ADD CONSTRAINT "money_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_credits" ADD CONSTRAINT "payee_credits_payout_reversal_id_payout_reversals_id_fk" FOREIGN KEY ("payout_reversal_id") REFERENCES "public"."payout_reversals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_credits" ADD CONSTRAINT "payee_credits_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_credits" ADD CONSTRAINT "payee_credits_payee_user_id_users_id_fk" FOREIGN KEY ("payee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_credits" ADD CONSTRAINT "payee_credits_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_credits" ADD CONSTRAINT "payee_credits_repay_payout_id_payouts_id_fk" FOREIGN KEY ("repay_payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_connect_balances_user" ON "connect_balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_connect_balances_manual" ON "connect_balances" USING btree ("manual_payouts_since") WHERE "connect_balances"."manual_payouts_since" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_connect_balances_negative" ON "connect_balances" USING btree ("negative_since") WHERE "connect_balances"."negative_since" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_money_notices_per_period" ON "money_notices" USING btree ("user_id","kind","period_key");--> statement-breakpoint
CREATE INDEX "idx_money_notices_recent" ON "money_notices" USING btree ("user_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payee_credits_per_step" ON "payee_credits" USING btree ("payout_reversal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payee_credits_repay" ON "payee_credits" USING btree ("repay_payout_id") WHERE "payee_credits"."repay_payout_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_payee_credits_open" ON "payee_credits" USING btree ("found_at") WHERE "payee_credits"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_payee_credits_payee" ON "payee_credits" USING btree ("payee_user_id");--> statement-breakpoint
-- Codex-2hxff.34 (Q5) — the connect-needed email goes for the FIRST waiting
-- sale only, so it says when the money moves and that no per-sale emails
-- follow (mock-b-studio emails.html M4).
--
-- The seed was corrected, but `seed-email-templates.ts` skips a template that
-- already exists, so no deploy reaches the row production has (as 0098). It
-- ships in the SAME release as its sender (purchase-service): the copy uses
-- no new token, so the deploy order does not matter.
--
-- Replaces exactly the stock sentence. Only a body that still has it also
-- gains the closing line, so an edited copy is left alone and a second run
-- (the sentence gone) changes nothing.
UPDATE "email_templates"
SET
  "html_body" = CASE
    WHEN strpos("html_body", 'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.') > 0
    THEN replace(
      replace(
        "html_body",
        'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.',
        'Your earnings are held safely and moved to your Stripe account once you connect it and Stripe approves it. From there, each sale''s money goes to your bank 14 days after the sale.'
      ),
      '>Connect Stripe Account</a></p>',
      '>Connect Stripe Account</a></p><p style="color:#666;font-size:13px;">We won''t email you about each sale. If money is still waiting after 30 days, we''ll remind you once a month.</p>'
    )
    ELSE "html_body"
  END,
  "text_body" = CASE
    WHEN strpos("text_body", 'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.') > 0
    THEN replace(
      replace(
        "text_body",
        'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.',
        'Your earnings are held safely and moved to your Stripe account once you connect it and Stripe approves it. From there, each sale''s money goes to your bank 14 days after the sale.'
      ),
      E'Earnings dashboard:\n{{dashboardUrl}}',
      E'Earnings dashboard:\n{{dashboardUrl}}\n\nWe won''t email you about each sale. If money is still waiting after 30 days, we''ll remind you once a month.'
    )
    ELSE "text_body"
  END,
  "updated_at" = now()
WHERE "name" = 'creator-connect-needed'
  AND "deleted_at" IS NULL
  AND (
    strpos("html_body", 'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.') > 0
    OR strpos("text_body", 'Your earnings are held safely and will be released the moment you connect your Stripe account and it is approved.') > 0
  );
--> statement-breakpoint
-- Codex-2hxff.29 (Q1), step 1 of 2 — `payout-released` stops promising the
-- bank "within 2 business days". New accounts are manual from this release,
-- and a sale's money now waits 14 days, so that line would be false for them.
--
-- This swaps it for a line with NO token, because production runs migrations
-- before the workers deploy: the drain only starts sending `bankSentence` and
-- `bankLines` in this release, and the notifications-api that lists them
-- deploys last. Step 2, the dated copy that uses them, is migration 0119, one
-- release later (batch B design §5.5). The seed already carries step 2's copy,
-- so a row seeded from it has no old sentence and is left alone.
UPDATE "email_templates"
SET
  "html_body" = replace(
    "html_body",
    'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.',
    'Your Earnings page shows the date each payment goes to your bank.'
  ),
  "text_body" = replace(
    "text_body",
    'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.',
    'Your Earnings page shows the date each payment goes to your bank.'
  ),
  "updated_at" = now()
WHERE "name" = 'payout-released'
  AND "deleted_at" IS NULL
  AND (
    strpos("html_body", 'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.') > 0
    OR strpos("text_body", 'Funds typically appear in your bank account within 2 business days depending on your Stripe payout schedule.') > 0
  );
