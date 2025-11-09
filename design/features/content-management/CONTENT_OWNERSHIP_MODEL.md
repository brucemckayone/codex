# Content Ownership Model: Creator vs Organization

**Purpose**: Clarify the fundamental ownership model for content in Codex - whether creators or organizations own content, and how this impacts the multi-tenant architecture, R2 bucket structure, and revenue sharing.

**Version**: 1.0
**Last Updated**: 2025-11-04
**Status**: Planning - Requires Architecture Decision

---

## Problem Statement

The current design has ambiguity around content ownership:

- **Current R2 Structure**: Buckets organized by `creatorId` (suggests creator ownership)
- **Current Auth Model**: Organizations own data, creators are members/staff
- **Current Revenue Model**: Platform Owner keeps subscription revenue (creator payouts Phase 3+)
- **Unclear**: Can one creator share content across multiple organizations? Who owns the content?

This needs clarification because it affects:
- R2 bucket organization (creator-scoped vs organization-scoped)
- Content reusability (can creator share same content across orgs?)
- Revenue attribution (who gets paid when content is sold?)
- Multi-org support (Phase 2+)
- Creator independence (can creators own their content independently?)

---

## Option A: Creator-Owned Content (Recommended)

**Model**: Creators own all content. Organizations license/feature creator content.

### Architecture

**Ownership**:
- Creator uploads content to their creator account
- Content has `owner_id` pointing to creator user
- Creator can share content across multiple organizations
- Organizations have no ownership, only display/feature rights

**R2 Structure** (Creator-Scoped):
```
codex-media-production/
├── {creatorId-1}/                    # Creator owns this content
│   ├── originals/
│   │   └── {mediaId}/
│   │       └── original.mp4
│   ├── hls/
│   │   └── {mediaId}/
│   │       └── master.m3u8
│   └── audio/
│       └── {mediaId}/
│           └── audio.mp3
│
├── {creatorId-2}/
│   ├── originals/
│   └── ...
```

**Database Schema**:
```
content:
  id, creatorId, title, description, ...
  # Creator owns content (one creator per content)

content_organization_assignments:
  id, contentId, organizationId, visibility
  # Tracks which orgs can feature this content
  # visibility: 'featured', 'available', 'hidden'
```

**Key Features**:
- Creator can upload content once, feature it across multiple orgs
- No duplication in R2 (single source of truth)
- Creator controls content visibility per organization
- Organization can enable/disable content for their customers
- Revenue attribution: track which org drove the purchase

**Use Cases**:

1. **Independent Creator with Multiple Orgs**:
   - Creator "Jane" uploads yoga video once
   - Jane shares video to "Yoga Studio A" and "Yoga Studio B"
   - Both orgs can sell the video
   - Jane gets paid based on sales from both orgs

2. **Creator + Organization Owner (Same Person)**:
   - Owner creates their own content
   - Content is owned by their creator account
   - Content appears in their organization
   - Full control and earnings

3. **Organization with External Creators**:
   - Organization "Wellness Co" invites external creators
   - Creators upload content to their creator accounts
   - Creators choose to share with Wellness Co
   - Wellness Co can feature it in their storefront
   - Revenue split between creator and org (defined in agreement)

### Advantages

✅ **Creator Independence**: Creators own their work, can build personal brand
✅ **Content Reusability**: Upload once, sell everywhere (no duplication)
✅ **Flexibility**: Creator can work with multiple organizations
✅ **Scalability**: Works perfectly for Phase 2+ multi-org
✅ **Fair Revenue**: Creator always owns their content, gets direct payment
✅ **Future-Proof**: Supports freelancer marketplace model

### Disadvantages

❌ **Complex Visibility**: Need to manage per-org access control
❌ **Content Moderation**: Must be careful about content permissions per org
❌ **Database Complexity**: More relationships (content → creator → multiple orgs)

---

## Option B: Organization-Owned Content (Current Assumption)

