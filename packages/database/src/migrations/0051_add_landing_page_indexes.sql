-- Composite indexes for org landing page query performance
-- Covers: getPublicContent (newest/oldest sorted by publishedAt), getPublicCreators (content counts per creator)

-- Content: org landing page queries (status + publishedAt sort, filtered to non-deleted)
CREATE INDEX IF NOT EXISTS "idx_content_org_published"
  ON "content" ("organization_id", "status", "published_at")
  WHERE "deleted_at" IS NULL;

-- Content: creator content counts within an org (filtered to non-deleted)
CREATE INDEX IF NOT EXISTS "idx_content_creator_org_published"
  ON "content" ("creator_id", "organization_id", "status")
  WHERE "deleted_at" IS NULL;

-- Memberships: active members by org + role (for public creators endpoint)
CREATE INDEX IF NOT EXISTS "idx_org_memberships_org_active_role"
  ON "organization_memberships" ("organization_id", "status", "role")
  WHERE "status" = 'active';
