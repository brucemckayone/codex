# R2 Bucket Structure

## Overview

This document defines the Cloudflare R2 bucket organization for the Codex platform. R2 is used for:

- Media files (original uploads, transcoded HLS streams)
- Resources (PDFs, workbooks, downloadable files)
- Platform assets (thumbnails, logos)

## Design Decision: Bucket-Per-Creator (Option B)

**Decision**: Use isolated buckets per creator for media and resources.

**Rationale**:

- **Isolation**: Each creator's content is physically separated
- **Permissions**: Easier to manage creator-specific access control
- **Billing Attribution**: Track storage costs per creator
- **Scale**: Cloudflare allows 1 million buckets - sufficient for our needs
- **Security**: Compromised creator bucket doesn't affect others

**Trade-offs**:

- More complex bucket provisioning (automated via API)
- Cannot share media files between creators (acceptable - each creator owns their content)
- Slightly more complex deployment (must create buckets on creator onboarding)

---

## Bucket Architecture

### Bucket Types

#### 1. Media Buckets (Per-Creator)

**Naming**: `codex-media-{creatorId}`

**Purpose**: Store all media files (video, audio) for a specific creator

- Original uploads (before transcoding)
- Transcoded HLS streams (.m3u8 playlists, .ts segments)
- Audio files (MP3, etc.)

**Structure**:

```
codex-media-{creatorId}/
├── originals/
│   ├── {mediaId}/
│   │   └── original.mp4              # Original uploaded video
├── hls/
│   ├── {mediaId}/
│   │   ├── master.m3u8               # HLS master playlist
│   │   ├── 1080p/
│   │   │   ├── playlist.m3u8         # 1080p variant playlist
│   │   │   ├── segment_000.ts
│   │   │   ├── segment_001.ts
│   │   │   └── ...
│   │   ├── 720p/
│   │   │   ├── playlist.m3u8
│   │   │   └── segment_*.ts
│   │   ├── 480p/
│   │   │   └── ...
│   │   └── 360p/
│   │       └── ...
└── audio/
    ├── {mediaId}/
    │   └── audio.mp3                 # Audio files (podcasts, etc.)
```

**Access Control**:

- Public read for HLS streams (signed URLs for paid content)
- Private for originals (only creator + platform owner)

---

#### 2. Resource Buckets (Per-Creator)

**Naming**: `codex-resources-{creatorId}`

**Purpose**: Store reusable resources (PDFs, workbooks, files) owned by creator

**Structure**:

```
codex-resources-{creatorId}/
└── {resourceId}/
    └── {originalFilename}.pdf        # e.g., "workbook-v2.pdf"
```

**Key Design**: Resources stored by `resourceId` (NOT tied to specific content/offering)

**Why This Works**:

- Same workbook can be attached to multiple offerings via database relationships
- No file duplication in R2 (single source of truth)
- Resources belong to creator, not to specific content
- Database tracks which resources attach to which entities

**Database Schema** (for reference):

```sql
-- Resource entity (owns the file)
CREATE TABLE resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES users(id),
  file_key VARCHAR(500) NOT NULL,    -- '{resourceId}/{filename}.pdf'
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

- Creator uploads `workbook-v2.pdf` once → stored as `{resourceId}/workbook-v2.pdf`
- Attach to offering A → `INSERT INTO resource_attachments (resource_id, entity_type='offering', entity_id=A)`
- Attach to offering B → `INSERT INTO resource_attachments (resource_id, entity_type='offering', entity_id=B)`
- File only exists once in R2, referenced twice

**Access Control**:

- Private by default
- Signed URLs generated for users who purchased associated content/offering

---

#### 3. Asset Buckets (Per-Creator)

**Naming**: `codex-assets-{creatorId}`

**Purpose**: Store creator-specific assets (thumbnails, logos, branding)

**Structure**:

```
codex-assets-{creatorId}/
├── thumbnails/
│   ├── content/
│   │   └── {contentId}/
│   │       ├── auto-generated.jpg    # Generated from video frame
│   │       └── custom.jpg            # Custom uploaded thumbnail
│   ├── offerings/
│   │   └── {offeringId}/
│   │       └── hero-image.jpg
│   └── media/
│       └── {mediaId}/
│           └── preview.jpg           # Media item thumbnail
└── branding/
    ├── logo.png                      # Creator logo
    └── banner.jpg                    # Profile banner