**Model**: Organizations own all content created by their members. Content cannot be shared across orgs.

### Architecture

**Ownership**:
- Organization owns all content created by members
- Content has `organizationId` pointing to owner org
- Content cannot be shared across organizations
- Creator is just the "contributor" (no ownership)

**R2 Structure** (Organization-Scoped):
```
codex-media-production/
├── {organizationId-1}/
│   ├── {creatorId-1}/
│   │   ├── originals/
│   │   └── hls/
│   ├── {creatorId-2}/
│   │   ├── originals/
│   │   └── hls/
│   └── ...
│
├── {organizationId-2}/
│   ├── {creatorId-1}/
│   │   ├── originals/
│   │   └── hls/
│   └── ...
```

**Database Schema**:
```
content:
  id, organizationId, createdBy, title, description, ...
  # Organization owns content (one org per content)
  # createdBy tracks which member created it
```

**Key Features**:
- Each organization owns all its content
- Content is isolated per organization
- Creators are employees/contractors of the org
- Cannot share content across orgs (would need re-upload)

**Use Cases**:

1. **Single Organization (Phase 1)**:
   - You create content for your organization
   - You manage all content
   - Simple, straightforward

2. **Organization with Team**:
   - Admin invites team members
   - Team members upload content to org
   - Organization owns everything
   - Organization controls revenue

### Advantages

✅ **Simplicity**: Clear ownership model (org owns everything)
✅ **Easy Access Control**: All content in one place (organization-scoped)
✅ **Clear Revenue**: Organization gets all revenue (no complex splits)
✅ **Easy Deletion**: Delete org = delete all content

### Disadvantages

❌ **Content Duplication**: Creator uploads same content to multiple orgs = duplicated in R2
❌ **Creator Inflexibility**: Creator tied to single org, can't build personal brand
❌ **Reuse Friction**: Cannot reuse content across orgs without re-uploading
❌ **Doesn't Scale**: Phase 2 multi-creator with multiple orgs becomes problematic
❌ **Storage Waste**: Same video uploaded to 3 orgs = 3x storage cost

---

## Recommendation: Creator-Owned Model (Option A)

Based on the platform vision (multi-creator marketplace, scalability, creator independence), **Option A (Creator-Owned)** is recommended.

### Why Option A is Better for Codex

1. **Aligns with Platform Vision**: Codex is designed as a platform for creators, not just organizations
2. **Scales to Phase 2+**: Multi-creator and multi-org naturally supported
3. **Reduces Costs**: No content duplication in R2
4. **Creator Independence**: Creators build their brand, not locked into orgs
5. **Flexibility**: Creators can work solo or with multiple organizations
6. **Fair Revenue**: Creators own their work and get paid directly

### Implementation Path

**Phase 1** (Single Org, Creator-Owned):
- You are both platform owner AND creator
- You upload content to your creator account
- Your organization features your content
- No multi-org visibility needed yet
- R2 structure: `{creatorId}/originals/` (single creator = you)

**Phase 2** (Multi-Org, Creator-Owned):
- New creators join platform
- Each creator uploads to their creator account
- Organizations feature creator content
- Database tracks creator → organization assignments
- R2 structure stays same: `{creatorId}/originals/` (scales cleanly)

**Phase 2+ Revenue**:
- Creator → Content (owned by creator)
- Organization → Featured Content (selects creator content to feature)
- Purchase → Revenue Attribution (which org sold it? creator gets paid)

---

## R2 Structure Refinement (Creator-Owned)

With creator-owned content, the current R2 structure is correct and should be maintained:

### Media Bucket

