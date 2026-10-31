-- Fee changes become dated versions, and a rise waits for its emails
-- (Codex-2hxff.33; batch C1 Part B data design §1.2, §6.1). ADDITIVE: three
-- new tables and two nullable columns on fee_config_audit_log. Nothing old is
-- dropped or changed, so this applies safely before the workers deploy.
--
-- EXPAND (this file):
--   1. fee_changes (one row per announcement; a cut is dated at once, a rise
--      waits for everyone it affects to be told), fee_config_versions (the
--      level's full values from that change on; insert-only, a removal is a
--      `removed` version) and fee_change_notices (one row per person, change
--      and kind of email, retried daily by notifications-api).
--   2. fee_config_audit_log gains change_id and effective_from.
--   3. BACKFILL: one cut change and one version per existing fee_config_*
--      row, at effective_from 1970-01-01T00:00Z, so every lookup, including a
--      replay of an old invoice, resolves exactly today's values.
--   4. SEED: the fee-change-notice and fee-change-cancelled templates (the
--      deploy's seed would add them too; here they exist the moment the
--      tables do, as 0106 does for copy).
-- MIGRATE (the first deploy): the resolver reads versions; admin-api writes
-- versions and changes, and keeps the three old "current row" tables in step
-- with the values in force NOW (never a waiting rise), so code rolled back
-- to before this reads the right fee, and a waiting rise simply never starts.
-- CONTRACT (a later release): stop writing fee_config_platform, _org and
-- _org_creator, then drop or rename them. The audit log stays.
--
-- DEPLOY ORDER: migrations run before every worker. Old workers never read
-- the new tables. A rise saved by the new admin-api before notifications-api
-- ships its fee step simply waits for the first run after it ships: later,
-- never sooner.
--
-- The one-waiting-rise index covers WAITING rises only (effective_from IS
-- NULL): a rise that has started must not block the next one, and a dated
-- rise that hasn't started is held unique by the classifying write, which
-- locks the level first (pg_advisory_xact_lock).

