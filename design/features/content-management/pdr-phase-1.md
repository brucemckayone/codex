# Content Management - Phase 1 PRD

## Feature Summary

Content management system for Platform Owners to upload, organize, and manage video and written content. Phase 1 focuses on core CRUD operations with Cloudflare R2 storage for media files and Neon Postgres for metadata.

## Problem Statement

Platform Owners need a way to:
- Upload video content (MP4, WebM) for courses, tutorials, or media libraries
- Upload written content (articles, PDFs, documents)
- Organize content with metadata (title, description, categories, tags)
- Manage content lifecycle (draft, published, archived)
- Store media files securely and efficiently
- Prepare content for sale via e-commerce integration

Without content management:
- No way to add content to the platform
- No inventory for e-commerce purchases
- No content library for customers to access
- Platform is empty shell with no value

## Goals / Success Criteria

### Primary Goals
1. **Upload Video Content** - Platform Owners can upload video files (MP4, WebM)
2. **Upload Written Content** - Platform Owners can upload PDFs, articles, documents
3. **Metadata Management** - Add titles, descriptions, thumbnails, categories
4. **Content Organization** - Categorize and tag content for discovery
5. **Lifecycle Management** - Draft, publish, archive workflow
6. **Storage Integration** - Use Cloudflare R2 for scalable, cost-effective storage

### Success Metrics
-  Platform Owner can upload 1GB video file in < 5 minutes
-  Uploaded content appears in admin dashboard immediately
-  Content metadata stored in database with correct relationships
-  Files stored in R2 with proper access control
-  Published content appears in customer library (after purchase)
-  Draft content hidden from customers
-  100% pass rate on content management unit tests

## Scope

### In Scope (Phase 1 MVP)
-  **Video Content Upload**:
  - MP4 and WebM formats
  - Direct upload to Cloudflare R2
  - Progress tracking for large files
  - Thumbnail extraction/upload
-  **Written Content Upload**:
  - PDF documents
  - Markdown/rich text articles (stored in DB)
-  **Metadata Management**:
  - Title, description
  - Content type (video, article, PDF)
  - Categories (single category per content)
  - Tags (multiple tags)
  - Pricing information (for e-commerce)
-  **Content Lifecycle**:
  - Draft state (hidden from customers)
  - Published state (available for purchase/access)
  - Archived state (no longer available)
-  **Admin UI**:
  - Content list (table view)
  - Create/edit content form
  - File upload component with progress
  - Content preview
-  **Storage**:
  - Cloudflare R2 for video/PDF files
  - Neon Postgres for metadata
  - Signed URLs for secure file access

### Explicitly Out of Scope (Future Phases)
- L Video transcoding (multi-quality, HLS streaming) - Phase 2
- L Automatic thumbnail generation - Phase 2
- L Content versioning - Phase 3
- L Collaborative editing - Phase 3
- L Content scheduling (publish at specific time) - Phase 2
- L Bulk upload (multiple files at once) - Phase 2
- L Media library management (folders, galleries) - Phase 2
- L Content analytics (views, engagement) - Phase 2
- L Content search/filtering (basic filtering only in Phase 1) - Phase 2 for advanced
- L Subtitles/captions - Phase 3
- L DRM/content protection - Phase 3

## Cross-Feature Dependencies

### E-Commerce Feature (Phase 1)
**Dependency**: E-Commerce relies on content metadata for pricing and sales
- Content has price field (can be $0 for free content)
- Content linked to orders/purchases
- See [E-Commerce PRD](../e-commerce/pdr-phase-1.md)

### Content Access Feature (Phase 1)
**Dependency**: Content Access controls who can view content
- Published content available for purchase
- Purchased content appears in customer library
- See [Content Access PRD](../content-access/pdr-phase-1.md)

### Admin Dashboard (Phase 1)
**Dependency**: Admin Dashboard displays content management UI
- Content list in admin area
- Create/edit forms
- See [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md)

### Auth Feature (Phase 1)
**Dependency**: Only Platform Owners can manage content
- Content routes protected by `requireOwner()` guard
- See [Auth PRD](../auth/pdr-phase-1.md)

---

## User Stories & Use Cases

### US-CONTENT-001: Upload Video Content
**As a** Platform Owner
**I want to** upload video content
**So that** I can sell or provide it to customers

**Flow:**
1. Owner navigates to `/admin/content/new`
2. Owner selects "Video" as content type
3. Owner fills out form:
   - Title: "Introduction to TypeScript"
   - Description: "Learn TypeScript basics..."
   - Category: "Programming"
   - Tags: "typescript", "javascript", "tutorial"
   - Price: $29.99