```
codex-media-production/
├── {creatorId-1}/                    # All of Creator 1's media
│   ├── originals/
│   │   └── {mediaId}/
│   │       └── original.mp4
│   ├── hls/
│   │   └── {mediaId}/
│   │       ├── master.m3u8
│   │       ├── 1080p/
│   │       ├── 720p/
│   │       └── ...
│   └── audio/
│       └── {mediaId}/
│           └── audio.mp3
│
├── {creatorId-2}/                    # All of Creator 2's media
│   ├── originals/
│   │   └── {mediaId}/
│   │       └── original.mp4
│   └── ...
```

**Benefits**:
- ✅ Clean organization by creator ownership
- ✅ Easy to calculate storage per creator (sum all objects under `{creatorId}/`)
- ✅ Easy to delete creator content (delete entire `{creatorId}/` prefix)
- ✅ Aligns with creator independence model
- ✅ Works perfectly when scaled to hundreds of creators

### Resources Bucket

```
codex-resources-production/
├── {creatorId-1}/                    # Creator 1's resources
│   ├── {resourceId-1}/
│   │   └── workbook.pdf
│   └── {resourceId-2}/
│       └── guide.pdf
│
├── {creatorId-2}/                    # Creator 2's resources
│   └── {resourceId}/
│       └── template.xlsx
```

**Key Design**:
- Resources belong to creator (not to specific content/offering)
- Can be attached to multiple pieces of content
- Database tracks attachments (many-to-many)

### Assets Bucket

```
codex-assets-production/
├── {creatorId-1}/
│   ├── thumbnails/
│   │   ├── content/
│   │   │   └── {contentId}/
│   │   │       ├── auto-generated.jpg
│   │   │       └── custom.jpg
│   │   └── offerings/
│   │       └── {offeringId}/
│   │           └── hero-image.jpg
│   └── branding/
│       ├── logo.png
│       └── banner.jpg
│
├── {creatorId-2}/
│   └── ...
```

**Key Design**:
- All creator assets organized under creator ID
- Easy to spot which creator owns which assets
- Scales cleanly with more creators

---

## Database Schema (Creator-Owned Model)

### Content Ownership

```sql
CREATE TABLE content (
  id UUID PRIMARY KEY,
  creatorId UUID NOT NULL REFERENCES users(id),      -- Creator owns content
  organizationId UUID REFERENCES organizations(id),  -- Which org this was created for (Phase 1 only, null for independent)
  title VARCHAR NOT NULL,
  description TEXT,
  contentType ENUM('video', 'audio', 'written'),
  status ENUM('draft', 'published', 'archived'),
  visibility ENUM('public', 'private', 'members_only'),
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);

CREATE INDEX idx_content_creator ON content(creatorId);
CREATE INDEX idx_content_organization ON content(organizationId);
```

### Content Organization Assignments (Phase 2+)

Once creators can share content across multiple orgs:

```sql
CREATE TABLE content_organization_assignments (
  id UUID PRIMARY KEY,
  contentId UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  organizationId UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visibility ENUM('featured', 'available', 'hidden'),
  featuredAt TIMESTAMP,              -- When org featured this content
  createdAt TIMESTAMP,
  UNIQUE(contentId, organizationId)
);

CREATE INDEX idx_assignment_organization ON content_organization_assignments(organizationId);
```

### Purchase Attribution (Phase 2+)

```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY,
  userId UUID NOT NULL REFERENCES users(id),
  contentId UUID NOT NULL REFERENCES content(id),
  organizationId UUID NOT NULL REFERENCES organizations(id),  -- Which org sold it
  creatorId UUID NOT NULL REFERENCES users(id),               -- Who created it
  amount DECIMAL,
  status ENUM('completed', 'refunded', 'failed'),
  createdAt TIMESTAMP
);

CREATE INDEX idx_purchase_creator ON purchases(creatorId);
CREATE INDEX idx_purchase_organization ON purchases(organizationId);
```

---

## Phase 1 MVP Implementation

With creator-owned model, Phase 1 is actually simpler:

**Phase 1 Reality**:
- You are the platform owner AND the only creator
- You upload content to your creator ID
- Your organization (the only one) features your content
- All content in R2 organized under your `creatorId`
- No multi-org complexity yet (but schema supports it)

