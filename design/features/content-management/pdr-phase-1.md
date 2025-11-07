# Content Management - Phase 1 PRD

## Feature Summary

Content management system for Creators to upload, organize, and manage video and audio content. Phase 1 focuses on core CRUD operations with media library separation, Cloudflare R2 storage via bucket-per-creator architecture, and metadata management in Neon Postgres.

**Key Concept**: Media items (videos/audio) are **creator-owned** and stored in creator-specific R2 buckets. Content posts reference media items and can belong to organizations OR exist on creator's personal profile. This separation allows:
- Media reusability across multiple content posts/organizations
- Creator independence (media persists even if they leave an org)
- Personal creator profiles alongside organizational content

## Problem Statement

Creators need a way to:

- Upload video content (MP4, WebM, MOV) for courses, tutorials, or media libraries
- Upload audio content (MP3, M4A, WAV) for podcasts or audio lessons
- Organize content with metadata (title, description, categories, tags)
- Manage content lifecycle (draft, published, archived)
- Store media files securely in isolated creator buckets
- Prepare content for sale via e-commerce integration
- Attach downloadable resources (PDFs, workbooks) to content

Without content management:

- No way to add content to the platform
- No inventory for e-commerce purchases
- No content library for customers to access
- Platform is empty shell with no value

## Goals / Success Criteria

### Primary Goals

1. **Upload Video Content** - Creators can upload video files (MP4, WebM, MOV)
2. **Upload Audio Content** - Creators can upload audio files (MP3, M4A, WAV)
3. **Media Library Pattern** - Separate media storage from content metadata
4. **Metadata Management** - Add titles, descriptions, thumbnails, categories, pricing
5. **Content Organization** - Categorize and tag content for discovery
6. **Lifecycle Management** - Draft, publish, archive workflow
7. **Resource Attachments** - Attach PDFs/workbooks to content (reusable across content)
8. **Storage Integration** - Use Cloudflare R2 bucket-per-creator for scalable storage

### Success Metrics

- Creator can upload 1GB video file in < 5 minutes
- Uploaded media appears in media library immediately
- Content can reference existing media items (no re-upload)
- Metadata stored in database with correct relationships
- Files stored in creator-specific R2 buckets with proper access control
- Published content appears in customer catalog (after purchase)
- Draft content hidden from customers
- 100% pass rate on content management unit tests

## Scope

### In Scope (Phase 1 MVP)

- **Video Content**:
  - MP4, WebM, MOV formats
  - Direct upload to creator's R2 media bucket
  - Progress tracking for large files (up to 5GB)
  - Custom thumbnail upload (or auto-generated via transcoding)
  - Original files stored in R2 (transcoding handled separately)
- **Audio Content**:
  - MP3, M4A, WAV formats
  - Direct upload to creator's R2 media bucket
  - Progress tracking
  - Duration metadata extraction
- **Media Library**:
  - Separate `media_items` table for uploaded files
  - Content references media items (many-to-one relationship)
  - Media items can be reused across multiple content entities
  - Media status tracking (uploading, uploaded, transcoding, ready, failed)
- **Content Metadata**:
  - Title, description
  - Content type (video, audio)
  - Single category per content
  - Multiple tags
  - Pricing information (for e-commerce integration)
  - Media item reference (contentId → mediaId)
- **Resource Attachments**:
  - Attach PDFs, workbooks, files to content
  - Resources stored in creator's R2 resource bucket
  - Reusable resources (one resource → many content items)
  - See [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md) for details
- **Content Lifecycle**:
  - Draft state (hidden from customers)
  - Published state (available for purchase/access)
  - Archived state (no longer available)
- **Admin UI**:
  - Media library view (uploaded videos/audio)
  - Content list (table view)
  - Create/edit content form (select from media library)
  - File upload component with progress
  - Content preview
  - Resource attachment management
- **Storage**:
  - Cloudflare R2 bucket-per-creator architecture
  - Neon Postgres for metadata
  - Presigned URLs for secure file access

### Explicitly Out of Scope (Future Phases)

- **Written articles/PDFs as content** - Phase 2 (Phase 1 is video + audio only)
- **Video transcoding (HLS, multi-quality)** - Phase 1 but separate feature ([Media Transcoding](../media-transcoding/pdr-phase-1.md))
- **Automatic thumbnail generation** - Phase 1 but handled in Media Transcoding feature
- **Content versioning** - Phase 3
- **Collaborative editing** - Phase 3
- **Content scheduling (publish at specific time)** - Phase 2
- **Bulk upload (multiple files at once)** - Phase 2
- **Advanced media library features (folders, galleries)** - Phase 2
- **Content analytics (views, engagement)** - Phase 2
- **Advanced search/filtering** - Phase 2 (basic filtering in Phase 1)
- **Subtitles/captions** - Phase 3
- **DRM/content protection** - Phase 3

