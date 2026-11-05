-- A late win undoes a lost chargeback (Codex-2hxff.70; late-win data design
-- §3.1, §7, §9). ADDITIVE: four nullable columns and three CHECKs on disputes,
-- and the purchase-access-restored email; old code never reads them, so this
-- applies safely before the workers deploy. No backfill: until this release a
-- late win only alerted, and the release checklist (R18) records any lost row
-- a person already settled by hand as an applied late win.
--
-- late_won_at marks a row moved lost -> won; lost_applied_at keeps the loss's
-- outcome_applied_at when the undo clears it; late_win_refund_id is the
-- refund made for a buyer who had bought the item again; buyer_told_at claims
-- the buyer's email before it is sent. Each CHECK is IS [NOT] NULL tests and
-- a comparison on status, which is NOT NULL, so none can evaluate to NULL: a
-- late win is a won row, and only a late win keeps a loss date or a
-- late-win refund.
--
-- The runner applies this file as ONE implicit transaction, and each ADD
-- COLUMN or ADD CONSTRAINT holds an ACCESS EXCLUSIVE lock on disputes until
-- the file commits. lock_timeout bounds only the WAIT for each lock: if a long
-- transaction is open on disputes, the migration fails after 5s and rolls
-- back whole, instead of holding the webhook's and the drain's dispute reads
-- behind its own wait; re-run it once the database is quiet (as 0111). Once
-- the locks are held, the CHECKs' validating scans take well under a second
-- (the table is small) and cannot fail: every row's new columns are NULL.
SET lock_timeout = '5s';--> statement-breakpoint

ALTER TABLE "disputes" ADD COLUMN "late_won_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "lost_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "late_win_refund_id" varchar(255);--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN "buyer_told_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_late_won_status" CHECK ("disputes"."late_won_at" IS NULL OR "disputes"."status" = 'won');--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_late_win_refund" CHECK ("disputes"."late_win_refund_id" IS NULL OR "disputes"."late_won_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_lost_applied" CHECK ("disputes"."lost_applied_at" IS NULL OR "disputes"."late_won_at" IS NOT NULL);
--> statement-breakpoint
-- SEED. The buyer's access-restored email, exactly as packages/database/
--    scripts/seed-email-templates.ts has it (generated from it; the parity
--    test late-win-email-migration.test.ts holds the two together). The
--    deploy's seed skips a template that exists, so this and the seed never
--    both insert; a live global row of the same name is left alone.
INSERT INTO "email_templates" ("name", "scope", "subject", "html_body", "text_body", "description", "status")
SELECT $tpl$purchase-access-restored$tpl$, 'global', $tpl$Your access to {{contentTitle}} is back$tpl$,
  $tpl$<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}.container{max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;border-radius:8px}.button{background-color:{{primaryColor}};color:white;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold}.logo{max-height:40px;margin-bottom:20px}.footer{margin-top:30px;padding-top:20px;border-top:1px solid #eee;color:#666;font-size:12px}.details{background:#f9f9f9;padding:20px;border-radius:8px;margin:20px 0;border:1px solid #eee}</style></head><body><div class="container"><img src="{{logoUrl}}" alt="{{platformName}}" class="logo"/><h1>Your access is back</h1><p>Hi {{userName}},</p><p>Your bank has confirmed your payment for <strong>{{contentTitle}}</strong>, {{accessSentence}}</p><div class="details"><p style="margin:5px 0;"><strong>Item:</strong> {{contentTitle}}</p><p style="margin:5px 0;"><strong>Amount:</strong> {{amount}}</p><p style="margin:5px 0;"><strong>Paid:</strong> {{paidOn}}</p></div><p style="text-align:center;margin:30px 0;"><a href="{{itemUrl}}" class="button" style="color:white;">{{buttonLabel}}</a></p><div class="footer"><p>{{platformName}} - <a href="mailto:{{supportEmail}}">{{supportEmail}}</a></p></div></div></body></html>$tpl$,
  $tpl$Hi {{userName}},

Your bank has confirmed your payment for {{contentTitle}}, {{accessSentence}}

Item: {{contentTitle}}
Amount: {{amount}}
Paid: {{paidOn}}

{{buttonLabel}}: {{itemUrl}}

{{platformName}}$tpl$,
  $tpl$Sent once to a buyer when a chargeback that was lost is won later and their purchase or course comes back (Codex-2hxff.70, Q5). It says the bank confirmed the payment, never that the buyer disputed it. The sender composes accessSentence and buttonLabel: the template has no conditionals.$tpl$,
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM "email_templates"
  WHERE "name" = $tpl$purchase-access-restored$tpl$ AND "scope" = 'global' AND "deleted_at" IS NULL
);
--> statement-breakpoint
RESET lock_timeout;