```

**Why Tie Thumbnails to Creators**:

- Thumbnails are creator-owned assets
- Easier to manage all creator assets in one bucket
- Consistent with bucket-per-creator isolation model
- Billing attribution (storage costs belong to creator)

**Access Control**:

- Public read (thumbnails displayed publicly)
- Private write (only creator can upload)

---

#### 4. Platform Bucket (Global)

**Naming**: `codex-platform`

**Purpose**: Store platform-wide assets not owned by specific creators

**Structure**:

```
codex-platform/
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

### Creator Onboarding Flow

1. Platform Owner invites creator (Phase 3) or creator registers
2. Backend creates buckets via Cloudflare R2 API:

   ```typescript
   // Bucket creation on creator signup
   async function provisionCreatorBuckets(creatorId: string) {
     const buckets = [
       `codex-media-${creatorId}`,
       `codex-resources-${creatorId}`,
       `codex-assets-${creatorId}`,
     ];

     for (const bucketName of buckets) {
       await r2Client.createBucket(bucketName);

       // Set CORS policy
       await r2Client.putBucketCors(bucketName, {
         CORSRules: [
           {
             AllowedOrigins: ['https://codex.example.com'],
             AllowedMethods: ['GET', 'HEAD'],
             AllowedHeaders: ['*'],
           },
         ],
       });
     }
   }
   ```

3. Store bucket names in database:
   ```sql
   CREATE TABLE creator_buckets (
     creator_id UUID PRIMARY KEY REFERENCES users(id),
     media_bucket VARCHAR(100) NOT NULL,      -- 'codex-media-{creatorId}'
     resources_bucket VARCHAR(100) NOT NULL,  -- 'codex-resources-{creatorId}'
     assets_bucket VARCHAR(100) NOT NULL,     -- 'codex-assets-{creatorId}'
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

### Bucket Deletion (Creator Off-boarding)

- Mark buckets for deletion in database
- Async cleanup job empties buckets (delete all objects)
- Delete empty buckets via R2 API
- Retain metadata in database for audit trail

---

## Upload Flows

### Media Upload Flow

1. Creator uploads video via admin UI (`/admin/media/upload`)
2. Frontend requests presigned upload URL:
   ```typescript
   POST /api/media/presigned-upload
   Body: { filename: 'video.mp4', contentType: 'video/mp4' }
   ```
3. Backend generates presigned PUT URL for `codex-media-{creatorId}/originals/{mediaId}/original.mp4`
4. Frontend uploads directly to R2 (no server proxy)
5. Frontend notifies backend upload complete:
   ```typescript
   POST /api/media/upload-complete
   Body: { mediaId, fileKey: 'originals/{mediaId}/original.mp4' }
   ```
6. Backend creates `media_items` record:
   ```sql
   INSERT INTO media_items (id, owner_id, bucket_name, file_key, status)
   VALUES ('{mediaId}', '{creatorId}', 'codex-media-{creatorId}', 'originals/{mediaId}/original.mp4', 'uploaded');
   ```
7. Backend enqueues transcoding job (see [Media Transcoding TDD](../features/media-transcoding/ttd-dphase-1.md)):
   ```typescript
   await platform.env.TRANSCODING_QUEUE.send({
     mediaId,
     inputBucket: 'codex-media-{creatorId}',
     inputKey: 'originals/{mediaId}/original.mp4',
     outputBucket: 'codex-media-{creatorId}',
     outputPrefix: 'hls/{mediaId}/',
   });
   ```

### Resource Upload Flow

1. Creator uploads PDF via admin UI
2. Frontend requests presigned upload URL:
   ```typescript
   POST /api/resources/presigned-upload
   Body: { filename: 'workbook.pdf', contentType: 'application/pdf' }
   ```
3. Backend generates presigned PUT URL for `codex-resources-{creatorId}/{resourceId}/workbook.pdf`
4. Frontend uploads directly to R2
5. Backend creates `resources` record:
   ```sql
   INSERT INTO resources (id, owner_id, file_key, filename, bucket_name)
   VALUES ('{resourceId}', '{creatorId}', '{resourceId}/workbook.pdf', 'workbook.pdf', 'codex-resources-{creatorId}');
   ```
6. Creator attaches resource to offering via admin UI:
   ```sql
   INSERT INTO resource_attachments (resource_id, entity_type, entity_id, attachment_label)
   VALUES ('{resourceId}', 'offering', '{offeringId}', 'Preparation Workbook');
   ```

### Thumbnail Upload Flow

1. Creator uploads custom thumbnail for content
2. Backend generates presigned PUT URL for `codex-assets-{creatorId}/thumbnails/content/{contentId}/custom.jpg`
3. Frontend uploads directly to R2
4. Backend updates content record:
   ```sql
   UPDATE content
   SET custom_thumbnail_url = 'https://r2.example.com/codex-assets-{creatorId}/thumbnails/content/{contentId}/custom.jpg'
   WHERE id = '{contentId}';
   ```

---

## Access Patterns

### Public Access (HLS Streams for Free Content)

```typescript
// Generate public URL for free content HLS stream
const hlsUrl = `https://r2.example.com/codex-media-${creatorId}/hls/${mediaId}/master.m3u8`;
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
    Bucket: `codex-media-${creatorId}`,
    Key: `hls/${mediaId}/master.m3u8`,
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
    Bucket: resource.bucket_name,
    Key: resource.file_key,
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

