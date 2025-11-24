# @codex/cloudflare-clients

## Overview

Provides S3-compatible clients for Cloudflare R2 object storage and KV key-value stores. The R2Service integrates with Cloudflare Workers R2Bucket bindings for production workloads, while R2SigningClient offers standalone presigned URL generation for testing and scripts without runtime dependencies. These clients abstract Cloudflare service complexity with automatic retry logic, type safety, and convenient helper methods.

## Public API

| Export | Type | Purpose |
|--------|------|---------|
| `R2Service` | Class | R2 object storage operations with retries (Workers runtime) |
| `R2SigningClient` | Class | Standalone R2 presigned URL generation (tests/scripts) |
| `createR2SigningClientFromEnv` | Function | Factory for R2SigningClient from environment variables |
| `R2SigningConfig` | Type | S3 credentials config for R2 signing operations |
| `R2Opts` | Type | Retry configuration options |
| `kvPlaceholder` | Const | Placeholder (KV client not yet implemented) |

## R2Service - Object Storage Operations

S3-compatible client for R2 bucket operations with exponential backoff retry logic. Wraps Cloudflare Workers R2Bucket binding for automatic retry, JSON serialization, and presigned URL generation.

### Constructor
  opts?: R2Opts,
  signingConfig?: R2SigningConfig
)
```

**Parameters**:
- `bucket` (R2Bucket): The R2 bucket binding from Cloudflare Workers environment
- `opts` (R2Opts, optional): Configuration for retry behavior:
  - `maxRetries?: number` - Maximum retry attempts (default: 3)
  - `baseDelayMs?: number` - Initial backoff delay in milliseconds (default: 100)
  - `maxDelayMs?: number` - Maximum backoff delay in milliseconds (default: 2000)
  - `jitter?: boolean` - Add randomization to backoff delays (default: true)
- `signingConfig` (R2SigningConfig, optional): Credentials for presigned URL generation:
  - `accountId: string` - Cloudflare account ID
  - `accessKeyId: string` - R2 API token access key
  - `secretAccessKey: string` - R2 API token secret key
  - `bucketName: string` - R2 bucket name

**Throws**: Error if signingConfig is missing but presigned URLs are requested

**Example**:
```typescript
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';

// Initialize with retry config and signing credentials
const signingConfig: R2SigningConfig = {
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucketName: 'my-media-bucket',
};

const r2Service = new R2Service(env.MEDIA_BUCKET, {
  maxRetries: 5,
  baseDelayMs: 50,
  maxDelayMs: 5000,
}, signingConfig);
```

#### Methods

##### put(key, body, metadata?, httpMetadata?)

Upload or overwrite an object in R2.

```typescript
async put(
  key: string,
  body: Parameters<R2Bucket['put']>[1],
  metadata?: Record<string, string>,
  httpMetadata?: R2HTTPMetadata
): Promise<R2Object>
```

**Parameters**:
- `key: string` - The object key/path in the bucket
- `body: string | ArrayBuffer | Blob | ReadableStream<any>` - File content to upload
- `metadata?: Record<string, string>` - Custom metadata to attach to object (stored as x-amz-meta-*)
- `httpMetadata?: R2HTTPMetadata` - HTTP headers for the object:
  - `contentType?: string` - MIME type (e.g., 'video/mp4', 'application/json')
  - `contentDisposition?: string` - How browser should handle the object
  - `cacheControl?: string` - Cache control directives

**Returns**: R2Object with properties: `key`, `version`, `size`, `etag`, `httpMetadata`, `customMetadata`, `uploadedDate`

**Throws**: Error if upload fails after max retries (5xx, 429 status codes are retried)

**Example**:
```typescript
// Upload video file
const videoBuffer = await fs.readFile('video.mp4');
const result = await r2Service.put(
  'creator-123/videos/my-video.mp4',
  videoBuffer,
  { uploadedBy: 'mobile-app', version: '1.0' },
  { contentType: 'video/mp4', cacheControl: 'public, max-age=3600' }
);

console.log(`Uploaded: ${result.key} (${result.size} bytes)`);
```

##### putJson(key, obj, metadata?)

Convenience method to upload JSON data with automatic stringification and content-type.

```typescript
async putJson(
  key: string,
  obj: unknown,
  metadata?: Record<string, string>
): Promise<R2Object>
```

**Parameters**:
- `key: string` - The object key in the bucket
- `obj: unknown` - JavaScript object to serialize to JSON
- `metadata?: Record<string, string>` - Custom metadata

**Returns**: R2Object

**Throws**: Error if JSON serialization or upload fails

**Example**:
```typescript
const metadata = {
  creator: 'user-123',
  durationSeconds: '3600',
};