**Example**:
```
codex-media-production/
└── {your-user-id}/
    ├── originals/
    │   ├── yoga-video-1/
    │   └── yoga-video-2/
    ├── hls/
    │   ├── yoga-video-1/
    │   └── yoga-video-2/
    └── audio/
        └── meditation-audio-1/
```

**Database**:
```sql
content:
  id: content-123
  creatorId: your-user-id    -- You created this
  organizationId: org-1      -- Your organization
  title: "Yoga Basics"
  ...
```

Very clean and simple for Phase 1, but scales beautifully to Phase 2+.

---

## Related Documents to Update

Once this architecture is approved, update:

1. **[R2BucketStructure.md](./infrastructure/R2BucketStructure.md)**
   - Add explicit note: "R2 organized by creatorId (creator owns content)"
   - Clarify creator ownership vs organization assignment
   - Update examples with creator ownership clearly labeled

2. **[Auth EVOLUTION.md](./features/auth/EVOLUTION.md)**
   - Clarify creator role owns content
   - Explain how creators can share across orgs (Phase 2+)
   - Update organizational relationships

3. **[Content Management PRD/TDD](./features/content-management/pdr-phase-1.md)**
   - Clarify content ownership by creator
   - Update upload flow to show creator ownership
   - Update deletion to show creator's content deletion

4. **[Content Access EVOLUTION.md](./features/content-access/EVOLUTION.md)**
   - Clarify access control checks creator ownership
   - Update RLS policies for creator-owned model
   - Explain organization visibility of creator content

5. **[Database Schema](./infrastructure/DatabaseSchema.md)**
   - Add `creatorId` to content table
   - Add `content_organization_assignments` table
   - Update indexes for efficient lookups

6. **[Admin Dashboard EVOLUTION.md](./features/admin-dashboard/EVOLUTION.md)**
   - Creator can manage own content across orgs (Phase 2+)
   - Organization can feature/hide creator content
   - Separate "creator dashboard" from "organization dashboard"

---

## Open Questions

1. **Phase 1 Revenue**: If creator-owned, and you're the only creator, do you pay yourself? Or does revenue go straight to platform?
   - **Proposed**: Revenue goes to organization for Phase 1 (you own both). Payout system Phase 3+ when multiple creators exist.

2. **Creator Discovery**: How do customers discover creator content? By organization only, or by creator?
   - **Proposed**: Phase 1: By organization only. Phase 2+: By creator profile page.

3. **Creator Branding**: Can creators have their own branding/storefront separate from org?
   - **Proposed**: Phase 2+ feature. Phase 1: All content under organization branding.

4. **Content Approval**: Who approves creator content? Creator or organization?
   - **Proposed**: Organization approves. Creator uploads, org reviews before publishing.

5. **Multi-Creator Phase 1**: Should Phase 1 support multiple creators on team, or Phase 2?
   - **Proposed**: Phase 1 allows team members (as "members"). Phase 2 upgrades to "creator" role with independent content ownership.

---

## Conclusion

The **Creator-Owned Content Model (Option A)** is recommended because:

1. **Aligns with Codex vision**: Platform for creators to build independent businesses
2. **Cleanly scales**: Phase 1 (single creator) → Phase 2 (multiple creators across orgs)
3. **Reduces costs**: No R2 duplication
4. **Fair to creators**: They own their work and build their brand
5. **Flexible organizations**: Can feature any creator's content
6. **Simple R2 structure**: Already designed correctly by `creatorId`

The R2 bucket structure is already organized correctly for this model. We just need to clarify it in the documentation and ensure the database schema and access control reflect creator ownership.

**Next Steps**:
1. Confirm this architectural decision
2. Update all related documents
3. Update database schema design
4. Plan creator profile and discovery features
5. Plan Phase 2+ multi-org content sharing