## Cross-Feature Dependencies

See the centralized [Cross-Feature Dependencies](../../cross-feature-dependencies.md#4-content-management) document for details.

---

## User Stories & Use Cases

### US-CONTENT-001: Upload Video to Media Library

**As a** Creator
**I want to** upload video files to my media library
**So that** I can create content that references these videos

**Flow:**

1. Creator navigates to `/admin/media/upload`
2. Creator clicks "Upload Video" button
3. Creator selects MP4 file from computer (500MB)
4. System:
   - Validates file type (MP4, WebM, MOV) and size (max 5GB)
   - Requests presigned upload URL from backend
   - Backend generates R2 presigned URL for creator's bucket: `codex-media-{creatorId}/originals/{mediaId}/original.mp4`
   - Shows upload progress bar
   - Uploads directly to creator's R2 media bucket (creator-owned storage)
5. On upload complete:
   - Frontend notifies backend: `POST /api/media/upload-complete`
   - Backend creates `media_items` record:
     - `id = {mediaId}`
     - `creator_id = {creatorId}` ← Media is creator-owned
     - `type = 'video'`
     - `status = 'uploaded'`
     - `r2_key = 'originals/{mediaId}/original.mp4'`
   - Backend enqueues transcoding job (see [Media Transcoding](../media-transcoding/pdr-phase-1.md))
   - `media_items.status` updated to `'transcoding'`
6. Creator sees media item in media library with status "Transcoding..."
7. When transcoding completes, status updates to "Ready"

**Acceptance Criteria:**

- Video file uploaded to creator's R2 bucket successfully
- Progress bar shows accurate upload percentage
- `media_items` record created with correct metadata
- Transcoding job enqueued automatically
- Media item appears in media library with status indicator
- Upload fails gracefully if file too large or wrong format
- Creator sees success message after upload

---

### US-CONTENT-002: Create Content from Media Library

**As a** Creator
**I want to** create content that references a video in my media library
**So that** I can package media with pricing and metadata for sale on my profile or an organization

**Flow:**

1. Creator navigates to `/admin/content/new`
2. Creator fills out form:
   - **Title**: "Introduction to TypeScript"
   - **Description**: "Learn TypeScript basics..."
   - **Content Type**: "Video" (selected)
   - **Media Item**: Dropdown showing creator's video media items
     - Creator selects "typescript-intro.mp4" (uploaded previously)
   - **Post to**: Dropdown
     - "My Profile" (personal content, `organization_id = NULL`)
     - "Acme Org" (organizational content, `organization_id = {orgId}`) [If creator belongs to orgs]
   - **Category**: "Programming"
   - **Tags**: "typescript", "javascript", "tutorial"
   - **Price**: $29.99
3. Creator optionally uploads custom thumbnail:
   - Uploads to `codex-assets-{creatorId}/thumbnails/content/{contentId}/custom.jpg`
   - Falls back to auto-generated thumbnail from transcoding if not provided
4. Creator optionally attaches resources:
   - Clicks "Attach Resource"
   - Selects existing workbook from resource library OR uploads new PDF
   - Resource stored in `codex-resources-{creatorId}/{resourceId}/workbook.pdf`
   - Database links resource to content via `resource_attachments` table
5. Creator clicks "Save as Draft"
6. System:
   - Creates `content` record:
     - `creator_id = {creatorId}` ← Creator owns this post
     - `organization_id = NULL` (if "My Profile") OR `{orgId}` (if posted to org)
     - `media_item_id = {mediaId}` (reference to creator's media library)
     - `status = 'draft'`
     - `price = 29.99`
     - All metadata fields
   - Creates `resource_attachments` records if resources attached
   - Redirects to content edit page
7. Creator reviews, then clicks "Publish"
8. System:
   - Updates `content.status = 'published'`
   - If personal: Content appears on creator's profile page
   - If org: Content appears in organization's catalog

**Acceptance Criteria:**

- Content created successfully referencing existing media item
- No video re-upload required (reuses creator's media library)
- Metadata stored correctly in `content` table with `creator_id` and `organization_id`
- Resources attached correctly (many-to-many via `resource_attachments`)
- Draft content hidden from customers
- Published personal content (`organization_id = NULL`) appears on creator's profile
- Published org content appears in organization's catalog
- Custom thumbnail stored in creator's asset bucket
- Media item can be referenced by multiple content entities (reusability)
- Creator can choose to post to personal profile OR organization

---

### US-CONTENT-003: Upload Audio Content

**As a** Creator
**I want to** upload audio files (podcasts, audio lessons)
**So that** I can create audio-based content for customers

**Flow:**

1. Creator navigates to `/admin/media/upload`
2. Creator clicks "Upload Audio" button
3. Creator selects MP3 file from computer (50MB)
4. System uploads to `codex-media-{creatorId}/audio/{mediaId}/audio.mp3`
5. Backend creates `media_items` record:
   - `type = 'audio'`
   - `status = 'ready'` (no transcoding needed for audio)
6. Creator creates content referencing audio media item (same flow as video)

**Acceptance Criteria:**

- Audio file uploaded to R2 successfully
- `media_items` record created with type = 'audio'
- No transcoding for audio (status immediately 'ready')
- Content can reference audio media items
- Audio playback works in customer-facing player

---

### US-CONTENT-004: Reuse Media Across Multiple Content Items

**As a** Creator
**I want to** create multiple content items from the same video
**So that** I can sell the same video in different packages/bundles

**Flow:**

1. Creator already uploaded "intro-video.mp4" to media library
2. Creator creates Content A:
   - Title: "TypeScript Intro - Standalone"
   - Media Item: "intro-video.mp4"
   - Price: $9.99
3. Creator creates Content B:
   - Title: "TypeScript Bootcamp Bundle"
   - Media Item: "intro-video.mp4" (same video)
   - Price: $49.99 (bundle price with other content)
4. Both content items reference the same `media_items` record
5. Video stored once in R2, served twice

**Acceptance Criteria:**

- Multiple content entities can reference same media item
- No video duplication in R2
- Each content has independent pricing and metadata
- Deleting one content doesn't affect the other
- Media item cannot be deleted if referenced by published content

---

### US-CONTENT-005: Attach Reusable Resources

**As a** Creator
**I want to** attach the same workbook to multiple content items
**So that** I don't have to upload duplicates

**Flow:**

1. Creator uploads "workbook-v2.pdf" via resource manager:
   - Stored in `codex-resources-{creatorId}/{resourceId}/workbook-v2.pdf`
   - Creates `resources` record with `id = {resourceId}`
2. Creator edits Content A:
   - Clicks "Attach Resource"
   - Selects "workbook-v2.pdf" from resource library
   - Creates `resource_attachments` record: `(resourceId, 'content', contentA.id)`
3. Creator edits Content B:
   - Attaches same "workbook-v2.pdf"
   - Creates `resource_attachments` record: `(resourceId, 'content', contentB.id)`
4. PDF stored once in R2, attached to both content items
5. Customers who purchase Content A or B can download the workbook

**Acceptance Criteria:**

- One resource file stored in R2
- Multiple content items can attach same resource
- `resource_attachments` table tracks many-to-many relationships
- Deleting resource attachment from one content doesn't affect others
- Resource can be permanently deleted only if no attachments exist

---

### US-CONTENT-006: Edit Existing Content

**As a** Creator
**I want to** edit content after creation
**So that** I can fix mistakes or update information

**Flow:**

1. Creator navigates to `/admin/content`
2. Creator sees list of all their content
3. Creator clicks "Edit" on a content item
4. System loads content edit page with:
   - Pre-filled metadata
   - Current media item reference
   - Current status (draft/published/archived)
   - Attached resources
5. Creator updates title, description, price, etc.
6. Creator optionally:
   - Changes media item reference (select different video from library)
   - Uploads new custom thumbnail (replaces old one in R2)
   - Adds/removes resource attachments
7. Creator clicks "Save"
8. System updates `content` record
9. If thumbnail replaced, old thumbnail deleted from R2

**Acceptance Criteria:**

- All metadata fields editable
- Media item reference can be changed (no file re-upload)
- Old thumbnails deleted from R2 when replaced
- Resource attachments can be added/removed
- Changes reflected immediately in admin dashboard
- Published content updates visible to customers immediately

---

### US-CONTENT-007: Delete Content

**As a** Creator
**I want to** delete content
**So that** I can remove outdated or unwanted items

**Flow:**

1. Creator navigates to `/admin/content`
2. Creator clicks "Delete" on a content item
3. System shows confirmation dialog:
   - "Are you sure? This will permanently delete the content."
   - Warning if content has been purchased: "X customers have purchased this content. They will retain access."
4. Creator confirms deletion
5. System:
   - Soft deletes `content` record (set `deleted_at` timestamp)
   - Does NOT delete media item (may be used by other content)
   - Does NOT delete resource attachments (resources remain for other content)
   - Content no longer appears in customer catalog
   - Customers who purchased content retain access (via `deleted_at < purchase_date` check)
6. Creator sees success message

**Acceptance Criteria:**

- Soft delete (record remains in database with `deleted_at`)
- Media items not deleted (may be referenced elsewhere)
- Resource attachments removed but resources remain
- Customers who purchased content retain access
- Deleted content hidden from admin list (unless "Show Deleted" filter enabled)
- Media item can be manually deleted from media library if not referenced

---

### US-CONTENT-008: Organize with Categories and Tags

**As a** Creator
**I want to** categorize and tag content
**So that** customers can find relevant content easily

**Flow:**

1. Creator creates/edits content
2. Creator selects category from dropdown:
   - Programming
   - Business
   - Design
   - Health & Fitness
   - etc.
3. Creator adds tags (comma-separated or tag input):
   - "typescript, javascript, web development"
4. System stores `category_id` and creates tag relationships
5. Customers can filter by category and search by tags (Content Access feature)

**Acceptance Criteria:**

- Each content has exactly one category
- Content can have 0-10 tags
- Categories managed separately (admin can create/edit categories)
- Tags auto-created on first use
- Category and tags used for filtering in customer catalog

---

## User Flows (Visual)

See diagrams:

- [Content Upload Flow](../_assets/content-upload-flow.png)
- [Media Library Pattern](../_assets/media-library-pattern.png)
- [Content Lifecycle](../_assets/content-lifecycle.png)

---

## Dependencies

### Internal Dependencies (Phase 1)

- **Auth**: Content routes require `requireCreatorAccess()` guard
- **Admin Dashboard**: UI for content and media management
- **Media Transcoding**: Converts uploaded videos to HLS streams
- **E-Commerce**: Content pricing and purchase linking
- **Content Access**: Published content access control, signed URLs

### External Dependencies

- **Cloudflare R2**: Object storage for media, resources, assets
  - Bucket-per-creator architecture (see [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md))
  - Buckets: `codex-media-{creatorId}`, `codex-resources-{creatorId}`, `codex-assets-{creatorId}`
  - Access via R2 API with presigned URLs
- **Neon Postgres**: Metadata storage
  - `media_items` table (uploaded files)
  - `content` table (content metadata, references media_items)
  - `resources` table (downloadable files)
  - `resource_attachments` table (many-to-many: resources ↔ content)
  - `categories` table
  - `tags` table
  - `content_tags` join table

### Database Schema Dependencies

See [Database Schema](../../features/shared/database-schema.md) for full schema:

- `media_items` table
  - Creator-owned media (videos/audio)
  - `creator_id` references `users(id)`
  - Stored in creator's R2 bucket: `codex-media-{creator_id}`
- `content` table
  - Content posts (references media_items via `media_item_id`)
  - `creator_id` references `users(id)` (who created the post)
  - `organization_id` references `organizations(id)` (NULL = personal, NOT NULL = org)
  - `media_item_id` references `media_items(id)` (creator's media)
- `resources` table (PDFs, workbooks)
  - Creator-owned resources
  - `creator_id` references `users(id)`
- `resource_attachments` table (content ↔ resources many-to-many)
- `categories` table
- `tags` table
- `content_tags` table

---

## Acceptance Criteria (Feature-Level)

### Functional Requirements

- Creator can upload video files (MP4, WebM, MOV, max 5GB)
- Creator can upload audio files (MP3, M4A, WAV, max 500MB)
- Uploads go to creator-specific R2 buckets (bucket-per-creator)
- Media items stored in separate `media_items` table (media library pattern)
- Content entities reference media items (no file duplication)
- Creator can create content from existing media library items
- Creator can attach reusable resources (PDFs) to content
- Same resource can attach to multiple content items (no R2 duplication)
- Creator can edit existing content (metadata + media reference + resources)
- Creator can delete content (soft delete, customers retain access)
- Creator can publish/unpublish content
- Content has categories and tags for organization
- Draft content hidden from customers
- Published content available for purchase
- Archived content hidden from everyone

### Storage Requirements

- Files stored in creator-specific R2 buckets (isolation)
- Metadata stored in Neon Postgres
- Presigned URLs for secure file access (not public)
- File size limits enforced (5GB video, 500MB audio, 100MB PDF)
- Old thumbnails deleted from R2 when content updated
- Media items not deleted if referenced by content
- Resources not deleted if attached to content

### Performance Requirements

- Upload progress tracked and displayed
- Large file uploads complete successfully (5GB)
- Media library loads in < 500ms (p95)
- Content list loads in < 500ms (p95)
- Content edit page loads in < 1s (p95)

### Security Requirements

- Only Creators can access their own content/media
- Creators cannot access other creators' buckets
- R2 files not publicly accessible (presigned URLs only)
- File type validation (reject non-video/audio)
- File size limits enforced
- CSRF protection on all content forms

### Testing Requirements

- Unit tests for content CRUD operations
- Integration tests for file uploads to R2
- E2E tests for complete upload → publish flow
- Test media library reusability (multiple content → one media)
- Test resource reusability (multiple content → one resource)
- Test coverage > 85% for content module

---

## Related Documents

- **TDD**: [Content Management Technical Design](./ttd-dphase-1.md)
- **Cross-Feature Dependencies**:
  - [Media Transcoding PRD](../media-transcoding/pdr-phase-1.md) - Video to HLS conversion
  - [E-Commerce PRD](../e-commerce/pdr-phase-1.md) - Content pricing
  - [Content Access PRD](../content-access/pdr-phase-1.md) - Access control
  - [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md) - Management UI
  - [Auth PRD](../auth/pdr-phase-1.md) - Creator-only access
- **Infrastructure**:
  - [R2 Bucket Structure](../../infrastructure/R2BucketStructure.md) - Bucket-per-creator architecture
  - [Infrastructure Plan](../../infrastructure/infraplan.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)

---

## Notes

### Why Media Library Pattern?

- **Reusability**: One video → many content items (different pricing/bundles)
- **Separation of Concerns**: Media storage/transcoding separate from content metadata
- **Flexibility**: Swap media items without recreating content
- **Cost Efficiency**: No file duplication in R2
- **Future-Proof**: Easier to add media management features (folders, galleries)

### Why Bucket-Per-Creator?

- **Isolation**: Each creator's files physically separated
- **Security**: Compromised creator doesn't affect others
- **Permissions**: Easier creator-specific access control
- **Billing**: Track storage costs per creator
- **Scale**: Cloudflare allows 1 million buckets

### Why Reusable Resources?

- **Cost Efficiency**: Same workbook used across multiple offerings/content → stored once
- **Consistency**: Update resource once, all attachments reflect change
- **Flexibility**: Resources can attach to content, offerings, courses (extensible)

### Content vs Media Items vs Resources

| Entity         | Purpose                               | Ownership    | Storage                               | Reusability                      |
| -------------- | ------------------------------------- | ------------ | ------------------------------------- | -------------------------------- |
| **Media Item** | Uploaded video/audio file             | Creator-owned | R2: `codex-media-{creator_id}`     | Yes - multiple content items     |
| **Content**    | Sellable post (pricing + metadata)    | Creator-owned | Database (references media)          | N/A (links to media)             |
| **Resource**   | Downloadable file (PDF, workbook)     | Creator-owned | R2: `codex-resources-{creator_id}` | Yes - multiple content/offerings |

**Key Ownership Model:**
- **Media Items**: Owned by creator, stored in their bucket, can be used across multiple content posts
- **Content Posts**: Created by creator, can belong to their personal profile (`organization_id = NULL`) or an organization (`organization_id = X`)
- **Resources**: Owned by creator, can be attached to multiple content posts or offerings

### File Upload Strategy

**Direct browser → R2 upload via presigned URL**:

1. Browser requests upload URL from backend: `POST /api/media/presigned-upload`
2. Backend generates R2 presigned PUT URL for creator's bucket
3. Browser uploads directly to R2 (progress tracking)
4. On complete, browser notifies backend: `POST /api/media/upload-complete`
5. Backend creates `media_items` record and enqueues transcoding job

**Benefits**:

- No file passes through SvelteKit server (saves bandwidth)
- Upload progress tracked client-side
- Scalable (R2 handles upload load)
- Works with Cloudflare Workers/Pages (no filesystem access needed)

---

**Document Version**: 2.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