await r2Service.putJson(
  'creator-123/manifests/media-456.json',
  {
    segments: ['segment-0.m3u8', 'segment-1.m3u8'],
    duration: 3600,
    codec: 'h264',
  },
  metadata
);
```

##### get(key)

Retrieve an object from R2.

```typescript
async get(key: string): Promise<R2ObjectBody | null>
```

**Parameters**:
- `key: string` - The object key to retrieve

**Returns**: R2ObjectBody with properties: `key`, `version`, `size`, `etag`, `httpMetadata`, `customMetadata`, `uploadedDate`, plus `body` (ReadableStream)

Returns null if object doesn't exist (404 is not retried)

**Throws**: Error if retrieval fails (non-404 errors are retried for 5xx/429)

**Example**:
```typescript
const obj = await r2Service.get('creator-123/videos/my-video.mp4');

if (!obj) {
  console.log('Video not found');
  return;
}

console.log(`Retrieved: ${obj.key} (${obj.size} bytes, ${obj.httpMetadata.contentType})`);

// Stream body to response
const reader = obj.body.getReader();
// ... read chunks
```

##### delete(key)

Delete an object from R2.

```typescript
async delete(key: string): Promise<void>
```

**Parameters**:
- `key: string` - The object key to delete

**Returns**: void (no error if key doesn't exist)

**Throws**: Error if deletion fails after max retries

**Example**:
```typescript
await r2Service.delete('creator-123/videos/old-video.mp4');
console.log('Video deleted successfully');
```

##### list(options?)

List objects in the bucket with pagination support.

```typescript
async list(options?: R2ListOptions): Promise<R2Objects>
```

**Parameters**:
- `options?: R2ListOptions` - Listing options:
  - `prefix?: string` - Filter to keys starting with prefix (e.g., 'creator-123/')
  - `delimiter?: string` - Directory delimiter for simulating folder hierarchy
  - `limit?: number` - Maximum keys to return (default: 1000)
  - `cursor?: string` - Pagination cursor from previous response

**Returns**: R2Objects with properties: `objects` (array of R2Object), `delimitedPrefixes` (array of prefix strings), `isTruncated` (boolean), `cursor` (string for pagination)

**Throws**: Error if listing fails after max retries

**Example**:
```typescript
// List all videos for a creator
const result = await r2Service.list({
  prefix: 'creator-123/videos/',
  limit: 100,
});

console.log(`Found ${result.objects.length} videos`);
for (const obj of result.objects) {
  console.log(`- ${obj.key} (${obj.size} bytes)`);
}

if (result.isTruncated) {
  const nextPage = await r2Service.list({
    prefix: 'creator-123/videos/',
    cursor: result.cursor,
  });
}
```

##### createMultipartUpload(key, options?)

Initiate a multipart upload for large objects (useful for chunked/resumable uploads).

```typescript
async createMultipartUpload(
  key: string,
  options?: R2MultipartOptions
): Promise<R2MultipartUpload>
```

**Parameters**:
- `key: string` - The object key to upload to
- `options?: R2MultipartOptions` - Upload options:
  - `httpMetadata?: R2HTTPMetadata` - HTTP headers (contentType, cacheControl, etc.)
  - `customMetadata?: Record<string, string>` - Custom metadata

**Returns**: R2MultipartUpload with properties: `uploadId`, `key`, `parts` (array)

**Throws**: Error if upload initiation fails after max retries

**Example**:
```typescript
// Start multipart upload for large file
const multipart = await r2Service.createMultipartUpload(
  'creator-123/large-video.mp4',
  {
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: { uploadType: 'chunked' },
  }
);

console.log(`Upload ID: ${multipart.uploadId}`);
// Then upload parts using resumeMultipartUpload
```

##### resumeMultipartUpload(key, uploadId)

Resume an existing multipart upload to add/complete parts.

```typescript
resumeMultipartUpload(
  key: string,
  uploadId: string
): R2MultipartUpload
```

**Parameters**:
- `key: string` - The object key being uploaded
- `uploadId: string` - The upload ID from createMultipartUpload

**Returns**: R2MultipartUpload for uploading parts

**Note**: This is a synchronous method (returns immediately, doesn't perform I/O)

**Example**:
```typescript
// Resume a previous multipart upload
const uploadId = 'previously-stored-upload-id';
const multipart = r2Service.resumeMultipartUpload(
  'creator-123/large-video.mp4',
  uploadId
);

// Upload a part
await multipart.uploadPart(1, partData);
```

##### generateSignedUrl(r2Key, expirySeconds)

Generate a time-limited presigned URL for temporary access to an R2 object. URL expires after specified seconds.

```typescript
async generateSignedUrl(
  r2Key: string,
  expirySeconds: number
): Promise<string>
```

**Parameters**:
- `r2Key: string` - The object key in R2 (e.g., 'creator-123/hls/media-456/master.m3u8')
- `expirySeconds: number` - URL validity duration in seconds (maximum 604800 = 7 days, AWS limit)

**Returns**: Presigned URL string that can be shared or embedded in responses

**Throws**:
- Error if R2SigningConfig was not provided in constructor
- Error if AWS SDK fails to generate signature

**Setup Required**:
1. Create R2 API token: Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Token requires "Object Read" permission on target bucket
3. Token credentials must be provided in R2SigningConfig during construction

**Example**:
```typescript
// Generate 1-hour access URL for video streaming
const presignedUrl = await r2Service.generateSignedUrl(
  'creator-123/hls/media-456/master.m3u8',
  3600
);