4. Owner clicks "Choose Video File" button
5. Owner selects MP4 file from computer (500MB)
6. System:
   - Validates file type and size (max 5GB Phase 1)
   - Shows upload progress bar
   - Uploads directly to Cloudflare R2 bucket
   - Generates unique file ID and R2 key
7. Owner uploads thumbnail image (optional)
8. Owner clicks "Save as Draft"
9. System:
   - Stores metadata in database (content table)
   - Links R2 file key to content record
   - Sets status = 'draft'
   - Redirects to content edit page
10. Owner reviews, then clicks "Publish"
11. System:
    - Updates status = 'published'
    - Content now available for purchase

**Acceptance Criteria:**
- Video file uploaded to R2 successfully
- Progress bar shows accurate upload percentage
- Metadata stored in database with correct content_id
- Draft content hidden from customers
- Published content appears in catalog (for purchase)
- Upload fails gracefully if file too large or wrong format
- Owner sees success message after publish

---

### US-CONTENT-002: Upload Written Content (PDF)
**As a** Platform Owner
**I want to** upload PDF documents
**So that** customers can download/read them

**Flow:**
1. Owner navigates to `/admin/content/new`
2. Owner selects "PDF" as content type
3. Owner fills out metadata (title, description, category, tags, price)
4. Owner uploads PDF file (10MB)
5. System uploads to R2
6. Owner saves as draft or publishes
7. Content available for purchase/access

**Acceptance Criteria:**
- PDF stored in R2
- Metadata includes file size, page count (future: extract from PDF)
- Customers can download PDF after purchase
- PDF preview available in admin (future: first page thumbnail)

---

### US-CONTENT-003: Create Written Article
**As a** Platform Owner
**I want to** create written articles with rich text
**So that** I can provide text-based content without file uploads

**Flow:**
1. Owner navigates to `/admin/content/new`
2. Owner selects "Article" as content type
3. Owner fills metadata
4. Owner writes content in rich text editor (Markdown or WYSIWYG)
5. Owner saves draft
6. Owner publishes when ready
7. Article stored directly in database (no R2 file)

**Acceptance Criteria:**
- Article body stored in database (TEXT field, supports Markdown)
- No file upload required
- Renders correctly on customer-facing pages
- Supports basic formatting (bold, italic, lists, links, images via URL)

---

### US-CONTENT-004: Edit Existing Content
**As a** Platform Owner
**I want to** edit content after creation
**So that** I can fix mistakes or update information

**Flow:**
1. Owner navigates to `/admin/content`
2. Owner sees list of all content
3. Owner clicks "Edit" on a content item
4. System loads content edit page with:
   - Pre-filled metadata
   - Current status (draft/published/archived)
   - File information (if video/PDF)
5. Owner updates title, description, price, etc.
6. Owner optionally replaces video/PDF file
7. Owner clicks "Save"
8. System updates database record
9. If file replaced, old R2 file deleted, new file uploaded

**Acceptance Criteria:**
- All metadata fields editable
- File replacement works correctly
- Old files deleted from R2 to save storage
- Changes reflected immediately in admin dashboard
- Published content updates don't require re-publishing (live updates)

---

### US-CONTENT-005: Delete Content
**As a** Platform Owner
**I want to** delete content
**So that** I can remove outdated or unwanted items

**Flow:**
1. Owner navigates to `/admin/content`
2. Owner clicks "Delete" on a content item
3. System shows confirmation dialog:
   - "Are you sure? This will permanently delete the content and associated files."
   - Warning if content has been purchased: "X customers have purchased this content."
4. Owner confirms deletion
5. System:
   - Soft deletes content record (set deleted_at timestamp)
   - Optionally moves R2 file to "deleted" folder (or deletes after 30 days)
   - Content no longer appears in customer libraries (purchased content remains accessible)
6. Owner sees success message

**Acceptance Criteria:**
- Soft delete (record remains in database with deleted_at)
- Files moved to deleted folder in R2 (not immediately deleted)
- Customers who purchased content retain access (use deleted_at < purchase_date check)
- Deleted content hidden from admin list (unless "Show Deleted" filter enabled)
- Permanent deletion after 30 days (cron job) - Phase 2

---

### US-CONTENT-006: Organize with Categories and Tags
**As a** Platform Owner
**I want to** categorize and tag content
**So that** customers can find relevant content easily

**Flow:**
1. Owner creates/edits content
2. Owner selects category from dropdown:
   - Programming
   - Business
   - Design
   - Health & Fitness
   - etc.
3. Owner adds tags (comma-separated or tag input):
   - "typescript, javascript, web development"
4. System stores category_id and creates tag relationships
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
- [Content Lifecycle](../_assets/content-lifecycle.png)

---

## Dependencies

