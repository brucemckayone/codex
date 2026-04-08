-- Code review remediation: schema fixes
-- 1. Fix 5 unique constraints to exclude soft-deleted rows
-- 2. Add partial unique index for active subscriptions per user per org
-- 3. Add composite index for library query join path
-- 4. Drop deprecated visibility column from content table

-- ================================================================
-- 1. Content slug unique indexes: add deleted_at IS NULL filter
-- ================================================================

-- Drop existing partial unique indexes
DROP INDEX IF EXISTS "idx_unique_content_slug_per_org";
DROP INDEX IF EXISTS "idx_unique_content_slug_personal";

-- Recreate with soft-delete exclusion
CREATE UNIQUE INDEX "idx_unique_content_slug_per_org"
  ON "content" ("slug", "organization_id")
  WHERE "organization_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "idx_unique_content_slug_personal"
  ON "content" ("slug", "creator_id")
  WHERE "organization_id" IS NULL AND "deleted_at" IS NULL;

-- ================================================================
-- 2. Organization slug: replace column-level unique with partial index
-- ================================================================

-- Drop inline unique constraint (named by Drizzle as organizations_slug_unique)
ALTER TABLE "organizations" DROP CONSTRAINT IF EXISTS "organizations_slug_unique";

-- Create partial unique index excluding soft-deleted orgs
CREATE UNIQUE INDEX "idx_unique_org_slug"
  ON "organizations" ("slug")
  WHERE "deleted_at" IS NULL;

-- ================================================================
-- 3. Username: replace column-level unique with partial index
-- ================================================================

-- Drop inline unique constraint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique";

-- Create partial unique index excluding soft-deleted users
CREATE UNIQUE INDEX "idx_unique_username"
  ON "users" ("username")
  WHERE "deleted_at" IS NULL;

-- ================================================================
-- 4. Subscription tier sort order: add deleted_at IS NULL filter
-- ================================================================

-- Drop existing constraint (was a plain unique, now becomes a partial unique index)
ALTER TABLE "subscription_tiers" DROP CONSTRAINT IF EXISTS "uq_subscription_tiers_org_sort";

CREATE UNIQUE INDEX "uq_subscription_tiers_org_sort"
  ON "subscription_tiers" ("organization_id", "sort_order")
  WHERE "deleted_at" IS NULL;

-- ================================================================
-- 5. Active subscription uniqueness per user per org
-- ================================================================

CREATE UNIQUE INDEX "uq_active_subscription_per_user_org"
  ON "subscriptions" ("user_id", "organization_id")
  WHERE "status" IN ('active', 'past_due', 'cancelling');

-- ================================================================
-- 6. Composite index for library query join path
-- ================================================================

CREATE INDEX "idx_purchases_customer_status_content"
  ON "purchases" ("customer_id", "status", "content_id");

-- ================================================================
-- 7. Drop deprecated visibility column
-- ================================================================

-- Drop the CHECK constraint first
ALTER TABLE "content" DROP CONSTRAINT IF EXISTS "check_content_visibility";

-- Drop the column
ALTER TABLE "content" DROP COLUMN IF EXISTS "visibility";