// Response to client (e.g., HLS player)
res.json({
  streamingUrl: presignedUrl,
  expiresAt: new Date(Date.now() + 3600 * 1000),
});

// Later request to same URL succeeds (within 1 hour)
// After 1 hour, requests to URL get 403 Forbidden from R2
```

## R2SigningClient

Standalone client for generating presigned R2 URLs without requiring the R2Bucket binding. Use this in testing, Node.js scripts, or any environment with network access to R2 (not just Cloudflare Workers).

### Class: R2SigningClient

**File Location**: `/Users/brucemckay/development/Codex/packages/cloudflare-clients/src/r2/services/r2-signing-client.ts`

#### Constructor

```typescript
constructor(config: R2SigningConfig)
```

**Parameters**:
- `config: R2SigningConfig` - R2 credentials:
  - `accountId: string` - Cloudflare account ID (24-character hex string)
  - `accessKeyId: string` - R2 API token access key ID
  - `secretAccessKey: string` - R2 API token secret access key
  - `bucketName: string` - R2 bucket name (e.g., 'codex-media-production')

**Throws**: No validation in constructor; errors occur on first API call if credentials are invalid

**Difference from R2Service**:
- R2SigningClient: Only generates presigned URLs (no R2 object operations)
- R2SigningClient: Works in Node.js, tests, and non-Workers environments
- R2SigningClient: Requires full S3 credentials instead of Workers binding
- R2Service: Requires R2Bucket binding (Workers only) but supports all operations

**Example**:
```typescript
import { R2SigningClient } from '@codex/cloudflare-clients';

const client = new R2SigningClient({
  accountId: '1234567890abcdef1234567890abcdef',
  accessKeyId: 'abc123def456',
  secretAccessKey: 'secret-key-here',
  bucketName: 'codex-media-production',
});
```

#### Methods

##### generateSignedUrl(r2Key, expirySeconds)

Generate a presigned URL for temporary read access to an R2 object.

```typescript
async generateSignedUrl(
  r2Key: string,
  expirySeconds: number
): Promise<string>
```

**Parameters**:
- `r2Key: string` - The object key in the bucket (e.g., 'creator-123/videos/my-video.mp4')
- `expirySeconds: number` - URL validity in seconds (max 604800 = 7 days)

**Returns**: Presigned URL string in format: `https://{bucket}.r2.cloudflarestorage.com/{key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...&...`

**URL Components**:
- Query parameter `X-Amz-Expires` - Matches the requested expirySeconds
- Query parameter `X-Amz-Signature` - AWS Signature Version 4
- Query parameter `X-Amz-SignedHeaders` - List of signed header names
- Query parameter `X-Amz-Date` - Request timestamp

**Throws**: Error if AWS SDK fails (invalid credentials, network error, etc.)

**Example**:
```typescript
// Generate 24-hour access URL
const url = await client.generateSignedUrl(
  'creator-123/hls/media-456/master.m3u8',
  86400
);

console.log(url);
// https://codex-media-production.r2.cloudflarestorage.com/creator-123/hls/media-456/master.m3u8?X-Amz-Algorithm=AWS4-HMAC-SHA256&...

// Send to browser/HLS player - valid for next 24 hours
```

##### objectExists(r2Key)

Check if an object exists in the bucket. Useful for verifying uploads or testing object accessibility.

```typescript
async objectExists(r2Key: string): Promise<boolean>
```

**Parameters**:
- `r2Key: string` - The object key to check

**Returns**: true if object exists and is accessible, false if object not found

**Throws**: Error if request fails for reasons other than "not found" (e.g., permission denied, network error)

**Example**:
```typescript
const exists = await client.objectExists('creator-123/videos/video.mp4');

if (exists) {
  console.log('Video is accessible');
} else {
  console.log('Video not found or not uploaded yet');
}
```

##### getBucketName()

Get the bucket name this client is configured for.

```typescript
getBucketName(): string
```

**Returns**: Bucket name string (e.g., 'codex-media-production')

**Example**:
```typescript
const bucketName = client.getBucketName();
console.log(`Generating URLs for: ${bucketName}`);
```

#### Factory Function: createR2SigningClientFromEnv()

Create R2SigningClient from environment variables. Simplifies initialization in tests and scripts.

```typescript
function createR2SigningClientFromEnv(): R2SigningClient
```

**Environment Variables Required**:
- `R2_ACCOUNT_ID` - Cloudflare account ID
- `R2_ACCESS_KEY_ID` - R2 API token access key ID
- `R2_SECRET_ACCESS_KEY` - R2 API token secret access key
- `R2_BUCKET_MEDIA` - R2 bucket name

**Returns**: Initialized R2SigningClient

**Throws**: Error if any required environment variable is missing

