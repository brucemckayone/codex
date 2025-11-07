# Architecture Update Summary - Creator-Owned Media Model

**Date**: 2025-11-07
**Status**: ✅ Complete
**Commits**: 03b9197, 9d29979, c73ac0c

---

## Overview

This document summarizes the major architectural updates made to align all documentation with the **creator-owned media model**. The changes were made after user clarification that media should be owned by creators (not organizations), and content posts can exist on personal creator profiles or organizations.

---

## Key Architectural Decisions Confirmed

### 1. Media Ownership Model

**❌ OLD (Incorrect)**:
- Media stored at organization level
- `media_items.organization_id`
- R2 buckets: `codex-media-{organization_id}`

**✅ NEW (Correct)**:
- Media owned by creators
- `media_items.creator_id`
- R2 buckets: `codex-media-{creator_id}`
- Same media item can be used across multiple content posts/organizations

### 2. Content Posting Model

**✅ CONFIRMED**:
- Content posts have `creator_id` (who created it) AND `organization_id` (where posted)
- `organization_id = NULL` → Personal creator profile
- `organization_id = X` → Organization content
- Slug unique per organization (or per creator if personal)

### 3. Phase 1 Roles

**❌ OLD (Incorrect)**:
- Single "Platform Owner" who does everything
- No creators until Phase 3

**✅ NEW (Correct)**:
- **Platform Owner** = Super admin (developer), not content creator
- **Organization Owner** = Business operator who IS ALSO a creator
- **Creator** exists from Phase 1 (org owner is a creator)
- Database supports multi-creator from day 1, but Phase 1 UI only for single org

### 4. Multi-Organization Support

**✅ CONFIRMED**:
- Phase 1: Single organization, but database structure ready for multi-org
- Phase 2+: Add UI for creating orgs, inviting creators
- No schema changes needed between Phase 1 and Phase 2

---

## Files Updated

### Core Architecture Documents