### Internal Dependencies (Phase 1)
- **Auth**: Content routes require `requireOwner()` guard
- **Admin Dashboard**: UI for content management
- **E-Commerce**: Content pricing and purchase linking
- **Content Access**: Published content access control

### External Dependencies
- **Cloudflare R2**: Object storage for video/PDF files
  - Bucket: `codex-content`
  - Access via R2 API
  - Signed URLs for secure file access
- **Neon Postgres**: Metadata storage
  - `content` table
  - `categories` table
  - `tags` table
  - `content_tags` join table

### Database Schema Dependencies
See [Database Schema](../../infrastructure/DatabaseSchema.md) for full schema:
- `content` table
- `categories` table
- `tags` table
- `content_tags` table

---

## Acceptance Criteria (Feature-Level)

### Functional Requirements
-  Platform Owner can upload video files (MP4, WebM, max 5GB)
-  Platform Owner can upload PDF files (max 100MB)
-  Platform Owner can create written articles (Markdown)
-  Platform Owner can edit existing content (metadata + files)
-  Platform Owner can delete content (soft delete)
-  Platform Owner can publish/unpublish content
-  Content has categories and tags for organization
-  Draft content hidden from customers
-  Published content available for purchase
-  Archived content hidden from everyone

### Storage Requirements
-  Files stored in Cloudflare R2 with unique keys
-  Metadata stored in Neon Postgres
-  R2 files accessible via signed URLs only (not public)
-  File size limits enforced (5GB video, 100MB PDF)
-  Old files deleted from R2 when content updated

### Performance Requirements
-  Upload progress tracked and displayed
-  Large file uploads complete successfully (5GB)
-  Content list loads in < 500ms (p95)
-  Content edit page loads in < 1s (p95)

### Security Requirements
-  Only Platform Owners can access content management
-  R2 files not publicly accessible (signed URLs only)
-  File type validation (reject non-video/PDF)
-  File size limits enforced
-  CSRF protection on all content forms

### Testing Requirements
-  Unit tests for content CRUD operations
-  Integration tests for file uploads to R2
-  E2E tests for complete upload ’ publish flow
-  Test coverage > 85% for content module

---

## Related Documents

- **TDD**: [Content Management Technical Design](./ttd-dphase-1.md)
- **Full Feature**: [Content Management Full Overview](./full-feature-overview.md)
- **Cross-Feature Dependencies**:
  - [E-Commerce PRD](../e-commerce/pdr-phase-1.md) - Content pricing
  - [Content Access PRD](../content-access/pdr-phase-1.md) - Access control
  - [Admin Dashboard PRD](../admin-dashboard/pdr-phase-1.md) - Management UI
  - [Auth PRD](../auth/pdr-phase-1.md) - Owner-only access
- **Infrastructure**:
  - [Infrastructure Plan](../../infrastructure/infraplan.md)
  - [Database Schema](../../infrastructure/DatabaseSchema.md)
  - [Testing Strategy](../../infrastructure/TestingStrategy.md)
  - [Cloudflare R2 Setup](../../infrastructure/CloudflareSetup.md)

---

## Notes

### Why Cloudflare R2?
- **Cost-Effective**: No egress fees (unlike AWS S3)
- **Fast**: Cloudflare CDN integration
- **S3-Compatible**: Familiar API
- **Scalable**: Unlimited storage
- **Simple**: Easy integration with Cloudflare Pages/Workers

### Why Not Video Transcoding in Phase 1?
- **Complexity**: Transcoding requires ffmpeg, encoding workers, etc.
- **Cost**: Transcoding is CPU-intensive
- **MVP Focus**: Phase 1 delivers core value (upload + sell)
- **Phase 2**: Add transcoding for multi-quality playback (720p, 1080p, HLS)

### Content Types Comparison
| Type | Storage | Size Limit | Phase 1 Support |
|------|---------|------------|-----------------|
| Video (MP4/WebM) | R2 | 5GB |  |
| PDF | R2 | 100MB |  |
| Article (Markdown) | Database | 1MB |  |
| Images (JPEG/PNG) | R2 | 10MB |  (thumbnails) |
| Audio (MP3) | R2 | 500MB | L Phase 2 |
| Zip/Archives | R2 | 1GB | L Phase 2 |

### File Upload Strategy
**Phase 1**: Direct browser ’ R2 upload via presigned URL
- Browser requests upload URL from backend
- Backend generates R2 presigned POST URL
- Browser uploads directly to R2 (progress tracking)
- On complete, browser notifies backend to save metadata

**Benefits**:
- No file passes through SvelteKit server (saves bandwidth)
- Upload progress tracked client-side
- Scalable (R2 handles upload load)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