**Example**:
```typescript
// In vitest.setup.ts or .env.test
process.env.R2_ACCOUNT_ID = '1234567890abcdef1234567890abcdef';
process.env.R2_ACCESS_KEY_ID = 'abc123def456';
process.env.R2_SECRET_ACCESS_KEY = 'secret-key-here';
process.env.R2_BUCKET_MEDIA = 'codex-media-test';

// In test file
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';

const client = createR2SigningClientFromEnv();
// No error - all env vars present
```

**Setup in Tests**:
```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
});

// vitest.setup.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// .env.test
R2_ACCOUNT_ID=1234567890abcdef1234567890abcdef
R2_ACCESS_KEY_ID=abc123def456
R2_SECRET_ACCESS_KEY=secret-key-here
R2_BUCKET_MEDIA=codex-media-test
```

## Signed URL Generation

### How Signed URLs Work

Presigned URLs provide temporary, cryptographically-signed access to R2 objects without requiring authentication credentials. The signature is valid for a specific duration (expirySeconds) and allows unauthenticated requests to read the object.

**Flow**:
1. Service generates presigned URL using R2 API credentials (expires in N seconds)
2. URL is shared with client (embedded in response, sent to browser, etc.)
3. Client can access object via URL without authentication
4. After expiry, URL becomes invalid (403 Forbidden from R2)

**Security**:
- Signature includes: bucket name, object key, expiry time, request method (GET)
- Cannot be forged without secret access key
- Cannot be extended beyond specified expiry
- Different URL for each object/expiry combination

**Use Cases**:
- Video streaming URLs (HLS playlists, DASH manifests)
- Downloadable files with time-limited access
- Sharing with external parties (limited duration)
- Client-side playback without exposing API keys

### Configuration & Setup

#### Step 1: Create R2 API Token

```
Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token

Configuration:
- Permissions: "Object Read" (minimum for signed URLs)
- Bucket access: Specific bucket or All buckets
- TTL: Set as needed (token expiry, not URL expiry)
```

#### Step 2: Environment Variables

```bash
# Cloudflare account settings
R2_ACCOUNT_ID=1234567890abcdef1234567890abcdef

# From API token created above
R2_ACCESS_KEY_ID=abc123def456
R2_SECRET_ACCESS_KEY=secret-key-here-do-not-commit

# R2 bucket name
R2_BUCKET_MEDIA=codex-media-production
```

#### Step 3: Initialize Service

```typescript
import { R2Service } from '@codex/cloudflare-clients';

const signingConfig = {
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucketName: env.R2_BUCKET_MEDIA,
};

const r2Service = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);

// Now ready to generate signed URLs
```

#### Step 4: Use Signed URLs

```typescript
const presignedUrl = await r2Service.generateSignedUrl(
  'creator-123/hls/media-456/master.m3u8',
  3600  // Valid for 1 hour
);

// Send to client
res.json({ streamingUrl: presignedUrl });
```

### URL Expiry Constraints

- **Minimum**: 1 second
- **Maximum**: 604800 seconds (7 days) - AWS SDK limitation
- **Recommended**: 1 hour (3600 seconds) for streaming, 24 hours for downloads
- **Zero-TTL**: Not possible; always requires positive expiry

### Signature Verification

Presigned URLs use AWS Signature Version 4 with HMAC-SHA256. The signature includes:
- Access key ID
- Request timestamp
- Credential scope (date, region, service)
- Signed headers (Host, etc.)
- Payload hash

Tampering with any part of the URL (path, query parameters, headers) invalidates the signature.

## File Operations

### Upload Patterns

#### Simple Upload

```typescript
const result = await r2Service.put(
  'creator-123/videos/my-video.mp4',
  videoBuffer,
  { uploadedBy: 'mobile-app' },
  { contentType: 'video/mp4' }
);
```

#### JSON Upload

```typescript
await r2Service.putJson(
  'creator-123/metadata/video-456.json',
  { title: 'My Video', duration: 3600 },
  { uploadedBy: 'api-v1' }
);
```

#### Multipart Upload (Large Files)

```typescript
// Initiate
const upload = await r2Service.createMultipartUpload(
  'creator-123/large-file.mp4',
  { httpMetadata: { contentType: 'video/mp4' } }
);

// Upload parts in chunks
const part1 = await upload.uploadPart(1, chunk1);
const part2 = await upload.uploadPart(2, chunk2);
const part3 = await upload.uploadPart(3, chunk3);

// Complete upload
const result = await upload.complete([part1, part2, part3]);
```

### Download Patterns

#### Stream to Response

```typescript
const obj = await r2Service.get('creator-123/videos/video.mp4');

if (!obj) {
  res.status(404).send('Not found');
  return;
}

// Set response headers
res.setHeader('Content-Type', obj.httpMetadata.contentType);
res.setHeader('Content-Length', obj.size);

// Stream body
obj.body.pipeTo(res);
```

#### Read Entire Object

```typescript
const obj = await r2Service.get('creator-123/config.json');
const text = await obj.body.text();
const config = JSON.parse(text);
```

### Delete Patterns

