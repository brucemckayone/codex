CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"creator_id" text NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" varchar(500),
	"icon" varchar(64),
	"cover_image_key" varchar(500),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_categories" (
	"content_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "content_categories_content_id_category_id_pk" PRIMARY KEY("content_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_categories" ADD CONSTRAINT "content_categories_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_categories" ADD CONSTRAINT "content_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_categories_org_id" ON "categories" USING btree ("organization_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_categories_creator_id" ON "categories" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_category_slug_per_org" ON "categories" USING btree ("slug","organization_id") WHERE "categories"."organization_id" IS NOT NULL AND "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_category_slug_personal" ON "categories" USING btree ("slug","creator_id") WHERE "categories"."organization_id" IS NULL AND "categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_content_categories_category_id" ON "content_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_content_categories_content_id" ON "content_categories" USING btree ("content_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Data backfill (idempotent): seed `categories` from the legacy free-text
-- `content.category` column, one row per DISTINCT (space, category), then link
-- content -> category via `content_categories`. Re-running is a no-op: the
-- per-space partial unique slug indexes and the join primary key make every
-- INSERT idempotent via untargeted ON CONFLICT DO NOTHING (which covers both
-- partial unique indexes). `content.category` is left untouched as a
-- read-only legacy column (dropped in a later cleanup).
-- Slug rule (backfill-only, identical on both sides so the join matches):
-- lower(non-alphanumeric runs -> '-'). The service layer owns the canonical
-- slug rule going forward.
-- ---------------------------------------------------------------------------
INSERT INTO "categories" (
	"id", "organization_id", "creator_id", "name", "slug", "sort_order", "created_at", "updated_at"
)
SELECT
	gen_random_uuid(),
	c."organization_id",
	c."creator_id",
	c."category",
	lower(regexp_replace(trim(c."category"), '[^a-zA-Z0-9]+', '-', 'g')),
	0,
	now(),
	now()
FROM (
	SELECT DISTINCT "organization_id", "creator_id", "category"
	FROM "content"
	WHERE "category" IS NOT NULL
		AND trim("category") <> ''
		AND "deleted_at" IS NULL
) c
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "content_categories" ("content_id", "category_id")
SELECT ct."id", cat."id"
FROM "content" ct
JOIN "categories" cat
	ON cat."creator_id" = ct."creator_id"
	AND cat."organization_id" IS NOT DISTINCT FROM ct."organization_id"
	AND cat."slug" = lower(regexp_replace(trim(ct."category"), '[^a-zA-Z0-9]+', '-', 'g'))
	AND cat."deleted_at" IS NULL
WHERE ct."category" IS NOT NULL
	AND trim(ct."category") <> ''
	AND ct."deleted_at" IS NULL
ON CONFLICT DO NOTHING;