#### 1. `design/features/shared/database-schema.md`
**Changes**:
- ✅ Added `media_items` table with `creator_id` (not `organization_id`)
- ✅ Updated `content` table to include:
  - `creator_id` (who created post)
  - `organization_id` (nullable - where posted)
  - `media_item_id` (references creator's media)
- ✅ Documented media library pattern
- ✅ Added indexes for creator and organization scoping
- ✅ Added unique constraint: `(slug, organization_id)`

#### 2. `design/features/auth/EVOLUTION.md`
**Changes**:
- ✅ Updated user types table:
  - Platform Owner = super admin (not org owner)
  - Organization Owner = business operator + creator
  - Creator exists in Phase 1
- ✅ Updated Phase 1 description:
  - Single org in Phase 1
  - Org owner IS a creator
  - Database supports multi-creator from day 1
- ✅ Updated Phase 1 limitations:
  - No UI for inviting creators yet (database ready)
  - RLS policies written but not enforced
- ✅ Updated Phase 2 description:
  - Add multi-creator UI
  - Enable RLS policies
- ✅ Updated database schema diagram to show:
  - `media_items` with `creator_id`
  - `content` with `creator_id` and `organization_id`

#### 3. `design/features/content-access/EVOLUTION.md`
**Changes**:
- ✅ Updated database schema to show:
  - `media_items` table with `creator_id`
  - `content` table with `creator_id`, `organization_id`, `media_item_id`
- ✅ Documented creator-owned media in R2 buckets

### Work Packets

#### 4. `design/roadmap/work-packets/P1-CONTENT-001-content-service.md`
**Changes**:
- ✅ Fixed `mediaItems` schema:
  - `organization_id` → `creator_id`
  - Added comment: "Creator owns media"
  - Updated R2 storage comment
- ✅ Fixed `content` schema:
  - Added `creator_id`
  - Made `organization_id` nullable
  - Added unique constraint on `(slug, organization_id)`
- ✅ Updated service interface:
  - `create(input, creatorId, organizationId?)`
  - `findById(id, creatorId)`
  - `publish(id, creatorId)`
  - etc.
- ✅ Updated all service methods:
  - Check media ownership via `creator_id`
  - Support personal vs org content
  - Updated slug generation for NULL organization
- ✅ Updated test examples

### Feature PRDs

#### 5. `design/features/content-management/pdr-phase-1.md`
**Changes**:
- ✅ Updated feature summary with creator ownership model
- ✅ Updated US-CONTENT-001 (Upload Video):
  - Clarified `creator_id` ownership
  - Updated R2 bucket path
- ✅ Updated US-CONTENT-002 (Create Content):
  - Added "Post to" dropdown (My Profile vs Org)
  - Added `creator_id` and `organization_id` fields
  - Updated flow for personal vs org content
- ✅ Updated acceptance criteria:
  - Personal content (`organization_id = NULL`)
  - Org content appears in catalog
- ✅ Updated database schema dependencies:
  - Documented creator ownership
  - Added nullable semantics
- ✅ Updated Content vs Media vs Resources table:
  - Added "Ownership" column
  - Documented creator-owned model

#### 6. `design/MVP-Definition.md`
**Changes**:
- ✅ Updated stakeholders section:
  - Added Platform Owner (developer/super admin)
  - Changed to Organization Owner (business operator + creator)
  - Clarified org owner IS a creator
- ✅ Updated content management section:
  - Added media library pattern explanation
  - Separated media items from content posts
  - Updated upload flow
- ✅ Updated user stories:
  - "Platform Owner" → "Organization Owner"
  - Added media library workflow
  - Added reusability concept
- ✅ Updated admin panel section:
  - Added "Media Library Management"
  - Separated media from content management
  - Updated user stories

---

## Database Schema Changes Summary

### New Tables Structure

```sql
-- Media items are creator-owned
CREATE TABLE media_items (
  id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id), -- ← CREATOR OWNS MEDIA
  media_type media_type,
  status media_status,
  r2_key VARCHAR, -- In creator's bucket: codex-media-{creator_id}
  -- ... metadata
);

-- Content posts reference media, can be personal or org
CREATE TABLE content (
  id UUID PRIMARY KEY,
  creator_id UUID NOT NULL REFERENCES users(id),      -- ← Who created post
  organization_id UUID REFERENCES organizations(id),  -- ← NULL = personal, NOT NULL = org
  media_item_id UUID REFERENCES media_items(id),      -- ← Links to creator's media
  title VARCHAR,
  slug VARCHAR,
  -- ... metadata
  UNIQUE (slug, organization_id) -- ← Slug unique per org (or per creator if NULL)
);
```

### Key Relationships

```
User (Creator)
  └─ media_items (creator_id) ← CREATOR OWNS MEDIA
       └─ content (media_item_id) ← Content references media
            ├─ creator_id ← Who created the post
            └─ organization_id ← Where posted (NULL = personal)
```

---

## What This Enables

### ✅ Creator Independence
- Creators own their media (persists even if they leave an org)
- Media stored in creator's personal R2 bucket
- Can reuse same media across multiple orgs

### ✅ Personal Creator Profiles
- Content can exist on creator's profile (`organization_id = NULL`)
- Customers can browse creator's personal content
- Future: Creator profile pages at `/creators/{creator_slug}`

### ✅ Media Reusability
- Upload once, use in multiple content posts
- Same video can be:
  - Standalone paid content
  - Part of a bundle
  - Posted to multiple organizations

### ✅ Multi-Organization Ready
- Phase 1: Single org, but database ready
- Phase 2+: Just add UI for org creation and invitations
- No schema migrations needed

---

## What Still Needs Updating (Optional)

### Lower Priority Files

1. **`design/roadmap/work-packets/P1-ACCESS-001-content-access.md`**
   - `video_playback` table has `organizationId` (could be derived from content)
   - Not critical, but could be cleaned up later

2. **Other Work Packets**
   - Check for any other references to org-owned media
   - Update if found

3. **Testing Definitions**
   - Update test scenarios to reflect creator ownership
   - Add tests for personal vs org content

---

## Implementation Checklist

When implementing these changes in code:

- [ ] Create `media_items` table with `creator_id`
- [ ] Create `content` table with `creator_id` and nullable `organization_id`
- [ ] Create R2 buckets per creator: `codex-media-{creator_id}`
- [ ] Update upload flow to use creator's bucket
- [ ] Implement slug generation for NULL organization
- [ ] Add "Post to" dropdown in content creation UI
- [ ] Update queries to filter by `creator_id`
- [ ] Test personal content (`organization_id = NULL`)
- [ ] Test media reusability (multiple content → one media)
- [ ] Update guards to check creator ownership

---

## Migration Path (If Existing Data)

If there's existing data with old schema:

1. **Create `media_items` table** with `creator_id`
2. **Migrate data**:
   ```sql
   INSERT INTO media_items (id, creator_id, ...)
   SELECT content.id, content.creator_id, ...
   FROM old_content_table;
   ```
3. **Update `content` table**:
   - Add `media_item_id` column
   - Make `organization_id` nullable
   - Add `creator_id` column
4. **Populate references**:
   ```sql
   UPDATE content
   SET media_item_id = (SELECT id FROM media_items WHERE ...);
   ```
5. **Test thoroughly** before removing old columns

---

## Questions Answered

### Q: Do creators exist in Phase 1?
**A**: Yes. Organization owner IS a creator. Database supports multi-creator from day 1, but Phase 1 UI only for single org owner.

### Q: Can content have `organization_id = NULL`?
**A**: Yes. NULL = personal creator content on their profile.

### Q: Who is the Platform Owner?
**A**: Super admin (developer), not the content creator. Separate from organization owner.

### Q: Is media creator-owned or org-owned?
**A**: Creator-owned. Stored in `codex-media-{creator_id}` buckets.

### Q: Can creators join multiple orgs in Phase 1?
**A**: Database supports it, but Phase 1 UI doesn't expose multi-org features yet.

---

## Commits Summary

### Commit 1: `03b9197` - Architecture Clarification Document
- Created `/design/ARCHITECTURE_CLARIFICATION_NEEDED.md`
- Documented conflicts and questions

### Commit 2: `9d29979` - Core Architecture Updates
- Updated database schema
- Updated Auth EVOLUTION
- Updated Content Access EVOLUTION
- Fixed P1-CONTENT-001 work packet

### Commit 3: `c73ac0c` - PRD and MVP Updates
- Updated Content Management PRD
- Updated MVP Definition
- Updated user stories and flows

---

## Verification Checklist

To verify documentation is correct:

- [x] Media items have `creator_id` (not `organization_id`)
- [x] Content has both `creator_id` and `organization_id` (nullable)
- [x] Phase 1 includes creators (org owner is creator)
- [x] Platform Owner ≠ Organization Owner
- [x] R2 buckets are per-creator
- [x] Content can be personal (`org_id = NULL`)
- [x] Media reusability documented
- [x] Work packet P1-CONTENT-001 uses correct schema
- [x] User stories reflect creator workflow

---

**Status**: ✅ Documentation aligned with correct architecture

**Next Steps**: Begin implementation following updated work packets