```typescript
// Delete single object
await r2Service.delete('creator-123/old-video.mp4');

// Delete multiple objects (not batch - do in loop)
const keys = ['video1.mp4', 'video2.mp4', 'video3.mp4'];
for (const key of keys) {
  await r2Service.delete(`creator-123/${key}`);
}

// List and delete all objects with prefix
const result = await r2Service.list({ prefix: 'creator-123/temp/' });
for (const obj of result.objects) {
  await r2Service.delete(obj.key);
}
```

### List Patterns

#### List All Objects with Prefix

```typescript
const result = await r2Service.list({
  prefix: 'creator-123/videos/',
});

console.log(`Found ${result.objects.length} videos`);
for (const obj of result.objects) {
  console.log(`${obj.key} - ${obj.size} bytes`);
}
```

#### Paginated Listing

```typescript
let cursor: string | undefined;
let allObjects: typeof result.objects = [];

do {
  const result = await r2Service.list({
    prefix: 'creator-123/videos/',
    limit: 100,
    cursor,
  });

  allObjects = allObjects.concat(result.objects);
  cursor = result.isTruncated ? result.cursor : undefined;
} while (cursor);

console.log(`Total objects: ${allObjects.length}`);
```

#### Directory-like Listing (with Delimiter)

```typescript
const result = await r2Service.list({
  prefix: 'creator-123/',
  delimiter: '/',
});

console.log('Directories:');
for (const prefix of result.delimitedPrefixes) {
  console.log(`  ${prefix}`);
}

console.log('Files in root:');
for (const obj of result.objects) {
  console.log(`  ${obj.key}`);
}
```

## Bucket Configuration

### R2 Bucket Structure

Codex platform uses a single R2 bucket with creator-based organization:

```
codex-media-production/
├── {creatorId}/
│   ├── videos/
│   │   ├── {mediaId}.mp4
│   │   └── {mediaId}.webm
│   ├── hls/
│   │   └── {mediaId}/
│   │       ├── master.m3u8
│   │       ├── segment-0.ts
│   │       └── segment-1.ts
│   ├── audio/
│   │   └── {mediaId}.m4a
│   ├── thumbnails/
│   │   └── {mediaId}.jpg
│   └── metadata/
│       └── {mediaId}.json
└── public/
    └── shared-resources/
```

### Key Naming Conventions

- **Creator Scoped**: All media organized under creator ID for access control
- **Media Type Subdirs**: videos/, hls/, audio/, thumbnails/ for type separation
- **Media ID Suffix**: Unique identifier ensures no collisions
- **Metadata Separation**: JSON manifests in separate metadata/ directory

### Custom Metadata

R2 supports custom metadata (stored as x-amz-meta-* headers):

```typescript
await r2Service.put(
  'creator-123/videos/video-456.mp4',
  videoBuffer,
  {
    uploadedBy: 'mobile-app',
    uploadTime: new Date().toISOString(),
    processingStatus: 'pending-transcoding',
  },
  { contentType: 'video/mp4' }
);

// Later retrieve and check
const obj = await r2Service.get('creator-123/videos/video-456.mp4');
console.log(obj.customMetadata);
// { uploadedBy: 'mobile-app', uploadTime: '2024-01-15T10:30:00Z', ... }
```

### HTTP Metadata

```typescript
await r2Service.put(key, body, metadata, {
  contentType: 'video/mp4',
  contentDisposition: 'inline',  // or 'attachment' for download
  cacheControl: 'public, max-age=3600',  // 1 hour for HLS segments
  contentEncoding: 'gzip',  // if pre-compressed
});
```

## KV Namespaces

KV support is currently a placeholder in the package. Expected implementation:

- **Rate Limiting Namespace**: Track request counts per user/IP
- **Session Cache**: Cache short-lived session data
- **Distributed Locks**: Prevent concurrent operations
- **Analytics Aggregation**: Buffer metrics before bulk insert

Expected API (when implemented):

```typescript
// Placeholder - not yet implemented
export class KVClient {
  async get(key: string): Promise<string | null>;
  async put(key: string, value: string, ttl?: number): Promise<void>;
  async delete(key: string): Promise<void>;
  async list(prefix?: string): Promise<string[]>;
}
```

## Error Handling

### R2 Service Errors

R2Service wraps errors from the underlying R2 bucket API with automatic retry logic for transient failures.

#### Retryable Errors (Automatically Retried)

| Status Code | Reason | Max Retries | Action |
|------------|--------|------------|--------|
| 429 | Rate limited | 3 (configurable) | Exponential backoff |
| 5xx | Server error | 3 (configurable) | Exponential backoff |
| Timeout | Network timeout | 3 (configurable) | Exponential backoff |

**Backoff Strategy**:
- Base delay: 100ms (configurable)
- Formula: base_delay * (2 ^ attempt) with optional jitter
- Max delay: 2000ms (configurable)
- Jitter: ±50% randomization to prevent thundering herd