CREATE TABLE "fee_change_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"on_list" boolean NOT NULL,
	"roles" jsonb NOT NULL,
	"before_values" jsonb NOT NULL,
	"after_values" jsonb NOT NULL,
	"quoted_from" date,
	"state" text DEFAULT 'due' NOT NULL,
	"last_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"last_error" text,
	"alert_error_id" uuid,
	"told_note" text,
	"told_by_user_id" text,
	"told_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_fee_change_notices_kind" CHECK ("fee_change_notices"."kind" IN ('announce', 'smaller', 'cancelled')),
	CONSTRAINT "check_fee_change_notices_state" CHECK ("fee_change_notices"."state" IN ('due', 'sent', 'failed', 'unknown', 'told_another_way', 'not_needed')),
	CONSTRAINT "check_fee_change_notices_reason" CHECK ("fee_change_notices"."last_reason" IS NULL OR "fee_change_notices"."last_reason" IN ('refused', 'skipped', 'no_address', 'unknown')),
	CONSTRAINT "check_fee_change_notices_attempts" CHECK ("fee_change_notices"."attempts" >= 0),
	CONSTRAINT "check_fee_change_notices_sent" CHECK ("fee_change_notices"."state" <> 'sent' OR "fee_change_notices"."accepted_at" IS NOT NULL),
	CONSTRAINT "check_fee_change_notices_told" CHECK ("fee_change_notices"."state" <> 'told_another_way' OR ("fee_change_notices"."told_note" IS NOT NULL AND "fee_change_notices"."told_by_user_id" IS NOT NULL AND "fee_change_notices"."told_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "fee_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"organization_id" uuid,
	"creator_id" text,
	"kind" text NOT NULL,
	"effective_from" timestamp with time zone,
	"first_run_at" timestamp with time zone,
	"listed_count" integer,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"replaces_change_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_fee_changes_scope" CHECK ("fee_changes"."scope" IN ('platform', 'org', 'creator')),
	CONSTRAINT "check_fee_changes_scope_keys" CHECK (("fee_changes"."scope" = 'platform' AND "fee_changes"."organization_id" IS NULL AND "fee_changes"."creator_id" IS NULL)
        OR ("fee_changes"."scope" = 'org' AND "fee_changes"."organization_id" IS NOT NULL AND "fee_changes"."creator_id" IS NULL)
        OR ("fee_changes"."scope" = 'creator' AND "fee_changes"."organization_id" IS NOT NULL AND "fee_changes"."creator_id" IS NOT NULL)),
	CONSTRAINT "check_fee_changes_kind" CHECK ("fee_changes"."kind" IN ('cut', 'rise')),
	CONSTRAINT "check_fee_changes_cut_dated" CHECK ("fee_changes"."kind" <> 'cut' OR "fee_changes"."effective_from" IS NOT NULL),
	CONSTRAINT "check_fee_changes_listed_pair" CHECK (("fee_changes"."first_run_at" IS NULL) = ("fee_changes"."listed_count" IS NULL) AND ("fee_changes"."first_run_at" IS NULL OR "fee_changes"."kind" = 'rise')),
	CONSTRAINT "check_fee_changes_void_pair" CHECK (("fee_changes"."voided_at" IS NULL) = ("fee_changes"."void_reason" IS NULL)),
	CONSTRAINT "check_fee_changes_void_reason" CHECK ("fee_changes"."void_reason" IS NULL OR "fee_changes"."void_reason" IN ('cancelled', 'cut_below_today', 'replaced_by_bigger'))
);
--> statement-breakpoint
CREATE TABLE "fee_config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"platform_fee_percent" integer,
	"one_off_org_fee_percent" integer,
	"subscription_org_fee_percent" integer,
	"org_fee_percent" integer,
	"min_platform_fee_cents" integer,
	"min_transfer_cents" integer,
	"notes" text,
	"removed" boolean DEFAULT false NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_fee_config_versions_scope" CHECK ("fee_config_versions"."scope" IN ('platform', 'org', 'creator')),
	CONSTRAINT "check_fee_config_versions_platform_shape" CHECK ("fee_config_versions"."scope" <> 'platform' OR ("fee_config_versions"."platform_fee_percent" IS NOT NULL AND "fee_config_versions"."one_off_org_fee_percent" IS NOT NULL AND "fee_config_versions"."subscription_org_fee_percent" IS NOT NULL AND "fee_config_versions"."min_platform_fee_cents" IS NOT NULL AND "fee_config_versions"."min_transfer_cents" IS NOT NULL AND "fee_config_versions"."org_fee_percent" IS NULL AND NOT "fee_config_versions"."removed")),
	CONSTRAINT "check_fee_config_versions_level_shape" CHECK ("fee_config_versions"."scope" = 'platform' OR ("fee_config_versions"."one_off_org_fee_percent" IS NULL AND "fee_config_versions"."subscription_org_fee_percent" IS NULL)),
	CONSTRAINT "check_fee_config_versions_notes_creator" CHECK ("fee_config_versions"."notes" IS NULL OR "fee_config_versions"."scope" = 'creator'),
	CONSTRAINT "check_fee_config_versions_removed_empty" CHECK (NOT "fee_config_versions"."removed" OR ("fee_config_versions"."platform_fee_percent" IS NULL AND "fee_config_versions"."org_fee_percent" IS NULL AND "fee_config_versions"."min_platform_fee_cents" IS NULL AND "fee_config_versions"."min_transfer_cents" IS NULL AND "fee_config_versions"."notes" IS NULL)),
	CONSTRAINT "check_fee_config_versions_bps" CHECK (("fee_config_versions"."platform_fee_percent" IS NULL OR "fee_config_versions"."platform_fee_percent" BETWEEN 0 AND 10000)
        AND ("fee_config_versions"."one_off_org_fee_percent" IS NULL OR "fee_config_versions"."one_off_org_fee_percent" BETWEEN 0 AND 10000)
        AND ("fee_config_versions"."subscription_org_fee_percent" IS NULL OR "fee_config_versions"."subscription_org_fee_percent" BETWEEN 0 AND 10000)
        AND ("fee_config_versions"."org_fee_percent" IS NULL OR "fee_config_versions"."org_fee_percent" BETWEEN 0 AND 10000)),
	CONSTRAINT "check_fee_config_versions_cents" CHECK (("fee_config_versions"."min_platform_fee_cents" IS NULL OR "fee_config_versions"."min_platform_fee_cents" >= 0)
        AND ("fee_config_versions"."min_transfer_cents" IS NULL OR "fee_config_versions"."min_transfer_cents" >= 0))
);
--> statement-breakpoint
ALTER TABLE "fee_config_audit_log" ADD COLUMN "change_id" uuid;--> statement-breakpoint
ALTER TABLE "fee_config_audit_log" ADD COLUMN "effective_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fee_change_notices" ADD CONSTRAINT "fee_change_notices_change_id_fee_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."fee_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_change_notices" ADD CONSTRAINT "fee_change_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_change_notices" ADD CONSTRAINT "fee_change_notices_told_by_user_id_users_id_fk" FOREIGN KEY ("told_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_changes" ADD CONSTRAINT "fee_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_changes" ADD CONSTRAINT "fee_changes_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_changes" ADD CONSTRAINT "fee_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_changes" ADD CONSTRAINT "fk_fee_changes_replaces" FOREIGN KEY ("replaces_change_id") REFERENCES "public"."fee_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_config_versions" ADD CONSTRAINT "fee_config_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-ordered: the composite FK below needs its parent unique index first.
CREATE UNIQUE INDEX "uq_fee_changes_id_scope" ON "fee_changes" USING btree ("id","scope");--> statement-breakpoint
ALTER TABLE "fee_config_versions" ADD CONSTRAINT "fk_fee_config_versions_change_scope" FOREIGN KEY ("change_id","scope") REFERENCES "public"."fee_changes"("id","scope") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fee_change_notices_person" ON "fee_change_notices" USING btree ("change_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "idx_fee_change_notices_open" ON "fee_change_notices" USING btree ("state","created_at") WHERE "fee_change_notices"."state" IN ('due', 'failed', 'unknown');--> statement-breakpoint
CREATE INDEX "idx_fee_change_notices_user" ON "fee_change_notices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_fee_change_notices_change" ON "fee_change_notices" USING btree ("change_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fee_changes_one_waiting_rise" ON "fee_changes" USING btree ("scope",COALESCE("organization_id", '00000000-0000-0000-0000-000000000000'::uuid),COALESCE("creator_id", '')) WHERE "fee_changes"."kind" = 'rise' AND "fee_changes"."voided_at" IS NULL AND "fee_changes"."effective_from" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_fee_changes_level" ON "fee_changes" USING btree ("scope","organization_id","creator_id");--> statement-breakpoint
CREATE INDEX "idx_fee_changes_waiting" ON "fee_changes" USING btree ("created_at") WHERE "fee_changes"."kind" = 'rise' AND "fee_changes"."voided_at" IS NULL AND "fee_changes"."effective_from" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fee_config_versions_live" ON "fee_config_versions" USING btree ("change_id") WHERE "fee_config_versions"."superseded_at" IS NULL;--> statement-breakpoint
ALTER TABLE "fee_config_audit_log" ADD CONSTRAINT "fee_config_audit_log_change_id_fee_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."fee_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- 3. BACKFILL. One cut change and its version per existing row, dated at the
--    epoch so it is in force for every sale, old or new. created_at keeps the
--    row's last write; created_by its author (NULL if since deleted). Guarded
--    on the level having no change yet, so a second run adds nothing.
WITH "backfilled" AS (
  INSERT INTO "fee_changes" ("scope", "kind", "effective_from", "created_by", "created_at")
  SELECT 'platform', 'cut', '1970-01-01T00:00:00Z'::timestamptz, p."updated_by", p."updated_at"
  FROM "fee_config_platform" p
  WHERE NOT EXISTS (SELECT 1 FROM "fee_changes" c WHERE c."scope" = 'platform')
  RETURNING "id"
)
INSERT INTO "fee_config_versions" (
  "change_id", "scope", "platform_fee_percent", "one_off_org_fee_percent",
  "subscription_org_fee_percent", "min_platform_fee_cents", "min_transfer_cents",
  "created_by", "created_at"
)
SELECT b."id", 'platform', p."platform_fee_percent", p."one_off_org_fee_percent",
  p."subscription_org_fee_percent", p."min_platform_fee_cents", p."min_transfer_cents",
  p."updated_by", p."updated_at"
FROM "backfilled" b CROSS JOIN "fee_config_platform" p;
--> statement-breakpoint
WITH "backfilled" AS (
  INSERT INTO "fee_changes" ("scope", "organization_id", "kind", "effective_from", "created_by", "created_at")
  SELECT 'org', o."organization_id", 'cut', '1970-01-01T00:00:00Z'::timestamptz, o."updated_by", o."updated_at"
  FROM "fee_config_org" o
  WHERE NOT EXISTS (
    SELECT 1 FROM "fee_changes" c
    WHERE c."scope" = 'org' AND c."organization_id" = o."organization_id"
  )
  RETURNING "id", "organization_id"
)
INSERT INTO "fee_config_versions" (
  "change_id", "scope", "platform_fee_percent", "org_fee_percent",
  "min_platform_fee_cents", "min_transfer_cents", "created_by", "created_at"
)
SELECT b."id", 'org', o."platform_fee_percent", o."org_fee_percent",
  o."min_platform_fee_cents", o."min_transfer_cents", o."updated_by", o."updated_at"
FROM "backfilled" b
JOIN "fee_config_org" o ON o."organization_id" = b."organization_id";
--> statement-breakpoint
WITH "backfilled" AS (
  INSERT INTO "fee_changes" ("scope", "organization_id", "creator_id", "kind", "effective_from", "created_by", "created_at")
  SELECT 'creator', oc."organization_id", oc."creator_id", 'cut', '1970-01-01T00:00:00Z'::timestamptz, oc."updated_by", oc."updated_at"
  FROM "fee_config_org_creator" oc
  WHERE NOT EXISTS (
    SELECT 1 FROM "fee_changes" c
    WHERE c."scope" = 'creator'
      AND c."organization_id" = oc."organization_id"
      AND c."creator_id" = oc."creator_id"
  )
  RETURNING "id", "organization_id", "creator_id"
)
INSERT INTO "fee_config_versions" (
  "change_id", "scope", "platform_fee_percent", "org_fee_percent",
  "min_platform_fee_cents", "min_transfer_cents", "notes", "created_by", "created_at"
)
SELECT b."id", 'creator', oc."platform_fee_percent", oc."org_fee_percent",
  oc."min_platform_fee_cents", oc."min_transfer_cents", oc."notes", oc."updated_by", oc."updated_at"
FROM "backfilled" b
JOIN "fee_config_org_creator" oc
  ON oc."organization_id" = b."organization_id" AND oc."creator_id" = b."creator_id";
