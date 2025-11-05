# R2 Storage Patterns

**Purpose**: This document defines the R2 storage architecture, patterns, and best practices for the Codex platform. It consolidates storage patterns from all feature documents into a single source of truth.

**Version**: 1.0
**Last Updated**: 2025-11-05
**Status**: Approved - Ready for Implementation

---

## Table of Contents

1. [Introduction and Design Philosophy](#introduction-and-design-philosophy)
2. [Bucket Architecture](#bucket-architecture)
3. [Naming Conventions](#naming-conventions)
4. [File Organization Patterns](#file-organization-patterns)
5. [Upload Patterns](#upload-patterns)
6. [Access Patterns](#access-patterns)
7. [R2Service Interface](#r2service-interface)
8. [Security Model](#security-model)
9. [Storage Scaling Considerations](#storage-scaling-considerations)
10. [References](#references)

---

## Introduction and Design Philosophy

### Core Principles

The Codex platform uses Cloudflare R2 for all object storage with the following design principles:

1. **Creator Isolation**: Each creator's files are logically isolated through folder structure
2. **Security by Design**: Private by default, access granted through signed URLs
3. **Direct Upload Strategy**: Browser uploads directly to R2, bypassing server infrastructure
4. **Cost Efficiency**: No egress fees, reusable resources (one file, many references)
5. **Scalability**: Architecture supports unlimited creators and content
6. **Future-Ready**: Designed for evolution from single-tenant to multi-tenant

### Architecture Evolution

**Phase 1 Design Decision**: The platform uses **unified buckets per environment** with internal folder structure organized by `creatorId`, rather than dedicated buckets per creator.

**Rationale**:

- **Simplicity**: No dynamic bucket provisioning on creator onboarding
- **Cost-Effective**: Fewer buckets = lower operation costs initially
- **Easier Management**: Single set of buckets to monitor and configure
- **Future-Compatible**: Internal structure matches future per-creator bucket design if needed
- **Simple Migration**: Moving to per-creator buckets (if needed) is just folder moves
- **No Functional Downsides**: Folder-level isolation works equally well for permissions, deletion, and access control

**Trade-offs**:

- All creators share buckets (but isolated by folder structure)
- Slightly more complex deletion (delete folder contents vs delete bucket)
- **Mitigation**: Root-level `creatorId` folders make deletion straightforward with S3 prefix deletion

**Historical Context**: Early design documents referenced "bucket-per-creator" architecture. The team decided on unified buckets with per-creator folders for Phase 1 simplicity, with the option to migrate to dedicated buckets per creator in later phases if needed.

### Storage Categories

The platform organizes storage into four logical categories:

1. **Media**: Video and audio content (originals + transcoded streams)
2. **Resources**: Downloadable files (PDFs, workbooks, attachments)
3. **Assets**: Platform and creator branding (logos, thumbnails, banners)
4. **Platform**: Global platform assets (email templates, legal documents)

---

## Bucket Architecture

### Environment-Specific Buckets

Each environment (production, staging, development) has its own set of buckets:

```
Production:
├── codex-media-production
├── codex-resources-production
├── codex-assets-production
└── codex-platform-production

Staging:
├── codex-media-staging
├── codex-resources-staging
├── codex-assets-staging
└── codex-platform-staging

Development:
├── codex-media-dev
├── codex-resources-dev
├── codex-assets-dev
└── codex-platform-dev
```

### 1. Media Bucket

**Purpose**: Store all media files (video, audio) for all creators

**Naming Convention**:
- Production: `codex-media-production`
- Staging: `codex-media-staging`
- Development: `codex-media-dev`

**Structure**:

```
codex-media-production/
├── {creatorId-1}/
│   ├── originals/
│   │   └── {mediaId}/
│   │       └── original.mp4              # Original uploaded video
│   ├── hls/                               # Phase 2: Transcoded streams
│   │   └── {mediaId}/
│   │       ├── master.m3u8               # HLS master playlist
│   │       ├── 1080p/
│   │       │   ├── playlist.m3u8
│   │       │   ├── segment_000.ts
│   │       │   └── segment_*.ts
│   │       ├── 720p/
│   │       ├── 480p/
│   │       └── 360p/
│   └── audio/
│       └── {mediaId}/
│           └── audio.mp3                 # Audio files (podcasts, etc.)
│
├── {creatorId-2}/
│   ├── originals/
│   ├── hls/
│   └── audio/
└── ...
```

**Access Control**:
- **Originals**: Private (only creator + platform owner)
- **HLS Streams**: Signed URLs for paid content, public for free content
- **Audio**: Signed URLs for paid content, public for free content

**Key Design**: Files are namespaced by `creatorId` at the root level for easy isolation and deletion.

### 2. Resources Bucket

**Purpose**: Store reusable resources (PDFs, workbooks, files) owned by creators

**Naming Convention**:
- Production: `codex-resources-production`
- Staging: `codex-resources-staging`
- Development: `codex-resources-dev`

**Structure**:

```
codex-resources-production/
├── {creatorId-1}/
│   └── {resourceId}/
│       └── {originalFilename}.pdf        # e.g., "workbook-v2.pdf"
│
├── {creatorId-2}/
│   └── {resourceId}/
│       └── document.pdf
└── ...
```

**Key Design**:
- Resources stored by `{creatorId}/{resourceId}` (NOT tied to specific content/offering)
- Same file can be attached to multiple content entities via database relationships
- No file duplication in R2 (single source of truth)
- Resources belong to creator, not to specific content

**Database Relationship**:

```sql
-- Resource entity (owns the file)
CREATE TABLE resources (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  file_key VARCHAR(500) NOT NULL,    -- '{creatorId}/{resourceId}/{filename}.pdf'
  filename VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL
);

-- Attachments (many-to-many: resources <-> entities)
CREATE TABLE resource_attachments (
  id UUID PRIMARY KEY,
  resource_id UUID NOT NULL REFERENCES resources(id),
  entity_type VARCHAR(50) NOT NULL,  -- 'content', 'offering', 'course'
  entity_id UUID NOT NULL,
  attachment_label VARCHAR(100),     -- e.g., "Workbook", "Bonus PDF"
  UNIQUE(resource_id, entity_type, entity_id)
);
```

**Example**: Upload `workbook-v2.pdf` once → stored as `{creatorId}/{resourceId}/workbook-v2.pdf` → attach to multiple content items via `resource_attachments` table → file exists once in R2, referenced multiple times.

**Access Control**: Private (signed URLs only for users who purchased associated content)

### 3. Assets Bucket

**Purpose**: Store creator-specific assets (thumbnails, logos, branding)

**Naming Convention**:
- Production: `codex-assets-production`
- Staging: `codex-assets-staging`
- Development: `codex-assets-dev`

**Structure**:

```
codex-assets-production/
├── {creatorId-1}/
│   ├── thumbnails/
│   │   ├── content/
│   │   │   └── {contentId}/
│   │   │       ├── auto-generated.jpg    # Generated from video frame
│   │   │       └── custom.jpg            # Custom uploaded thumbnail
│   │   ├── offerings/
│   │   │   └── {offeringId}/
│   │   │       └── hero-image.jpg
│   │   └── media/
│   │       └── {mediaId}/
│   │           └── preview.jpg           # Media item thumbnail
│   └── branding/
│       ├── logo.png                      # Platform owner logo
│       └── banner.jpg                    # Profile banner
│
├── {creatorId-2}/
│   ├── thumbnails/
│   └── branding/
└── ...
```

**Access Control**: Public read (thumbnails displayed publicly), private write (only creator can upload)

**Logo Storage Pattern** (Platform Settings):
```
codex-assets-{ownerId}/branding/logo.{ext}
```

### 4. Platform Bucket

**Purpose**: Store platform-wide assets not owned by specific creators

**Naming Convention**:
- Production: `codex-platform-production`
- Staging: `codex-platform-staging`
- Development: `codex-platform-dev`

**Structure**:

```
codex-platform-production/
├── email-assets/
│   ├── logo.png                      # Platform logo for emails
│   └── footer-banner.jpg
├── static-assets/
│   └── default-thumbnail.jpg         # Fallback thumbnail
└── legal/
    ├── terms-of-service.pdf
    └── privacy-policy.pdf
```

**Access Control**: Public read, private write (platform owner only)

---

## Naming Conventions

### Bucket Names

**Pattern**: `codex-{category}-{environment}`

Examples:
- `codex-media-production`
- `codex-resources-staging`
- `codex-assets-dev`

### File Key Structure

**General Pattern**: `{creatorId}/{category}/{entityId}/{filename}`

**Media Keys**:
```
{creatorId}/originals/{mediaId}/original.mp4
{creatorId}/hls/{mediaId}/master.m3u8
{creatorId}/hls/{mediaId}/1080p/segment_000.ts
{creatorId}/audio/{mediaId}/audio.mp3
```

**Resource Keys**:
```
{creatorId}/{resourceId}/{filename}.pdf
```

**Asset Keys**:
```
{creatorId}/thumbnails/content/{contentId}/custom.jpg
{creatorId}/thumbnails/offerings/{offeringId}/hero-image.jpg
{creatorId}/thumbnails/media/{mediaId}/preview.jpg
{creatorId}/branding/logo.png
```

### Filename Sanitization

All filenames must be sanitized before use as keys:

```typescript
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
}

// Example:
// "My Video File (Final).mp4" → "My_Video_File__Final_.mp4"
```

---

## File Organization Patterns

### Media Library Pattern

**Concept**: Separate media storage from content metadata

**Why This Works**:
- **Reusability**: One video → many content items (different pricing/bundles)
- **Separation of Concerns**: Media storage/transcoding separate from content metadata
- **Flexibility**: Swap media items without recreating content
- **Cost Efficiency**: No file duplication in R2
- **Future-Proof**: Easier to add media management features (folders, galleries)

**Database Schema**:

```sql
-- Media items (uploaded files)
CREATE TABLE media_items (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  type media_type NOT NULL,              -- 'video' | 'audio'
  status media_status NOT NULL,          -- 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
  bucket_name VARCHAR(100) NOT NULL,     -- 'codex-media-production'
  file_key VARCHAR(500) NOT NULL,        -- '{creatorId}/originals/{mediaId}/original.mp4'
  filename VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  hls_master_playlist_key VARCHAR(500),  -- Populated after transcoding
  duration_seconds INTEGER,
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content (references media items)
CREATE TABLE content (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  media_item_id UUID NOT NULL REFERENCES media_items(id),  -- Reference to media library
  category_id UUID REFERENCES categories(id),
  price DECIMAL(10, 2),
  status content_status DEFAULT 'draft',  -- 'draft' | 'published' | 'archived'
  custom_thumbnail_key VARCHAR(500),      -- Optional custom thumbnail in R2
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

**Example Flow**:
1. Creator uploads `video.mp4` → creates `media_items` record
2. Creator creates "Content A" → references `media_item_id`
3. Creator creates "Content B" → references same `media_item_id`
4. Video stored once in R2, served twice
5. Each content has independent pricing and metadata

### Reusable Resources Pattern

**Concept**: Resources stored once, attached to multiple entities

**Why This Works**:
- **Cost Efficiency**: Same workbook used across multiple offerings/content → stored once
- **Consistency**: Update resource once, all attachments reflect change
- **Flexibility**: Resources can attach to content, offerings, courses (extensible)

**Example**:

| Entity Type | Purpose | Storage | Reusability |
|-------------|---------|---------|-------------|
| **Media Item** | Uploaded video/audio file | R2 (originals + HLS) | Yes - multiple content items |
| **Content** | Sellable package (pricing + metadata) | Database (references media) | N/A |
| **Resource** | Downloadable file (PDF, workbook) | R2 (resources bucket) | Yes - multiple content/offerings |

---

## Upload Patterns

### Direct Browser → R2 Upload Strategy

**Philosophy**: Files should never pass through the SvelteKit server. Browser uploads directly to R2 using presigned URLs.

**Benefits**:
- No file passes through server (saves bandwidth)
- Upload progress tracked client-side
- Scalable (R2 handles upload load)
- Works with Cloudflare Workers/Pages (no filesystem access needed)
- Server only validates and generates URLs

### Upload Flow Pattern

**Generic Upload Flow**:

```
1. Browser → Backend: Request presigned upload URL
   POST /api/{type}/presigned-upload
   Body: { filename, contentType, {entityId} }

2. Backend → Browser: Generate presigned PUT URL
   Response: { url, bucketName, fileKey, expiresIn }

3. Browser → R2: Direct upload with progress tracking
   PUT {presignedUrl}
   Body: File blob

4. Browser → Backend: Notify upload complete
   POST /api/{type}/upload-complete
   Body: { {entityId}, filename, fileSize, mimeType, bucketName, fileKey }

5. Backend: Create database record
   INSERT INTO {table} ...
```

### Media Upload Flow

**Implementation**:

```typescript
// Step 1: Request presigned URL
POST /api/media/presigned-upload
Body: {
  filename: 'video.mp4',
  contentType: 'video/mp4',
  mediaId: 'uuid-generated-client-side'  // Generated upfront
}

// Step 2: Backend generates URL
const bucketName = `codex-media-${user.id}`;  // Note: In unified model, this is actually 'codex-media-production'
const fileKey = r2Service.generateMediaKey(mediaId, filename);
// fileKey = '{creatorId}/originals/{mediaId}/video.mp4'

const uploadUrl = await r2Service.getUploadUrl(
  bucketName,
  fileKey,
  contentType,
  900  // 15 minutes for large files
);

// Step 3: Browser uploads directly to R2
await fetch(uploadUrl.url, {
  method: 'PUT',
  body: fileBlob,
  headers: {
    'Content-Type': contentType
  }
});

// Step 4: Notify backend
POST /api/media/upload-complete
Body: {
  mediaId,
  filename,
  fileSize,
  mimeType,
  bucketName,
  fileKey
}

// Step 5: Backend creates record and enqueues transcoding
const mediaItem = await mediaItemsService.createMediaItem({
  id: mediaId,
  ownerId: user.id,
  type: mimeType.startsWith('video/') ? 'video' : 'audio',
  bucketName,
  fileKey,
  filename,
  fileSize,
  mimeType,
});

// If video, enqueue transcoding job (Phase 2)
if (mediaItem.type === 'video') {
  await platform.env.TRANSCODING_QUEUE.send({
    mediaId: mediaItem.id,
    inputBucket: bucketName,
    inputKey: fileKey,
    outputBucket: bucketName,
    outputPrefix: `{creatorId}/hls/${mediaId}/`,
  });

  await mediaItemsService.updateMediaItemStatus(mediaId, 'transcoding');
} else {
  // Audio is immediately ready
  await mediaItemsService.updateMediaItemStatus(mediaId, 'ready');
}
```

### Resource Upload Flow

**Implementation**:

```typescript
// Step 1: Request presigned URL
POST /api/resources/presigned-upload
Body: {
  filename: 'workbook.pdf',
  contentType: 'application/pdf',
  resourceId: 'uuid-generated-client-side'
}

// Step 2: Backend generates URL
const bucketName = `codex-resources-${user.id}`;  // Note: Unified model uses 'codex-resources-production'
const fileKey = r2Service.generateResourceKey(resourceId, filename);
// fileKey = '{creatorId}/{resourceId}/workbook.pdf'

const uploadUrl = await r2Service.getUploadUrl(
  bucketName,
  fileKey,
  contentType
);

// Step 3: Browser uploads directly to R2
// Step 4: Notify backend
POST /api/resources/upload-complete
Body: {
  resourceId,
  filename,
  fileSize,
  mimeType,
  bucketName,
  fileKey
}

// Step 5: Backend creates record
const resource = await resourceService.createResource({
  id: resourceId,
  ownerId: user.id,
  bucketName,
  fileKey,
  filename,
  fileSize,
  mimeType,
}, user.id);
```

### Thumbnail/Asset Upload Flow

**Implementation**:

```typescript
// Logo upload (Platform Settings)
const bucketName = `codex-assets-${ownerId}`;  // Unified: 'codex-assets-production'
const fileExt = filename.split('.').pop();
const fileKey = `${ownerId}/branding/logo.${fileExt}`;

await r2Service.uploadFile(bucketName, fileKey, fileBuffer, {
  contentType: getContentType(fileExt)
});

// Custom thumbnail upload (Content Management)
const fileKey = `${creatorId}/thumbnails/content/${contentId}/custom.jpg`;

await r2Service.uploadFile(bucketName, fileKey, fileBuffer, {
  contentType: 'image/jpeg'
});
```

### File Size Limits

**Enforced Limits**:
- **Video**: 5GB max (enforced client-side and validated server-side)
- **Audio**: 500MB max
- **Resources (PDFs)**: 100MB max
- **Thumbnails/Logos**: 2MB max

**Validation Pattern**:

```typescript
// Client-side validation
if (file.size > MAX_VIDEO_SIZE) {
  throw new Error(`File too large. Maximum size is ${formatBytes(MAX_VIDEO_SIZE)}`);
}

// Server-side validation (in presigned URL generation)
if (fileSize > MAX_SIZE_BY_TYPE[type]) {
  return fail(400, { error: 'File too large' });
}
```

---

## Access Patterns

### Presigned URLs vs Signed URLs

**Terminology Clarification**:
- **Presigned Upload URL**: Time-limited URL for uploading files (PUT method)
- **Signed Download URL**: Time-limited URL for accessing/downloading files (GET method)

Both use the same underlying AWS S3 signature mechanism.

### Generating Presigned Upload URLs

**Purpose**: Allow browser to upload directly to R2 without server proxy

**Implementation**:

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function getUploadUrl(
  bucketName: string,
  fileKey: string,
  contentType: string,
  expiresIn: number = 900  // 15 minutes for large file uploads
): Promise<PresignedUploadUrl> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: contentType,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn });

  return {
    url,
    bucketName,
    fileKey,
    expiresIn,
  };
}
```

**Usage Pattern**:
```typescript
// Backend API endpoint
export const POST: RequestHandler = async ({ request, locals }) => {
  const user = requireCreatorAccess({ locals, url: request.url });

  const { filename, contentType, mediaId } = await request.json();

  // Validate file type
  if (!ALLOWED_TYPES.includes(contentType)) {
    return json({ error: 'Invalid file type' }, { status: 400 });
  }

  // Generate presigned URL for creator's folder in unified bucket
  const bucketName = 'codex-media-production';
  const fileKey = `${user.id}/originals/${mediaId}/${sanitizeFilename(filename)}`;

  const uploadUrl = await r2Service.getUploadUrl(
    bucketName,
    fileKey,
    contentType
  );

  return json(uploadUrl);
};
```

### Generating Signed Download URLs

**Purpose**: Provide time-limited access to private content

**Implementation**:

```typescript
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async function getDownloadUrl(
  bucketName: string,
  fileKey: string,
  expiresIn: number = 3600  // 1 hour
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}
```

**Usage Patterns**:

#### HLS Video Streaming

```typescript
// Check access before generating URL
GET /api/content/:id/stream

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = locals.user;
  const contentId = params.id;

  // Verify user has purchased content
  const hasPurchased = await verifyPurchase(user.id, contentId);
  if (!hasPurchased) {
    return json({ error: 'Access denied' }, { status: 403 });
  }

  // Get content and media item
  const content = await contentService.getContentById(contentId, user.id);
  const mediaItem = await mediaItemsService.getMediaItemById(content.mediaItemId);

  // Generate signed URL for HLS master playlist
  const url = await r2Service.getDownloadUrl(
    mediaItem.bucketName,
    mediaItem.hlsMasterPlaylistKey,  // e.g., '{creatorId}/hls/{mediaId}/master.m3u8'
    3600  // 1 hour
  );

  // Track view event
  await analytics.trackView(user.id, contentId);

  return json({ url });
};
```

#### Resource Download

```typescript
// Generate download URL for purchased resource
GET /api/resources/:id/download

export const GET: RequestHandler = async ({ params, locals }) => {
  const user = locals.user;
  const resourceId = params.id;

  // Verify user has access to ANY entity this resource is attached to
  const hasAccess = await resourceService.checkAccess(user.id, resourceId);
  if (!hasAccess) {
    return json({ error: 'Access denied' }, { status: 403 });
  }

  // Get resource
  const resource = await resourceService.getResourceById(resourceId);

  // Generate signed URL
  const url = await r2Service.getDownloadUrl(
    resource.bucketName,
    resource.fileKey,  // e.g., '{creatorId}/{resourceId}/workbook.pdf'
    3600  // 1 hour
  );

  return json({ url, filename: resource.filename });
};
```

### Direct Public Access

**Use Case**: Free content, public thumbnails, platform assets

**Implementation**:

```typescript
// Public URL (no signature needed)
const publicUrl = `https://${R2_PUBLIC_DOMAIN}/${bucketName}/${fileKey}`;

// Example: Public thumbnail
const thumbnailUrl = `https://r2.codex.example.com/codex-assets-production/${creatorId}/thumbnails/content/${contentId}/custom.jpg`;
```

**When to Use**:
- Thumbnails and preview images
- Free video/audio content (public HLS streams)
- Platform branding assets
- Legal documents (Terms of Service, Privacy Policy)

### Security Layers

**Multi-Layer Security Model**:

```
Layer 1: Application Access Control
  ├─ Check user authentication
  ├─ Check purchase/subscription status
  └─ Verify ownership for creator content

Layer 2: Database RLS (Phase 2+)
  ├─ Ensure queries scoped to organization
  ├─ Row-level security on content access
  └─ Prevent cross-organization data leakage

Layer 3: Signed URLs
  ├─ Time-limited (1 hour default)
  ├─ Signature validates request integrity
  ├─ Cannot be shared (tied to specific file)
  └─ R2 validates signature before serving

Layer 4: CORS Configuration
  ├─ Restrict origins (only platform domain)
  ├─ Limit methods (GET, HEAD, PUT)
  └─ Prevent unauthorized cross-origin access
```

---

## R2Service Interface

### Service Interface

**Location**: `packages/web/src/lib/server/r2/service.ts`

**Interface**:

```typescript
export class R2Service {
  private client: S3Client;
  private accountId: string;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID!;

    // R2 uses S3-compatible API
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * Generate presigned PUT URL for direct browser upload
   * @param bucketName The R2 bucket name
   * @param fileKey The file path within the bucket
   * @param contentType MIME type of the file
   * @param expiresIn Expiration time in seconds (default: 900 = 15 minutes)
   */
  async getUploadUrl(
    bucketName: string,
    fileKey: string,
    contentType: string,
    expiresIn: number = 900
  ): Promise<PresignedUploadUrl>;

  /**
   * Generate signed GET URL for downloading/viewing file
   * @param bucketName The R2 bucket name
   * @param fileKey The file path within the bucket
   * @param expiresIn Expiration time in seconds (default: 3600 = 1 hour)
   */
  async getDownloadUrl(
    bucketName: string,
    fileKey: string,
    expiresIn: number = 3600
  ): Promise<string>;

  /**
   * Upload a file directly (used for small files like thumbnails)
   * @param bucketName The R2 bucket name
   * @param fileKey The file path within the bucket
   * @param file File buffer or Uint8Array
   * @param options Optional metadata (contentType, etc.)
   */
  async uploadFile(
    bucketName: string,
    fileKey: string,
    file: ArrayBuffer | Uint8Array,
    options?: { contentType?: string }
  ): Promise<void>;

  /**
   * Delete file from R2
   * @param bucketName The R2 bucket name
   * @param fileKey The file path within the bucket
   */
  async deleteFile(bucketName: string, fileKey: string): Promise<void>;

  /**
   * Delete all files with a specific prefix (e.g., delete all creator content)
   * @param bucketName The R2 bucket name
   * @param prefix The folder prefix (e.g., '{creatorId}/')
   */
  async deleteFolder(bucketName: string, prefix: string): Promise<void>;

  /**
   * Generate file keys following naming conventions
   */
  generateMediaKey(mediaId: string, filename: string): string;
  generateResourceKey(resourceId: string, filename: string): string;
  generateThumbnailKey(
    entityType: string,
    entityId: string,
    filename: string
  ): string;
}
```

### Implementation Examples

**Upload File (Direct)**:

```typescript
async uploadFile(
  bucketName: string,
  fileKey: string,
  file: ArrayBuffer | Uint8Array,
  options?: { contentType?: string }
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    Body: file,
    ContentType: options?.contentType,
  });

  await this.client.send(command);
}
```

**Delete File**:

```typescript
async deleteFile(bucketName: string, fileKey: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });

  await this.client.send(command);
}
```

**Delete Folder (Batch Delete)**:

```typescript
import { ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';

async deleteFolder(bucketName: string, prefix: string): Promise<void> {
  // List all objects with prefix
  const listCommand = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  });

  const { Contents } = await this.client.send(listCommand);

  if (!Contents || Contents.length === 0) return;

  // Batch delete (max 1000 per request)
  const deleteCommand = new DeleteObjectsCommand({
    Bucket: bucketName,
    Delete: {
      Objects: Contents.map((obj) => ({ Key: obj.Key })),
    },
  });

  await this.client.send(deleteCommand);
}
```

**Generate File Keys**:

```typescript
generateMediaKey(mediaId: string, filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `originals/${mediaId}/${sanitized}`;
}

generateResourceKey(resourceId: string, filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${resourceId}/${sanitized}`;
}

generateThumbnailKey(
  entityType: string,
  entityId: string,
  filename: string
): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `thumbnails/${entityType}/${entityId}/${sanitized}`;
}
```

### Environment Configuration

**Required Environment Variables**:

```env
# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_PUBLIC_DOMAIN=r2.codex.example.com  # Custom domain for R2 access

# Bucket names (environment-specific)
R2_BUCKET_MEDIA=codex-media-production
R2_BUCKET_RESOURCES=codex-resources-production
R2_BUCKET_ASSETS=codex-assets-production
R2_BUCKET_PLATFORM=codex-platform-production

# File size limits
MAX_VIDEO_SIZE=5368709120    # 5GB in bytes
MAX_AUDIO_SIZE=524288000     # 500MB in bytes
MAX_RESOURCE_SIZE=104857600  # 100MB in bytes
MAX_LOGO_SIZE=2097152        # 2MB in bytes
```

**Cloudflare Wrangler Bindings**:

```toml
# wrangler.toml

[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "codex-media-production"
preview_bucket_name = "codex-media-dev"

[[r2_buckets]]
binding = "RESOURCES_BUCKET"
bucket_name = "codex-resources-production"
preview_bucket_name = "codex-resources-dev"

[[r2_buckets]]
binding = "ASSETS_BUCKET"
bucket_name = "codex-assets-production"
preview_bucket_name = "codex-assets-dev"

[[r2_buckets]]
binding = "PLATFORM_BUCKET"
bucket_name = "codex-platform-production"
preview_bucket_name = "codex-platform-dev"
```

---

## Security Model

### Access Control Strategy

**Private by Default**: All buckets are private by default. Access is granted through:

1. **Signed URLs** (time-limited, signature-validated)
2. **CORS Configuration** (restricts origins and methods)
3. **Application Guards** (checks authentication and authorization before issuing URLs)
4. **Database RLS** (Phase 2+: row-level security on content access)

### CORS Configuration

**Applied to all buckets that accept uploads**:

```typescript
const corsRules = {
  CORSRules: [
    {
      AllowedOrigins: ['https://codex.example.com'],
      AllowedMethods: ['GET', 'HEAD', 'PUT'],  // PUT for presigned uploads
      AllowedHeaders: ['*'],
      MaxAgeSeconds: 3600,
    },
  ],
};
```

### Bucket Policies

**Media Bucket**:
- **Originals**: Private (only creator + platform owner via signed URLs)
- **HLS Streams**: Conditional
  - Free content: Public read
  - Paid content: Signed URLs only
- **Audio**: Same as HLS

**Resources Bucket**:
- Private (signed URLs only)
- Access granted after purchase verification

**Assets Bucket**:
- Thumbnails: Public read (displayed on content pages)
- Branding: Public read (logos, banners)
- Write: Private (only creator via presigned upload URLs)

**Platform Bucket**:
- Public read (email templates, legal documents)
- Write: Platform owner only

### URL Expiration Times

**Recommended Expiration Times**:

| Use Case | Expiration Time | Rationale |
|----------|----------------|-----------|
| **Upload URLs** | 15 minutes (900s) | Long enough for large video uploads (5GB), short enough to limit exposure |
| **HLS Streaming URLs** | 1 hour (3600s) | Must refresh for longer viewing sessions (handled by player) |
| **Resource Download URLs** | 1 hour (3600s) | Time to download PDF/workbook |
| **Thumbnail URLs** | Public (no expiry) | No sensitive data, displayed publicly |
| **Admin/Creator Access** | 1 hour (3600s) | Access to originals for editing |

### Security Best Practices

**1. Never Store Presigned URLs**:
```typescript
// ❌ Bad: Storing presigned URL in database
await db.insert(content).values({
  streamUrl: signedUrl  // Don't do this! URL will expire.
});

// ✅ Good: Generate URL on-demand
export async function getStreamUrl(contentId: string, userId: string) {
  // Check access
  await verifyAccess(userId, contentId);

  // Generate fresh URL
  return await r2Service.getDownloadUrl(bucketName, fileKey);
}
```

**2. Always Validate Before Issuing URLs**:
```typescript
// ✅ Good: Check access before generating URL
export const GET: RequestHandler = async ({ params, locals }) => {
  const user = locals.user;

  // Layer 1: Check authentication
  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Layer 2: Check purchase/access
  const hasAccess = await verifyPurchase(user.id, params.contentId);
  if (!hasAccess) {
    return json({ error: 'Access denied' }, { status: 403 });
  }

  // Layer 3: Generate signed URL
  const url = await r2Service.getDownloadUrl(bucketName, fileKey);
  return json({ url });
};
```

**3. Sanitize All User Inputs**:
```typescript
// ✅ Good: Sanitize filename before using as key
const filename = sanitizeFilename(userProvidedFilename);
const fileKey = `${creatorId}/originals/${mediaId}/${filename}`;
```

**4. Use Organization Scoping**:
```typescript
// ✅ Good: Always scope to organization
const content = await db.query.content.findFirst({
  where: and(
    eq(content.id, contentId),
    eq(content.organizationId, user.organizationId)  // Prevent cross-org access
  )
});
```

### Threat Prevention

**Data Leakage (Org A sees Org B content)**:
- Layer 1: `organizationId` check in every query
- Layer 2: RLS policies block cross-org queries
- Layer 3: Signed URLs include validation
- Layer 4: R2 validates signature before serving

**Unauthorized Playback (Watch without purchase)**:
- Layer 1: Check purchase before issuing URL
- Layer 2: RLS prevents database query
- Layer 3: Signed URL validates purchase
- Layer 4: R2 validates signature

**File Deletion Safety**:
```typescript
// ✅ Good: Check references before deleting
async function deleteMediaItem(mediaId: string, creatorId: string) {
  // Check if media item is referenced by any content
  const referencingContent = await db.query.content.findFirst({
    where: and(
      eq(content.mediaItemId, mediaId),
      isNull(content.deletedAt)
    )
  });

  if (referencingContent) {
    throw new Error('Cannot delete media item: referenced by content');
  }

  // Safe to delete
  await r2Service.deleteFile(bucketName, fileKey);
  await db.delete(mediaItems).where(eq(mediaItems.id, mediaId));
}
```

---

## Storage Scaling Considerations

### Current Architecture Capacity

**Phase 1 (Single Creator)**:
- Media (Original): ~10 videos × 500MB = 5GB
- Media (HLS Transcoded): ~10 videos × 1GB (4 variants) = 10GB
- Resources: ~20 PDFs × 5MB = 100MB
- Thumbnails: ~30 images × 200KB = 6MB
- **Total per Creator**: ~15GB
- **Total Buckets**: 4 (unified buckets)

**Phase 3 (100 Creators)**:
- Total Storage: 100 creators × 15GB = 1.5TB
- R2 Pricing: $0.015/GB/month = ~$22.50/month (storage only)
- Egress: First 10TB free (sufficient for MVP)
- **Total Buckets**: Still 4 (unified buckets scale horizontally)

**Cloudflare R2 Limits**:
- Unlimited objects per bucket
- Unlimited storage per account
- No egress fees (major cost savings vs S3)
- Custom domains supported

### Performance Optimizations

**1. CDN Caching**:
- All R2 content served via Cloudflare CDN
- Automatic edge caching for frequently accessed files
- Custom cache rules for different content types

**2. Metadata Caching**:
```typescript
// Cache media item metadata (not presigned URLs)
await redis.set(
  `media:${mediaId}`,
  JSON.stringify(mediaItem),
  'EX',
  86400  // 24 hours
);
```

**3. Batch Operations**:
```typescript
// Delete multiple files in one request (max 1000)
await s3Client.send(new DeleteObjectsCommand({
  Bucket: bucketName,
  Delete: {
    Objects: fileKeys.map(key => ({ Key: key }))
  }
}));
```

**4. Streaming Optimizations**:
- HLS adaptive bitrate streaming (Phase 2)
- Multiple quality levels (360p, 480p, 720p, 1080p)
- Browser automatically selects optimal quality

### Cost Management

**Storage Billing Attribution**:
```typescript
// Calculate storage per creator via folder prefix
async function getCreatorStorageUsage(creatorId: string) {
  const buckets = [
    'codex-media-production',
    'codex-resources-production',
    'codex-assets-production',
  ];

  let totalBytes = 0;

  for (const bucketName of buckets) {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: `${creatorId}/`,
    });

    const { Contents } = await s3Client.send(listCommand);
    totalBytes += Contents?.reduce((sum, obj) => sum + (obj.Size || 0), 0) || 0;
  }

  return {
    bytes: totalBytes,
    gb: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
    estimatedMonthlyCost: (totalBytes / 1024 / 1024 / 1024 * 0.015).toFixed(2)
  };
}
```

**Cleanup Strategies**:

```typescript
// 1. Delete old transcoded variants when re-transcoding
async function cleanupOldTranscode(mediaId: string, creatorId: string) {
  const prefix = `${creatorId}/hls/${mediaId}/`;
  await r2Service.deleteFolder('codex-media-production', prefix);
}

// 2. Delete old thumbnails when uploading new ones
async function replaceCustomThumbnail(
  contentId: string,
  creatorId: string,
  newThumbnailKey: string
) {
  // Get old thumbnail
  const content = await db.query.content.findFirst({
    where: eq(content.id, contentId)
  });

  // Delete old
  if (content.customThumbnailKey) {
    await r2Service.deleteFile('codex-assets-production', content.customThumbnailKey);
  }

  // Update with new
  await db.update(content)
    .set({ customThumbnailKey: newThumbnailKey })
    .where(eq(content.id, contentId));
}

// 3. Lifecycle policies (future: Cloudflare R2 lifecycle rules)
// Move old originals to cold storage after N days
// Delete transcoded streams for unpublished content after N days
```

### Migration Path (Future: Per-Creator Buckets)

**If needed in the future**, migrate from unified buckets to per-creator buckets:

```typescript
async function migrateToPerCreatorBuckets(creatorId: string) {
  const newBuckets = [
    `codex-media-${creatorId}`,
    `codex-resources-${creatorId}`,
    `codex-assets-${creatorId}`,
  ];

  // 1. Create new buckets
  for (const bucketName of newBuckets) {
    await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
  }

  // 2. Copy objects from unified bucket to creator bucket
  const unifiedBuckets = [
    'codex-media-production',
    'codex-resources-production',
    'codex-assets-production',
  ];

  for (let i = 0; i < unifiedBuckets.length; i++) {
    const sourceBucket = unifiedBuckets[i];
    const targetBucket = newBuckets[i];

    // List all objects with creator prefix
    const objects = await listAllObjectsWithPrefix(sourceBucket, `${creatorId}/`);

    // Copy each object, removing creatorId prefix in target
    for (const obj of objects) {
      const newKey = obj.Key.replace(`${creatorId}/`, '');
      await copyObject(sourceBucket, obj.Key, targetBucket, newKey);
    }

    // Delete from source after verification
    await r2Service.deleteFolder(sourceBucket, `${creatorId}/`);
  }

  // 3. Update database references
  await db.update(mediaItems)
    .set({ bucketName: `codex-media-${creatorId}` })
    .where(eq(mediaItems.ownerId, creatorId));

  // Similar updates for resources, assets...
}
```

**Note**: Migration is **optional** - the unified bucket approach works perfectly fine at scale. Only consider per-creator buckets if:
- Regulatory requirements mandate physical isolation
- Billing attribution needs to be exact per creator
- Customer requests separate bucket per creator

### Monitoring and Alerts

**Storage Usage Monitoring**:
```typescript
// Track storage metrics per creator
interface StorageMetrics {
  creatorId: string;
  mediaStorageGB: number;
  resourceStorageGB: number;
  assetStorageGB: number;
  totalStorageGB: number;
  fileCount: number;
  estimatedMonthlyCost: number;
  lastCalculated: Date;
}

// Alert when storage exceeds threshold
if (totalStorageGB > STORAGE_ALERT_THRESHOLD) {
  await notifications.send({
    type: 'storage_alert',
    creatorId,
    message: `Storage usage: ${totalStorageGB}GB (threshold: ${STORAGE_ALERT_THRESHOLD}GB)`,
  });
}
```

---

## References

This document consolidates R2 storage patterns from the following feature documents:

### Primary Sources

1. **Content Management PRD** (`/design/features/content-management/pdr-phase-1.md`)
   - Lines 95-99: Bucket-per-creator rationale
   - Lines 541-578: Direct upload strategy and benefits

2. **Content Management TDD** (`/design/features/content-management/ttd-dphase-1.md`)
   - Lines 639-883: R2Service implementation
   - Presigned URLs for upload/download
   - Bucket provisioning patterns

3. **Platform Settings PRD** (`/design/features/platform-settings/pdr-phase-1.md`)
   - Lines 48-50: Logo storage requirements

4. **Platform Settings TDD** (`/design/features/platform-settings/ttd-dphase-1.md`)
   - Lines 951-993: Asset storage implementation
   - Logo upload and delete flows

5. **Content Access EVOLUTION** (`/design/features/content-access/EVOLUTION.md`)
   - Media streaming patterns
   - Access control layers
   - Signed URLs for content delivery
   - Security model

6. **R2 Bucket Structure** (`/design/infrastructure/R2BucketStructure.md`)
   - Complete bucket architecture
   - Unified buckets vs per-creator buckets decision
   - File organization patterns
   - Upload/access flows
   - Storage scaling

### Related Documents

- **[Database Schema](../infrastructure/DatabaseSchema.md)** - `media_items`, `content`, `resources`, `resource_attachments` tables
- **[Infrastructure Plan](../infrastructure/infraplan.md)** - Overall infrastructure architecture
- **[Media Transcoding TDD](../features/media-transcoding/ttd-dphase-1.md)** - HLS transcoding workflow (Phase 2)
- **[Auth PRD](../features/auth/pdr-phase-1.md)** - Authentication and authorization
- **[E-Commerce PRD](../features/e-commerce/pdr-phase-1.md)** - Purchase verification for content access

### Feature Dependencies

**Features that reference this document**:

- Content Management (media uploads, media library)
- Platform Settings (logo and branding assets)
- Content Access (signed URLs for streaming)
- Media Transcoding (HLS output storage) - Phase 2
- E-Commerce (resource delivery after purchase)
- Offerings (session recording uploads) - Phase 2

---

## Appendix: Phase 1 vs Phase 2+ Patterns

### Phase 1 (Current)

**Upload Strategy**: Direct browser → R2 via presigned URLs
**Storage**: Unified buckets with per-creator folders
**Access**: Signed URLs for paid content, public for free content
**Transcoding**: Disabled (original files only)
**Resources**: Reusable across content
**Security**: Application guards + signed URLs

### Phase 2 (Planned)

**New Capabilities**:
- HLS transcoding (adaptive bitrate streaming)
- Automatic thumbnail generation from video frames
- Subscription tier-based access
- Preview/trailer content (30-second clips)
- Offering recording uploads and automatic processing

**Storage Additions**:
- HLS output folders (`{creatorId}/hls/{mediaId}/`)
- Auto-generated thumbnails (`thumbnails/media/{mediaId}/auto-generated.jpg`)
- Trailer clips (`trailers/{contentId}/preview.mp4`)

**Access Enhancements**:
- RLS policies enforced at database level
- Subscription-based access checks
- Content expiration support
- Analytics tracking (view events, completion rates)

### Phase 3+ (Future)

**Advanced Features**:
- DRM/encryption for premium content
- Geo-blocking support
- Offline download capabilities
- Content versioning
- Multi-CDN support

---

**Document Maintenance**:
- This document should be updated when:
  - New storage patterns are introduced
  - Bucket structure changes
  - Security requirements evolve
  - Performance optimizations are discovered
- Review quarterly to ensure accuracy
- Tag version updates in git with detailed change notes

---

**End of Document**
