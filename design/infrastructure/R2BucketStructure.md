# R2 Bucket Structure

## Overview

This document defines the Cloudflare R2 bucket organization for the Codex platform. R2 is used for:

- Media files (original uploads, transcoded HLS streams)
- Resources (PDFs, workbooks, downloadable files)
- Platform assets (thumbnails, logos)

## Design Decision: Unified Buckets with Per-Creator Folders

**Decision**: Use unified buckets per environment with internal folder structure organized by `creatorId`.

**Rationale**:

- **Simplicity**: No dynamic bucket provisioning on creator onboarding
- **Cost-Effective**: Fewer buckets = lower operation costs initially
- **Easier Management**: Single set of buckets to monitor and configure
- **Future-Compatible**: Internal structure matches future per-creator bucket design
- **Simple Migration**: Moving to per-creator buckets (if needed) is just folder moves
- **No Functional Downsides**: Folder-level isolation works equally well for permissions, deletion, and access control

**Trade-offs**:

- All creators share buckets (but isolated by folder structure)
- Slightly more complex deletion (delete folder contents vs delete bucket)
- **Mitigation**: Root-level `creatorId` folders make deletion straightforward with S3 prefix deletion

---

## Bucket Architecture

### Bucket Types

#### 1. Media Bucket (Unified)

**Naming**:
- Production: `codex-media-production`
- Staging: `codex-media-staging`
- Development: `codex-media-dev`

**Purpose**: Store all media files (video, audio) for all creators

**Structure**:

```
codex-media-production/
├── {creatorId-1}/
│   ├── originals/
│   │   └── {mediaId}/
│   │       └── original.mp4              # Original uploaded video
│   ├── hls/
│   │   └── {mediaId}/
│   │       ├── master.m3u8               # HLS master playlist
│   │       ├── 1080p/
│   │       │   ├── playlist.m3u8         # 1080p variant playlist
│   │       │   ├── segment_000.ts
│   │       │   ├── segment_001.ts
│   │       │   └── ...
│   │       ├── 720p/
│   │       │   ├── playlist.m3u8
│   │       │   └── segment_*.ts
│   │       ├── 480p/
│   │       │   └── ...
│   │       └── 360p/
│   │           └── ...
│   └── audio/
│       └── {mediaId}/
│           └── audio.mp3                 # Audio files (podcasts, etc.)
│
├── {creatorId-2}/
│   ├── originals/
│   └── hls/
│       └── ...
└── ...
```

**Access Control**:

- Public read for HLS streams (signed URLs for paid content)
- Private for originals (only creator + platform owner)

**Deletion Strategy**:
```typescript
// Delete all media for a creator
await s3Client.send(new DeleteObjectsCommand({
  Bucket: 'codex-media-production',
  Delete: {
    Objects: await listAllObjects(`${creatorId}/`)
  }
}));
```

---

#### 2. Resources Bucket (Unified)

**Naming**:
- Production: `codex-resources-production`
- Staging: `codex-resources-staging`
- Development: `codex-resources-dev`

**Purpose**: Store reusable resources (PDFs, workbooks, files) owned by creators

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

**Key Design**: Resources stored by `{creatorId}/{resourceId}` (NOT tied to specific content/offering)

**Why This Works**:

- Same workbook can be attached to multiple offerings via database relationships
- No file duplication in R2 (single source of truth)
- Resources belong to creator, not to specific content
- Database tracks which resources attach to which entities
- Root-level `creatorId` makes deletion straightforward

**Database Schema** (for reference):

```sql
-- Resource entity (owns the file)
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id),
  file_key VARCHAR(500) NOT NULL,    -- '{creatorId}/{resourceId}/{filename}.pdf'
  filename VARCHAR(255) NOT NULL,    -- Original filename
  file_size_bytes BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attachments (many-to-many: resources <-> entities)
CREATE TABLE resource_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL,  -- 'content', 'offering', 'course'
  entity_id UUID NOT NULL,
  attachment_label VARCHAR(100),     -- e.g., "Workbook", "Bonus PDF"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(resource_id, entity_type, entity_id)
);
```

**Example Usage**:

- Creator uploads `workbook-v2.pdf` once → stored as `{creatorId}/{resourceId}/workbook-v2.pdf`
- Attach to offering A → `INSERT INTO resource_attachments (resource_id, entity_type='offering', entity_id=A)`
- Attach to offering B → `INSERT INTO resource_attachments (resource_id, entity_type='offering', entity_id=B)`
- File only exists once in R2, referenced twice