**Example**:
```typescript
const service = new R2Service(bucket, {
  maxRetries: 5,       // Try up to 5 times
  baseDelayMs: 50,     // Start with 50ms delay
  maxDelayMs: 5000,    // Cap at 5 seconds
  jitter: true,        // Add randomization
});

// 429 error → wait 50ms → retry → 429 error → wait 100ms → retry → ...
```

#### Non-Retryable Errors

| Condition | Response | Action |
|-----------|----------|--------|
| 404 Not Found | Return null | No retry |
| 403 Forbidden | Throw Error | No retry |
| 400 Bad Request | Throw Error | No retry |
| Invalid key format | Throw Error | No retry |

#### Signing Errors

```typescript
try {
  const url = await r2Service.generateSignedUrl(key, 3600);
} catch (err) {
  if (err instanceof Error && err.message.includes('signing config required')) {
    // R2SigningConfig was not provided in constructor
    // Fix: Initialize R2Service with signingConfig parameter
  } else if (err instanceof Error && err.message.includes('credentials')) {
    // Invalid AWS credentials
    // Fix: Check R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
  } else {
    // Other AWS SDK errors (network, service, etc.)
    throw err;
  }
}
```

### R2SigningClient Errors

R2SigningClient is a lightweight wrapper around AWS SDK. Errors typically come from:

1. **Missing Config**:
```typescript
const client = new R2SigningClient({
  accountId: '1234567890abcdef1234567890abcdef',
  accessKeyId: 'abc123',
  secretAccessKey: 'secret',
  bucketName: 'my-bucket',
});

// Credentials are not validated until first request
```

2. **Invalid Credentials**:
```typescript
try {
  await client.generateSignedUrl('key', 3600);
} catch (err) {
  // SignatureDoesNotMatch: The request signature we calculated does not match
  // Fix: Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY values
}
```

3. **Network Errors**:
```typescript
try {
  await client.generateSignedUrl('key', 3600);
} catch (err) {
  // ENOTFOUND, ECONNREFUSED, ETIMEDOUT
  // Fix: Check network connectivity to r2.cloudflarestorage.com
}
```

### Error Recovery Patterns

#### Retry with Exponential Backoff

```typescript
async function uploadWithRetry(
  r2Service: R2Service,
  key: string,
  body: Buffer,
  maxAttempts: number = 3
): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await r2Service.put(key, body, {}, { contentType: 'application/octet-stream' });
      console.log(`Upload succeeded on attempt ${attempt}`);
      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts) {
        const delay = Math.min(100 * (2 ** (attempt - 1)), 2000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Upload failed after ${maxAttempts} attempts: ${lastError?.message}`);
}
```

#### Handle Not Found Gracefully

```typescript
const obj = await r2Service.get('creator-123/videos/video.mp4');

if (!obj) {
  console.warn('Object not found - returning default');
  return getDefaultVideo();
}

return obj;
```

#### Fail Open for Metadata

```typescript
try {
  const url = await r2Service.generateSignedUrl(key, 3600);
  res.json({ streamingUrl: url });
} catch (err) {
  console.error('Failed to generate signed URL', err);
  // Fallback: Return unsigned redirect (if R2 bucket is public)
  res.redirect(`https://${bucketName}.r2.cloudflarestorage.com/${key}`);
}
```

## Usage Examples

### Complete: Streaming URL Generation

```typescript
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
import { dbHttp } from '@codex/database';
import { content, mediaItems } from '@codex/database/schema';
import { eq } from 'drizzle-orm';

// 1. Initialize R2Service (in handler or setup)
const signingConfig: R2SigningConfig = {
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucketName: env.R2_BUCKET_MEDIA,
};

const r2Service = new R2Service(env.MEDIA_BUCKET, {
  maxRetries: 3,
  baseDelayMs: 100,
}, signingConfig);

// 2. Fetch content and media details
const contentRecord = await dbHttp.query.content.findFirst({
  where: eq(content.id, contentId),
  with: { mediaItem: true },
});

if (!contentRecord?.mediaItem?.r2Key) {
  throw new Error('Media not found');
}

// 3. Generate signed URL
const expirySeconds = 3600; // 1 hour
const presignedUrl = await r2Service.generateSignedUrl(
  contentRecord.mediaItem.r2Key,
  expirySeconds
);

// 4. Return to client
res.json({
  streamingUrl: presignedUrl,
  expiresAt: new Date(Date.now() + expirySeconds * 1000),
  contentType: contentRecord.mediaItem.mediaType,
});
```

### Complete: Video Upload with Progress

```typescript
import { R2Service } from '@codex/cloudflare-clients';