### Phase 3 (100 Creators)

- **Total Storage**: 100 creators × 15GB = 1.5TB
- **R2 Pricing**: $0.015/GB/month = ~$22.50/month (storage only)
- **Egress**: First 10TB free (sufficient for MVP)

### Scaling Considerations

- R2 allows 1 million buckets (100 creators × 3 buckets = 300 buckets used)
- R2 allows unlimited storage per bucket
- No egress fees (major cost savings vs S3)

---

## Environment Configuration

### Environment Variables

```env
# .env.prod
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_PUBLIC_DOMAIN=r2.codex.example.com  # Custom domain for R2 bucket access
```

### Cloudflare R2 Bindings (wrangler.toml)

```toml
[[r2_buckets]]
binding = "PLATFORM_BUCKET"
bucket_name = "codex-platform"
preview_bucket_name = "codex-platform-preview"

# Creator buckets are created dynamically, not bound in wrangler.toml
# Access via R2 API using credentials above
```

### Custom Domain Setup

1. Add custom domain in Cloudflare R2 dashboard: `r2.codex.example.com`
2. Update DNS CNAME record:
   ```
   r2.codex.example.com CNAME {bucket-name}.{account-id}.r2.cloudflarestorage.com
   ```
3. All bucket URLs become: `https://r2.codex.example.com/{bucket-name}/{key}`

---

## Security

### Bucket Permissions

- **Media Buckets**:
  - Originals: Private (creator + platform owner only)
  - HLS Streams: Public read OR signed URLs (based on content pricing)
  - Audio: Public read OR signed URLs
- **Resource Buckets**: Private (signed URLs only)
- **Asset Buckets**: Public read (thumbnails, logos)
- **Platform Bucket**: Public read

### CORS Configuration

```typescript
// Applied to all creator buckets
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

## Related Documents

- **[Content Management PRD](../features/content-management/pdr-phase-1.md)** - Media upload requirements
- **[Content Management TDD](../features/content-management/ttd-dphase-1.md)** - Media library architecture
- **[Media Transcoding TDD](../features/media-transcoding/ttd-dphase-1.md)** - HLS transcoding workflow
- **[Content Access PRD](../features/content-access/pdr-phase-1.md)** - Signed URL generation for paid content
- **[Database Schema](./DatabaseSchema.md)** - `media_items`, `resources`, `resource_attachments` tables
- **[Infrastructure Plan](./infraplan.md)** - Overall infrastructure architecture

---

## Open Questions

1. **Thumbnail Auto-Generation**: Should we auto-generate thumbnails from video frames during transcoding?
   - **Proposed**: Yes - extract frame at 10% mark, store in `codex-assets-{creatorId}/thumbnails/media/{mediaId}/auto-generated.jpg`

2. **Offering Recordings**: How do we handle live offering recordings (e.g., recorded Zoom sessions)?
   - **Option A**: Store in `codex-media-{creatorId}/originals/{mediaId}/` (treat as media item, transcode to HLS)
   - **Option B**: Separate `codex-recordings-{creatorId}` bucket
   - **Recommendation**: Option A (recordings are just media items with `source_type = 'offering_recording'`)

3. **Resource Versioning**: Should we support multiple versions of same resource (e.g., workbook-v1.pdf, workbook-v2.pdf)?
   - **Proposed**: Yes - store as separate resources, use `attachment_label` to indicate version or allow creator to "replace" old attachment

---

**Document Version**: 1.0
**Last Updated**: 2025-10-20
**Status**: Draft - Awaiting Review
