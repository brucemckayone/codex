ALTER TABLE "organizations" DROP CONSTRAINT "organizations_primary_connect_account_user_id_users_id_fk";
--> statement-breakpoint
CREATE INDEX "idx_email_audit_logs_recipient_template_created" ON "email_audit_logs" USING btree ("recipient_email","template_name","created_at");--> statement-breakpoint
-- primary_connect_account_user_id: dropped in step 2, after this release is live (Codex-2hxff.36)
ALTER TABLE "disputes" ADD CONSTRAINT "check_disputes_buyer_told" CHECK ("disputes"."buyer_told_at" IS NULL OR "disputes"."late_won_at" IS NOT NULL);