async function uploadVideo(
  r2Service: R2Service,
  creatorId: string,
  mediaId: string,
  videoBuffer: Buffer,
  options: { title: string; contentType: string }
) {
  const r2Key = `${creatorId}/videos/${mediaId}.mp4`;

  console.log(`Starting upload: ${r2Key} (${videoBuffer.length} bytes)`);

  try {
    const result = await r2Service.put(
      r2Key,
      videoBuffer,
      {
        uploadedBy: 'web-app',
        uploadTime: new Date().toISOString(),
        title: options.title,
      },
      {
        contentType: options.contentType,
        cacheControl: 'public, max-age=31536000', // Immutable after upload
      }
    );

    console.log(`Upload complete: ${result.key} (v${result.version})`);

    return {
      key: result.key,
      size: result.size,
      version: result.version,
      uploadedAt: result.uploadedDate,
    };
  } catch (err) {
    console.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
```

### Complete: Testing R2 Operations

```typescript
import { beforeAll, describe, expect, it } from 'vitest';
import { createR2SigningClientFromEnv } from '@codex/cloudflare-clients';

describe('R2 Operations', () => {
  let client: R2SigningClient;

  beforeAll(() => {
    // Loads R2 credentials from .env.test via vitest.setup.ts
    client = createR2SigningClientFromEnv();
  });

  it('should generate valid presigned URLs', async () => {
    const r2Key = 'test/sample-video.mp4';
    const expirySeconds = 3600;

    const signedUrl = await client.generateSignedUrl(r2Key, expirySeconds);

    // Verify URL structure
    expect(signedUrl).toContain('r2.cloudflarestorage.com');
    expect(signedUrl).toContain(encodeURIComponent(r2Key).replace(/%2F/g, '/'));

    // Verify AWS Signature v4 parameters
    const url = new URL(signedUrl);
    expect(url.searchParams.has('X-Amz-Algorithm')).toBe(true);
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(expirySeconds));
    expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
  });

  it('should verify object existence', async () => {
    const exists = await client.objectExists('test/non-existent.mp4');
    expect(exists).toBe(false);
  });

  it('should handle missing environment variables', () => {
    const originalAccountId = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;

    expect(() => createR2SigningClientFromEnv()).toThrow(
      'Missing R2 environment variables'
    );

    process.env.R2_ACCOUNT_ID = originalAccountId;
  });
});
```

### Complete: Integration with ContentAccessService

```typescript
import { R2Service, type R2SigningConfig } from '@codex/cloudflare-clients';
import { ContentAccessService } from '@codex/access';

// Handler in content-api worker
export async function handleGetStreamingUrl(req: Request, env: Env): Promise<Response> {
  const { contentId } = await req.json();

  // Initialize R2Service with signing config
  const signingConfig: R2SigningConfig = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketName: env.R2_BUCKET_MEDIA,
  };

  const r2Service = new R2Service(env.MEDIA_BUCKET, {}, signingConfig);

  // Initialize content access service (handles access control + signed URLs)
  const contentAccessService = new ContentAccessService({
    r2: r2Service,
    db: dbHttp,
    obs: observability,
  });

  try {
    const result = await contentAccessService.getStreamingUrl(userId, {
      contentId,
      expirySeconds: 3600,
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err instanceof AccessDeniedError ? 403 : 500,
    });
  }
}
```

## Performance Notes

### Request Optimization

#### Connection Reuse

```typescript
// GOOD: Reuse service instance across requests
const r2Service = new R2Service(bucket, {}, signingConfig);

export async function handler(req: Request) {
  // Reuses S3Client connection for each request
  const url = await r2Service.generateSignedUrl(key, 3600);
}

// BAD: Creating new instance per request
export async function handler(req: Request) {
  const service = new R2Service(bucket, {}, signingConfig); // New S3Client!
  const url = await service.generateSignedUrl(key, 3600);
}
```

#### Signed URL Caching

```typescript
// Cache presigned URLs to avoid regenerating them
const urlCache = new Map<string, { url: string; expiresAt: Date }>();

async function getStreamingUrl(r2Key: string): Promise<string> {
  const cached = urlCache.get(r2Key);

  // Return cached URL if still valid (with 5-minute buffer)
  if (cached && cached.expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return cached.url;
  }

  // Generate new URL (1 hour validity)
  const expirySeconds = 3600;
  const url = await r2Service.generateSignedUrl(r2Key, expirySeconds);

  urlCache.set(r2Key, {
    url,
    expiresAt: new Date(Date.now() + expirySeconds * 1000),
  });

  return url;
}
```

#### Batch Operations

```typescript
// List and process objects efficiently
async function processAllCreatorVideos(creatorId: string) {
  let cursor: string | undefined;

  do {
    const result = await r2Service.list({
      prefix: `${creatorId}/videos/`,
      limit: 1000,  // Max page size
      cursor,
    });

    for (const obj of result.objects) {
      await processVideo(obj);  // Do work in parallel
    }

    cursor = result.isTruncated ? result.cursor : undefined;
  } while (cursor);
}
```

### Concurrency Limits

```typescript
// R2 supports high concurrency but avoid overwhelming endpoints
const pLimit = require('p-limit');
const limit = pLimit(10);  // Max 10 concurrent operations

const tasks = keys.map(key =>
  limit(() => r2Service.delete(key))
);