**Access Control**:

- Private by default
- Signed URLs generated for users who purchased associated content/offering

---

#### 3. Assets Bucket (Unified)

**Naming**:
- Production: `codex-assets-production`
- Staging: `codex-assets-staging`
- Development: `codex-assets-dev`

**Purpose**: Store creator-specific assets (thumbnails, logos, branding)

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
│       ├── logo.png                      # Creator logo
│       └── banner.jpg                    # Profile banner
│
├── {creatorId-2}/
│   ├── thumbnails/
│   └── branding/
└── ...
```

**Why Organize by Creator**:

- Thumbnails are creator-owned assets
- Easier to manage all creator assets in one logical location
- Consistent folder structure across all buckets
- Easy deletion on creator off-boarding
- Billing attribution (can calculate storage per creator via folder prefix)

**Access Control**:

- Public read (thumbnails displayed publicly)
- Private write (only creator can upload)

---

#### 4. Platform Bucket (Global)

**Naming**:
- Production: `codex-platform-production`
- Staging: `codex-platform-staging`
- Development: `codex-platform-dev`

**Purpose**: Store platform-wide assets not owned by specific creators

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

**Access Control**:

- Public read
- Private write (platform owner only)

---

## Bucket Lifecycle

### Initial Setup (Phase 1 MVP)

**One-Time Bucket Creation:**

```bash
# Create production buckets (via Cloudflare Dashboard or Wrangler CLI)
wrangler r2 bucket create codex-media-production
wrangler r2 bucket create codex-resources-production
wrangler r2 bucket create codex-assets-production
wrangler r2 bucket create codex-platform-production
```

**No Dynamic Provisioning Needed**: Creators can start uploading immediately to their folder prefix.

### Creator Onboarding Flow (Simplified)

1. Platform Owner invites creator (Phase 3) or creator registers
2. Backend creates user record in database with `creatorId`
3. **That's it!** No bucket creation needed - creator uploads to their folder automatically

### Creator Off-boarding / Deletion

```typescript
// Delete all content for a creator across all buckets
async function deleteCreatorContent(creatorId: string) {
  const buckets = [
    'codex-media-production',
    'codex-resources-production',
    'codex-assets-production',
  ];

  for (const bucketName of buckets) {
    // List all objects with creator prefix
    const objects = await listAllObjectsWithPrefix(bucketName, `${creatorId}/`);

    // Batch delete (S3 supports 1000 objects per request)
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objects.map((obj) => ({ Key: obj.Key })),
        },
      })
    );
  }

  // Mark as deleted in database
  await db
    .update(users)
    .set({ deleted_at: new Date(), status: 'deleted' })
    .where(eq(users.id, creatorId));
}
```

**Benefits**:
- Simple prefix-based deletion
- No bucket management overhead
- Fast and efficient (batch deletes)

---

## Upload Flows

### Media Upload Flow

1. Creator uploads video via admin UI (`/admin/media/upload`)
2. Frontend requests presigned upload URL:
   ```typescript
   POST /api/media/presigned-upload
   Body: { filename: 'video.mp4', contentType: 'video/mp4' }
   ```
3. Backend generates presigned PUT URL for `codex-media-production/{creatorId}/originals/{mediaId}/original.mp4`
4. Frontend uploads directly to R2 (no server proxy)
5. Frontend notifies backend upload complete:
   ```typescript
   POST /api/media/upload-complete
   Body: { mediaId, fileKey: '{creatorId}/originals/{mediaId}/original.mp4' }
   ```
6. Backend creates `media_items` record:
   ```sql
   INSERT INTO media_items (id, owner_id, bucket_name, file_key, status)
   VALUES ('{mediaId}', '{creatorId}', 'codex-media-production', '{creatorId}/originals/{mediaId}/original.mp4', 'uploaded');
   ```
7. **Phase 2**: Backend enqueues transcoding job (currently disabled - direct upload only for MVP)

### Resource Upload Flow

1. Creator uploads PDF via admin UI
2. Frontend requests presigned upload URL:
   ```typescript
   POST /api/resources/presigned-upload
   Body: { filename: 'workbook.pdf', contentType: 'application/pdf' }
   ```
3. Backend generates presigned PUT URL for `codex-resources-production/{creatorId}/{resourceId}/workbook.pdf`
4. Frontend uploads directly to R2
5. Backend creates `resources` record:
   ```sql
   INSERT INTO resources (id, owner_id, file_key, filename, bucket_name)
   VALUES ('{resourceId}', '{creatorId}', '{creatorId}/{resourceId}/workbook.pdf', 'workbook.pdf', 'codex-resources-production');
   ```
6. Creator attaches resource to offering via admin UI:
   ```sql
   INSERT INTO resource_attachments (resource_id, entity_type, entity_id, attachment_label)
   VALUES ('{resourceId}', 'offering', '{offeringId}', 'Preparation Workbook');
   ```

### Thumbnail Upload Flow

1. Creator uploads custom thumbnail for content
2. Backend generates presigned PUT URL for `codex-assets-production/{creatorId}/thumbnails/content/{contentId}/custom.jpg`
3. Frontend uploads directly to R2
4. Backend updates content record:
   ```sql
   UPDATE content
   SET custom_thumbnail_url = 'https://r2.example.com/codex-assets-production/{creatorId}/thumbnails/content/{contentId}/custom.jpg'
   WHERE id = '{contentId}';
   ```

---

## Access Patterns

### Public Access (HLS Streams for Free Content)

```typescript
// Generate public URL for free content HLS stream
const hlsUrl = `https://r2.example.com/codex-media-production/${creatorId}/hls/${mediaId}/master.m3u8`;
```

### Signed URLs (Paid Content)

```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Generate signed URL for paid content (expires in 1 hour)
async function getSignedHlsUrl(
  mediaId: string,
  creatorId: string,
  userId: string
) {
  // Verify user purchased content (see Content Access PRD)
  const hasPurchased = await verifyPurchase(userId, mediaId);
  if (!hasPurchased) throw new Error('Access denied');

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const command = new GetObjectCommand({
    Bucket: 'codex-media-production',
    Key: `${creatorId}/hls/${mediaId}/master.m3u8`,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return url;
}
```

### Signed URLs (Resources)

```typescript
// Generate signed URL for downloadable resource
async function getSignedResourceUrl(resourceId: string, userId: string) {
  // Verify user has access to ANY entity this resource is attached to
  const hasAccess = await db.query.resource_attachments.findFirst({
    where: and(
      eq(resource_attachments.resource_id, resourceId)
      // Check if user purchased the associated content/offering
      // (Complex query - see Content Access TDD)
    ),
  });

  if (!hasAccess) throw new Error('Access denied');

  const resource = await db.query.resources.findFirst({
    where: eq(resources.id, resourceId),
  });

  const command = new GetObjectCommand({
    Bucket: 'codex-resources-production', // Unified bucket
    Key: resource.file_key, // Already includes {creatorId}/{resourceId}/filename
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return url;
}
```

---

## Storage Estimates

### Phase 1 MVP (Single Creator)

- **Media (Original)**: ~10 videos × 500MB = 5GB
- **Media (HLS Transcoded)**: ~10 videos × 1GB (4 variants) = 10GB
- **Resources**: ~20 PDFs × 5MB = 100MB
- **Thumbnails**: ~30 images × 200KB = 6MB
- **Total per Creator**: ~15GB
- **Total Buckets**: 4 (media, resources, assets, platform)

### Phase 3 (100 Creators)

- **Total Storage**: 100 creators × 15GB = 1.5TB
- **R2 Pricing**: $0.015/GB/month = ~$22.50/month (storage only)
- **Egress**: First 10TB free (sufficient for MVP)
- **Total Buckets**: Still 4 (no per-creator buckets)

### Scaling Considerations

- R2 allows unlimited objects per bucket
- No egress fees (major cost savings vs S3)
- Billing attribution per creator: Calculate storage via folder prefix

---

## Environment Configuration

### Environment Variables

```env
# .env.production
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_PUBLIC_DOMAIN=r2.codex.example.com  # Custom domain for R2 bucket access

# Bucket names
R2_BUCKET_MEDIA=codex-media-production
R2_BUCKET_RESOURCES=codex-resources-production
R2_BUCKET_ASSETS=codex-assets-production
R2_BUCKET_PLATFORM=codex-platform-production
```

### Cloudflare R2 Bindings (wrangler.toml)

```toml
# SvelteKit app / Workers that need R2 access

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

### Custom Domain Setup

1. Add custom domain in Cloudflare R2 dashboard: `r2.codex.example.com`
2. Update DNS CNAME record:
   ```
   r2.codex.example.com CNAME {account-id}.r2.cloudflarestorage.com
   ```
3. All bucket URLs become: `https://r2.codex.example.com/{bucket-name}/{key}`

---

## Security

### Bucket Permissions

- **Media Bucket**:
  - Originals: Private (creator + platform owner only)
  - HLS Streams: Public read OR signed URLs (based on content pricing)
  - Audio: Public read OR signed URLs
- **Resources Bucket**: Private (signed URLs only)
- **Assets Bucket**: Public read (thumbnails, logos)
- **Platform Bucket**: Public read

### CORS Configuration

```typescript
// Applied to all buckets that accept uploads
{
  CORSRules: [
    {
      AllowedOrigins: ['https://codex.example.com'],
      AllowedMethods: ['GET', 'HEAD', 'PUT'], // PUT for presigned uploads
      AllowedHeaders: ['*'],
      MaxAgeSeconds: 3600,
    },
  ];
}
```

### Presigned URL Expiry

- **Upload URLs**: 15 minutes (enough time for large video uploads)
- **Download URLs (HLS/Resources)**: 1 hour (must refresh for longer viewing)
- **Thumbnail URLs**: Public (no expiry needed)

---

## Migration Path (Future: Per-Creator Buckets)

If you ever need to migrate to per-creator buckets (e.g., for strict multi-tenancy):

```typescript
// Automated migration script
async function migrateToPerCreatorBuckets(creatorId: string) {
  const newBuckets = [
    `codex-media-${creatorId}`,
    `codex-resources-${creatorId}`,
    `codex-assets-${creatorId}`,
  ];

  // 1. Create new buckets
  for (const bucketName of newBuckets) {
    await r2Client.createBucket(bucketName);
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
    const objects = await listAllObjectsWithPrefix(
      sourceBucket,
      `${creatorId}/`
    );

    // Copy each object, removing creatorId prefix in target
    for (const obj of objects) {
      const newKey = obj.Key.replace(`${creatorId}/`, '');
      await copyObject(sourceBucket, obj.Key, targetBucket, newKey);
    }

    // Delete from source after verification
    await deleteCreatorFolder(sourceBucket, creatorId);
  }

  // 3. Update database references
  await db
    .update(media_items)
    .set({ bucket_name: `codex-media-${creatorId}` })
    .where(eq(media_items.owner_id, creatorId));

  // Similar updates for resources, assets...
}
```

**Migration is optional** - the unified bucket approach works perfectly fine at scale.

---

## Related Documents

- **[Content Management PRD](../features/content-management/pdr-phase-1.md)** - Media upload requirements
- **[Content Management TDD](../features/content-management/ttd-dphase-1.md)** - Media library architecture
- **[Media Transcoding TDD](../features/media-transcoding/ttd-dphase-1.md)** - HLS transcoding workflow (Phase 2)
- **[Content Access PRD](../features/content-access/pdr-phase-1.md)** - Signed URL generation for paid content
- **[Database Schema](./DatabaseSchema.md)** - `media_items`, `resources`, `resource_attachments` tables
- **[Infrastructure Plan](./infraplan.md)** - Overall infrastructure architecture

---

## Open Questions

1. **Thumbnail Auto-Generation**: Should we auto-generate thumbnails from video frames during transcoding?
   - **Proposed**: Yes (Phase 2) - extract frame at 10% mark, store in `codex-assets-production/{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg`

2. **Offering Recordings**: How do we handle live offering recordings (e.g., recorded Zoom sessions)?
   - **Option A**: Store in `codex-media-production/{creatorId}/originals/{mediaId}/` (treat as media item, transcode to HLS in Phase 2)
   - **Option B**: Separate `codex-recordings-production` bucket
   - **Recommendation**: Option A (recordings are just media items with `source_type = 'offering_recording'`)

3. **Resource Versioning**: Should we support multiple versions of same resource (e.g., workbook-v1.pdf, workbook-v2.pdf)?
   - **Proposed**: Yes - store as separate resources, use `attachment_label` to indicate version or allow creator to "replace" old attachment

---

**Document Version**: 2.0
**Last Updated**: 2025-10-26
**Status**: Approved - Ready for Implementation
**Change**: Updated from per-creator buckets to unified buckets with per-creator folder structure for simplicity and cost-effectiveness