await Promise.all(tasks);
```

### Retry Configuration Trade-offs

| Config | Latency | Reliability | Use Case |
|--------|---------|-------------|----------|
| `maxRetries: 1, baseDelayMs: 50` | Fast | Lower | Non-critical requests |
| `maxRetries: 3, baseDelayMs: 100` | Medium | Good | Streaming URLs (default) |
| `maxRetries: 5, baseDelayMs: 50` | Slow | High | File uploads, critical ops |

### Signed URL Expiry Trade-offs

| Expiry | Security | UX | Use Case |
|--------|----------|----|-----------|
| 10 minutes | High | Streaming interruptions | Security-critical |
| 1 hour | Good | Reliable playback | Default for streaming |
| 24 hours | Lower | Shareable links | Public downloads |
| 7 days | Low | Very shareable | Static resources |

## Integration Points

### Dependents

Packages and workers that use @codex/cloudflare-clients:

| Component | Module | Usage | Purpose |
|-----------|--------|-------|---------|
| @codex/access | ContentAccessService | R2Service | Generate presigned streaming URLs |
| content-api worker | Media routes | R2Service | Upload/download media files |
| Test Suite | R2SigningClient | R2SigningClient | Verify presigned URL generation |

### Dependencies

Packages this module depends on:

| Package | Version | Purpose |
|---------|---------|---------|
| @aws-sdk/client-s3 | ^3.931.0 | S3-compatible R2 operations |
| @aws-sdk/s3-request-presigner | ^3.914.0 | Presigned URL generation |
| @cloudflare/workers-types | ^4.20241127.0 | R2Bucket type definitions |

### Data Flow

```
API Request
    ↓
ContentAccessService (access package)
    ↓
R2Service.generateSignedUrl()
    ↓
AWS SDK SignCommand → R2 Endpoint
    ↓
Presigned URL String
    ↓
Return to Client (HLS Player, Browser, etc.)
    ↓
Client uses URL to fetch media from R2
```

### Security Boundary

R2Service acts as security boundary:
- Validates content access before generating URLs (in ContentAccessService)
- Signatures are cryptographically locked to specific keys
- Time-limited URLs prevent indefinite access
- Credentials are kept server-side (never exposed to client)

### Cloudflare Architecture Integration

```
Cloudflare Workers (content-api)
    ↓
R2Service (cloudflare-clients)
    ↓
R2 Bucket Binding (Workers runtime)
    ↓
Cloudflare R2 Storage
    ↓
Client (Browser, Mobile App)
```

## Testing

### Unit Testing R2SigningClient

```typescript
import { R2SigningClient } from '@codex/cloudflare-clients';
import { describe, expect, it, beforeAll } from 'vitest';

describe('R2SigningClient', () => {
  let client: R2SigningClient;

  beforeAll(() => {
    client = new R2SigningClient({
      accountId: process.env.R2_ACCOUNT_ID!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucketName: process.env.R2_BUCKET_MEDIA!,
    });
  });

  it('should generate AWS Signature v4 URLs', async () => {
    const url = await client.generateSignedUrl('test-key', 3600);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(parsed.searchParams.has('X-Amz-Signature')).toBe(true);
  });

  it('should include expiry in URL', async () => {
    const url = await client.generateSignedUrl('test-key', 7200);

    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('7200');
  });
});
```

### Integration Testing

```typescript
import { R2Service, R2SigningClient } from '@codex/cloudflare-clients';

describe('R2 Integration', () => {
  let client: R2SigningClient;

  beforeAll(() => {
    client = createR2SigningClientFromEnv();
  });

  it('should verify uploaded objects exist', async () => {
    const testKey = `integration-test/${Date.now()}.txt`;

    // Upload using external tool (or service if available)
    // ...

    // Verify with client
    const exists = await client.objectExists(testKey);
    expect(exists).toBe(true);
  });

  it('should verify non-existent objects return false', async () => {
    const exists = await client.objectExists('definitely-does-not-exist-12345.txt');
    expect(exists).toBe(false);
  });
});
```

### Mock Testing

```typescript
import { R2Service } from '@codex/cloudflare-clients';
import { vi, describe, expect, it, beforeEach } from 'vitest';

describe('R2Service with mocks', () => {
  it('should handle bucket errors gracefully', async () => {
    const mockBucket = {
      put: vi.fn().mockRejectedValue(new Error('500 Server Error')),
    };

    const service = new R2Service(mockBucket as any, {
      maxRetries: 2,
      baseDelayMs: 10,
    });

    await expect(
      service.put('key', 'data')
    ).rejects.toThrow('500 Server Error');

    // Verify retry attempts
    expect(mockBucket.put).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
```

### Environment Variables for Testing

```bash
# .env.test
R2_ACCOUNT_ID=1234567890abcdef1234567890abcdef
R2_ACCESS_KEY_ID=abc123def456
R2_SECRET_ACCESS_KEY=secret-key-here
R2_BUCKET_MEDIA=codex-media-test

# vitest.setup.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });
```

---

**Documentation Version**: 1.0
**Last Updated**: 2024-11-23
**Status**: Complete - All R2 APIs documented, KV placeholder noted
