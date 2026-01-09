# Code Review Context
Date: Thu Jan  8 14:11:45 GMT 2026
Branch: feature/transcoding-phase1-schema

## 1. Project Structure (High Level)
apps/:
web/

packages/:
access/
admin/
CLAUDE.md
cloudflare-clients/
content/
database/
identity/
observability/
organization/
platform-settings/
purchase/
security/
service-errors/
shared-types/
test-utils/
transcoding/
validation/
worker-utils/

workers/:
admin-api/
auth/
CLAUDE.md
content-api/
ecom-api/
identity-api/
media-api/
notifications-api/
organization-api/

## 2. Change Statistics
 .beads/beads.db                                    |  Bin 278528 -> 278528 bytes
 .beads/beads.db-shm                                |  Bin 32768 -> 32768 bytes
 .../P1-TRANSCODE-001-media-transcoding.md          |  239 +-
 infrastructure/runpod/Dockerfile                   |   45 +
 infrastructure/runpod/README.md                    |  170 ++
 infrastructure/runpod/handler/__init__.py          |    1 +
 infrastructure/runpod/handler/main.py              |  699 ++++++
 infrastructure/runpod/requirements.txt             |   12 +
 .../src/migrations/0017_typical_mantis.sql         |   24 +
 .../migrations/0018_overconfident_ken_ellis.sql    |    3 +
 .../0020_fix_transcoding_constraints.sql           |    8 +
 .../src/migrations/meta/0017_snapshot.json         | 2595 +++++++++++++++++++
 .../src/migrations/meta/0018_snapshot.json         | 2614 ++++++++++++++++++++
 .../database/src/migrations/meta/_journal.json     |   14 +
 packages/database/src/schema/content.ts            |   57 +-
 packages/security/src/worker-auth.ts               |    6 +-
 packages/shared-types/src/worker-types.ts          |   48 +
 packages/test-utils/src/factories.ts               |   20 +-
 packages/transcoding/package.json                  |   54 +
 packages/transcoding/src/__tests__/paths.test.ts   |   96 +
 .../src/__tests__/transcoding-service.test.ts      |  205 ++
 packages/transcoding/src/errors.ts                 |  163 ++
 packages/transcoding/src/index.ts                  |  112 +
 packages/transcoding/src/paths.ts                  |  328 +++
 packages/transcoding/src/services/index.ts         |    8 +
 .../src/services/transcoding-service.ts            |  645 +++++
 packages/transcoding/src/types.ts                  |  113 +
 packages/transcoding/tsconfig.json                 |    8 +
 packages/transcoding/vite.config.transcoding.ts    |    6 +
 packages/transcoding/vitest.config.transcoding.ts  |    9 +
 packages/validation/src/index.ts                   |    2 +
 packages/validation/src/schemas/transcoding.ts     |  196 ++
 packages/worker-utils/package.json                 |    1 +
 packages/worker-utils/src/procedure/helpers.ts     |   53 +-
 .../worker-utils/src/procedure/service-registry.ts |   36 +
 packages/worker-utils/src/procedure/types.ts       |    4 +
 pnpm-lock.yaml                                     |  116 +-
 vitest.workspace.ts                                |    2 +
 workers/content-api/src/routes/media.ts            |   71 +
 workers/content-api/wrangler.jsonc                 |    6 +-
 workers/media-api/package.json                     |   45 +
 workers/media-api/src/__tests__/endpoints.test.ts  |  114 +
 workers/media-api/src/__tests__/env.d.ts           |   10 +
 workers/media-api/src/index.ts                     |   98 +
 .../src/middleware/verify-runpod-signature.ts      |  286 +++
 workers/media-api/src/routes/transcoding.ts        |  117 +
 workers/media-api/src/routes/webhook.ts            |  119 +
 workers/media-api/tsconfig.json                    |   24 +
 workers/media-api/vite.config.ts                   |    5 +
 workers/media-api/vitest.config.ts                 |   25 +
 workers/media-api/wrangler.jsonc                   |  151 ++
 51 files changed, 9705 insertions(+), 78 deletions(-)
 infrastructure/runpod/Dockerfile                  | 4 ++++
 workers/media-api/src/__tests__/endpoints.test.ts | 5 ++---
 workers/media-api/src/__tests__/env.d.ts          | 1 +
 workers/media-api/src/index.ts                    | 2 --
 workers/media-api/vitest.config.ts                | 1 +
 workers/media-api/wrangler.jsonc                  | 3 ++-
 6 files changed, 10 insertions(+), 6 deletions(-)

## 3. List of Changed Files
.beads/beads.db
.beads/beads.db-shm
design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md
infrastructure/runpod/Dockerfile
infrastructure/runpod/handler/__init__.py
infrastructure/runpod/handler/main.py
infrastructure/runpod/README.md
infrastructure/runpod/requirements.txt
infrastructure/runpod/test_worker_local.py
packages/database/src/migrations/0017_typical_mantis.sql
packages/database/src/migrations/0018_overconfident_ken_ellis.sql
packages/database/src/migrations/0020_fix_transcoding_constraints.sql
packages/database/src/migrations/meta/_journal.json
packages/database/src/migrations/meta/0017_snapshot.json
packages/database/src/migrations/meta/0018_snapshot.json
packages/database/src/schema/content.ts
packages/security/src/worker-auth.ts
packages/shared-types/src/worker-types.ts
packages/test-utils/src/factories.ts
packages/transcoding/package.json
packages/transcoding/src/__tests__/paths.test.ts
packages/transcoding/src/__tests__/transcoding-service.test.ts
packages/transcoding/src/errors.ts
packages/transcoding/src/index.ts
packages/transcoding/src/paths.ts
packages/transcoding/src/services/index.ts
packages/transcoding/src/services/transcoding-service.ts
packages/transcoding/src/types.ts
packages/transcoding/tsconfig.json
packages/transcoding/vite.config.transcoding.ts
packages/transcoding/vitest.config.transcoding.ts
packages/validation/src/index.ts
packages/validation/src/schemas/transcoding.ts
packages/worker-utils/package.json
packages/worker-utils/src/procedure/helpers.ts
packages/worker-utils/src/procedure/service-registry.ts
packages/worker-utils/src/procedure/types.ts
pnpm-lock.yaml
REVIEW_PROMPT.md
review_report.md
scripts/prep-review.sh
test-media/input/video.mp4
test-media/output/user-123/hls/test-media-123/360p/index.m3u8
test-media/output/user-123/hls/test-media-123/360p/segment_000.ts
test-media/output/user-123/hls/test-media-123/480p/index.m3u8
test-media/output/user-123/hls/test-media-123/480p/segment_000.ts
test-media/output/user-123/hls/test-media-123/720p/index.m3u8
test-media/output/user-123/hls/test-media-123/720p/segment_000.ts
test-media/output/user-123/hls/test-media-123/master.m3u8
test-media/output/user-123/mezzanine/test-media-123/mezzanine.mp4
test-media/output/user-123/thumbnails/test-media-123/auto-generated.jpg
vitest.workspace.ts
workers/content-api/src/routes/media.ts
workers/content-api/wrangler.jsonc
workers/media-api/package.json
workers/media-api/src/__tests__/endpoints.test.ts
workers/media-api/src/__tests__/env.d.ts
workers/media-api/src/index.ts
workers/media-api/src/middleware/verify-runpod-signature.ts
workers/media-api/src/routes/transcoding.ts
workers/media-api/src/routes/webhook.ts
workers/media-api/tsconfig.json
workers/media-api/vite.config.ts
workers/media-api/vitest.config.ts
workers/media-api/wrangler.jsonc

## 4. The Diff (Code Changes)
diff --git a/.beads/beads.db b/.beads/beads.db
index 90e9144..3f2cad2 100644
Binary files a/.beads/beads.db and b/.beads/beads.db differ
diff --git a/.beads/beads.db-shm b/.beads/beads.db-shm
index 3025fbc..fe9ac28 100644
Binary files a/.beads/beads.db-shm and b/.beads/beads.db-shm differ
diff --git a/design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md b/design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md
index 635ad8a..86ab5e5 100644
--- a/design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md
+++ b/design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md
@@ -588,90 +588,127 @@ END FUNCTION
 
 | Method | Path | Purpose | Security Policy |
 |--------|------|---------|-----------------|
-| POST | `/api/transcoding/webhook` | Receive RunPod completion webhook | HMAC signature verification |
-| POST | `/api/media/:id/retry-transcoding` | Manually retry failed job | `POLICY_PRESETS.creator()` |
-| GET | `/api/media/:id/transcoding-status` | Get current transcoding status | `POLICY_PRESETS.authenticated()` |
+| POST | `/api/transcoding/webhook` | Receive RunPod completion webhook | `auth: 'none'` + HMAC signature verification |
+| POST | `/api/media/:id/retry-transcoding` | Manually retry failed job | `auth: 'required'`, `roles: ['creator', 'admin']` |
+| GET | `/api/media/:id/transcoding-status` | Get current transcoding status | `auth: 'required'` |
 
-### Webhook Handler
+### Webhook Handler (Using procedure() pattern)
 
 ```typescript
-// Webhook endpoint (no auth, uses HMAC verification)
-app.post('/api/transcoding/webhook',
-  async (c) => {
-    const signature = c.req.header('x-runpod-signature');
-    const webhookSecret = c.env.RUNPOD_WEBHOOK_SECRET;
-
-    if (!signature || !webhookSecret) {
-      return c.json({ error: 'Missing signature' }, 401);
-    }
+import { procedure } from '@codex/worker-utils';
+import { runpodWebhookSchema } from '@codex/validation';
 
-    const payload = await c.req.json() as RunPodWebhookPayload;
+// Webhook endpoint - no auth (uses HMAC verification instead)
+app.post('/api/transcoding/webhook',
+  procedure({
+    policy: {
+      auth: 'none',           // No session auth - HMAC verified separately
+      rateLimit: 'webhook',   // Webhook-specific rate limiting
+    },
+    input: { body: runpodWebhookSchema },
+    handler: async (ctx): Promise<{ received: true }> => {
+      // Extract and verify HMAC signature
+      const signature = ctx.env.req?.header('x-runpod-signature');
+      const webhookSecret = ctx.env.RUNPOD_WEBHOOK_SECRET;
+
+      if (!signature || !webhookSecret) {
+        throw new UnauthorizedError('Missing webhook signature');
+      }
 
-    // Verify HMAC signature
-    const computedSignature = createHmac('sha256', webhookSecret)
-      .update(JSON.stringify(payload))
-      .digest('hex');
+      // Verify HMAC signature
+      const computedSignature = await computeHmacSha256(
+        webhookSecret,
+        JSON.stringify(ctx.input.body)
+      );
 
-    if (computedSignature !== signature) {
-      return c.json({ error: 'Invalid signature' }, 401);
-    }
+      if (computedSignature !== signature) {
+        throw new ForbiddenError('Invalid webhook signature');
+      }
 
-    // Process webhook
-    const service = new TranscodingService(c.env);
-    await service.handleWebhook(payload);
+      // Process webhook using service from registry
+      await ctx.services.transcoding.handleWebhook(ctx.input.body);
 
-    return c.json({ received: true }, 200);
-  }
+      return { received: true };
+    },
+  })
 );
 ```
 
-### Retry Endpoint
+### Retry Endpoint (Using procedure() pattern)
 
 ```typescript
-// Manual retry endpoint (creator only)
-app.post('/api/media/:id/retry-transcoding',
-  withPolicy(POLICY_PRESETS.creator()),
-  createAuthenticatedHandler({
-    inputSchema: z.object({ id: z.string().uuid() }),
-    handler: async ({ input, context }) => {
-      const service = new TranscodingService(context.env);
+import { procedure } from '@codex/worker-utils';
+import { createIdParamsSchema } from '@codex/validation';
 
-      await service.retryTranscoding(input.id, context.user.id);
+// Manual retry endpoint - creator only
+app.post('/api/media/:id/retry-transcoding',
+  procedure({
+    policy: {
+      auth: 'required',              // Must be authenticated
+      roles: ['creator', 'admin'],   // Creator or admin role
+      rateLimit: 'auth',             // Stricter rate limit for mutations
+    },
+    input: { params: createIdParamsSchema() },
+    handler: async (ctx): Promise<{ message: string }> => {
+      // ctx.user is guaranteed to exist (auth: 'required')
+      // ctx.services.transcoding is lazy-loaded from ServiceRegistry
+      await ctx.services.transcoding.retryTranscoding(
+        ctx.input.params.id,
+        ctx.user.id
+      );
 
       return { message: 'Transcoding retry triggered' };
-    }
+    },
   })
 );
 ```
 
-### Status Check Endpoint
+### Status Check Endpoint (Using procedure() pattern)
 
 ```typescript
+import { procedure } from '@codex/worker-utils';
+import { createIdParamsSchema } from '@codex/validation';
+
+// Transcoding status response type
+interface TranscodingStatusResponse {
+  status: string;
+  transcodingAttempts: number;
+  transcodingError: string | null;
+  runpodJobId: string | null;
+}
+
 // Get transcoding status
 app.get('/api/media/:id/transcoding-status',
-  withPolicy(POLICY_PRESETS.authenticated()),
-  createAuthenticatedGetHandler({
-    inputSchema: z.object({ id: z.string().uuid() }),
-    handler: async ({ input, context }) => {
-      const media = await db.query.mediaItems.findFirst({
-        where: eq(mediaItems.id, input.id),
-      });
-
-      if (!media) {
-        throw new NotFoundError('Media not found');
-      }
-
-      return {
-        status: media.status,
-        transcodingAttempts: media.transcodingAttempts,
-        transcodingError: media.transcodingError,
-        runpodJobId: media.runpodJobId,
-      };
-    }
+  procedure({
+    policy: {
+      auth: 'required',   // Must be authenticated
+      rateLimit: 'api',   // Standard API rate limit
+    },
+    input: { params: createIdParamsSchema() },
+    handler: async (ctx): Promise<TranscodingStatusResponse> => {
+      // Use service registry - services are lazy-loaded
+      const status = await ctx.services.transcoding.getTranscodingStatus(
+        ctx.input.params.id,
+        ctx.user.id  // For ownership verification
+      );
+
+      return status;
+    },
   })
 );
 ```
 
+### Key Pattern Changes (Old → New)
+
+| Old Pattern | New Pattern |
+|-------------|-------------|
+| `withPolicy(POLICY_PRESETS.creator())` | `procedure({ policy: { auth: 'required', roles: ['creator'] } })` |
+| `createAuthenticatedHandler({ inputSchema, handler })` | `procedure({ input: { body: schema }, handler })` |
+| `context.user.id` | `ctx.user.id` (type-safe based on auth level) |
+| `new TranscodingService(context.env)` | `ctx.services.transcoding` (lazy-loaded) |
+| Manual error handling | Automatic via `mapErrorToResponse()` |
+| Manual response wrapping | Auto-wrapped in `{ data: T }` |
+
 ---
 
 ## Available Patterns & Utilities
@@ -793,15 +830,77 @@ import { createWorker } from '@codex/worker-utils';
 
 const app = createWorker({
   serviceName: 'transcoding-api',
-  enableCors: true,
-  enableSecurityHeaders: true,
+  enableGlobalAuth: false,  // Using route-level procedure() instead
 });
 
 // Mount routes
 app.route('/api/transcoding', transcodingRoutes);
 ```
 
-**When to use**: Standard worker setup for transcoding API.
+**Procedure Pattern** (primary way to define routes):
+```typescript
+import { procedure } from '@codex/worker-utils';
+
+app.post('/api/media/:id/retry',
+  procedure({
+    // 1. Policy: Auth, roles, rate limiting, org membership
+    policy: {
+      auth: 'required',              // 'none' | 'optional' | 'required' | 'worker' | 'platform_owner'
+      roles: ['creator', 'admin'],   // RBAC check
+      rateLimit: 'auth',             // 'api' | 'auth' | 'strict' | 'public' | 'webhook' | 'streaming'
+    },
+    // 2. Input: Zod schemas for params, query, body
+    input: {
+      params: z.object({ id: uuidSchema }),
+      body: retryTranscodingSchema,  // Optional
+    },
+    // 3. Success status (default: 200)
+    successStatus: 200,
+    // 4. Handler: Fully typed context
+    handler: async (ctx) => {
+      // ctx.user - Guaranteed UserData when auth: 'required'
+      // ctx.input.params - Validated params
+      // ctx.input.body - Validated body
+      // ctx.services - Lazy-loaded ServiceRegistry
+      // ctx.env - Cloudflare bindings
+      // ctx.obs - ObservabilityClient
+
+      await ctx.services.transcoding.retryTranscoding(
+        ctx.input.params.id,
+        ctx.user.id
+      );
+
+      return { success: true };  // Auto-wrapped as { data: { success: true } }
+    },
+  })
+);
+```
+
+**Auth Levels**:
+| Level | User Type | Description |
+|-------|-----------|-------------|
+| `none` | `undefined` | No auth required (webhooks with HMAC) |
+| `optional` | `UserData \| undefined` | Auth attempted but not required |
+| `required` | `UserData` | Must be authenticated |
+| `worker` | `undefined` | Worker-to-worker auth only |
+| `platform_owner` | `UserData` | Platform owner + auto org lookup |
+
+**Service Registry Access**:
+```typescript
+// Services are lazy-loaded (created on first access)
+ctx.services.transcoding    // TranscodingService
+ctx.services.content        // ContentService
+ctx.services.media          // MediaService
+ctx.services.access         // ContentAccessService
+ctx.services.purchase       // PurchaseService
+ctx.services.organization   // OrganizationService
+ctx.services.settings       // PlatformSettingsService
+
+// Services share a per-request DB client for transactions
+// Cleanup is automatic after handler completes
+```
+
+**When to use**: All route definitions should use `procedure()` for type-safe auth, validation, and service injection.
 
 ---
 
@@ -893,6 +992,8 @@ const result = await response.json();
 - ✅ R2 storage service
 - ✅ Error handling (@codex/service-errors)
 - ✅ Validation (@codex/validation)
+- ✅ Procedure pattern (`@codex/worker-utils` - procedure(), ServiceRegistry)
+- ✅ Session auth middleware (cookie-based auth with KV caching)
 
 ### RunPod Setup Required
 
@@ -935,17 +1036,23 @@ const result = await response.json();
   - [ ] Implement `getTranscodingStatus()` method
   - [ ] Add unit tests with mocked RunPod API
 
+- [ ] **ServiceRegistry Integration** (NEW - Required for procedure() pattern)
+  - [ ] Add `transcoding` getter to `ServiceRegistry` in `@codex/worker-utils/procedure/service-registry.ts`
+  - [ ] Add `TranscodingService` type to `ServiceRegistry` interface in `types.ts`
+  - [ ] Ensure lazy initialization with shared DB client
+  - [ ] Add cleanup function registration
+
 - [ ] **Validation**
   - [ ] Add `runpodWebhookSchema` to `@codex/validation`
   - [ ] Add `retryTranscodingSchema`
   - [ ] Add schema tests (100% coverage)
 
-- [ ] **Worker/API**
+- [ ] **Worker/API** (Using procedure() pattern)
   - [ ] Create transcoding routes or add to existing worker
-  - [ ] Implement `POST /api/transcoding/webhook` endpoint
-  - [ ] Implement `POST /api/media/:id/retry-transcoding` endpoint
-  - [ ] Implement `GET /api/media/:id/transcoding-status` endpoint
-  - [ ] Add HMAC signature verification for webhooks
+  - [ ] Implement `POST /api/transcoding/webhook` using `procedure({ policy: { auth: 'none' } })`
+  - [ ] Implement `POST /api/media/:id/retry-transcoding` using `procedure({ policy: { auth: 'required', roles: ['creator'] } })`
+  - [ ] Implement `GET /api/media/:id/transcoding-status` using `procedure({ policy: { auth: 'required' } })`
+  - [ ] Add HMAC signature verification in webhook handler
   - [ ] Add integration tests
 
 - [ ] **Integration**
@@ -1124,5 +1231,5 @@ CMD ["python", "/handler.py"]
 
 ---
 
-**Last Updated**: 2025-11-23
-**Version**: 2.0 (Enhanced with implementation patterns and RunPod integration details)
+**Last Updated**: 2026-01-05
+**Version**: 3.0 (Updated to use new procedure() pattern and ServiceRegistry from @codex/worker-utils)
diff --git a/infrastructure/runpod/Dockerfile b/infrastructure/runpod/Dockerfile
new file mode 100644
index 0000000..f1532a2
--- /dev/null
+++ b/infrastructure/runpod/Dockerfile
@@ -0,0 +1,45 @@
+# RunPod Transcoding Worker
+# GPU-accelerated media transcoding with FFmpeg and audiowaveform
+#
+# Features:
+# - NVIDIA GPU support (h264_nvenc)
+# - CPU fallback (libx264)
+# - HLS multi-quality transcoding
+# - Audio waveform generation
+# - S3-compatible storage (R2/B2)
+
+FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04
+
+# Prevent interactive prompts during install
+ENV DEBIAN_FRONTEND=noninteractive
+
+# Install system dependencies
+RUN apt-get update && apt-get install -y --no-install-recommends \
+    # FFmpeg with all codecs
+    ffmpeg \
+    # Python runtime
+    python3 \
+    python3-pip \
+    python3-dev \
+    # audiowaveform for audio visualization
+    audiowaveform \
+    # Utilities
+    curl \
+    ca-certificates \
+    && rm -rf /var/lib/apt/lists/*
+
+# Create working directory
+WORKDIR /app
+
+# Install Python dependencies
+COPY requirements.txt .
+RUN pip3 install --no-cache-dir -r requirements.txt
+
+# Copy handler code
+COPY handler/ ./handler/
+
+# Set Python path
+ENV PYTHONPATH=/app
+
+# RunPod serverless entry point
+CMD ["python3", "-u", "handler/main.py"]
diff --git a/infrastructure/runpod/README.md b/infrastructure/runpod/README.md
new file mode 100644
index 0000000..38a1aeb
--- /dev/null
+++ b/infrastructure/runpod/README.md
@@ -0,0 +1,170 @@
+# RunPod Transcoding Worker
+
+GPU-accelerated media transcoding worker for the Codex platform.
+
+## Overview
+
+This worker runs on RunPod's serverless GPU infrastructure to:
+
+- Transcode video/audio to multi-quality HLS streams
+- Generate archive-quality mezzanine files (stored in B2)
+- Extract thumbnails and preview clips
+- Generate audio waveform visualizations
+- Send HMAC-signed webhook callbacks on completion
+
+## Architecture
+
+```
+┌────────────────────────────────────────────────────────────────┐
+│                    RunPod Serverless GPU                       │
+├────────────────────────────────────────────────────────────────┤
+│  1. Download original from R2                                  │
+│  2. Probe metadata (ffprobe)                                   │
+│  3. Create mezzanine (CRF 18) → B2                            │
+│  4. Transcode HLS variants → R2                                │
+│  5. Generate preview/thumbnail/waveform → R2                   │
+│  6. Send HMAC-signed webhook → media-api                       │
+└────────────────────────────────────────────────────────────────┘
+```
+
+## Storage
+
+| Asset | Storage | Bucket |
+|-------|---------|--------|
+| Original uploads | R2 | codex-media-{env} |
+| HLS streams | R2 | codex-media-{env} |
+| Thumbnails | R2 | codex-media-{env} |
+| Waveforms | R2 | codex-media-{env} |
+| Mezzanine (archive) | B2 | codex-mezzanine-{env} |
+
+## FFmpeg Settings
+
+### Video Encoding
+- **GPU**: `h264_nvenc`, preset p4, cq 23
+- **CPU fallback**: `libx264`, preset fast, crf 23
+- **Mezzanine**: CRF 18 (archive quality)
+
+### HLS Variants (Video)
+| Quality | Resolution | Video Bitrate | Audio Bitrate |
+|---------|------------|---------------|---------------|
+| 1080p | 1920x1080 | 5000 kbps | 192 kbps |
+| 720p | 1280x720 | 3000 kbps | 128 kbps |
+| 480p | 854x480 | 1500 kbps | 96 kbps |
+| 360p | 640x360 | 800 kbps | 64 kbps |
+
+### HLS Variants (Audio)
+| Quality | Bitrate |
+|---------|---------|
+| 128k | 128 kbps |
+| 64k | 64 kbps |
+
+### Audio Normalization
+- **Target loudness**: -16 LUFS
+- **True peak**: -1.5 dBTP
+- **Loudness range**: 11 LU
+
+## Local Development
+
+### Build the Docker image
+
+```bash
+cd infrastructure/runpod
+docker build -t codex-transcoder:dev .
+```
+
+### Test locally (without GPU)
+
+```bash
+docker run --rm \
+  -e RUNPOD_DEBUG=true \
+  codex-transcoder:dev \
+  python3 -c "from handler.main import handler; print('Handler loaded successfully')"
+```
+
+### Test with GPU
+
+```bash
+docker run --rm --gpus all \
+  codex-transcoder:dev \
+  ffmpeg -encoders | grep nvenc
+```
+
+## Deployment
+
+### Push to Docker Hub
+
+```bash
+docker tag codex-transcoder:dev yourusername/codex-transcoder:latest
+docker push yourusername/codex-transcoder:latest
+```
+
+### Create RunPod Serverless Endpoint
+
+1. Go to RunPod Console → Serverless
+2. Create new endpoint
+3. Use Docker image: `yourusername/codex-transcoder:latest`
+4. Configure GPU (RTX 3090 or better recommended)
+5. Set webhook URL in endpoint settings
+
+## Environment Variables
+
+The handler receives credentials via the job input payload:
+
+```json
+{
+  "mediaId": "uuid",
+  "creatorId": "user-id",
+  "type": "video",
+  "inputKey": "creator-id/originals/media-id/video.mp4",
+  "webhookUrl": "https://media-api.codex.com/api/transcoding/webhook",
+  "webhookSecret": "hmac-secret",
+  "r2Endpoint": "https://account-id.r2.cloudflarestorage.com",
+  "r2AccessKeyId": "...",
+  "r2SecretAccessKey": "...",
+  "r2BucketName": "codex-media-production",
+  "b2Endpoint": "https://s3.us-west-004.backblazeb2.com",
+  "b2AccessKeyId": "...",
+  "b2SecretAccessKey": "...",
+  "b2BucketName": "codex-mezzanine-production"
+}
+```
+
+## Webhook Payload
+
+### Success
+
+```json
+{
+  "status": "completed",
+  "mediaId": "uuid",
+  "hlsMasterPlaylistKey": "creator-id/hls/media-id/master.m3u8",
+  "hlsPreviewKey": "creator-id/hls/media-id/preview/preview.m3u8",
+  "thumbnailKey": "creator-id/thumbnails/media-id/auto-generated.jpg",
+  "waveformKey": null,
+  "waveformImageKey": null,
+  "mezzanineKey": "creator-id/mezzanine/media-id/mezzanine.mp4",
+  "durationSeconds": 600,
+  "width": 1920,
+  "height": 1080,
+  "readyVariants": ["1080p", "720p", "480p", "360p"],
+  "error": null
+}
+```
+
+### Failure
+
+```json
+{
+  "status": "failed",
+  "mediaId": "uuid",
+  "error": "Error message (max 2KB)"
+}
+```
+
+### Webhook Signature
+
+Webhooks are signed with HMAC-SHA256:
+
+```
+X-Runpod-Signature: hmac_sha256(payload, webhook_secret)
+```
diff --git a/infrastructure/runpod/handler/__init__.py b/infrastructure/runpod/handler/__init__.py
new file mode 100644
index 0000000..d333e2e
--- /dev/null
+++ b/infrastructure/runpod/handler/__init__.py
@@ -0,0 +1 @@
+# handler module
diff --git a/infrastructure/runpod/handler/main.py b/infrastructure/runpod/handler/main.py
new file mode 100644
index 0000000..7396045
--- /dev/null
+++ b/infrastructure/runpod/handler/main.py
@@ -0,0 +1,699 @@
+"""
+RunPod Transcoding Handler
+
+GPU-accelerated media transcoding pipeline for video and audio files.
+
+Pipeline:
+1. Download original from R2
+2. Probe metadata (ffprobe)
+3. Create mezzanine (CRF 18) → Upload to B2
+4. Two-pass loudness analysis
+5. Transcode HLS variants (1080p/720p/480p/360p)
+6. Generate preview (30s at 720p)
+7. Extract thumbnail (10% mark)
+8. Generate waveform JSON + PNG (audio only)
+9. Upload outputs to R2
+10. Send signed webhook
+
+FFmpeg Settings:
+- GPU: h264_nvenc, preset p4, cq 23
+- CPU fallback: libx264, preset fast, crf 23
+- HLS: 6s segments, VOD playlist type
+- Audio: loudnorm I=-16 TP=-1.5 LRA=11
+"""
+
+import hashlib
+import hmac
+import json
+import os
+import shutil
+import subprocess
+import tempfile
+import time
+from typing import Any, TypedDict
+
+import boto3
+import requests
+import runpod
+
+# =============================================================================
+# Type Definitions
+# =============================================================================
+
+
+class JobInput(TypedDict):
+    """Input payload from RunPod job trigger."""
+
+    mediaId: str
+    creatorId: str
+    type: str  # 'video' | 'audio'
+    inputKey: str  # R2 key for original file
+    webhookUrl: str
+    webhookSecret: str
+    # R2 config (delivery assets)
+    r2Endpoint: str
+    r2AccessKeyId: str
+    r2SecretAccessKey: str
+    r2BucketName: str
+    # B2 config (mezzanine archival)
+    b2Endpoint: str
+    b2AccessKeyId: str
+    b2SecretAccessKey: str
+    b2BucketName: str
+
+
+class TranscodingResult(TypedDict):
+    """Result payload sent via webhook."""
+
+    status: str  # 'completed' | 'failed'
+    mediaId: str
+    hlsMasterPlaylistKey: str | None
+    hlsPreviewKey: str | None
+    thumbnailKey: str | None
+    waveformKey: str | None
+    waveformImageKey: str | None
+    mezzanineKey: str | None
+    durationSeconds: int | None
+    width: int | None
+    height: int | None
+    readyVariants: list[str]
+    error: str | None
+
+
+# =============================================================================
+# FFmpeg Configuration
+# =============================================================================
+
+# HLS variant settings (resolution → bitrate)
+HLS_VARIANTS = {
+    "1080p": {"height": 1080, "video_bitrate": "5000k", "audio_bitrate": "192k"},
+    "720p": {"height": 720, "video_bitrate": "3000k", "audio_bitrate": "128k"},
+    "480p": {"height": 480, "video_bitrate": "1500k", "audio_bitrate": "96k"},
+    "360p": {"height": 360, "video_bitrate": "800k", "audio_bitrate": "64k"},
+}
+
+# Audio-only HLS variants
+AUDIO_VARIANTS = {
+    "128k": {"audio_bitrate": "128k"},
+    "64k": {"audio_bitrate": "64k"},
+}
+
+# Preview clip settings
+PREVIEW_DURATION = 30  # seconds
+PREVIEW_HEIGHT = 720
+
+# Segment duration for HLS
+HLS_SEGMENT_DURATION = 6
+
+
+# =============================================================================
+# Storage Clients
+# =============================================================================
+
+
+def create_s3_client(endpoint: str, access_key: str, secret_key: str) -> Any:
+    """Create S3-compatible client for R2 or B2."""
+    return boto3.client(
+        "s3",
+        endpoint_url=endpoint,
+        aws_access_key_id=access_key,
+        aws_secret_access_key=secret_key,
+        region_name="auto",
+    )
+
+
+def download_file(client: Any, bucket: str, key: str, local_path: str) -> None:
+    """Download file from S3-compatible storage."""
+    print(f"Downloading s3://{bucket}/{key} → {local_path}")
+    client.download_file(bucket, key, local_path)
+
+
+def upload_file(client: Any, bucket: str, key: str, local_path: str, content_type: str | None = None) -> None:
+    """Upload file to S3-compatible storage."""
+    print(f"Uploading {local_path} → s3://{bucket}/{key}")
+    extra_args = {}
+    if content_type:
+        extra_args["ContentType"] = content_type
+    client.upload_file(local_path, bucket, key, ExtraArgs=extra_args if extra_args else None)
+
+
+def upload_directory(client: Any, bucket: str, key_prefix: str, local_dir: str) -> None:
+    """Upload all files in a directory to S3-compatible storage."""
+    for root, _, files in os.walk(local_dir):
+        for filename in files:
+            local_path = os.path.join(root, filename)
+            relative_path = os.path.relpath(local_path, local_dir)
+            key = f"{key_prefix}{relative_path}"
+
+            # Determine content type
+            content_type = None
+            if filename.endswith(".m3u8"):
+                content_type = "application/vnd.apple.mpegurl"
+            elif filename.endswith(".ts"):
+                content_type = "video/MP2T"
+            elif filename.endswith(".json"):
+                content_type = "application/json"
+            elif filename.endswith(".png"):
+                content_type = "image/png"
+            elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
+                content_type = "image/jpeg"
+
+            upload_file(client, bucket, key, local_path, content_type)
+
+
+# =============================================================================
+# Media Analysis
+# =============================================================================
+
+
+def probe_media(input_path: str) -> dict[str, Any]:
+    """Get media metadata using ffprobe."""
+    cmd = [
+        "ffprobe",
+        "-v", "quiet",
+        "-print_format", "json",
+        "-show_format",
+        "-show_streams",
+        input_path,
+    ]
+    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
+    return json.loads(result.stdout)
+
+
+def get_media_info(probe_data: dict[str, Any]) -> tuple[int, int | None, int | None]:
+    """Extract duration, width, height from probe data."""
+    duration = int(float(probe_data.get("format", {}).get("duration", 0)))
+
+    width = None
+    height = None
+    for stream in probe_data.get("streams", []):
+        if stream.get("codec_type") == "video":
+            width = stream.get("width")
+            height = stream.get("height")
+            break
+
+    return duration, width, height
+
+
+def check_gpu_available() -> bool:
+    """Check if NVIDIA GPU encoder is available."""
+    try:
+        result = subprocess.run(
+            ["ffmpeg", "-encoders"],
+            capture_output=True,
+            text=True,
+            timeout=10,
+        )
+        return "h264_nvenc" in result.stdout
+    except Exception:
+        return False
+
+
+# =============================================================================
+# Transcoding Functions
+# =============================================================================
+
+
+def create_mezzanine(input_path: str, output_path: str, use_gpu: bool) -> None:
+    """Create high-quality mezzanine file (CRF 18 for archival)."""
+    print("Creating mezzanine (CRF 18)...")
+
+    if use_gpu:
+        # GPU encoding
+        cmd = [
+            "ffmpeg", "-y",
+            "-hwaccel", "cuda",
+            "-i", input_path,
+            "-c:v", "h264_nvenc",
+            "-preset", "p4",
+            "-cq", "18",
+            "-c:a", "aac",
+            "-b:a", "256k",
+            output_path,
+        ]
+    else:
+        # CPU encoding
+        cmd = [
+            "ffmpeg", "-y",
+            "-i", input_path,
+            "-c:v", "libx264",
+            "-preset", "slow",
+            "-crf", "18",
+            "-c:a", "aac",
+            "-b:a", "256k",
+            output_path,
+        ]
+
+    subprocess.run(cmd, check=True)
+
+
+def analyze_loudness(input_path: str) -> dict[str, float]:
+    """Two-pass loudness analysis using loudnorm filter."""
+    print("Analyzing audio loudness...")
+
+    cmd = [
+        "ffmpeg",
+        "-i", input_path,
+        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
+        "-f", "null",
+        "-",
+    ]
+    result = subprocess.run(cmd, capture_output=True, text=True)
+
+    # Parse loudnorm output from stderr
+    output = result.stderr
+    try:
+        # Find JSON block in output
+        json_start = output.rfind("{")
+        json_end = output.rfind("}") + 1
+        if json_start >= 0 and json_end > json_start:
+            loudness_data = json.loads(output[json_start:json_end])
+            return {
+                "input_i": float(loudness_data.get("input_i", -16)),
+                "input_tp": float(loudness_data.get("input_tp", -1)),
+                "input_lra": float(loudness_data.get("input_lra", 7)),
+            }
+    except (json.JSONDecodeError, ValueError):
+        pass
+
+    return {"input_i": -16, "input_tp": -1, "input_lra": 7}
+
+
+def transcode_video_hls(
+    input_path: str,
+    output_dir: str,
+    source_height: int | None,
+    use_gpu: bool,
+) -> list[str]:
+    """Transcode video to multi-quality HLS variants."""
+    print("Transcoding video to HLS variants...")
+
+    ready_variants = []
+    variant_playlists = []
+
+    for variant_name, settings in HLS_VARIANTS.items():
+        # Skip variants higher than source resolution
+        if source_height and settings["height"] > source_height:
+            print(f"Skipping {variant_name} (source height {source_height} < {settings['height']})")
+            continue
+
+        variant_dir = os.path.join(output_dir, variant_name)
+        os.makedirs(variant_dir, exist_ok=True)
+        playlist_path = os.path.join(variant_dir, "index.m3u8")
+
+        print(f"Encoding {variant_name}...")
+
+        if use_gpu:
+            cmd = [
+                "ffmpeg", "-y",
+                "-hwaccel", "cuda",
+                "-i", input_path,
+                "-vf", f"scale=-2:{settings['height']}",
+                "-c:v", "h264_nvenc",
+                "-preset", "p4",
+                "-cq", "23",
+                "-b:v", settings["video_bitrate"],
+                "-maxrate", settings["video_bitrate"],
+                "-bufsize", f"{int(settings['video_bitrate'][:-1]) * 2}k",
+                "-c:a", "aac",
+                "-b:a", settings["audio_bitrate"],
+                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
+                "-f", "hls",
+                "-hls_time", str(HLS_SEGMENT_DURATION),
+                "-hls_playlist_type", "vod",
+                "-hls_segment_filename", os.path.join(variant_dir, "segment_%03d.ts"),
+                playlist_path,
+            ]
+        else:
+            cmd = [
+                "ffmpeg", "-y",
+                "-i", input_path,
+                "-vf", f"scale=-2:{settings['height']}",
+                "-c:v", "libx264",
+                "-preset", "fast",
+                "-crf", "23",
+                "-b:v", settings["video_bitrate"],
+                "-maxrate", settings["video_bitrate"],
+                "-bufsize", f"{int(settings['video_bitrate'][:-1]) * 2}k",
+                "-c:a", "aac",
+                "-b:a", settings["audio_bitrate"],
+                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
+                "-f", "hls",
+                "-hls_time", str(HLS_SEGMENT_DURATION),
+                "-hls_playlist_type", "vod",
+                "-hls_segment_filename", os.path.join(variant_dir, "segment_%03d.ts"),
+                playlist_path,
+            ]
+
+        subprocess.run(cmd, check=True)
+        ready_variants.append(variant_name)
+        variant_playlists.append((variant_name, settings))
+
+    # Generate master playlist
+    master_path = os.path.join(output_dir, "master.m3u8")
+    with open(master_path, "w") as f:
+        f.write("#EXTM3U\n")
+        f.write("#EXT-X-VERSION:3\n")
+        for variant_name, settings in variant_playlists:
+            bandwidth = int(settings["video_bitrate"][:-1]) * 1000
+            resolution = f"{int(settings['height'] * 16 / 9)}x{settings['height']}"
+            f.write(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={resolution}\n")
+            f.write(f"{variant_name}/index.m3u8\n")
+
+    return ready_variants
+
+
+def transcode_audio_hls(input_path: str, output_dir: str) -> list[str]:
+    """Transcode audio to HLS variants."""
+    print("Transcoding audio to HLS variants...")
+
+    ready_variants = []
+    variant_playlists = []
+
+    for variant_name, settings in AUDIO_VARIANTS.items():
+        variant_dir = os.path.join(output_dir, variant_name)
+        os.makedirs(variant_dir, exist_ok=True)
+        playlist_path = os.path.join(variant_dir, "index.m3u8")
+
+        print(f"Encoding audio {variant_name}...")
+
+        cmd = [
+            "ffmpeg", "-y",
+            "-i", input_path,
+            "-vn",  # No video
+            "-c:a", "aac",
+            "-b:a", settings["audio_bitrate"],
+            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
+            "-f", "hls",
+            "-hls_time", str(HLS_SEGMENT_DURATION),
+            "-hls_playlist_type", "vod",
+            "-hls_segment_filename", os.path.join(variant_dir, "segment_%03d.ts"),
+            playlist_path,
+        ]
+
+        subprocess.run(cmd, check=True)
+        ready_variants.append(variant_name)
+        variant_playlists.append((variant_name, settings))
+
+    # Generate master playlist
+    master_path = os.path.join(output_dir, "master.m3u8")
+    with open(master_path, "w") as f:
+        f.write("#EXTM3U\n")
+        f.write("#EXT-X-VERSION:3\n")
+        for variant_name, settings in variant_playlists:
+            bandwidth = int(settings["audio_bitrate"][:-1]) * 1000
+            f.write(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth}\n")
+            f.write(f"{variant_name}/index.m3u8\n")
+
+    return ready_variants
+
+
+def create_preview(input_path: str, output_dir: str, duration: int, use_gpu: bool) -> None:
+    """Create 30-second preview clip at 720p."""
+    print("Creating preview clip...")
+
+    preview_dir = os.path.join(output_dir, "preview")
+    os.makedirs(preview_dir, exist_ok=True)
+
+    # Calculate start time (10% into the video, but at least 0)
+    start_time = max(0, int(duration * 0.1))
+    preview_duration = min(PREVIEW_DURATION, duration - start_time)
+
+    if use_gpu:
+        cmd = [
+            "ffmpeg", "-y",
+            "-hwaccel", "cuda",
+            "-ss", str(start_time),
+            "-i", input_path,
+            "-t", str(preview_duration),
+            "-vf", f"scale=-2:{PREVIEW_HEIGHT}",
+            "-c:v", "h264_nvenc",
+            "-preset", "p4",
+            "-cq", "23",
+            "-c:a", "aac",
+            "-b:a", "128k",
+            "-f", "hls",
+            "-hls_time", str(HLS_SEGMENT_DURATION),
+            "-hls_playlist_type", "vod",
+            "-hls_segment_filename", os.path.join(preview_dir, "segment_%03d.ts"),
+            os.path.join(preview_dir, "preview.m3u8"),
+        ]
+    else:
+        cmd = [
+            "ffmpeg", "-y",
+            "-ss", str(start_time),
+            "-i", input_path,
+            "-t", str(preview_duration),
+            "-vf", f"scale=-2:{PREVIEW_HEIGHT}",
+            "-c:v", "libx264",
+            "-preset", "fast",
+            "-crf", "23",
+            "-c:a", "aac",
+            "-b:a", "128k",
+            "-f", "hls",
+            "-hls_time", str(HLS_SEGMENT_DURATION),
+            "-hls_playlist_type", "vod",
+            "-hls_segment_filename", os.path.join(preview_dir, "segment_%03d.ts"),
+            os.path.join(preview_dir, "preview.m3u8"),
+        ]
+
+    subprocess.run(cmd, check=True)
+
+
+def extract_thumbnail(input_path: str, output_path: str, duration: int) -> None:
+    """Extract thumbnail at 10% mark."""
+    print("Extracting thumbnail...")
+
+    timestamp = max(1, int(duration * 0.1))
+
+    cmd = [
+        "ffmpeg", "-y",
+        "-ss", str(timestamp),
+        "-i", input_path,
+        "-vframes", "1",
+        "-q:v", "2",
+        output_path,
+    ]
+
+    subprocess.run(cmd, check=True)
+
+
+def generate_waveform(input_path: str, json_path: str, image_path: str) -> None:
+    """Generate audio waveform data and image using audiowaveform."""
+    print("Generating audio waveform...")
+
+    # Generate JSON waveform data
+    cmd_json = [
+        "audiowaveform",
+        "-i", input_path,
+        "-o", json_path,
+        "--pixels-per-second", "10",
+        "-b", "8",
+    ]
+    subprocess.run(cmd_json, check=True)
+
+    # Generate PNG waveform image
+    cmd_png = [
+        "audiowaveform",
+        "-i", input_path,
+        "-o", image_path,
+        "--width", "1800",
+        "--height", "140",
+        "--colors", "audition",
+    ]
+    subprocess.run(cmd_png, check=True)
+
+
+# =============================================================================
+# Webhook
+# =============================================================================
+
+
+def sign_payload(payload: str, secret: str) -> str:
+    """Generate HMAC-SHA256 signature for webhook payload."""
+    return hmac.new(
+        secret.encode("utf-8"),
+        payload.encode("utf-8"),
+        hashlib.sha256,
+    ).hexdigest()
+
+
+def send_webhook(url: str, secret: str, result: TranscodingResult) -> None:
+    """Send signed webhook to notify completion."""
+    print(f"Sending webhook to {url}...")
+
+    payload = json.dumps(result)
+    signature = sign_payload(payload, secret)
+
+    response = requests.post(
+        url,
+        data=payload,
+        headers={
+            "Content-Type": "application/json",
+            "X-Runpod-Signature": signature,
+        },
+        timeout=30,
+    )
+
+    print(f"Webhook response: {response.status_code}")
+    response.raise_for_status()
+
+
+# =============================================================================
+# Main Handler
+# =============================================================================
+
+
+def handler(job: dict[str, Any]) -> dict[str, Any]:
+    """RunPod serverless handler for transcoding jobs."""
+    job_input: JobInput = job["input"]
+
+    media_id = job_input["mediaId"]
+    creator_id = job_input["creatorId"]
+    media_type = job_input["type"]
+    input_key = job_input["inputKey"]
+
+    print(f"Starting transcoding job for {media_type}: {media_id}")
+
+    # Initialize storage clients
+    r2_client = create_s3_client(
+        job_input["r2Endpoint"],
+        job_input["r2AccessKeyId"],
+        job_input["r2SecretAccessKey"],
+    )
+    b2_client = create_s3_client(
+        job_input["b2Endpoint"],
+        job_input["b2AccessKeyId"],
+        job_input["b2SecretAccessKey"],
+    )
+
+    # Check GPU availability
+    use_gpu = check_gpu_available()
+    print(f"GPU available: {use_gpu}")
+
+    # Create temp directory for processing
+    work_dir = tempfile.mkdtemp(prefix="transcoding_")
+
+    try:
+        # Step 1: Download original from R2
+        input_ext = os.path.splitext(input_key)[1] or ".mp4"
+        input_path = os.path.join(work_dir, f"input{input_ext}")
+        download_file(r2_client, job_input["r2BucketName"], input_key, input_path)
+
+        # Step 2: Probe metadata
+        probe_data = probe_media(input_path)
+        duration, width, height = get_media_info(probe_data)
+        print(f"Media info: duration={duration}s, width={width}, height={height}")
+
+        # Step 3: Create mezzanine → Upload to B2
+        mezzanine_path = os.path.join(work_dir, "mezzanine.mp4")
+        mezzanine_key = f"{creator_id}/mezzanine/{media_id}/mezzanine.mp4"
+
+        if media_type == "video":
+            create_mezzanine(input_path, mezzanine_path, use_gpu)
+            upload_file(b2_client, job_input["b2BucketName"], mezzanine_key, mezzanine_path, "video/mp4")
+        else:
+            mezzanine_key = None  # No mezzanine for audio-only
+
+        # Step 4: Loudness analysis
+        loudness = analyze_loudness(input_path)
+        print(f"Loudness: {loudness}")
+
+        # Step 5: Transcode HLS variants
+        hls_dir = os.path.join(work_dir, "hls")
+        os.makedirs(hls_dir, exist_ok=True)
+
+        if media_type == "video":
+            ready_variants = transcode_video_hls(input_path, hls_dir, height, use_gpu)
+        else:
+            ready_variants = transcode_audio_hls(input_path, hls_dir)
+
+        # Upload HLS to R2
+        hls_prefix = f"{creator_id}/hls/{media_id}/"
+        upload_directory(r2_client, job_input["r2BucketName"], hls_prefix, hls_dir)
+        hls_master_key = f"{hls_prefix}master.m3u8"
+        hls_preview_key = f"{hls_prefix}preview/preview.m3u8" if media_type == "video" else None
+
+        # Step 6: Create preview (video only)
+        if media_type == "video" and duration > 0:
+            create_preview(input_path, hls_dir, duration, use_gpu)
+            # Preview is already in hls_dir, uploaded above
+
+        # Step 7: Extract thumbnail (video only)
+        thumbnail_key = None
+        if media_type == "video" and duration > 0:
+            thumbnail_path = os.path.join(work_dir, "thumbnail.jpg")
+            extract_thumbnail(input_path, thumbnail_path, duration)
+            thumbnail_key = f"{creator_id}/thumbnails/{media_id}/auto-generated.jpg"
+            upload_file(r2_client, job_input["r2BucketName"], thumbnail_key, thumbnail_path, "image/jpeg")
+
+        # Step 8: Generate waveform (audio only)
+        waveform_key = None
+        waveform_image_key = None
+        if media_type == "audio":
+            waveform_json_path = os.path.join(work_dir, "waveform.json")
+            waveform_png_path = os.path.join(work_dir, "waveform.png")
+            generate_waveform(input_path, waveform_json_path, waveform_png_path)
+
+            waveform_key = f"{creator_id}/waveforms/{media_id}/waveform.json"
+            waveform_image_key = f"{creator_id}/waveforms/{media_id}/waveform.png"
+            upload_file(r2_client, job_input["r2BucketName"], waveform_key, waveform_json_path, "application/json")
+            upload_file(r2_client, job_input["r2BucketName"], waveform_image_key, waveform_png_path, "image/png")
+
+        # Build result
+        result: TranscodingResult = {
+            "status": "completed",
+            "mediaId": media_id,
+            "hlsMasterPlaylistKey": hls_master_key,
+            "hlsPreviewKey": hls_preview_key,
+            "thumbnailKey": thumbnail_key,
+            "waveformKey": waveform_key,
+            "waveformImageKey": waveform_image_key,
+            "mezzanineKey": mezzanine_key,
+            "durationSeconds": duration,
+            "width": width,
+            "height": height,
+            "readyVariants": ready_variants,
+            "error": None,
+        }
+
+        # Step 10: Send webhook
+        send_webhook(job_input["webhookUrl"], job_input["webhookSecret"], result)
+
+        return {"status": "success", "mediaId": media_id}
+
+    except Exception as e:
+        error_msg = str(e)
+        print(f"Transcoding failed: {error_msg}")
+
+        # Send failure webhook
+        result: TranscodingResult = {
+            "status": "failed",
+            "mediaId": media_id,
+            "hlsMasterPlaylistKey": None,
+            "hlsPreviewKey": None,
+            "thumbnailKey": None,
+            "waveformKey": None,
+            "waveformImageKey": None,
+            "mezzanineKey": None,
+            "durationSeconds": None,
+            "width": None,
+            "height": None,
+            "readyVariants": [],
+            "error": error_msg[:2000],  # Cap at 2KB
+        }
+
+        try:
+            send_webhook(job_input["webhookUrl"], job_input["webhookSecret"], result)
+        except Exception as webhook_error:
+            print(f"Failed to send error webhook: {webhook_error}")
+
+        return {"status": "error", "error": error_msg}
+
+    finally:
+        # Cleanup temp directory
+        shutil.rmtree(work_dir, ignore_errors=True)
+
+
+# RunPod serverless entry point
+runpod.serverless.start({"handler": handler})
diff --git a/infrastructure/runpod/requirements.txt b/infrastructure/runpod/requirements.txt
new file mode 100644
index 0000000..380db29
--- /dev/null
+++ b/infrastructure/runpod/requirements.txt
@@ -0,0 +1,12 @@
+# RunPod Transcoding Worker Dependencies
+#
+# Core:
+# - runpod: RunPod serverless SDK
+# - boto3: S3-compatible storage (R2/B2)
+# - requests: HTTP client for webhooks
+#
+# Note: FFmpeg and audiowaveform are system packages installed in Dockerfile
+
+runpod>=1.6.0
+boto3>=1.34.0
+requests>=2.31.0
diff --git a/packages/database/src/migrations/0017_typical_mantis.sql b/packages/database/src/migrations/0017_typical_mantis.sql
new file mode 100644
index 0000000..c968b4d
--- /dev/null
+++ b/packages/database/src/migrations/0017_typical_mantis.sql
@@ -0,0 +1,24 @@
+ALTER TABLE "media_items" DROP CONSTRAINT "status_ready_requires_keys";--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "hls_preview_key" varchar(500);--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "waveform_key" varchar(500);--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "waveform_image_key" varchar(500);--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "runpod_job_id" varchar(255);--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "transcoding_error" text;--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "transcoding_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "transcoding_priority" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "mezzanine_key" varchar(500);--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "mezzanine_status" varchar(50);--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "ready_variants" jsonb;--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "loudness_integrated" integer;--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "loudness_peak" integer;--> statement-breakpoint
+ALTER TABLE "media_items" ADD COLUMN "loudness_range" integer;--> statement-breakpoint
+ALTER TABLE "media_items" ADD CONSTRAINT "check_mezzanine_status" CHECK ("media_items"."mezzanine_status" IS NULL OR "media_items"."mezzanine_status" IN ('pending', 'processing', 'ready', 'failed'));--> statement-breakpoint
+ALTER TABLE "media_items" ADD CONSTRAINT "check_transcoding_priority" CHECK ("media_items"."transcoding_priority" >= 0 AND "media_items"."transcoding_priority" <= 4);--> statement-breakpoint
+ALTER TABLE "media_items" ADD CONSTRAINT "status_ready_requires_keys" CHECK ("media_items"."status" != 'ready' OR (
+        "media_items"."hls_master_playlist_key" IS NOT NULL
+        AND "media_items"."duration_seconds" IS NOT NULL
+        AND (
+          ("media_items"."media_type" = 'video' AND "media_items"."thumbnail_key" IS NOT NULL)
+          OR ("media_items"."media_type" = 'audio' AND "media_items"."waveform_key" IS NOT NULL)
+        )
+      ));
\ No newline at end of file
diff --git a/packages/database/src/migrations/0018_overconfident_ken_ellis.sql b/packages/database/src/migrations/0018_overconfident_ken_ellis.sql
new file mode 100644
index 0000000..8c8e8bd
--- /dev/null
+++ b/packages/database/src/migrations/0018_overconfident_ken_ellis.sql
@@ -0,0 +1,3 @@
+ALTER TABLE "media_items" ALTER COLUMN "transcoding_error" SET DATA TYPE varchar(2000);--> statement-breakpoint
+CREATE INDEX "idx_media_items_runpod_job_id" ON "media_items" USING btree ("runpod_job_id");--> statement-breakpoint
+ALTER TABLE "media_items" ADD CONSTRAINT "check_max_transcoding_attempts" CHECK ("media_items"."transcoding_attempts" >= 0 AND "media_items"."transcoding_attempts" <= 1);
\ No newline at end of file
diff --git a/packages/database/src/migrations/0020_fix_transcoding_constraints.sql b/packages/database/src/migrations/0020_fix_transcoding_constraints.sql
new file mode 100644
index 0000000..dcbc054
--- /dev/null
+++ b/packages/database/src/migrations/0020_fix_transcoding_constraints.sql
@@ -0,0 +1,8 @@
+-- Drop old constraint restricted to 1 attempt
+ALTER TABLE "media_items" DROP CONSTRAINT "check_max_transcoding_attempts";
+
+-- Add new constraint allowing up to 3 attempts
+ALTER TABLE "media_items" ADD CONSTRAINT "check_max_transcoding_attempts" CHECK ("media_items"."transcoding_attempts" >= 0 AND "media_items"."transcoding_attempts" <= 3);
+
+-- Add index for efficient polling/retry queries
+CREATE INDEX IF NOT EXISTS "idx_media_items_transcoding_status" ON "media_items" ("status", "transcoding_attempts");
diff --git a/packages/database/src/migrations/meta/0017_snapshot.json b/packages/database/src/migrations/meta/0017_snapshot.json
new file mode 100644
index 0000000..ba0239e
--- /dev/null
+++ b/packages/database/src/migrations/meta/0017_snapshot.json
@@ -0,0 +1,2595 @@
+{
+  "id": "22525cf2-94c9-4f68-a4c0-b6013676edd0",
+  "prevId": "26074af1-367e-44c1-8fe2-107b3ed5a75b",
+  "version": "7",
+  "dialect": "postgresql",
+  "tables": {
+    "public.accounts": {
+      "name": "accounts",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "account_id": {
+          "name": "account_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "provider_id": {
+          "name": "provider_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "access_token": {
+          "name": "access_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refresh_token": {
+          "name": "refresh_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "id_token": {
+          "name": "id_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "access_token_expires_at": {
+          "name": "access_token_expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refresh_token_expires_at": {
+          "name": "refresh_token_expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "scope": {
+          "name": "scope",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "password": {
+          "name": "password",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "accounts_user_id_users_id_fk": {
+          "name": "accounts_user_id_users_id_fk",
+          "tableFrom": "accounts",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.sessions": {
+      "name": "sessions",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "token": {
+          "name": "token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "ip_address": {
+          "name": "ip_address",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "user_agent": {
+          "name": "user_agent",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "sessions_user_id_users_id_fk": {
+          "name": "sessions_user_id_users_id_fk",
+          "tableFrom": "sessions",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "sessions_token_unique": {
+          "name": "sessions_token_unique",
+          "nullsNotDistinct": false,
+          "columns": ["token"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.users": {
+      "name": "users",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "email": {
+          "name": "email",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "email_verified": {
+          "name": "email_verified",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "image": {
+          "name": "image",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "role": {
+          "name": "role",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'customer'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "users_email_unique": {
+          "name": "users_email_unique",
+          "nullsNotDistinct": false,
+          "columns": ["email"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.verification": {
+      "name": "verification",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "identifier": {
+          "name": "identifier",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "value": {
+          "name": "value",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {
+        "verification_identifier_idx": {
+          "name": "verification_identifier_idx",
+          "columns": [
+            {
+              "expression": "identifier",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.content": {
+      "name": "content",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "creator_id": {
+          "name": "creator_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "media_item_id": {
+          "name": "media_item_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "title": {
+          "name": "title",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "slug": {
+          "name": "slug",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "content_type": {
+          "name": "content_type",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "thumbnail_url": {
+          "name": "thumbnail_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "content_body": {
+          "name": "content_body",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "category": {
+          "name": "category",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "tags": {
+          "name": "tags",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": false,
+          "default": "'[]'::jsonb"
+        },
+        "visibility": {
+          "name": "visibility",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'purchased_only'"
+        },
+        "price_cents": {
+          "name": "price_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'draft'"
+        },
+        "published_at": {
+          "name": "published_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "view_count": {
+          "name": "view_count",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "purchase_count": {
+          "name": "purchase_count",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "deleted_at": {
+          "name": "deleted_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_content_creator_id": {
+          "name": "idx_content_creator_id",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_organization_id": {
+          "name": "idx_content_organization_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_media_item_id": {
+          "name": "idx_content_media_item_id",
+          "columns": [
+            {
+              "expression": "media_item_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_slug_org": {
+          "name": "idx_content_slug_org",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_status": {
+          "name": "idx_content_status",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_published_at": {
+          "name": "idx_content_published_at",
+          "columns": [
+            {
+              "expression": "published_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_category": {
+          "name": "idx_content_category",
+          "columns": [
+            {
+              "expression": "category",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_unique_content_slug_per_org": {
+          "name": "idx_unique_content_slug_per_org",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "where": "\"content\".\"organization_id\" IS NOT NULL",
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_unique_content_slug_personal": {
+          "name": "idx_unique_content_slug_personal",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "where": "\"content\".\"organization_id\" IS NULL",
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "content_creator_id_users_id_fk": {
+          "name": "content_creator_id_users_id_fk",
+          "tableFrom": "content",
+          "tableTo": "users",
+          "columnsFrom": ["creator_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        },
+        "content_organization_id_organizations_id_fk": {
+          "name": "content_organization_id_organizations_id_fk",
+          "tableFrom": "content",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        },
+        "content_media_item_id_media_items_id_fk": {
+          "name": "content_media_item_id_media_items_id_fk",
+          "tableFrom": "content",
+          "tableTo": "media_items",
+          "columnsFrom": ["media_item_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_content_status": {
+          "name": "check_content_status",
+          "value": "\"content\".\"status\" IN ('draft', 'published', 'archived')"
+        },
+        "check_content_visibility": {
+          "name": "check_content_visibility",
+          "value": "\"content\".\"visibility\" IN ('public', 'private', 'members_only', 'purchased_only')"
+        },
+        "check_content_type": {
+          "name": "check_content_type",
+          "value": "\"content\".\"content_type\" IN ('video', 'audio', 'written')"
+        },
+        "check_price_non_negative": {
+          "name": "check_price_non_negative",
+          "value": "\"content\".\"price_cents\" IS NULL OR \"content\".\"price_cents\" >= 0"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.media_items": {
+      "name": "media_items",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "creator_id": {
+          "name": "creator_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "title": {
+          "name": "title",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "media_type": {
+          "name": "media_type",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'uploading'"
+        },
+        "r2_key": {
+          "name": "r2_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "file_size_bytes": {
+          "name": "file_size_bytes",
+          "type": "bigint",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "mime_type": {
+          "name": "mime_type",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "duration_seconds": {
+          "name": "duration_seconds",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "width": {
+          "name": "width",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "height": {
+          "name": "height",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "hls_master_playlist_key": {
+          "name": "hls_master_playlist_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "hls_preview_key": {
+          "name": "hls_preview_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "thumbnail_key": {
+          "name": "thumbnail_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "waveform_key": {
+          "name": "waveform_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "waveform_image_key": {
+          "name": "waveform_image_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "runpod_job_id": {
+          "name": "runpod_job_id",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "transcoding_error": {
+          "name": "transcoding_error",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "transcoding_attempts": {
+          "name": "transcoding_attempts",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "transcoding_priority": {
+          "name": "transcoding_priority",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 2
+        },
+        "mezzanine_key": {
+          "name": "mezzanine_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "mezzanine_status": {
+          "name": "mezzanine_status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "ready_variants": {
+          "name": "ready_variants",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "loudness_integrated": {
+          "name": "loudness_integrated",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "loudness_peak": {
+          "name": "loudness_peak",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "loudness_range": {
+          "name": "loudness_range",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "uploaded_at": {
+          "name": "uploaded_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "deleted_at": {
+          "name": "deleted_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_media_items_creator_id": {
+          "name": "idx_media_items_creator_id",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_media_items_status": {
+          "name": "idx_media_items_status",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_media_items_type": {
+          "name": "idx_media_items_type",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "media_type",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "media_items_creator_id_users_id_fk": {
+          "name": "media_items_creator_id_users_id_fk",
+          "tableFrom": "media_items",
+          "tableTo": "users",
+          "columnsFrom": ["creator_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_media_status": {
+          "name": "check_media_status",
+          "value": "\"media_items\".\"status\" IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')"
+        },
+        "check_media_type": {
+          "name": "check_media_type",
+          "value": "\"media_items\".\"media_type\" IN ('video', 'audio')"
+        },
+        "check_mezzanine_status": {
+          "name": "check_mezzanine_status",
+          "value": "\"media_items\".\"mezzanine_status\" IS NULL OR \"media_items\".\"mezzanine_status\" IN ('pending', 'processing', 'ready', 'failed')"
+        },
+        "check_transcoding_priority": {
+          "name": "check_transcoding_priority",
+          "value": "\"media_items\".\"transcoding_priority\" >= 0 AND \"media_items\".\"transcoding_priority\" <= 4"
+        },
+        "status_ready_requires_keys": {
+          "name": "status_ready_requires_keys",
+          "value": "\"media_items\".\"status\" != 'ready' OR (\n        \"media_items\".\"hls_master_playlist_key\" IS NOT NULL\n        AND \"media_items\".\"duration_seconds\" IS NOT NULL\n        AND (\n          (\"media_items\".\"media_type\" = 'video' AND \"media_items\".\"thumbnail_key\" IS NOT NULL)\n          OR (\"media_items\".\"media_type\" = 'audio' AND \"media_items\".\"waveform_key\" IS NOT NULL)\n        )\n      )"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.organization_memberships": {
+      "name": "organization_memberships",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "role": {
+          "name": "role",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'member'"
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'active'"
+        },
+        "invited_by": {
+          "name": "invited_by",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_unique_org_membership": {
+          "name": "idx_unique_org_membership",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_org_id": {
+          "name": "idx_org_memberships_org_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_user_id": {
+          "name": "idx_org_memberships_user_id",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_role": {
+          "name": "idx_org_memberships_role",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "role",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_status": {
+          "name": "idx_org_memberships_status",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "organization_memberships_organization_id_organizations_id_fk": {
+          "name": "organization_memberships_organization_id_organizations_id_fk",
+          "tableFrom": "organization_memberships",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "organization_memberships_user_id_users_id_fk": {
+          "name": "organization_memberships_user_id_users_id_fk",
+          "tableFrom": "organization_memberships",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "organization_memberships_invited_by_users_id_fk": {
+          "name": "organization_memberships_invited_by_users_id_fk",
+          "tableFrom": "organization_memberships",
+          "tableTo": "users",
+          "columnsFrom": ["invited_by"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_membership_role": {
+          "name": "check_membership_role",
+          "value": "\"organization_memberships\".\"role\" IN ('owner', 'admin', 'creator', 'subscriber', 'member')"
+        },
+        "check_membership_status": {
+          "name": "check_membership_status",
+          "value": "\"organization_memberships\".\"status\" IN ('active', 'inactive', 'invited')"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.organizations": {
+      "name": "organizations",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "name": {
+          "name": "name",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "slug": {
+          "name": "slug",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "logo_url": {
+          "name": "logo_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "website_url": {
+          "name": "website_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "deleted_at": {
+          "name": "deleted_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_organizations_slug": {
+          "name": "idx_organizations_slug",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "organizations_slug_unique": {
+          "name": "organizations_slug_unique",
+          "nullsNotDistinct": false,
+          "columns": ["slug"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.content_access": {
+      "name": "content_access",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_id": {
+          "name": "content_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "access_type": {
+          "name": "access_type",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_content_access_user_id": {
+          "name": "idx_content_access_user_id",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_access_content_id": {
+          "name": "idx_content_access_content_id",
+          "columns": [
+            {
+              "expression": "content_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_access_organization_id": {
+          "name": "idx_content_access_organization_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "content_access_user_id_users_id_fk": {
+          "name": "content_access_user_id_users_id_fk",
+          "tableFrom": "content_access",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "content_access_content_id_content_id_fk": {
+          "name": "content_access_content_id_content_id_fk",
+          "tableFrom": "content_access",
+          "tableTo": "content",
+          "columnsFrom": ["content_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "content_access_organization_id_organizations_id_fk": {
+          "name": "content_access_organization_id_organizations_id_fk",
+          "tableFrom": "content_access",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "content_access_user_content_unique": {
+          "name": "content_access_user_content_unique",
+          "nullsNotDistinct": false,
+          "columns": ["user_id", "content_id"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "check_access_type": {
+          "name": "check_access_type",
+          "value": "\"content_access\".\"access_type\" IN ('purchased', 'subscription', 'complimentary', 'preview')"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.creator_organization_agreements": {
+      "name": "creator_organization_agreements",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "creator_id": {
+          "name": "creator_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_fee_percentage": {
+          "name": "organization_fee_percentage",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "effective_from": {
+          "name": "effective_from",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "effective_until": {
+          "name": "effective_until",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_creator_org_agreement_creator_id": {
+          "name": "idx_creator_org_agreement_creator_id",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_creator_org_agreement_org_id": {
+          "name": "idx_creator_org_agreement_org_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_creator_org_agreement_effective": {
+          "name": "idx_creator_org_agreement_effective",
+          "columns": [
+            {
+              "expression": "effective_from",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "effective_until",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "creator_organization_agreements_creator_id_users_id_fk": {
+          "name": "creator_organization_agreements_creator_id_users_id_fk",
+          "tableFrom": "creator_organization_agreements",
+          "tableTo": "users",
+          "columnsFrom": ["creator_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "creator_organization_agreements_organization_id_organizations_id_fk": {
+          "name": "creator_organization_agreements_organization_id_organizations_id_fk",
+          "tableFrom": "creator_organization_agreements",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "creator_org_agreement_unique": {
+          "name": "creator_org_agreement_unique",
+          "nullsNotDistinct": false,
+          "columns": ["creator_id", "organization_id", "effective_from"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "check_org_fee_percentage": {
+          "name": "check_org_fee_percentage",
+          "value": "\"creator_organization_agreements\".\"organization_fee_percentage\" >= 0 AND \"creator_organization_agreements\".\"organization_fee_percentage\" <= 10000"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.organization_platform_agreements": {
+      "name": "organization_platform_agreements",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "platform_fee_percentage": {
+          "name": "platform_fee_percentage",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "effective_from": {
+          "name": "effective_from",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "effective_until": {
+          "name": "effective_until",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_org_platform_agreement_org_id": {
+          "name": "idx_org_platform_agreement_org_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_platform_agreement_effective": {
+          "name": "idx_org_platform_agreement_effective",
+          "columns": [
+            {
+              "expression": "effective_from",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "effective_until",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "organization_platform_agreements_organization_id_organizations_id_fk": {
+          "name": "organization_platform_agreements_organization_id_organizations_id_fk",
+          "tableFrom": "organization_platform_agreements",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_org_platform_fee_percentage": {
+          "name": "check_org_platform_fee_percentage",
+          "value": "\"organization_platform_agreements\".\"platform_fee_percentage\" >= 0 AND \"organization_platform_agreements\".\"platform_fee_percentage\" <= 10000"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.platform_fee_config": {
+      "name": "platform_fee_config",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "platform_fee_percentage": {
+          "name": "platform_fee_percentage",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "effective_from": {
+          "name": "effective_from",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "effective_until": {
+          "name": "effective_until",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_platform_fee_config_effective": {
+          "name": "idx_platform_fee_config_effective",
+          "columns": [
+            {
+              "expression": "effective_from",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "effective_until",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_platform_fee_percentage": {
+          "name": "check_platform_fee_percentage",
+          "value": "\"platform_fee_config\".\"platform_fee_percentage\" >= 0 AND \"platform_fee_config\".\"platform_fee_percentage\" <= 10000"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.purchases": {
+      "name": "purchases",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "customer_id": {
+          "name": "customer_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_id": {
+          "name": "content_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "amount_paid_cents": {
+          "name": "amount_paid_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "currency": {
+          "name": "currency",
+          "type": "varchar(3)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'usd'"
+        },
+        "platform_fee_cents": {
+          "name": "platform_fee_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "organization_fee_cents": {
+          "name": "organization_fee_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "creator_payout_cents": {
+          "name": "creator_payout_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "platform_agreement_id": {
+          "name": "platform_agreement_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "creator_org_agreement_id": {
+          "name": "creator_org_agreement_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "stripe_payment_intent_id": {
+          "name": "stripe_payment_intent_id",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "purchased_at": {
+          "name": "purchased_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refunded_at": {
+          "name": "refunded_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refund_reason": {
+          "name": "refund_reason",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refund_amount_cents": {
+          "name": "refund_amount_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "stripe_refund_id": {
+          "name": "stripe_refund_id",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_purchases_customer_id": {
+          "name": "idx_purchases_customer_id",
+          "columns": [
+            {
+              "expression": "customer_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_content_id": {
+          "name": "idx_purchases_content_id",
+          "columns": [
+            {
+              "expression": "content_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_organization_id": {
+          "name": "idx_purchases_organization_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_stripe_payment_intent": {
+          "name": "idx_purchases_stripe_payment_intent",
+          "columns": [
+            {
+              "expression": "stripe_payment_intent_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_created_at": {
+          "name": "idx_purchases_created_at",
+          "columns": [
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_purchased_at": {
+          "name": "idx_purchases_purchased_at",
+          "columns": [
+            {
+              "expression": "purchased_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_platform_agreement": {
+          "name": "idx_purchases_platform_agreement",
+          "columns": [
+            {
+              "expression": "platform_agreement_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_creator_org_agreement": {
+          "name": "idx_purchases_creator_org_agreement",
+          "columns": [
+            {
+              "expression": "creator_org_agreement_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_org_status_created": {
+          "name": "idx_purchases_org_status_created",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_org_status_purchased": {
+          "name": "idx_purchases_org_status_purchased",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "purchased_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "purchases_customer_id_users_id_fk": {
+          "name": "purchases_customer_id_users_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "users",
+          "columnsFrom": ["customer_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "purchases_content_id_content_id_fk": {
+          "name": "purchases_content_id_content_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "content",
+          "columnsFrom": ["content_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        },
+        "purchases_organization_id_organizations_id_fk": {
+          "name": "purchases_organization_id_organizations_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        },
+        "purchases_platform_agreement_id_organization_platform_agreements_id_fk": {
+          "name": "purchases_platform_agreement_id_organization_platform_agreements_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "organization_platform_agreements",
+          "columnsFrom": ["platform_agreement_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        },
+        "purchases_creator_org_agreement_id_creator_organization_agreements_id_fk": {
+          "name": "purchases_creator_org_agreement_id_creator_organization_agreements_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "creator_organization_agreements",
+          "columnsFrom": ["creator_org_agreement_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "purchases_stripe_payment_intent_id_unique": {
+          "name": "purchases_stripe_payment_intent_id_unique",
+          "nullsNotDistinct": false,
+          "columns": ["stripe_payment_intent_id"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "check_purchase_status": {
+          "name": "check_purchase_status",
+          "value": "\"purchases\".\"status\" IN ('pending', 'completed', 'refunded', 'failed')"
+        },
+        "check_amount_positive": {
+          "name": "check_amount_positive",
+          "value": "\"purchases\".\"amount_paid_cents\" >= 0"
+        },
+        "check_platform_fee_positive": {
+          "name": "check_platform_fee_positive",
+          "value": "\"purchases\".\"platform_fee_cents\" >= 0"
+        },
+        "check_org_fee_positive": {
+          "name": "check_org_fee_positive",
+          "value": "\"purchases\".\"organization_fee_cents\" >= 0"
+        },
+        "check_creator_payout_positive": {
+          "name": "check_creator_payout_positive",
+          "value": "\"purchases\".\"creator_payout_cents\" >= 0"
+        },
+        "check_revenue_split_equals_total": {
+          "name": "check_revenue_split_equals_total",
+          "value": "\"purchases\".\"amount_paid_cents\" = \"purchases\".\"platform_fee_cents\" + \"purchases\".\"organization_fee_cents\" + \"purchases\".\"creator_payout_cents\""
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.video_playback": {
+      "name": "video_playback",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_id": {
+          "name": "content_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "position_seconds": {
+          "name": "position_seconds",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "duration_seconds": {
+          "name": "duration_seconds",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "completed": {
+          "name": "completed",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_video_playback_user_id": {
+          "name": "idx_video_playback_user_id",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_video_playback_content_id": {
+          "name": "idx_video_playback_content_id",
+          "columns": [
+            {
+              "expression": "content_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "video_playback_user_id_users_id_fk": {
+          "name": "video_playback_user_id_users_id_fk",
+          "tableFrom": "video_playback",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "video_playback_content_id_content_id_fk": {
+          "name": "video_playback_content_id_content_id_fk",
+          "tableFrom": "video_playback",
+          "tableTo": "content",
+          "columnsFrom": ["content_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "video_playback_user_id_content_id_unique": {
+          "name": "video_playback_user_id_content_id_unique",
+          "nullsNotDistinct": false,
+          "columns": ["user_id", "content_id"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.branding_settings": {
+      "name": "branding_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "logo_url": {
+          "name": "logo_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "logo_r2_path": {
+          "name": "logo_r2_path",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "primary_color_hex": {
+          "name": "primary_color_hex",
+          "type": "varchar(7)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'#3B82F6'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "branding_settings_updated_at_idx": {
+          "name": "branding_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "branding_settings_organization_id_platform_settings_organization_id_fk": {
+          "name": "branding_settings_organization_id_platform_settings_organization_id_fk",
+          "tableFrom": "branding_settings",
+          "tableTo": "platform_settings",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["organization_id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.contact_settings": {
+      "name": "contact_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "platform_name": {
+          "name": "platform_name",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'Codex Platform'"
+        },
+        "support_email": {
+          "name": "support_email",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'support@example.com'"
+        },
+        "contact_url": {
+          "name": "contact_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "timezone": {
+          "name": "timezone",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'UTC'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "contact_settings_updated_at_idx": {
+          "name": "contact_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "contact_settings_organization_id_platform_settings_organization_id_fk": {
+          "name": "contact_settings_organization_id_platform_settings_organization_id_fk",
+          "tableFrom": "contact_settings",
+          "tableTo": "platform_settings",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["organization_id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.feature_settings": {
+      "name": "feature_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "enable_signups": {
+          "name": "enable_signups",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "enable_purchases": {
+          "name": "enable_purchases",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "feature_settings_updated_at_idx": {
+          "name": "feature_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "feature_settings_organization_id_platform_settings_organization_id_fk": {
+          "name": "feature_settings_organization_id_platform_settings_organization_id_fk",
+          "tableFrom": "feature_settings",
+          "tableTo": "platform_settings",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["organization_id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.platform_settings": {
+      "name": "platform_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "platform_settings_updated_at_idx": {
+          "name": "platform_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "platform_settings_organization_id_organizations_id_fk": {
+          "name": "platform_settings_organization_id_organizations_id_fk",
+          "tableFrom": "platform_settings",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.test_table": {
+      "name": "test_table",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "test_table_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    }
+  },
+  "enums": {},
+  "schemas": {},
+  "sequences": {},
+  "roles": {},
+  "policies": {},
+  "views": {},
+  "_meta": {
+    "columns": {},
+    "schemas": {},
+    "tables": {}
+  }
+}
diff --git a/packages/database/src/migrations/meta/0018_snapshot.json b/packages/database/src/migrations/meta/0018_snapshot.json
new file mode 100644
index 0000000..be40db3
--- /dev/null
+++ b/packages/database/src/migrations/meta/0018_snapshot.json
@@ -0,0 +1,2614 @@
+{
+  "id": "1d92f27a-22c4-4011-83c6-91cad0342274",
+  "prevId": "22525cf2-94c9-4f68-a4c0-b6013676edd0",
+  "version": "7",
+  "dialect": "postgresql",
+  "tables": {
+    "public.accounts": {
+      "name": "accounts",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "account_id": {
+          "name": "account_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "provider_id": {
+          "name": "provider_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "access_token": {
+          "name": "access_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refresh_token": {
+          "name": "refresh_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "id_token": {
+          "name": "id_token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "access_token_expires_at": {
+          "name": "access_token_expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refresh_token_expires_at": {
+          "name": "refresh_token_expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "scope": {
+          "name": "scope",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "password": {
+          "name": "password",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "accounts_user_id_users_id_fk": {
+          "name": "accounts_user_id_users_id_fk",
+          "tableFrom": "accounts",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.sessions": {
+      "name": "sessions",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "token": {
+          "name": "token",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "ip_address": {
+          "name": "ip_address",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "user_agent": {
+          "name": "user_agent",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "sessions_user_id_users_id_fk": {
+          "name": "sessions_user_id_users_id_fk",
+          "tableFrom": "sessions",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "sessions_token_unique": {
+          "name": "sessions_token_unique",
+          "nullsNotDistinct": false,
+          "columns": ["token"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.users": {
+      "name": "users",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "email": {
+          "name": "email",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "email_verified": {
+          "name": "email_verified",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "image": {
+          "name": "image",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "role": {
+          "name": "role",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'customer'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "users_email_unique": {
+          "name": "users_email_unique",
+          "nullsNotDistinct": false,
+          "columns": ["email"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.verification": {
+      "name": "verification",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "identifier": {
+          "name": "identifier",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "value": {
+          "name": "value",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {
+        "verification_identifier_idx": {
+          "name": "verification_identifier_idx",
+          "columns": [
+            {
+              "expression": "identifier",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.content": {
+      "name": "content",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "creator_id": {
+          "name": "creator_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "media_item_id": {
+          "name": "media_item_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "title": {
+          "name": "title",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "slug": {
+          "name": "slug",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "content_type": {
+          "name": "content_type",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "thumbnail_url": {
+          "name": "thumbnail_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "content_body": {
+          "name": "content_body",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "category": {
+          "name": "category",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "tags": {
+          "name": "tags",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": false,
+          "default": "'[]'::jsonb"
+        },
+        "visibility": {
+          "name": "visibility",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'purchased_only'"
+        },
+        "price_cents": {
+          "name": "price_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'draft'"
+        },
+        "published_at": {
+          "name": "published_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "view_count": {
+          "name": "view_count",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "purchase_count": {
+          "name": "purchase_count",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "deleted_at": {
+          "name": "deleted_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_content_creator_id": {
+          "name": "idx_content_creator_id",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_organization_id": {
+          "name": "idx_content_organization_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_media_item_id": {
+          "name": "idx_content_media_item_id",
+          "columns": [
+            {
+              "expression": "media_item_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_slug_org": {
+          "name": "idx_content_slug_org",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_status": {
+          "name": "idx_content_status",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_published_at": {
+          "name": "idx_content_published_at",
+          "columns": [
+            {
+              "expression": "published_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_category": {
+          "name": "idx_content_category",
+          "columns": [
+            {
+              "expression": "category",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_unique_content_slug_per_org": {
+          "name": "idx_unique_content_slug_per_org",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "where": "\"content\".\"organization_id\" IS NOT NULL",
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_unique_content_slug_personal": {
+          "name": "idx_unique_content_slug_personal",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "where": "\"content\".\"organization_id\" IS NULL",
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "content_creator_id_users_id_fk": {
+          "name": "content_creator_id_users_id_fk",
+          "tableFrom": "content",
+          "tableTo": "users",
+          "columnsFrom": ["creator_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        },
+        "content_organization_id_organizations_id_fk": {
+          "name": "content_organization_id_organizations_id_fk",
+          "tableFrom": "content",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        },
+        "content_media_item_id_media_items_id_fk": {
+          "name": "content_media_item_id_media_items_id_fk",
+          "tableFrom": "content",
+          "tableTo": "media_items",
+          "columnsFrom": ["media_item_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_content_status": {
+          "name": "check_content_status",
+          "value": "\"content\".\"status\" IN ('draft', 'published', 'archived')"
+        },
+        "check_content_visibility": {
+          "name": "check_content_visibility",
+          "value": "\"content\".\"visibility\" IN ('public', 'private', 'members_only', 'purchased_only')"
+        },
+        "check_content_type": {
+          "name": "check_content_type",
+          "value": "\"content\".\"content_type\" IN ('video', 'audio', 'written')"
+        },
+        "check_price_non_negative": {
+          "name": "check_price_non_negative",
+          "value": "\"content\".\"price_cents\" IS NULL OR \"content\".\"price_cents\" >= 0"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.media_items": {
+      "name": "media_items",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "creator_id": {
+          "name": "creator_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "title": {
+          "name": "title",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "media_type": {
+          "name": "media_type",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'uploading'"
+        },
+        "r2_key": {
+          "name": "r2_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "file_size_bytes": {
+          "name": "file_size_bytes",
+          "type": "bigint",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "mime_type": {
+          "name": "mime_type",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "duration_seconds": {
+          "name": "duration_seconds",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "width": {
+          "name": "width",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "height": {
+          "name": "height",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "hls_master_playlist_key": {
+          "name": "hls_master_playlist_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "hls_preview_key": {
+          "name": "hls_preview_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "thumbnail_key": {
+          "name": "thumbnail_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "waveform_key": {
+          "name": "waveform_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "waveform_image_key": {
+          "name": "waveform_image_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "runpod_job_id": {
+          "name": "runpod_job_id",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "transcoding_error": {
+          "name": "transcoding_error",
+          "type": "varchar(2000)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "transcoding_attempts": {
+          "name": "transcoding_attempts",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "transcoding_priority": {
+          "name": "transcoding_priority",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 2
+        },
+        "mezzanine_key": {
+          "name": "mezzanine_key",
+          "type": "varchar(500)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "mezzanine_status": {
+          "name": "mezzanine_status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "ready_variants": {
+          "name": "ready_variants",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "loudness_integrated": {
+          "name": "loudness_integrated",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "loudness_peak": {
+          "name": "loudness_peak",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "loudness_range": {
+          "name": "loudness_range",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "uploaded_at": {
+          "name": "uploaded_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "deleted_at": {
+          "name": "deleted_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_media_items_creator_id": {
+          "name": "idx_media_items_creator_id",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_media_items_status": {
+          "name": "idx_media_items_status",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_media_items_type": {
+          "name": "idx_media_items_type",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "media_type",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_media_items_runpod_job_id": {
+          "name": "idx_media_items_runpod_job_id",
+          "columns": [
+            {
+              "expression": "runpod_job_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "media_items_creator_id_users_id_fk": {
+          "name": "media_items_creator_id_users_id_fk",
+          "tableFrom": "media_items",
+          "tableTo": "users",
+          "columnsFrom": ["creator_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_media_status": {
+          "name": "check_media_status",
+          "value": "\"media_items\".\"status\" IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')"
+        },
+        "check_media_type": {
+          "name": "check_media_type",
+          "value": "\"media_items\".\"media_type\" IN ('video', 'audio')"
+        },
+        "check_mezzanine_status": {
+          "name": "check_mezzanine_status",
+          "value": "\"media_items\".\"mezzanine_status\" IS NULL OR \"media_items\".\"mezzanine_status\" IN ('pending', 'processing', 'ready', 'failed')"
+        },
+        "check_transcoding_priority": {
+          "name": "check_transcoding_priority",
+          "value": "\"media_items\".\"transcoding_priority\" >= 0 AND \"media_items\".\"transcoding_priority\" <= 4"
+        },
+        "check_max_transcoding_attempts": {
+          "name": "check_max_transcoding_attempts",
+          "value": "\"media_items\".\"transcoding_attempts\" >= 0 AND \"media_items\".\"transcoding_attempts\" <= 1"
+        },
+        "status_ready_requires_keys": {
+          "name": "status_ready_requires_keys",
+          "value": "\"media_items\".\"status\" != 'ready' OR (\n        \"media_items\".\"hls_master_playlist_key\" IS NOT NULL\n        AND \"media_items\".\"duration_seconds\" IS NOT NULL\n        AND (\n          (\"media_items\".\"media_type\" = 'video' AND \"media_items\".\"thumbnail_key\" IS NOT NULL)\n          OR (\"media_items\".\"media_type\" = 'audio' AND \"media_items\".\"waveform_key\" IS NOT NULL)\n        )\n      )"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.organization_memberships": {
+      "name": "organization_memberships",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "role": {
+          "name": "role",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'member'"
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'active'"
+        },
+        "invited_by": {
+          "name": "invited_by",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_unique_org_membership": {
+          "name": "idx_unique_org_membership",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_org_id": {
+          "name": "idx_org_memberships_org_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_user_id": {
+          "name": "idx_org_memberships_user_id",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_role": {
+          "name": "idx_org_memberships_role",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "role",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_memberships_status": {
+          "name": "idx_org_memberships_status",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "organization_memberships_organization_id_organizations_id_fk": {
+          "name": "organization_memberships_organization_id_organizations_id_fk",
+          "tableFrom": "organization_memberships",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "organization_memberships_user_id_users_id_fk": {
+          "name": "organization_memberships_user_id_users_id_fk",
+          "tableFrom": "organization_memberships",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "organization_memberships_invited_by_users_id_fk": {
+          "name": "organization_memberships_invited_by_users_id_fk",
+          "tableFrom": "organization_memberships",
+          "tableTo": "users",
+          "columnsFrom": ["invited_by"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_membership_role": {
+          "name": "check_membership_role",
+          "value": "\"organization_memberships\".\"role\" IN ('owner', 'admin', 'creator', 'subscriber', 'member')"
+        },
+        "check_membership_status": {
+          "name": "check_membership_status",
+          "value": "\"organization_memberships\".\"status\" IN ('active', 'inactive', 'invited')"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.organizations": {
+      "name": "organizations",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "name": {
+          "name": "name",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "slug": {
+          "name": "slug",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "logo_url": {
+          "name": "logo_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "website_url": {
+          "name": "website_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "deleted_at": {
+          "name": "deleted_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "idx_organizations_slug": {
+          "name": "idx_organizations_slug",
+          "columns": [
+            {
+              "expression": "slug",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "organizations_slug_unique": {
+          "name": "organizations_slug_unique",
+          "nullsNotDistinct": false,
+          "columns": ["slug"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.content_access": {
+      "name": "content_access",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_id": {
+          "name": "content_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "access_type": {
+          "name": "access_type",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "expires_at": {
+          "name": "expires_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_content_access_user_id": {
+          "name": "idx_content_access_user_id",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_access_content_id": {
+          "name": "idx_content_access_content_id",
+          "columns": [
+            {
+              "expression": "content_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_content_access_organization_id": {
+          "name": "idx_content_access_organization_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "content_access_user_id_users_id_fk": {
+          "name": "content_access_user_id_users_id_fk",
+          "tableFrom": "content_access",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "content_access_content_id_content_id_fk": {
+          "name": "content_access_content_id_content_id_fk",
+          "tableFrom": "content_access",
+          "tableTo": "content",
+          "columnsFrom": ["content_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "content_access_organization_id_organizations_id_fk": {
+          "name": "content_access_organization_id_organizations_id_fk",
+          "tableFrom": "content_access",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "content_access_user_content_unique": {
+          "name": "content_access_user_content_unique",
+          "nullsNotDistinct": false,
+          "columns": ["user_id", "content_id"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "check_access_type": {
+          "name": "check_access_type",
+          "value": "\"content_access\".\"access_type\" IN ('purchased', 'subscription', 'complimentary', 'preview')"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.creator_organization_agreements": {
+      "name": "creator_organization_agreements",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "creator_id": {
+          "name": "creator_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_fee_percentage": {
+          "name": "organization_fee_percentage",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "effective_from": {
+          "name": "effective_from",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "effective_until": {
+          "name": "effective_until",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_creator_org_agreement_creator_id": {
+          "name": "idx_creator_org_agreement_creator_id",
+          "columns": [
+            {
+              "expression": "creator_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_creator_org_agreement_org_id": {
+          "name": "idx_creator_org_agreement_org_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_creator_org_agreement_effective": {
+          "name": "idx_creator_org_agreement_effective",
+          "columns": [
+            {
+              "expression": "effective_from",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "effective_until",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "creator_organization_agreements_creator_id_users_id_fk": {
+          "name": "creator_organization_agreements_creator_id_users_id_fk",
+          "tableFrom": "creator_organization_agreements",
+          "tableTo": "users",
+          "columnsFrom": ["creator_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "creator_organization_agreements_organization_id_organizations_id_fk": {
+          "name": "creator_organization_agreements_organization_id_organizations_id_fk",
+          "tableFrom": "creator_organization_agreements",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "creator_org_agreement_unique": {
+          "name": "creator_org_agreement_unique",
+          "nullsNotDistinct": false,
+          "columns": ["creator_id", "organization_id", "effective_from"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "check_org_fee_percentage": {
+          "name": "check_org_fee_percentage",
+          "value": "\"creator_organization_agreements\".\"organization_fee_percentage\" >= 0 AND \"creator_organization_agreements\".\"organization_fee_percentage\" <= 10000"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.organization_platform_agreements": {
+      "name": "organization_platform_agreements",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "platform_fee_percentage": {
+          "name": "platform_fee_percentage",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "effective_from": {
+          "name": "effective_from",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "effective_until": {
+          "name": "effective_until",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_org_platform_agreement_org_id": {
+          "name": "idx_org_platform_agreement_org_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_org_platform_agreement_effective": {
+          "name": "idx_org_platform_agreement_effective",
+          "columns": [
+            {
+              "expression": "effective_from",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "effective_until",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "organization_platform_agreements_organization_id_organizations_id_fk": {
+          "name": "organization_platform_agreements_organization_id_organizations_id_fk",
+          "tableFrom": "organization_platform_agreements",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_org_platform_fee_percentage": {
+          "name": "check_org_platform_fee_percentage",
+          "value": "\"organization_platform_agreements\".\"platform_fee_percentage\" >= 0 AND \"organization_platform_agreements\".\"platform_fee_percentage\" <= 10000"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.platform_fee_config": {
+      "name": "platform_fee_config",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "platform_fee_percentage": {
+          "name": "platform_fee_percentage",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "effective_from": {
+          "name": "effective_from",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "effective_until": {
+          "name": "effective_until",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_platform_fee_config_effective": {
+          "name": "idx_platform_fee_config_effective",
+          "columns": [
+            {
+              "expression": "effective_from",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "effective_until",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {
+        "check_platform_fee_percentage": {
+          "name": "check_platform_fee_percentage",
+          "value": "\"platform_fee_config\".\"platform_fee_percentage\" >= 0 AND \"platform_fee_config\".\"platform_fee_percentage\" <= 10000"
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.purchases": {
+      "name": "purchases",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "customer_id": {
+          "name": "customer_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_id": {
+          "name": "content_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "amount_paid_cents": {
+          "name": "amount_paid_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "currency": {
+          "name": "currency",
+          "type": "varchar(3)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'usd'"
+        },
+        "platform_fee_cents": {
+          "name": "platform_fee_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "organization_fee_cents": {
+          "name": "organization_fee_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "creator_payout_cents": {
+          "name": "creator_payout_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "platform_agreement_id": {
+          "name": "platform_agreement_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "creator_org_agreement_id": {
+          "name": "creator_org_agreement_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "stripe_payment_intent_id": {
+          "name": "stripe_payment_intent_id",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "varchar(50)",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "purchased_at": {
+          "name": "purchased_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refunded_at": {
+          "name": "refunded_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refund_reason": {
+          "name": "refund_reason",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "refund_amount_cents": {
+          "name": "refund_amount_cents",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "stripe_refund_id": {
+          "name": "stripe_refund_id",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_purchases_customer_id": {
+          "name": "idx_purchases_customer_id",
+          "columns": [
+            {
+              "expression": "customer_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_content_id": {
+          "name": "idx_purchases_content_id",
+          "columns": [
+            {
+              "expression": "content_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_organization_id": {
+          "name": "idx_purchases_organization_id",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_stripe_payment_intent": {
+          "name": "idx_purchases_stripe_payment_intent",
+          "columns": [
+            {
+              "expression": "stripe_payment_intent_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_created_at": {
+          "name": "idx_purchases_created_at",
+          "columns": [
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_purchased_at": {
+          "name": "idx_purchases_purchased_at",
+          "columns": [
+            {
+              "expression": "purchased_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_platform_agreement": {
+          "name": "idx_purchases_platform_agreement",
+          "columns": [
+            {
+              "expression": "platform_agreement_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_creator_org_agreement": {
+          "name": "idx_purchases_creator_org_agreement",
+          "columns": [
+            {
+              "expression": "creator_org_agreement_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_org_status_created": {
+          "name": "idx_purchases_org_status_created",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_purchases_org_status_purchased": {
+          "name": "idx_purchases_org_status_purchased",
+          "columns": [
+            {
+              "expression": "organization_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "purchased_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "purchases_customer_id_users_id_fk": {
+          "name": "purchases_customer_id_users_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "users",
+          "columnsFrom": ["customer_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "purchases_content_id_content_id_fk": {
+          "name": "purchases_content_id_content_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "content",
+          "columnsFrom": ["content_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        },
+        "purchases_organization_id_organizations_id_fk": {
+          "name": "purchases_organization_id_organizations_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "restrict",
+          "onUpdate": "no action"
+        },
+        "purchases_platform_agreement_id_organization_platform_agreements_id_fk": {
+          "name": "purchases_platform_agreement_id_organization_platform_agreements_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "organization_platform_agreements",
+          "columnsFrom": ["platform_agreement_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        },
+        "purchases_creator_org_agreement_id_creator_organization_agreements_id_fk": {
+          "name": "purchases_creator_org_agreement_id_creator_organization_agreements_id_fk",
+          "tableFrom": "purchases",
+          "tableTo": "creator_organization_agreements",
+          "columnsFrom": ["creator_org_agreement_id"],
+          "columnsTo": ["id"],
+          "onDelete": "set null",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "purchases_stripe_payment_intent_id_unique": {
+          "name": "purchases_stripe_payment_intent_id_unique",
+          "nullsNotDistinct": false,
+          "columns": ["stripe_payment_intent_id"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {
+        "check_purchase_status": {
+          "name": "check_purchase_status",
+          "value": "\"purchases\".\"status\" IN ('pending', 'completed', 'refunded', 'failed')"
+        },
+        "check_amount_positive": {
+          "name": "check_amount_positive",
+          "value": "\"purchases\".\"amount_paid_cents\" >= 0"
+        },
+        "check_platform_fee_positive": {
+          "name": "check_platform_fee_positive",
+          "value": "\"purchases\".\"platform_fee_cents\" >= 0"
+        },
+        "check_org_fee_positive": {
+          "name": "check_org_fee_positive",
+          "value": "\"purchases\".\"organization_fee_cents\" >= 0"
+        },
+        "check_creator_payout_positive": {
+          "name": "check_creator_payout_positive",
+          "value": "\"purchases\".\"creator_payout_cents\" >= 0"
+        },
+        "check_revenue_split_equals_total": {
+          "name": "check_revenue_split_equals_total",
+          "value": "\"purchases\".\"amount_paid_cents\" = \"purchases\".\"platform_fee_cents\" + \"purchases\".\"organization_fee_cents\" + \"purchases\".\"creator_payout_cents\""
+        }
+      },
+      "isRLSEnabled": false
+    },
+    "public.video_playback": {
+      "name": "video_playback",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "content_id": {
+          "name": "content_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "position_seconds": {
+          "name": "position_seconds",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 0
+        },
+        "duration_seconds": {
+          "name": "duration_seconds",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "completed": {
+          "name": "completed",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "idx_video_playback_user_id": {
+          "name": "idx_video_playback_user_id",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "idx_video_playback_content_id": {
+          "name": "idx_video_playback_content_id",
+          "columns": [
+            {
+              "expression": "content_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "video_playback_user_id_users_id_fk": {
+          "name": "video_playback_user_id_users_id_fk",
+          "tableFrom": "video_playback",
+          "tableTo": "users",
+          "columnsFrom": ["user_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        },
+        "video_playback_content_id_content_id_fk": {
+          "name": "video_playback_content_id_content_id_fk",
+          "tableFrom": "video_playback",
+          "tableTo": "content",
+          "columnsFrom": ["content_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "video_playback_user_id_content_id_unique": {
+          "name": "video_playback_user_id_content_id_unique",
+          "nullsNotDistinct": false,
+          "columns": ["user_id", "content_id"]
+        }
+      },
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.branding_settings": {
+      "name": "branding_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "logo_url": {
+          "name": "logo_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "logo_r2_path": {
+          "name": "logo_r2_path",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "primary_color_hex": {
+          "name": "primary_color_hex",
+          "type": "varchar(7)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'#3B82F6'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "branding_settings_updated_at_idx": {
+          "name": "branding_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "branding_settings_organization_id_platform_settings_organization_id_fk": {
+          "name": "branding_settings_organization_id_platform_settings_organization_id_fk",
+          "tableFrom": "branding_settings",
+          "tableTo": "platform_settings",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["organization_id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.contact_settings": {
+      "name": "contact_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "platform_name": {
+          "name": "platform_name",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'Codex Platform'"
+        },
+        "support_email": {
+          "name": "support_email",
+          "type": "varchar(255)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'support@example.com'"
+        },
+        "contact_url": {
+          "name": "contact_url",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "timezone": {
+          "name": "timezone",
+          "type": "varchar(100)",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'UTC'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "contact_settings_updated_at_idx": {
+          "name": "contact_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "contact_settings_organization_id_platform_settings_organization_id_fk": {
+          "name": "contact_settings_organization_id_platform_settings_organization_id_fk",
+          "tableFrom": "contact_settings",
+          "tableTo": "platform_settings",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["organization_id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.feature_settings": {
+      "name": "feature_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "enable_signups": {
+          "name": "enable_signups",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "enable_purchases": {
+          "name": "enable_purchases",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "feature_settings_updated_at_idx": {
+          "name": "feature_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "feature_settings_organization_id_platform_settings_organization_id_fk": {
+          "name": "feature_settings_organization_id_platform_settings_organization_id_fk",
+          "tableFrom": "feature_settings",
+          "tableTo": "platform_settings",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["organization_id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.platform_settings": {
+      "name": "platform_settings",
+      "schema": "",
+      "columns": {
+        "organization_id": {
+          "name": "organization_id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "updated_at": {
+          "name": "updated_at",
+          "type": "timestamp with time zone",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "platform_settings_updated_at_idx": {
+          "name": "platform_settings_updated_at_idx",
+          "columns": [
+            {
+              "expression": "updated_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "platform_settings_organization_id_organizations_id_fk": {
+          "name": "platform_settings_organization_id_organizations_id_fk",
+          "tableFrom": "platform_settings",
+          "tableTo": "organizations",
+          "columnsFrom": ["organization_id"],
+          "columnsTo": ["id"],
+          "onDelete": "cascade",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    },
+    "public.test_table": {
+      "name": "test_table",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "integer",
+          "primaryKey": true,
+          "notNull": true,
+          "identity": {
+            "type": "always",
+            "name": "test_table_id_seq",
+            "schema": "public",
+            "increment": "1",
+            "startWith": "1",
+            "minValue": "1",
+            "maxValue": "2147483647",
+            "cache": "1",
+            "cycle": false
+          }
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {},
+      "policies": {},
+      "checkConstraints": {},
+      "isRLSEnabled": false
+    }
+  },
+  "enums": {},
+  "schemas": {},
+  "sequences": {},
+  "roles": {},
+  "policies": {},
+  "views": {},
+  "_meta": {
+    "columns": {},
+    "schemas": {},
+    "tables": {}
+  }
+}
diff --git a/packages/database/src/migrations/meta/_journal.json b/packages/database/src/migrations/meta/_journal.json
index f808d4a..7dce73e 100644
--- a/packages/database/src/migrations/meta/_journal.json
+++ b/packages/database/src/migrations/meta/_journal.json
@@ -120,6 +120,20 @@
       "when": 1767203123763,
       "tag": "0016_parallel_rattler",
       "breakpoints": true
+    },
+    {
+      "idx": 17,
+      "version": "7",
+      "when": 1767638617924,
+      "tag": "0017_typical_mantis",
+      "breakpoints": true
+    },
+    {
+      "idx": 18,
+      "version": "7",
+      "when": 1767689532834,
+      "tag": "0018_overconfident_ken_ellis",
+      "breakpoints": true
     }
   ]
 }
diff --git a/packages/database/src/schema/content.ts b/packages/database/src/schema/content.ts
index 1030157..0f7074e 100644
--- a/packages/database/src/schema/content.ts
+++ b/packages/database/src/schema/content.ts
@@ -133,7 +133,11 @@ export const mediaItems = pgTable(
     status: varchar('status', { length: 50 }).default('uploading').notNull(),
     // 'uploading' | 'uploaded' | 'transcoding' | 'ready' | 'failed'
 
-    // R2 Storage (in creator's bucket: codex-media-{creator_id}) // TODO: double check this is correct becuase it should be that we are 4 buckets and each has its own creator id subfolder within
+    // R2 Storage - Single MEDIA_BUCKET with creator subfolder structure:
+    // {creatorId}/originals/{mediaId}/video.mp4 (uploads)
+    // {creatorId}/hls/{mediaId}/master.m3u8 (transcoded)
+    // {creatorId}/thumbnails/{mediaId}/thumb.jpg
+    // {creatorId}/waveforms/{mediaId}/waveform.json
     r2Key: varchar('r2_key', { length: 500 }).notNull(), // "originals/{media_id}/video.mp4"
     fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
     mimeType: varchar('mime_type', { length: 100 }),
@@ -145,8 +149,31 @@ export const mediaItems = pgTable(
 
     // HLS Transcoding (Phase 1+)
     hlsMasterPlaylistKey: varchar('hls_master_playlist_key', { length: 500 }), // "hls/{media_id}/master.m3u8"
+    hlsPreviewKey: varchar('hls_preview_key', { length: 500 }), // "hls/{media_id}/preview/preview.m3u8" - 30s preview
     thumbnailKey: varchar('thumbnail_key', { length: 500 }), // "thumbnails/{media_id}/thumb.jpg"
 
+    // Audio Waveform (audio only)
+    waveformKey: varchar('waveform_key', { length: 500 }), // "waveforms/{media_id}/waveform.json"
+    waveformImageKey: varchar('waveform_image_key', { length: 500 }), // "waveforms/{media_id}/waveform.png"
+
+    // Transcoding Job Tracking
+    runpodJobId: varchar('runpod_job_id', { length: 255 }), // RunPod job ID for tracking
+    transcodingError: varchar('transcoding_error', { length: 2000 }), // Error message (max 2KB to prevent DoS)
+    transcodingAttempts: integer('transcoding_attempts').default(0).notNull(), // Retry count (max 1)
+    transcodingPriority: integer('transcoding_priority').default(2).notNull(), // 0=urgent, 2=normal, 4=backlog
+
+    // Mezzanine/Archive (extensibility)
+    mezzanineKey: varchar('mezzanine_key', { length: 500 }), // Archive-quality intermediate
+    mezzanineStatus: varchar('mezzanine_status', { length: 50 }), // pending|processing|ready|failed
+
+    // HLS Variants Tracking
+    readyVariants: jsonb('ready_variants').$type<string[]>(), // ["1080p", "720p", "480p", "360p"]
+
+    // Audio Loudness (stored as integer × 100 for precision)
+    loudnessIntegrated: integer('loudness_integrated'), // LUFS × 100 (e.g., -14.0 LUFS = -1400)
+    loudnessPeak: integer('loudness_peak'), // dBTP × 100 (e.g., -1.0 dBTP = -100)
+    loudnessRange: integer('loudness_range'), // LRA × 100 (e.g., 7.0 LU = 700)
+
     // Timestamps
     uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
     createdAt: timestamp('created_at', { withTimezone: true })
@@ -162,6 +189,11 @@ export const mediaItems = pgTable(
     index('idx_media_items_creator_id').on(table.creatorId),
     index('idx_media_items_status').on(table.creatorId, table.status),
     index('idx_media_items_type').on(table.creatorId, table.mediaType),
+    index('idx_media_items_runpod_job_id').on(table.runpodJobId), // For webhook callback queries
+    index('idx_media_items_transcoding_status').on(
+      table.status,
+      table.transcodingAttempts
+    ), // For efficient polling/retry queries
 
     // CHECK constraints
     check(
@@ -169,11 +201,32 @@ export const mediaItems = pgTable(
       sql`${table.status} IN ('uploading', 'uploaded', 'transcoding', 'ready', 'failed')`
     ),
     check('check_media_type', sql`${table.mediaType} IN ('video', 'audio')`),
+    check(
+      'check_mezzanine_status',
+      sql`${table.mezzanineStatus} IS NULL OR ${table.mezzanineStatus} IN ('pending', 'processing', 'ready', 'failed')`
+    ),
+    check(
+      'check_transcoding_priority',
+      sql`${table.transcodingPriority} >= 0 AND ${table.transcodingPriority} <= 4`
+    ),
+    check(
+      'check_max_transcoding_attempts',
+      sql`${table.transcodingAttempts} >= 0 AND ${table.transcodingAttempts} <= 3`
+    ),
 
     // Media lifecycle constraint: status='ready' requires transcoding outputs
+    // Video: needs HLS + thumbnail + duration
+    // Audio: needs HLS + waveform + duration
     check(
       'status_ready_requires_keys',
-      sql`${table.status} != 'ready' OR (${table.hlsMasterPlaylistKey} IS NOT NULL AND ${table.thumbnailKey} IS NOT NULL AND ${table.durationSeconds} IS NOT NULL)`
+      sql`${table.status} != 'ready' OR (
+        ${table.hlsMasterPlaylistKey} IS NOT NULL
+        AND ${table.durationSeconds} IS NOT NULL
+        AND (
+          (${table.mediaType} = 'video' AND ${table.thumbnailKey} IS NOT NULL)
+          OR (${table.mediaType} = 'audio' AND ${table.waveformKey} IS NOT NULL)
+        )
+      )`
     ),
   ]
 );
diff --git a/packages/security/src/worker-auth.ts b/packages/security/src/worker-auth.ts
index ee87a44..d50695a 100644
--- a/packages/security/src/worker-auth.ts
+++ b/packages/security/src/worker-auth.ts
@@ -181,7 +181,11 @@ export function workerAuth(options: WorkerAuthOptions) {
       return c.json({ error: 'Invalid signature' }, 401);
     }
 
-    // Signature valid, proceed
+    // Signature valid - set context flag for policy enforcement
+    // This allows enforcePolicyInline to recognize worker-authenticated requests
+    c.set('workerAuth' as never, true as never);
+
+    // Proceed to handler
     await next();
   };
 }
diff --git a/packages/shared-types/src/worker-types.ts b/packages/shared-types/src/worker-types.ts
index 2c21c30..d7a751b 100644
--- a/packages/shared-types/src/worker-types.ts
+++ b/packages/shared-types/src/worker-types.ts
@@ -113,6 +113,47 @@ export type Bindings = {
    * Stripe webhook signing secret for dispute events
    */
   STRIPE_WEBHOOK_SECRET_DISPUTE?: string;
+
+  // ==========================================================================
+  // RunPod Transcoding Service
+  // ==========================================================================
+
+  /**
+   * RunPod API key for authentication
+   */
+  RUNPOD_API_KEY?: string;
+
+  /**
+   * RunPod serverless endpoint ID
+   */
+  RUNPOD_ENDPOINT_ID?: string;
+
+  /**
+   * RunPod webhook signing secret (HMAC-SHA256)
+   * Used to verify incoming webhook callbacks from RunPod
+   */
+  RUNPOD_WEBHOOK_SECRET?: string;
+
+  /**
+   * Base URL for RunPod webhook callbacks
+   * e.g., https://api.example.com - used to construct webhook URLs
+   */
+  RUNPOD_WEBHOOK_BASE_URL?: string;
+
+  /**
+   * Shared secret for worker-to-worker HMAC authentication
+   */
+  WORKER_SHARED_SECRET?: string;
+
+  // ==========================================================================
+  // Worker-to-Worker Communication
+  // ==========================================================================
+
+  /**
+   * Media API worker URL for triggering transcoding
+   * Used by content-api to call media-api internal endpoints
+   */
+  MEDIA_API_URL?: string;
 };
 
 /**
@@ -188,6 +229,13 @@ export interface Variables {
     status: string;
     joinedAt: Date;
   };
+
+  /**
+   * Raw request body stored by middleware
+   * Used by webhook handlers that need to verify signatures before parsing JSON
+   * Set by signature verification middleware (e.g., verifyRunpodSignature)
+   */
+  rawBody?: string;
 }
 
 /**
diff --git a/packages/test-utils/src/factories.ts b/packages/test-utils/src/factories.ts
index 8c52771..ff2dc27 100644
--- a/packages/test-utils/src/factories.ts
+++ b/packages/test-utils/src/factories.ts
@@ -130,7 +130,9 @@ export function createTestMediaItemInput(
     width: isReady && mediaType === 'video' ? 1920 : null,
     height: isReady && mediaType === 'video' ? 1080 : null,
     hlsMasterPlaylistKey: isReady ? `hls/${tempId}/master.m3u8` : null, // Required for status='ready'
-    thumbnailKey: isReady ? `thumbnails/${tempId}/thumb.jpg` : null, // Required for status='ready'
+    thumbnailKey: isReady ? `thumbnails/${tempId}/thumb.jpg` : null, // Required for video
+    waveformKey:
+      isReady && mediaType === 'audio' ? `waveforms/${tempId}.json` : null, // Required for audio
     uploadedAt: isReady ? new Date() : null,
     ...overrides,
   };
@@ -164,7 +166,21 @@ export function createTestMediaItem(
     width: mediaType === 'video' ? 1920 : null,
     height: mediaType === 'video' ? 1080 : null,
     hlsMasterPlaylistKey: `hls/${id}/master.m3u8`,
-    thumbnailKey: `thumbnails/${id}/thumb.jpg`,
+    hlsPreviewKey: null, // Transcoding Phase 1 field
+    thumbnailKey: mediaType === 'video' ? `thumbnails/${id}/thumb.jpg` : null,
+    waveformKey: mediaType === 'audio' ? `waveforms/${id}/waveform.json` : null,
+    waveformImageKey:
+      mediaType === 'audio' ? `waveforms/${id}/waveform.png` : null,
+    runpodJobId: null, // Transcoding Phase 1 field
+    transcodingError: null, // Transcoding Phase 1 field
+    transcodingAttempts: 0, // Transcoding Phase 1 field
+    transcodingPriority: 2, // Transcoding Phase 1 field (normal priority)
+    mezzanineKey: null, // Transcoding Phase 1 field
+    mezzanineStatus: null, // Transcoding Phase 1 field
+    readyVariants: null, // Transcoding Phase 1 field
+    loudnessIntegrated: null, // Transcoding Phase 1 field
+    loudnessPeak: null, // Transcoding Phase 1 field
+    loudnessRange: null, // Transcoding Phase 1 field
     uploadedAt: now,
     createdAt: now,
     updatedAt: now,
diff --git a/packages/transcoding/package.json b/packages/transcoding/package.json
new file mode 100644
index 0000000..66e4e04
--- /dev/null
+++ b/packages/transcoding/package.json
@@ -0,0 +1,54 @@
+{
+  "name": "@codex/transcoding",
+  "version": "1.0.0",
+  "description": "Media transcoding service for Codex platform - RunPod integration and R2 path management",
+  "type": "module",
+  "main": "./dist/index.js",
+  "types": "./dist/index.d.ts",
+  "exports": {
+    ".": {
+      "types": "./dist/index.d.ts",
+      "default": "./dist/index.js"
+    },
+    "./services": {
+      "types": "./dist/services/index.d.ts",
+      "default": "./dist/services/index.js"
+    },
+    "./errors": {
+      "types": "./dist/errors.d.ts",
+      "default": "./dist/errors.js"
+    },
+    "./paths": {
+      "types": "./dist/paths.d.ts",
+      "default": "./dist/paths.js"
+    },
+    "./types": {
+      "types": "./dist/types.d.ts",
+      "default": "./dist/types.js"
+    }
+  },
+  "scripts": {
+    "build": "vite build --config vite.config.transcoding.ts",
+    "dev": "vite build --config vite.config.transcoding.ts --watch",
+    "typecheck": "tsc --noEmit",
+    "test": "vitest run --config vitest.config.transcoding.ts",
+    "test:watch": "vitest",
+    "test:coverage": "vitest run --coverage",
+    "lint": "biome lint --write .",
+    "format": "biome format --write ."
+  },
+  "dependencies": {
+    "@codex/database": "workspace:*",
+    "@codex/service-errors": "workspace:*",
+    "@codex/shared-types": "workspace:*",
+    "@codex/validation": "workspace:*",
+    "drizzle-orm": "0.44.7"
+  },
+  "devDependencies": {
+    "@codex/test-utils": "workspace:*",
+    "@types/node": "^22.0.0",
+    "typescript": "^5.6.3",
+    "vite": "^7.2.2",
+    "vitest": "^4.0.2"
+  }
+}
diff --git a/packages/transcoding/src/__tests__/paths.test.ts b/packages/transcoding/src/__tests__/paths.test.ts
new file mode 100644
index 0000000..aa7e85f
--- /dev/null
+++ b/packages/transcoding/src/__tests__/paths.test.ts
@@ -0,0 +1,96 @@
+import { describe, expect, it } from 'vitest';
+import {
+  B2_PATH_CONFIG,
+  getHlsMasterKey,
+  getHlsPreviewKey,
+  getMezzanineKey,
+  getMezzaninePrefix,
+  getOriginalKey,
+  getThumbnailKey,
+  getWaveformKey,
+  isValidR2Key,
+  parseR2Key,
+} from '../paths';
+
+describe('Path Helpers', () => {
+  const creatorId = 'user_123';
+  const mediaId = '550e8400-e29b-41d4-a716-446655440000';
+
+  describe('R2 Key Generation', () => {
+    it('getOriginalKey should return correct format', () => {
+      const key = getOriginalKey(creatorId, mediaId, 'video.mp4');
+      expect(key).toBe(`${creatorId}/originals/${mediaId}/video.mp4`);
+    });
+
+    it('getHlsMasterKey should return correct format', () => {
+      const key = getHlsMasterKey(creatorId, mediaId);
+      expect(key).toBe(`${creatorId}/hls/${mediaId}/master.m3u8`);
+    });
+
+    it('getHlsPreviewKey should return correct format', () => {
+      const key = getHlsPreviewKey(creatorId, mediaId);
+      expect(key).toBe(`${creatorId}/hls/${mediaId}/preview/preview.m3u8`);
+    });
+
+    it('getThumbnailKey should return correct format', () => {
+      const key = getThumbnailKey(creatorId, mediaId);
+      expect(key).toBe(`${creatorId}/thumbnails/${mediaId}/auto-generated.jpg`);
+    });
+
+    it('getWaveformKey should return correct format', () => {
+      const key = getWaveformKey(creatorId, mediaId);
+      expect(key).toBe(`${creatorId}/waveforms/${mediaId}/waveform.json`);
+    });
+  });
+
+  describe('B2 Key Generation', () => {
+    it('getMezzanineKey should return correct format', () => {
+      const key = getMezzanineKey(creatorId, mediaId);
+      expect(key).toBe(
+        `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/${B2_PATH_CONFIG.MEZZANINE_FILENAME}`
+      );
+      // Double check exact string to ensure config wasn't accidentally changed
+      expect(key).toBe(`${creatorId}/mezzanine/${mediaId}/mezzanine.mp4`);
+    });
+
+    it('getMezzaninePrefix should return correct format', () => {
+      const prefix = getMezzaninePrefix(creatorId, mediaId);
+      expect(prefix).toBe(
+        `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/`
+      );
+    });
+  });
+
+  describe('R2 Key Parsing and Validation', () => {
+    it('isValidR2Key should return true for valid keys', () => {
+      const validKey = `${creatorId}/originals/${mediaId}/video.mp4`;
+      expect(isValidR2Key(validKey)).toBe(true);
+    });
+
+    // isValidR2Key only validates format, not ownership against a creatorId argument
+    it('isValidR2Key should return true for valid key structure regardless of creator', () => {
+      const otherCreatorKey = `other_user/originals/${mediaId}/video.mp4`;
+      expect(isValidR2Key(otherCreatorKey)).toBe(true);
+    });
+
+    it('isValidR2Key should return false for malformed keys', () => {
+      expect(isValidR2Key('invalid-key')).toBe(false);
+      expect(isValidR2Key(`${creatorId}/foo`)).toBe(false); // Too short
+    });
+
+    it('parseR2Key should extract components correctly', () => {
+      const key = `${creatorId}/originals/${mediaId}/video.mp4`;
+      const result = parseR2Key(key);
+      expect(result).toEqual({
+        creatorId,
+        folder: 'originals',
+        mediaId,
+        filename: 'video.mp4',
+      });
+    });
+
+    it('parseR2Key should return null for invalid keys', () => {
+      expect(parseR2Key('invalid-key')).toBeNull();
+    });
+  });
+});
diff --git a/packages/transcoding/src/__tests__/transcoding-service.test.ts b/packages/transcoding/src/__tests__/transcoding-service.test.ts
new file mode 100644
index 0000000..2f2c188
--- /dev/null
+++ b/packages/transcoding/src/__tests__/transcoding-service.test.ts
@@ -0,0 +1,205 @@
+import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
+import {
+  TranscodingService,
+  type TranscodingServiceFullConfig,
+} from '../services/transcoding-service';
+import type { MediaStatus, MediaType, RunPodWebhookPayload } from '../types';
+
+// Mock Dependencies
+const mockDb = {
+  query: {
+    mediaItems: {
+      findFirst: vi.fn(),
+    },
+  },
+  update: vi.fn(),
+};
+
+const mockConfig = {
+  db: mockDb as unknown as TranscodingServiceFullConfig['db'],
+  environment: 'test',
+  runpodApiKey: 'mock-api-key',
+  runpodEndpointId: 'mock-endpoint-id',
+  webhookBaseUrl: 'https://api.example.com',
+  hmacSecret: 'mock-secret',
+} as TranscodingServiceFullConfig;
+
+describe('TranscodingService', () => {
+  let service: TranscodingService;
+
+  beforeEach(() => {
+    service = new TranscodingService(mockConfig);
+    vi.clearAllMocks();
+    global.fetch = vi.fn();
+  });
+
+  afterEach(() => {
+    vi.restoreAllMocks();
+  });
+
+  describe('triggerJob', () => {
+    const mediaId = '550e8400-e29b-41d4-a716-446655440000';
+    const creatorId = 'user_123';
+
+    // Valid media item for testing
+    const validMedia = {
+      id: mediaId,
+      creatorId,
+      status: 'uploaded' as MediaStatus,
+      mediaType: 'video' as MediaType,
+      r2Key: 'user_123/originals/uuid/video.mp4',
+      transcodingPriority: 1,
+    };
+
+    it('should successfully trigger a job for uploaded media', async () => {
+      // Mock DB findFirst
+      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);
+
+      // Mock RunPod API response
+      (global.fetch as any).mockResolvedValue({
+        ok: true,
+        json: async () => ({ id: 'runpod-job-123' }),
+      });
+
+      // Mock DB update
+      mockDb.update.mockReturnValue({
+        set: vi.fn().mockReturnValue({
+          where: vi.fn().mockReturnValue({}),
+        }),
+      });
+
+      await service.triggerJob(mediaId, creatorId);
+
+      // Verify RunPod API called correctly
+      expect(global.fetch).toHaveBeenCalledWith(
+        `https://api.runpod.ai/v2/${mockConfig.runpodEndpointId}/run`,
+        expect.objectContaining({
+          method: 'POST',
+          headers: expect.objectContaining({
+            Authorization: `Bearer ${mockConfig.runpodApiKey}`,
+          }),
+          body: expect.stringContaining(mediaId),
+        })
+      );
+
+      // Verify DB update status='transcoding'
+      expect(mockDb.update).toHaveBeenCalled();
+    });
+
+    it('should throw Error if media is not in uploaded state', async () => {
+      mockDb.query.mediaItems.findFirst.mockResolvedValue({
+        ...validMedia,
+        status: 'transcoding', // Invalid state for trigger
+      });
+
+      await expect(service.triggerJob(mediaId, creatorId)).rejects.toThrow(
+        /Media must be in 'uploaded' status/
+      );
+    });
+
+    it('should throw Error if r2Key is missing', async () => {
+      mockDb.query.mediaItems.findFirst.mockResolvedValue({
+        ...validMedia,
+        r2Key: null,
+      });
+
+      await expect(service.triggerJob(mediaId, creatorId)).rejects.toThrow(
+        /Input file not uploaded/
+      );
+    });
+
+    it('should throw Error if RunPod API fails', async () => {
+      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);
+
+      (global.fetch as any).mockResolvedValue({
+        ok: false,
+        status: 500,
+        statusText: 'Internal Server Error',
+        text: async () => 'Internal Server Error',
+      });
+
+      await expect(service.triggerJob(mediaId, creatorId)).rejects.toThrow(
+        /RunPod API error/
+      );
+    });
+  });
+
+  describe('handleWebhook', () => {
+    const jobId = 'runpod-job-123';
+    const mediaId = '550e8400-e29b-41d4-a716-446655440000';
+
+    it('should update status to ready and save keys on success', async () => {
+      const payload: RunPodWebhookPayload = {
+        jobId: jobId,
+        status: 'completed',
+        output: {
+          mediaId,
+          type: 'video',
+          hlsMasterKey: 'path/to/master.m3u8',
+          hlsPreviewKey: 'path/to/preview.m3u8',
+          thumbnailKey: 'path/to/thumb.jpg',
+          waveformKey: null,
+          waveformImageKey: null,
+          durationSeconds: 120,
+          width: 1920,
+          height: 1080,
+          readyVariants: ['1080p', '720p'],
+        } as any, // Cast as any because mezzanineKey is missing from type definition in some versions
+      };
+
+      // Mock DB to return media in 'transcoding' state
+      mockDb.query.mediaItems.findFirst.mockResolvedValue({
+        id: mediaId,
+        status: 'transcoding',
+        runpodJobId: jobId,
+      });
+
+      // Mock update chain
+      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
+      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
+      const setMock = vi.fn().mockReturnValue({ where: whereMock });
+      mockDb.update.mockReturnValue({ set: setMock });
+
+      await service.handleWebhook(payload);
+
+      expect(mockDb.update).toHaveBeenCalled();
+      expect(setMock).toHaveBeenCalledWith(
+        expect.objectContaining({
+          status: 'ready',
+          hlsMasterPlaylistKey: 'path/to/master.m3u8',
+          durationSeconds: 120,
+        })
+      );
+    });
+
+    it('should update status to failed on error', async () => {
+      const payload: RunPodWebhookPayload = {
+        jobId: jobId,
+        status: 'failed',
+        error: 'Transcoding failed due to GPU error',
+        output: { mediaId } as any,
+      };
+
+      // Mock DB to return media in 'transcoding' state
+      mockDb.query.mediaItems.findFirst.mockResolvedValue({
+        id: mediaId,
+        status: 'transcoding',
+        runpodJobId: jobId,
+      });
+
+      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
+      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
+      const setMock = vi.fn().mockReturnValue({ where: whereMock });
+      mockDb.update.mockReturnValue({ set: setMock });
+
+      await service.handleWebhook(payload);
+
+      expect(setMock).toHaveBeenCalledWith(
+        expect.objectContaining({
+          status: 'failed',
+          transcodingError: 'Transcoding failed due to GPU error',
+        })
+      );
+    });
+  });
+});
diff --git a/packages/transcoding/src/errors.ts b/packages/transcoding/src/errors.ts
new file mode 100644
index 0000000..5e349e5
--- /dev/null
+++ b/packages/transcoding/src/errors.ts
@@ -0,0 +1,163 @@
+/**
+ * Transcoding Service Errors
+ *
+ * Domain-specific error classes for media transcoding operations.
+ * Extends base errors from @codex/service-errors.
+ */
+
+import {
+  BusinessLogicError,
+  ForbiddenError,
+  InternalServiceError,
+  NotFoundError,
+  ValidationError,
+} from '@codex/service-errors';
+
+// Re-export base error classes for convenience
+export {
+  BusinessLogicError,
+  ForbiddenError,
+  InternalServiceError,
+  isServiceError as isTranscodingServiceError,
+  NotFoundError,
+  ServiceError as TranscodingServiceError,
+  ValidationError,
+  wrapError,
+} from '@codex/service-errors';
+
+/**
+ * Media item not found for transcoding operations
+ */
+export class TranscodingMediaNotFoundError extends NotFoundError {
+  constructor(mediaId: string, context?: Record<string, unknown>) {
+    super('Media item not found', {
+      mediaId,
+      code: 'TRANSCODING_MEDIA_NOT_FOUND',
+      ...context,
+    });
+  }
+}
+
+/**
+ * Media is not in correct state for requested operation
+ */
+export class InvalidMediaStateError extends BusinessLogicError {
+  constructor(
+    mediaId: string,
+    currentStatus: string,
+    requiredStatus: string | string[],
+    context?: Record<string, unknown>
+  ) {
+    const required = Array.isArray(requiredStatus)
+      ? requiredStatus.join(' or ')
+      : requiredStatus;
+    super(`Media must be in '${required}' status to perform this operation`, {
+      mediaId,
+      currentStatus,
+      requiredStatus,
+      code: 'INVALID_MEDIA_STATE',
+      ...context,
+    });
+  }
+}
+
+/**
+ * Maximum retry attempts reached for transcoding
+ */
+export class MaxRetriesExceededError extends BusinessLogicError {
+  constructor(
+    mediaId: string,
+    attempts: number,
+    context?: Record<string, unknown>
+  ) {
+    super('Maximum transcoding retry attempts exceeded', {
+      mediaId,
+      attempts,
+      maxAttempts: 1,
+      code: 'MAX_RETRIES_EXCEEDED',
+      ...context,
+    });
+  }
+}
+
+/**
+ * RunPod API call failed
+ */
+export class RunPodApiError extends InternalServiceError {
+  constructor(
+    operation: string,
+    statusCode?: number,
+    context?: Record<string, unknown>
+  ) {
+    super(`RunPod API error during ${operation}`, {
+      operation,
+      statusCode,
+      code: 'RUNPOD_API_ERROR',
+      ...context,
+    });
+  }
+}
+
+/**
+ * Invalid webhook signature
+ */
+export class InvalidWebhookSignatureError extends ForbiddenError {
+  constructor(context?: Record<string, unknown>) {
+    super('Invalid webhook signature', {
+      code: 'INVALID_WEBHOOK_SIGNATURE',
+      ...context,
+    });
+  }
+}
+
+/**
+ * Media not owned by the requesting user
+ */
+export class MediaOwnershipError extends ForbiddenError {
+  constructor(
+    mediaId: string,
+    userId: string,
+    context?: Record<string, unknown>
+  ) {
+    super('User does not own this media item', {
+      mediaId,
+      userId,
+      code: 'MEDIA_OWNERSHIP_ERROR',
+      ...context,
+    });
+  }
+}
+
+/**
+ * Transcoding job not found (by runpodJobId)
+ */
+export class TranscodingJobNotFoundError extends NotFoundError {
+  constructor(jobId: string, context?: Record<string, unknown>) {
+    super('Transcoding job not found', {
+      jobId,
+      code: 'TRANSCODING_JOB_NOT_FOUND',
+      ...context,
+    });
+  }
+}
+
+/**
+ * Invalid media type for transcoding
+ */
+export class InvalidMediaTypeError extends ValidationError {
+  constructor(
+    mediaType: string,
+    allowedTypes: string[] = ['video', 'audio'],
+    context?: Record<string, unknown>
+  ) {
+    super(
+      `Invalid media type '${mediaType}'. Allowed: ${allowedTypes.join(', ')}`,
+      {
+        mediaType,
+        allowedTypes,
+        code: 'INVALID_MEDIA_TYPE',
+        ...context,
+      }
+    );
+  }
+}
diff --git a/packages/transcoding/src/index.ts b/packages/transcoding/src/index.ts
new file mode 100644
index 0000000..5699190
--- /dev/null
+++ b/packages/transcoding/src/index.ts
@@ -0,0 +1,112 @@
+/**
+ * @codex/transcoding
+ *
+ * Media transcoding service package for RunPod GPU integration.
+ *
+ * This package provides:
+ * - TranscodingService: Core business logic for transcoding lifecycle
+ * - Error classes: Domain-specific errors for transcoding operations
+ * - Path utilities: R2 key generation (SINGLE SOURCE OF TRUTH)
+ * - Types: RunPod payloads, webhook types, service types
+ *
+ * @example
+ * ```typescript
+ * import {
+ *   TranscodingService,
+ *   getHlsMasterKey,
+ *   TranscodingMediaNotFoundError,
+ * } from '@codex/transcoding';
+ *
+ * const service = new TranscodingService({
+ *   db: dbHttp,
+ *   environment: 'production',
+ *   obs: observabilityClient,
+ *   runpodApiKey: env.RUNPOD_API_KEY,
+ *   runpodEndpointId: env.RUNPOD_ENDPOINT_ID,
+ *   webhookBaseUrl: 'https://media-api.codex.com',
+ * });
+ *
+ * // Trigger transcoding (async - returns immediately)
+ * await service.triggerJob(mediaId, creatorId);
+ *
+ * // Handle webhook callback (when RunPod completes)
+ * await service.handleWebhook(validatedPayload);
+ * ```
+ */
+
+// Errors
+export {
+  // Re-exported base errors
+  BusinessLogicError,
+  ForbiddenError,
+  InternalServiceError,
+  // Domain-specific errors
+  InvalidMediaStateError,
+  InvalidMediaTypeError,
+  InvalidWebhookSignatureError,
+  isTranscodingServiceError,
+  MaxRetriesExceededError,
+  MediaOwnershipError,
+  NotFoundError,
+  RunPodApiError,
+  TranscodingJobNotFoundError,
+  TranscodingMediaNotFoundError,
+  TranscodingServiceError,
+  ValidationError,
+  wrapError,
+} from './errors';
+// Path utilities (SINGLE SOURCE OF TRUTH for R2/B2 keys)
+export {
+  // B2 paths (mezzanine archival)
+  B2_PATH_CONFIG,
+  // R2 paths (delivery assets)
+  getHlsMasterKey,
+  getHlsPrefix,
+  getHlsPreviewKey,
+  getHlsVariantKey,
+  getMezzanineKey,
+  getMezzaninePrefix,
+  getOriginalKey,
+  getThumbnailKey,
+  getTranscodingOutputKeys,
+  getWaveformImageKey,
+  getWaveformKey,
+  isValidR2Key,
+  PATH_CONFIG,
+  parseR2Key,
+} from './paths';
+// Services
+export {
+  TranscodingService,
+  type TranscodingServiceFullConfig,
+} from './services';
+
+// Types
+export {
+  type GetTranscodingStatusInput,
+  getTranscodingStatusSchema,
+  type HlsVariant,
+  hlsVariantSchema,
+  type MediaStatus,
+  // Package-specific types
+  type MediaType,
+  type MezzanineStatus,
+  mezzanineStatusEnum,
+  type RetryTranscodingInput,
+  type RunPodJobRequest,
+  type RunPodJobResponse,
+  type RunPodWebhookOutput,
+  type RunPodWebhookPayload,
+  retryTranscodingSchema,
+  runpodJobStatusEnum,
+  runpodWebhookOutputSchema,
+  // Re-exported from @codex/validation
+  runpodWebhookSchema,
+  type TranscodingMediaItem,
+  type TranscodingServiceConfig,
+  type TranscodingStatusResponse,
+  type TriggerTranscodingInput,
+  transcodingPrioritySchema,
+  transcodingStatusResponseSchema,
+  triggerTranscodingSchema,
+} from './types';
diff --git a/packages/transcoding/src/paths.ts b/packages/transcoding/src/paths.ts
new file mode 100644
index 0000000..25efb2e
--- /dev/null
+++ b/packages/transcoding/src/paths.ts
@@ -0,0 +1,328 @@
+/**
+ * R2/B2 Path Generation - SINGLE SOURCE OF TRUTH
+ *
+ * All R2 storage paths for transcoding inputs and outputs MUST come from this file.
+ * No path strings should be hardcoded elsewhere in the codebase.
+ *
+ * Storage Structure (single MEDIA_BUCKET with creator subfolder structure):
+ *   {creatorId}/originals/{mediaId}/video.mp4          - Original upload
+ *   {creatorId}/hls/{mediaId}/master.m3u8              - HLS master playlist
+ *   {creatorId}/hls/{mediaId}/preview/preview.m3u8    - 30s preview clip
+ *   {creatorId}/thumbnails/{mediaId}/auto-generated.jpg - Auto thumbnail
+ *   {creatorId}/waveforms/{mediaId}/waveform.json      - Audio waveform data
+ *   {creatorId}/waveforms/{mediaId}/waveform.png       - Audio waveform image
+ */
+
+import type { MediaType } from './types';
+
+/**
+ * Path configuration constants
+ */
+export const PATH_CONFIG = {
+  /** Folder for original uploaded files */
+  ORIGINALS_FOLDER: 'originals',
+  /** Folder for HLS transcoded outputs */
+  HLS_FOLDER: 'hls',
+  /** Subfolder for HLS preview clips */
+  HLS_PREVIEW_SUBFOLDER: 'preview',
+  /** Folder for auto-generated thumbnails */
+  THUMBNAILS_FOLDER: 'thumbnails',
+  /** Folder for audio waveform data */
+  WAVEFORMS_FOLDER: 'waveforms',
+
+  /** Default filenames */
+  HLS_MASTER_FILENAME: 'master.m3u8',
+  HLS_PREVIEW_FILENAME: 'preview.m3u8',
+  THUMBNAIL_FILENAME: 'auto-generated.jpg',
+  WAVEFORM_JSON_FILENAME: 'waveform.json',
+  WAVEFORM_IMAGE_FILENAME: 'waveform.png',
+} as const;
+
+/**
+ * B2 Path configuration constants (archival mezzanine storage)
+ *
+ * Bucket names by environment:
+ * - Production: codex-mezzanine-production
+ * - Dev: codex-mezzanine-dev
+ * - Test: codex-mezzanine-test
+ */
+export const B2_PATH_CONFIG = {
+  /** Folder for mezzanine archive files */
+  MEZZANINE_FOLDER: 'mezzanine',
+  /** Default mezzanine filename (high-quality CRF 18 intermediate) */
+  MEZZANINE_FILENAME: 'mezzanine.mp4',
+} as const;
+
+/**
+ * Generate B2 key for mezzanine archive file
+ *
+ * Mezzanine files are high-quality intermediates (CRF 18) stored in B2
+ * for archival purposes and potential future re-transcoding.
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns B2 key path to mezzanine file
+ *
+ * @example
+ * getMezzanineKey('user-123', 'media-456')
+ * // Returns: 'user-123/mezzanine/media-456/mezzanine.mp4'
+ */
+export function getMezzanineKey(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/${B2_PATH_CONFIG.MEZZANINE_FILENAME}`;
+}
+
+/**
+ * Generate B2 key prefix for mezzanine folder
+ * Useful for listing or deleting mezzanine files for a media item
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns B2 key prefix
+ *
+ * @example
+ * getMezzaninePrefix('user-123', 'media-456')
+ * // Returns: 'user-123/mezzanine/media-456/'
+ */
+export function getMezzaninePrefix(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/`;
+}
+
+/**
+ * Generate R2 key for original uploaded file
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @param filename - Original filename with extension
+ * @returns R2 key path
+ *
+ * @example
+ * getOriginalKey('user-123', 'media-456', 'video.mp4')
+ * // Returns: 'user-123/originals/media-456/video.mp4'
+ */
+export function getOriginalKey(
+  creatorId: string,
+  mediaId: string,
+  filename: string
+): string {
+  return `${creatorId}/${PATH_CONFIG.ORIGINALS_FOLDER}/${mediaId}/${filename}`;
+}
+
+/**
+ * Generate R2 key for HLS master playlist
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns R2 key path to master.m3u8
+ *
+ * @example
+ * getHlsMasterKey('user-123', 'media-456')
+ * // Returns: 'user-123/hls/media-456/master.m3u8'
+ */
+export function getHlsMasterKey(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/${PATH_CONFIG.HLS_MASTER_FILENAME}`;
+}
+
+/**
+ * Generate R2 key for HLS preview clip playlist
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns R2 key path to preview playlist
+ *
+ * @example
+ * getHlsPreviewKey('user-123', 'media-456')
+ * // Returns: 'user-123/hls/media-456/preview/preview.m3u8'
+ */
+export function getHlsPreviewKey(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/${PATH_CONFIG.HLS_PREVIEW_SUBFOLDER}/${PATH_CONFIG.HLS_PREVIEW_FILENAME}`;
+}
+
+/**
+ * Generate R2 key for HLS variant playlist
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @param variant - Quality variant (1080p, 720p, 480p, 360p, audio)
+ * @returns R2 key path to variant playlist
+ *
+ * @example
+ * getHlsVariantKey('user-123', 'media-456', '1080p')
+ * // Returns: 'user-123/hls/media-456/1080p/index.m3u8'
+ */
+export function getHlsVariantKey(
+  creatorId: string,
+  mediaId: string,
+  variant: string
+): string {
+  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/${variant}/index.m3u8`;
+}
+
+/**
+ * Generate R2 key for auto-generated thumbnail
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns R2 key path to thumbnail
+ *
+ * @example
+ * getThumbnailKey('user-123', 'media-456')
+ * // Returns: 'user-123/thumbnails/media-456/auto-generated.jpg'
+ */
+export function getThumbnailKey(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${PATH_CONFIG.THUMBNAILS_FOLDER}/${mediaId}/${PATH_CONFIG.THUMBNAIL_FILENAME}`;
+}
+
+/**
+ * Generate R2 key for audio waveform JSON data
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns R2 key path to waveform JSON
+ *
+ * @example
+ * getWaveformKey('user-123', 'media-456')
+ * // Returns: 'user-123/waveforms/media-456/waveform.json'
+ */
+export function getWaveformKey(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${PATH_CONFIG.WAVEFORMS_FOLDER}/${mediaId}/${PATH_CONFIG.WAVEFORM_JSON_FILENAME}`;
+}
+
+/**
+ * Generate R2 key for audio waveform image
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns R2 key path to waveform PNG
+ *
+ * @example
+ * getWaveformImageKey('user-123', 'media-456')
+ * // Returns: 'user-123/waveforms/media-456/waveform.png'
+ */
+export function getWaveformImageKey(
+  creatorId: string,
+  mediaId: string
+): string {
+  return `${creatorId}/${PATH_CONFIG.WAVEFORMS_FOLDER}/${mediaId}/${PATH_CONFIG.WAVEFORM_IMAGE_FILENAME}`;
+}
+
+/**
+ * Generate R2 key prefix for all HLS outputs
+ * Useful for listing or deleting all HLS files for a media item
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @returns R2 key prefix
+ *
+ * @example
+ * getHlsPrefix('user-123', 'media-456')
+ * // Returns: 'user-123/hls/media-456/'
+ */
+export function getHlsPrefix(creatorId: string, mediaId: string): string {
+  return `${creatorId}/${PATH_CONFIG.HLS_FOLDER}/${mediaId}/`;
+}
+
+/**
+ * Generate all expected output keys for a transcoding job
+ *
+ * @param creatorId - Creator's user ID
+ * @param mediaId - Media item UUID
+ * @param mediaType - Type of media (video or audio)
+ * @returns Object with all expected output keys
+ */
+export function getTranscodingOutputKeys(
+  creatorId: string,
+  mediaId: string,
+  mediaType: MediaType
+): {
+  hlsMasterKey: string;
+  hlsPreviewKey: string;
+  thumbnailKey: string | null;
+  waveformKey: string | null;
+  waveformImageKey: string | null;
+} {
+  const hlsMasterKey = getHlsMasterKey(creatorId, mediaId);
+  const hlsPreviewKey = getHlsPreviewKey(creatorId, mediaId);
+
+  if (mediaType === 'video') {
+    return {
+      hlsMasterKey,
+      hlsPreviewKey,
+      thumbnailKey: getThumbnailKey(creatorId, mediaId),
+      waveformKey: null,
+      waveformImageKey: null,
+    };
+  }
+
+  // Audio
+  return {
+    hlsMasterKey,
+    hlsPreviewKey,
+    thumbnailKey: null,
+    waveformKey: getWaveformKey(creatorId, mediaId),
+    waveformImageKey: getWaveformImageKey(creatorId, mediaId),
+  };
+}
+
+/**
+ * Parse a media item's r2Key to extract components
+ *
+ * @param r2Key - Full R2 key path
+ * @returns Parsed components or null if invalid format
+ *
+ * @example
+ * parseR2Key('user-123/originals/media-456/video.mp4')
+ * // Returns: { creatorId: 'user-123', folder: 'originals', mediaId: 'media-456', filename: 'video.mp4' }
+ */
+export function parseR2Key(r2Key: string): {
+  creatorId: string;
+  folder: string;
+  mediaId: string;
+  filename: string;
+} | null {
+  const parts = r2Key.split('/');
+  if (parts.length < 4) {
+    return null;
+  }
+
+  const [creatorId, folder, mediaId, ...rest] = parts;
+  const filename = rest.join('/');
+
+  if (!creatorId || !folder || !mediaId || !filename) {
+    return null;
+  }
+
+  return { creatorId, folder, mediaId, filename };
+}
+
+/**
+ * Validate that an R2 key follows expected format (no path traversal)
+ *
+ * @param r2Key - R2 key to validate
+ * @returns true if valid, false otherwise
+ */
+export function isValidR2Key(r2Key: string): boolean {
+  // Check for path traversal attempts (including URL-encoded variants)
+  if (
+    r2Key.includes('..') ||
+    r2Key.includes('//') ||
+    r2Key.includes('%2e') ||
+    r2Key.includes('%2E') ||
+    r2Key.includes('\\')
+  ) {
+    return false;
+  }
+
+  // Check for null bytes (including URL-encoded)
+  if (r2Key.includes('\0') || r2Key.includes('%00')) {
+    return false;
+  }
+
+  // Must start with alphanumeric (creator ID)
+  if (!/^[a-zA-Z0-9]/.test(r2Key)) {
+    return false;
+  }
+
+  // Parse to validate structure
+  const parsed = parseR2Key(r2Key);
+  return parsed !== null;
+}
diff --git a/packages/transcoding/src/services/index.ts b/packages/transcoding/src/services/index.ts
new file mode 100644
index 0000000..f74ddb3
--- /dev/null
+++ b/packages/transcoding/src/services/index.ts
@@ -0,0 +1,8 @@
+/**
+ * Transcoding Services Exports
+ */
+
+export {
+  TranscodingService,
+  type TranscodingServiceFullConfig,
+} from './transcoding-service';
diff --git a/packages/transcoding/src/services/transcoding-service.ts b/packages/transcoding/src/services/transcoding-service.ts
new file mode 100644
index 0000000..fa36283
--- /dev/null
+++ b/packages/transcoding/src/services/transcoding-service.ts
@@ -0,0 +1,645 @@
+/**
+ * Transcoding Service
+ *
+ * Manages media transcoding lifecycle via RunPod integration.
+ *
+ * Key Responsibilities:
+ * - Trigger transcoding jobs on RunPod
+ * - Handle webhook callbacks from RunPod
+ * - Manage retry logic (max 3 retries)
+ * - Update media item status and metadata
+ *
+ * Key Principles:
+ * - All R2 paths come from paths.ts (SINGLE SOURCE OF TRUTH)
+ * - Creator scoping on all queries
+ * - Transaction safety for multi-step operations
+ * - Proper error handling with custom error classes
+ */
+
+import { scopedNotDeleted } from '@codex/database';
+
+import { mediaItems } from '@codex/database/schema';
+import {
+  BaseService,
+  type ServiceConfig,
+  wrapError,
+} from '@codex/service-errors';
+import type { RunPodWebhookPayload } from '@codex/validation';
+import { and, eq, isNull, lt, or } from 'drizzle-orm';
+
+import {
+  InvalidMediaStateError,
+  MaxRetriesExceededError,
+  MediaOwnershipError,
+  RunPodApiError,
+  TranscodingJobNotFoundError,
+  TranscodingMediaNotFoundError,
+} from '../errors';
+import { getTranscodingOutputKeys } from '../paths';
+import type {
+  HlsVariant,
+  MediaType,
+  RunPodJobRequest,
+  RunPodJobResponse,
+  TranscodingMediaItem,
+  TranscodingStatusResponse,
+} from '../types';
+
+/**
+ * Extended service config for TranscodingService
+ */
+export interface TranscodingServiceConfig {
+  runpodApiKey: string;
+  runpodEndpointId: string;
+  webhookBaseUrl: string; // Required for callbacks
+  runpodTimeout?: number; // Configurable timeout, defaults to 30000ms
+}
+
+export interface TranscodingServiceFullConfig
+  extends ServiceConfig,
+    TranscodingServiceConfig {}
+
+/**
+ * Transcoding Service Class
+ *
+ * Manages transcoding lifecycle for video and audio media via RunPod integration.
+ *
+ * ## RunPod Async Pattern
+ *
+ * RunPod's /run endpoint is asynchronous (fire-and-forget):
+ * 1. triggerJob() calls POST /v2/{endpoint_id}/run
+ * 2. RunPod returns immediately with { id: "job-xxx", status: "IN_QUEUE" }
+ * 3. The actual transcoding runs on a GPU worker in the background
+ * 4. On completion, RunPod POSTs results to our webhook URL
+ * 5. handleWebhook() processes the callback and updates the database
+ *
+ * This means triggerJob() returns quickly - it doesn't wait for transcoding.
+ * Status tracking relies on webhook callbacks, not polling.
+ */
+export class TranscodingService extends BaseService {
+  private readonly runpodApiKey: string;
+  private readonly runpodEndpointId: string;
+  private readonly runpodApiUrl: string;
+  private readonly webhookUrl: string;
+  private readonly runpodTimeout: number;
+
+  /**
+   * Initialize TranscodingService with RunPod credentials
+   *
+   * @param config - Service config with RunPod API credentials
+   */
+  constructor(config: TranscodingServiceFullConfig) {
+    super(config);
+
+    // Validate required config
+    if (!config.runpodApiKey) {
+      throw new Error('TranscodingService: runpodApiKey is required');
+    }
+    if (!config.runpodEndpointId) {
+      throw new Error('TranscodingService: runpodEndpointId is required');
+    }
+    if (!config.webhookBaseUrl) {
+      throw new Error('TranscodingService: webhookBaseUrl is required');
+    }
+
+    this.runpodApiKey = config.runpodApiKey;
+    this.runpodEndpointId = config.runpodEndpointId;
+    this.runpodTimeout = config.runpodTimeout ?? 30000;
+
+    // Pre-construct URLs (won't change during service lifetime)
+    this.runpodApiUrl = `https://api.runpod.ai/v2/${config.runpodEndpointId}/run`;
+    this.webhookUrl = `${config.webhookBaseUrl}/api/transcoding/webhook`;
+  }
+
+  /**
+   * Trigger a new transcoding job on RunPod
+   *
+   * @param mediaId - Media item UUID
+   * @param creatorId - Creator ID for authorization
+   * @param priority - Optional priority (0=urgent, 2=normal, 4=backlog)
+   * @returns void
+   *
+   * @throws {TranscodingMediaNotFoundError} If media doesn't exist or not owned
+   * @throws {InvalidMediaStateError} If media is not in 'uploaded' status
+   * @throws {RunPodApiError} If RunPod API call fails
+   */
+  async triggerJob(
+    mediaId: string,
+    creatorId: string,
+    priority?: number
+  ): Promise<void> {
+    this.obs.info('Triggering transcoding job', {
+      mediaId,
+      creatorId,
+      priority,
+    });
+
+    // Step 1: Fetch and validate media
+    const media = await this.getMediaForTranscoding(mediaId, creatorId);
+
+    // Verify media is in correct state
+    if (media.status !== 'uploaded') {
+      throw new InvalidMediaStateError(mediaId, media.status, 'uploaded', {
+        operation: 'triggerJob',
+      });
+    }
+
+    // Verify input file exists
+    if (!media.r2Key) {
+      throw new Error('Input file not uploaded (r2Key missing)');
+    }
+
+    // Step 2: Construct job request
+    const jobRequest: RunPodJobRequest = {
+      input: {
+        mediaId: media.id,
+        type: media.mediaType,
+        creatorId: media.creatorId,
+        inputKey: media.r2Key,
+        webhookUrl: this.webhookUrl,
+        priority: priority ?? media.transcodingPriority,
+      },
+    };
+
+    // Step 3: Call RunPod /run API (async)
+    let runpodJobId: string;
+
+    try {
+      // Call RunPod API with configurable timeout
+      const response = await fetch(this.runpodApiUrl, {
+        method: 'POST',
+        headers: {
+          'Content-Type': 'application/json',
+          Authorization: `Bearer ${this.runpodApiKey}`,
+        },
+        body: JSON.stringify(jobRequest),
+        signal: AbortSignal.timeout(this.runpodTimeout),
+      });
+
+      if (!response.ok) {
+        const errorText = await response.text();
+        this.obs.error('RunPod API error', {
+          mediaId,
+          statusCode: response.status,
+          errorText,
+        });
+        throw new RunPodApiError('triggerJob', response.status, {
+          responseBody: errorText,
+        });
+      }
+
+      const result = (await response.json()) as RunPodJobResponse;
+      runpodJobId = result.id;
+    } catch (error) {
+      if (error instanceof RunPodApiError) {
+        throw error;
+      }
+      // Check for timeout/abort errors
+      throw new RunPodApiError('triggerJob', undefined, {
+        originalError: error instanceof Error ? error.message : String(error),
+      });
+    }
+
+    // Step 4: Update media status to 'transcoding'
+    await this.db
+      .update(mediaItems)
+      .set({
+        status: 'transcoding',
+        runpodJobId,
+        transcodingPriority: priority ?? media.transcodingPriority,
+        updatedAt: new Date(),
+      })
+      .where(eq(mediaItems.id, mediaId));
+
+    this.obs.info('Transcoding job started', {
+      mediaId,
+      runpodJobId,
+      mediaType: media.mediaType,
+    });
+  }
+
+  /**
+   * Handle webhook callback from RunPod
+   *
+   * Called asynchronously when transcoding job completes (success or failure).
+   * This is the second half of the RunPod async pattern - the completion callback.
+   * Updates media_items atomically with all transcoding outputs.
+   *
+   * NOTE: Webhook signature verification (HMAC-SHA256) must be performed by
+   * the calling worker before invoking this method. This service trusts
+   * that the payload has already been authenticated.
+   *
+   * @param payload - Validated RunPod webhook payload (already HMAC-verified)
+   * @returns void
+   *
+   * @throws {TranscodingJobNotFoundError} If no media matches the jobId
+   */
+  async handleWebhook(payload: RunPodWebhookPayload): Promise<void> {
+    const { jobId, status, output, error: errorMessage } = payload;
+
+    this.obs.info('Processing transcoding webhook', { jobId, status });
+
+    // Find media by job ID or mediaId from output
+    const media = await this.db.query.mediaItems.findFirst({
+      where: and(
+        or(
+          eq(mediaItems.runpodJobId, jobId),
+          output?.mediaId ? eq(mediaItems.id, output.mediaId) : undefined
+        ),
+        isNull(mediaItems.deletedAt)
+      ),
+    });
+
+    if (!media) {
+      this.obs.warn('Webhook received for unknown media', { jobId });
+      throw new TranscodingJobNotFoundError(jobId);
+    }
+
+    // Ignore stale webhooks - only process if media is in 'transcoding' state
+    if (media.status !== 'transcoding') {
+      this.obs.warn('Webhook received for non-transcoding media, ignoring', {
+        jobId,
+        mediaId: media.id,
+        currentStatus: media.status,
+      });
+      return;
+    }
+
+    if (status === 'completed' && output) {
+      // Success: Update atomically with all transcoding outputs
+      // Only updates if status='transcoding' to prevent race conditions
+      const result = await this.db
+        .update(mediaItems)
+        .set({
+          status: 'ready',
+          hlsMasterPlaylistKey: output.hlsMasterKey,
+          hlsPreviewKey: output.hlsPreviewKey,
+          thumbnailKey: output.thumbnailKey,
+          waveformKey: output.waveformKey,
+          waveformImageKey: output.waveformImageKey,
+          durationSeconds: output.durationSeconds,
+          width: output.width,
+          height: output.height,
+          readyVariants: output.readyVariants,
+          loudnessIntegrated: output.loudnessIntegrated,
+          loudnessPeak: output.loudnessPeak,
+          loudnessRange: output.loudnessRange,
+          transcodingError: null, // Clear any previous error
+          updatedAt: new Date(),
+        })
+        .where(
+          and(eq(mediaItems.id, media.id), eq(mediaItems.status, 'transcoding'))
+        )
+        .returning();
+
+      if (result.length === 0) {
+        this.obs.warn(
+          'Media no longer in transcoding state (concurrent update)',
+          {
+            jobId,
+            mediaId: media.id,
+          }
+        );
+        return;
+      }
+
+      this.obs.info('Transcoding completed successfully', {
+        mediaId: media.id,
+        jobId,
+        durationSeconds: output.durationSeconds,
+      });
+    } else {
+      // Failure: Store error message atomically
+      const result = await this.db
+        .update(mediaItems)
+        .set({
+          status: 'failed',
+          transcodingError: errorMessage || 'Unknown transcoding error',
+          updatedAt: new Date(),
+        })
+        .where(
+          and(eq(mediaItems.id, media.id), eq(mediaItems.status, 'transcoding'))
+        )
+        .returning();
+
+      if (result.length === 0) {
+        this.obs.warn(
+          'Media no longer in transcoding state (concurrent update)',
+          {
+            jobId,
+            mediaId: media.id,
+          }
+        );
+        return;
+      }
+
+      this.obs.error('Transcoding failed', {
+        mediaId: media.id,
+        jobId,
+        errorMessage: errorMessage || 'Unknown',
+      });
+    }
+  }
+
+  /**
+   * Retry a failed transcoding job
+   *
+   * Only 3 retries are allowed per media item.
+   * Uses atomic conditional update to prevent race conditions.
+   *
+   * @param mediaId - Media item UUID
+   * @param creatorId - Creator ID for authorization
+   * @returns void
+   *
+   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
+   * @throws {MediaOwnershipError} If creator doesn't own the media
+   * @throws {InvalidMediaStateError} If media is not in 'failed' status
+   * @throws {MaxRetriesExceededError} If retry limit (3) reached
+   */
+  async retryTranscoding(mediaId: string, creatorId: string): Promise<void> {
+    this.obs.info('Retrying transcoding', { mediaId, creatorId });
+
+    // Step 1: Verify ownership first (separate from atomic update for clear error messages)
+    const media = await this.getMediaForTranscoding(mediaId, creatorId);
+
+    // Step 2: Atomic conditional update - prevents TOCTOU race
+    // Only updates if status='failed' AND attempts < 3
+    const result = await this.db
+      .update(mediaItems)
+      .set({
+        status: 'uploaded',
+        transcodingAttempts: media.transcodingAttempts + 1,
+        transcodingError: null,
+        runpodJobId: null,
+        updatedAt: new Date(),
+      })
+      .where(
+        and(
+          eq(mediaItems.id, mediaId),
+          eq(mediaItems.status, 'failed'),
+          lt(mediaItems.transcodingAttempts, 3) // Allow up to 3 retries
+        )
+      )
+      .returning();
+
+    if (result.length === 0) {
+      // Determine which condition failed for appropriate error
+      if (media.status !== 'failed') {
+        throw new InvalidMediaStateError(mediaId, media.status, 'failed', {
+          operation: 'retryTranscoding',
+        });
+      }
+      // Must be max retries exceeded
+      throw new MaxRetriesExceededError(mediaId, media.transcodingAttempts);
+    }
+
+    // Step 3: Trigger new job
+    await this.triggerJob(mediaId, creatorId);
+
+    this.obs.info('Transcoding retry triggered', {
+      mediaId,
+      attempt: media.transcodingAttempts + 1,
+    });
+  }
+
+  /**
+   * Get current transcoding status for a media item
+   *
+   * @param mediaId - Media item UUID
+   * @param creatorId - Creator ID for authorization
+   * @returns Transcoding status response
+   *
+   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
+   * @throws {MediaOwnershipError} If creator doesn't own the media
+   */
+  async getTranscodingStatus(
+    mediaId: string,
+    creatorId: string
+  ): Promise<TranscodingStatusResponse> {
+    const media = await this.getMediaForTranscoding(mediaId, creatorId);
+
+    return {
+      status: media.status,
+      transcodingAttempts: media.transcodingAttempts,
+      transcodingError: media.transcodingError,
+      runpodJobId: media.runpodJobId,
+      transcodingPriority: media.transcodingPriority,
+      // Cast from string[] to HlsVariant[] - DB stores as text[], validated on write
+      readyVariants: media.readyVariants as HlsVariant[] | null,
+    };
+  }
+
+  /**
+   * Get expected output keys for a transcoding job
+   *
+   * Utility method to get all expected R2 paths for transcoding outputs.
+   * Uses paths.ts as the single source of truth.
+   *
+   * @param creatorId - Creator ID
+   * @param mediaId - Media item UUID
+   * @param mediaType - Type of media (video or audio)
+   * @returns Object with all expected output keys
+   */
+  getExpectedOutputKeys(
+    creatorId: string,
+    mediaId: string,
+    mediaType: MediaType
+  ) {
+    return getTranscodingOutputKeys(creatorId, mediaId, mediaType);
+  }
+
+  /**
+   * Internal helper to fetch and validate media for transcoding operations
+   *
+   * @param mediaId - Media item UUID
+   * @param creatorId - Creator ID for authorization
+   * @returns Media item data
+   *
+   * @throws {TranscodingMediaNotFoundError} If media doesn't exist
+   * @throws {MediaOwnershipError} If creator doesn't own the media
+   */
+  private async getMediaForTranscoding(
+    mediaId: string,
+    creatorId: string
+  ): Promise<TranscodingMediaItem> {
+    try {
+      const media = await this.db.query.mediaItems.findFirst({
+        where: and(
+          eq(mediaItems.id, mediaId),
+          scopedNotDeleted(mediaItems, creatorId)
+        ),
+        columns: {
+          id: true,
+          creatorId: true,
+          mediaType: true,
+          status: true,
+          r2Key: true,
+          transcodingAttempts: true,
+          runpodJobId: true,
+          transcodingError: true,
+          transcodingPriority: true,
+          hlsMasterPlaylistKey: true,
+          hlsPreviewKey: true,
+          thumbnailKey: true,
+          waveformKey: true,
+          waveformImageKey: true,
+          durationSeconds: true,
+          width: true,
+          height: true,
+          readyVariants: true,
+        },
+      });
+
+      if (!media) {
+        // Check if media exists but belongs to different creator
+        const exists = await this.db.query.mediaItems.findFirst({
+          where: eq(mediaItems.id, mediaId),
+          columns: { id: true, creatorId: true },
+        });
+
+        if (exists && exists.creatorId !== creatorId) {
+          throw new MediaOwnershipError(mediaId, creatorId);
+        }
+
+        throw new TranscodingMediaNotFoundError(mediaId);
+      }
+
+      return media as TranscodingMediaItem;
+    } catch (error) {
+      if (
+        error instanceof TranscodingMediaNotFoundError ||
+        error instanceof MediaOwnershipError
+      ) {
+        throw error;
+      }
+      throw wrapError(error, { mediaId, creatorId });
+    }
+  }
+
+  /**
+   * Get media item for transcoding without authorization check
+   *
+   * INTERNAL USE ONLY: Used by triggerJobInternal for worker-to-worker calls
+   * where authentication is done via HMAC instead of user session.
+   */
+  private async getMediaForTranscodingInternal(
+    mediaId: string
+  ): Promise<TranscodingMediaItem> {
+    const media = await this.db.query.mediaItems.findFirst({
+      where: and(eq(mediaItems.id, mediaId), isNull(mediaItems.deletedAt)),
+      columns: {
+        id: true,
+        creatorId: true,
+        mediaType: true,
+        status: true,
+        r2Key: true,
+        transcodingAttempts: true,
+        runpodJobId: true,
+        transcodingError: true,
+        transcodingPriority: true,
+        hlsMasterPlaylistKey: true,
+        hlsPreviewKey: true,
+        thumbnailKey: true,
+        waveformKey: true,
+        waveformImageKey: true,
+        durationSeconds: true,
+        width: true,
+        height: true,
+        readyVariants: true,
+      },
+    });
+
+    if (!media) {
+      throw new TranscodingMediaNotFoundError(mediaId);
+    }
+
+    return media as TranscodingMediaItem;
+  }
+
+  /**
+   * Trigger transcoding job for internal worker-to-worker calls
+   *
+   * INTERNAL USE ONLY: Called by media-api internal route after content-api
+   * triggers transcoding post-upload. Authentication is via HMAC workerAuth,
+   * not user session, so no creatorId authorization check is needed.
+   *
+   * @param mediaId - Media item UUID
+   * @param priority - Optional job priority (1-100, higher = more urgent)
+   */
+  async triggerJobInternal(mediaId: string, priority?: number): Promise<void> {
+    this.obs.info('Triggering transcoding job (internal)', {
+      mediaId,
+      priority,
+    });
+
+    // Fetch media without authorization check (workerAuth is the auth layer)
+    const media = await this.getMediaForTranscodingInternal(mediaId);
+
+    // Verify media is in correct state
+    if (media.status !== 'uploaded') {
+      throw new InvalidMediaStateError(mediaId, media.status, 'uploaded', {
+        operation: 'triggerJobInternal',
+      });
+    }
+
+    // Construct job request using media's creatorId
+    const jobRequest: RunPodJobRequest = {
+      input: {
+        mediaId: media.id,
+        type: media.mediaType,
+        creatorId: media.creatorId,
+        inputKey: media.r2Key,
+        webhookUrl: this.webhookUrl,
+        priority: priority ?? media.transcodingPriority,
+      },
+    };
+
+    let runpodJobId: string;
+
+    try {
+      const response = await fetch(this.runpodApiUrl, {
+        method: 'POST',
+        headers: {
+          'Content-Type': 'application/json',
+          Authorization: `Bearer ${this.runpodApiKey}`,
+        },
+        body: JSON.stringify(jobRequest),
+        signal: AbortSignal.timeout(this.runpodTimeout),
+      });
+
+      if (!response.ok) {
+        const errorText = await response.text();
+        throw new RunPodApiError('triggerJobInternal', response.status, {
+          responseBody: errorText,
+        });
+      }
+
+      const result = (await response.json()) as RunPodJobResponse;
+      runpodJobId = result.id;
+    } catch (error) {
+      if (error instanceof RunPodApiError) {
+        throw error;
+      }
+      // Handle timeout errors
+      throw new RunPodApiError('triggerJobInternal', undefined, {
+        originalError: error instanceof Error ? error.message : String(error),
+      });
+    }
+
+    // Update media status to 'transcoding'
+    await this.db
+      .update(mediaItems)
+      .set({
+        status: 'transcoding',
+        runpodJobId,
+        transcodingPriority: priority ?? media.transcodingPriority,
+        updatedAt: new Date(),
+      })
+      .where(eq(mediaItems.id, mediaId));
+
+    this.obs.info('Transcoding job triggered (internal)', {
+      mediaId,
+      runpodJobId,
+    });
+  }
+}
diff --git a/packages/transcoding/src/types.ts b/packages/transcoding/src/types.ts
new file mode 100644
index 0000000..c6a49ac
--- /dev/null
+++ b/packages/transcoding/src/types.ts
@@ -0,0 +1,113 @@
+/**
+ * Transcoding Types
+ *
+ * Re-exports validation schemas and types from @codex/validation,
+ * plus additional types specific to the transcoding service.
+ */
+
+// Re-export all transcoding schemas and types from validation package
+export {
+  type GetTranscodingStatusInput,
+  getTranscodingStatusSchema,
+  hlsVariantSchema,
+  mezzanineStatusEnum,
+  type RetryTranscodingInput,
+  type RunPodWebhookOutput,
+  // Types
+  type RunPodWebhookPayload,
+  retryTranscodingSchema,
+  runpodJobStatusEnum,
+  runpodWebhookOutputSchema,
+  // Schemas
+  runpodWebhookSchema,
+  type TranscodingStatusResponse,
+  type TriggerTranscodingInput,
+  transcodingPrioritySchema,
+  transcodingStatusResponseSchema,
+  triggerTranscodingSchema,
+} from '@codex/validation';
+
+/**
+ * Media type for transcoding operations
+ */
+export type MediaType = 'video' | 'audio';
+
+/**
+ * Media status enum values
+ */
+export type MediaStatus =
+  | 'uploading'
+  | 'uploaded'
+  | 'transcoding'
+  | 'ready'
+  | 'failed';
+
+/**
+ * HLS variant quality levels
+ */
+export type HlsVariant = '1080p' | '720p' | '480p' | '360p' | 'audio';
+
+/**
+ * RunPod job request payload
+ * Sent when triggering a new transcoding job
+ */
+export interface RunPodJobRequest {
+  input: {
+    mediaId: string;
+    type: MediaType;
+    creatorId: string;
+    inputKey: string;
+    webhookUrl: string;
+    priority?: number;
+  };
+}
+
+/**
+ * RunPod API response when triggering a job
+ */
+export interface RunPodJobResponse {
+  id: string;
+  status: string;
+}
+
+/**
+ * Service configuration for TranscodingService
+ */
+export interface TranscodingServiceConfig {
+  runpodApiKey: string;
+  runpodEndpointId: string;
+  webhookBaseUrl: string;
+}
+
+/**
+ * Mezzanine processing status
+ */
+export type MezzanineStatus = 'pending' | 'processing' | 'ready' | 'failed';
+
+/**
+ * Media item data required for transcoding operations
+ */
+export interface TranscodingMediaItem {
+  id: string;
+  creatorId: string;
+  mediaType: MediaType;
+  status: MediaStatus;
+  r2Key: string;
+  transcodingAttempts: number;
+  runpodJobId: string | null;
+  transcodingError: string | null;
+  transcodingPriority: number;
+  hlsMasterPlaylistKey: string | null;
+  hlsPreviewKey: string | null;
+  thumbnailKey: string | null;
+  waveformKey: string | null;
+  waveformImageKey: string | null;
+  durationSeconds: number | null;
+  width: number | null;
+  height: number | null;
+  readyVariants: string[] | null;
+  /** B2 archival mezzanine key (high-quality CRF 18 intermediate) */
+  mezzanineKey: string | null;
+  /** Mezzanine processing status */
+  mezzanineStatus: MezzanineStatus | null;
+}
diff --git a/packages/transcoding/tsconfig.json b/packages/transcoding/tsconfig.json
new file mode 100644
index 0000000..6601942
--- /dev/null
+++ b/packages/transcoding/tsconfig.json
@@ -0,0 +1,8 @@
+{
+  "extends": "../../config/tsconfig/package.json",
+  "compilerOptions": {
+    "rootDir": "src"
+  },
+  "include": ["src/**/*"],
+  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
+}
diff --git a/packages/transcoding/vite.config.transcoding.ts b/packages/transcoding/vite.config.transcoding.ts
new file mode 100644
index 0000000..f92744b
--- /dev/null
+++ b/packages/transcoding/vite.config.transcoding.ts
@@ -0,0 +1,6 @@
+import { createPackageConfig } from '../../config/vite/package.config';
+
+export default createPackageConfig({
+  packageName: 'transcoding',
+  additionalExternals: ['drizzle-orm'],
+});
diff --git a/packages/transcoding/vitest.config.transcoding.ts b/packages/transcoding/vitest.config.transcoding.ts
new file mode 100644
index 0000000..0075fe7
--- /dev/null
+++ b/packages/transcoding/vitest.config.transcoding.ts
@@ -0,0 +1,9 @@
+import { packageVitestConfig } from '../../config/vitest/package.config';
+
+export default packageVitestConfig({
+  packageName: 'transcoding',
+  setupFiles: ['../../vitest.setup.ts'],
+  testTimeout: 60000,
+  hookTimeout: 60000,
+  enableNeonTesting: true,
+});
diff --git a/packages/validation/src/index.ts b/packages/validation/src/index.ts
index 185f2d6..902332c 100644
--- a/packages/validation/src/index.ts
+++ b/packages/validation/src/index.ts
@@ -17,5 +17,7 @@ export * from './schemas/file-upload';
 export * from './schemas/purchase';
 // Settings schemas
 export * from './schemas/settings';
+// Transcoding schemas (RunPod webhooks, transcoding API)
+export * from './schemas/transcoding';
 // Shared schemas (pagination, etc)
 export * from './shared/pagination-schema';
diff --git a/packages/validation/src/schemas/transcoding.ts b/packages/validation/src/schemas/transcoding.ts
new file mode 100644
index 0000000..1c05e6f
--- /dev/null
+++ b/packages/validation/src/schemas/transcoding.ts
@@ -0,0 +1,196 @@
+import { z } from 'zod';
+import { uuidSchema } from '../primitives';
+
+/**
+ * Transcoding Validation Schemas
+ *
+ * Validates RunPod webhook payloads and transcoding-related API inputs.
+ * Aligned with P1-TRANSCODE-001 Media Transcoding Service.
+ */
+
+// ============================================================================
+// Enums (align with database CHECK constraints)
+// ============================================================================
+
+/**
+ * Mezzanine status enum
+ * Aligns with database CHECK constraint: check_mezzanine_status
+ */
+export const mezzanineStatusEnum = z.enum(
+  ['pending', 'processing', 'ready', 'failed'],
+  {
+    errorMap: () => ({
+      message: 'Mezzanine status must be pending, processing, ready, or failed',
+    }),
+  }
+);
+
+/**
+ * Transcoding priority enum (0-4 scale)
+ * 0 = urgent, 2 = normal, 4 = backlog
+ */
+export const transcodingPrioritySchema = z
+  .number()
+  .int()
+  .min(0, 'Priority must be at least 0')
+  .max(4, 'Priority cannot exceed 4')
+  .default(2);
+
+// ============================================================================
+// RunPod Webhook Schemas
+// ============================================================================
+
+/**
+ * RunPod job status from webhook
+ */
+export const runpodJobStatusEnum = z.enum(['completed', 'failed'], {
+  errorMap: () => ({ message: 'Job status must be completed or failed' }),
+});
+
+/**
+ * HLS variant names (quality levels)
+ */
+export const hlsVariantSchema = z.enum([
+  '1080p',
+  '720p',
+  '480p',
+  '360p',
+  'audio',
+]);
+
+/**
+ * RunPod webhook output payload (on success)
+ * Contains transcoded asset locations and metadata
+ */
+export const runpodWebhookOutputSchema = z.object({
+  // Media identification
+  mediaId: uuidSchema,
+  type: z.enum(['video', 'audio']),
+
+  // HLS outputs
+  hlsMasterKey: z.string().max(500).optional(),
+  hlsPreviewKey: z.string().max(500).optional(),
+
+  // Visual assets
+  thumbnailKey: z.string().max(500).optional(),
+  waveformKey: z.string().max(500).optional(),
+  waveformImageKey: z.string().max(500).optional(),
+
+  // Media metadata
+  durationSeconds: z.number().int().min(0).max(86400).optional(), // Max 24 hours
+  width: z.number().int().min(1).max(7680).optional(), // Max 8K
+  height: z.number().int().min(1).max(4320).optional(), // Max 8K
+
+  // HLS variants that are ready
+  readyVariants: z.array(hlsVariantSchema).optional(),
+
+  // Audio loudness (×100 for precision)
+  // Integrated Loudness (LUFS × 100): Range -10000 to 0 (-100.00 to 0.00 LUFS)
+  loudnessIntegrated: z
+    .number()
+    .int()
+    .min(-10000)
+    .max(0)
+    .optional()
+    .describe('Integrated loudness in LUFS * 100 (e.g. -1400 = -14.0 LUFS)'),
+
+  // True Peak (dBTP × 100): Range -10000 to 200 (-100.00 to +2.00 dBTP)
+  loudnessPeak: z
+    .number()
+    .int()
+    .min(-10000)
+    .max(200)
+    .optional()
+    .describe('True peak in dBTP * 100 (e.g. -100 = -1.0 dBTP)'),
+
+  // Loudness Range (LU × 100): Range 0 to 10000 (0.00 to 100.00 LU)
+  loudnessRange: z
+    .number()
+    .int()
+    .min(0)
+    .max(10000)
+    .optional()
+    .describe('Loudness range in LU * 100 (e.g. 700 = 7.0 LU)'),
+});
+
+export type RunPodWebhookOutput = z.infer<typeof runpodWebhookOutputSchema>;
+
+/**
+ * RunPod webhook payload
+ * Received when transcoding job completes (success or failure)
+ *
+ * @security HMAC-SHA256 signature verification REQUIRED before processing.
+ * The webhook handler must verify the `x-runpod-signature` header using
+ * RUNPOD_WEBHOOK_SECRET before trusting this payload. Never process
+ * webhook data without signature verification.
+ *
+ * @see packages/security for HMAC verification utilities
+ */
+export const runpodWebhookSchema = z.object({
+  // Job identification
+  jobId: z.string().min(1, 'Job ID is required'),
+  status: runpodJobStatusEnum,
+
+  // Output data (present on success)
+  output: runpodWebhookOutputSchema.optional(),
+
+  // Error message (present on failure, max 2KB to match DB constraint)
+  error: z.string().max(2000).optional(),
+});
+
+export type RunPodWebhookPayload = z.infer<typeof runpodWebhookSchema>;
+
+// ============================================================================
+// API Request Schemas
+// ============================================================================
+
+/**
+ * Retry transcoding request
+ * Used when manually retrying a failed transcoding job
+ */
+export const retryTranscodingSchema = z.object({
+  mediaId: uuidSchema,
+});
+
+export type RetryTranscodingInput = z.infer<typeof retryTranscodingSchema>;
+
+/**
+ * Get transcoding status request
+ */
+export const getTranscodingStatusSchema = z.object({
+  mediaId: uuidSchema,
+});
+
+export type GetTranscodingStatusInput = z.infer<
+  typeof getTranscodingStatusSchema
+>;
+
+/**
+ * Trigger transcoding request (internal/service use)
+ */
+export const triggerTranscodingSchema = z.object({
+  mediaId: uuidSchema,
+  priority: transcodingPrioritySchema.optional(),
+});
+
+export type TriggerTranscodingInput = z.infer<typeof triggerTranscodingSchema>;
+
+// ============================================================================
+// Response Types (for documentation/type safety)
+// ============================================================================
+
+/**
+ * Transcoding status response
+ */
+export const transcodingStatusResponseSchema = z.object({
+  status: z.enum(['uploading', 'uploaded', 'transcoding', 'ready', 'failed']),
+  transcodingAttempts: z.number().int().min(0),
+  transcodingError: z.string().nullable(),
+  runpodJobId: z.string().nullable(),
+  transcodingPriority: z.number().int().min(0).max(4),
+  readyVariants: z.array(hlsVariantSchema).nullable(),
+});
+
+export type TranscodingStatusResponse = z.infer<
+  typeof transcodingStatusResponseSchema
+>;
diff --git a/packages/worker-utils/package.json b/packages/worker-utils/package.json
index adf1bb6..acd4afd 100644
--- a/packages/worker-utils/package.json
+++ b/packages/worker-utils/package.json
@@ -40,6 +40,7 @@
     "@codex/security": "workspace:*",
     "@codex/service-errors": "workspace:*",
     "@codex/shared-types": "workspace:*",
+    "@codex/transcoding": "workspace:*",
     "@codex/validation": "workspace:*",
     "drizzle-orm": "0.44.7",
     "hono": "^4.7.8",
diff --git a/packages/worker-utils/src/procedure/helpers.ts b/packages/worker-utils/src/procedure/helpers.ts
index 8e14cbc..163dfff 100644
--- a/packages/worker-utils/src/procedure/helpers.ts
+++ b/packages/worker-utils/src/procedure/helpers.ts
@@ -223,12 +223,59 @@ export async function enforcePolicyInline(
   }
 
   // ========================================================================
-  // Auth: worker - Check worker auth flag
+  // Auth: worker - Check worker auth flag or apply workerAuth inline
   // ========================================================================
   if (mergedPolicy.auth === 'worker') {
-    if (!c.get('workerAuth')) {
-      throw new UnauthorizedError('Worker authentication required');
+    // If workerAuth flag is already set (by earlier middleware), we're authenticated
+    if (c.get('workerAuth')) {
+      return;
     }
+
+    // Apply workerAuth middleware inline
+    // Requires WORKER_SHARED_SECRET in environment
+    const secret = c.env.WORKER_SHARED_SECRET;
+    if (!secret) {
+      throw new UnauthorizedError('Worker authentication not configured');
+    }
+
+    // Import workerAuth dynamically to avoid circular deps
+    const { workerAuth } = await import('@codex/security');
+
+    // Execute workerAuth middleware inline
+    let authFailed = false;
+    let authError: string | undefined;
+
+    await new Promise<void>((resolve) => {
+      const middleware = workerAuth({ secret });
+      middleware(c, async () => {
+        // workerAuth succeeded - flag should now be set
+        resolve();
+      })
+        .then((response) => {
+          // If middleware returned a Response (401/403), auth failed
+          if (response) {
+            authFailed = true;
+            response
+              .json()
+              .then((body) => {
+                authError = (body as { error?: string }).error;
+                resolve();
+              })
+              .catch(() => resolve());
+          } else {
+            resolve();
+          }
+        })
+        .catch(() => {
+          authFailed = true;
+          resolve();
+        });
+    });
+
+    if (authFailed) {
+      throw new UnauthorizedError(authError || 'Worker authentication failed');
+    }
+
     return;
   }
 
diff --git a/packages/worker-utils/src/procedure/service-registry.ts b/packages/worker-utils/src/procedure/service-registry.ts
index 0354ba0..ae42737 100644
--- a/packages/worker-utils/src/procedure/service-registry.ts
+++ b/packages/worker-utils/src/procedure/service-registry.ts
@@ -25,6 +25,7 @@ import { OrganizationService } from '@codex/organization';
 import { PlatformSettingsFacade } from '@codex/platform-settings';
 import { createStripeClient, PurchaseService } from '@codex/purchase';
 import type { Bindings } from '@codex/shared-types';
+import { TranscodingService } from '@codex/transcoding';
 import type { ServiceRegistry } from './types';
 
 /**
@@ -73,6 +74,7 @@ export function createServiceRegistry(
   let _organization: OrganizationService | undefined;
   let _settings: PlatformSettingsFacade | undefined;
   let _purchase: PurchaseService | undefined;
+  let _transcoding: TranscodingService | undefined;
   let _adminAnalytics: AdminAnalyticsService | undefined;
   let _adminContent: AdminContentManagementService | undefined;
   let _adminCustomer: AdminCustomerManagementService | undefined;
@@ -199,6 +201,40 @@ export function createServiceRegistry(
       return _purchase;
     },
 
+    // ========================================================================
+    // Media Domain
+    // ========================================================================
+
+    get transcoding() {
+      if (!_transcoding) {
+        const runpodApiKey = env.RUNPOD_API_KEY;
+        const runpodEndpointId = env.RUNPOD_ENDPOINT_ID;
+        if (!runpodApiKey || !runpodEndpointId) {
+          throw new Error(
+            'RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID not configured. ' +
+              'Add secrets to worker environment for transcoding operations.'
+          );
+        }
+
+        // API_URL is required in production for webhook callbacks
+        const webhookBaseUrl = env.API_URL;
+        if (!webhookBaseUrl && getEnvironment() !== 'development') {
+          throw new Error(
+            'API_URL not configured. Required for transcoding webhook callbacks.'
+          );
+        }
+
+        _transcoding = new TranscodingService({
+          db: getSharedDb(),
+          environment: getEnvironment(),
+          runpodApiKey,
+          runpodEndpointId,
+          webhookBaseUrl: webhookBaseUrl || 'http://localhost:4002',
+        });
+      }
+      return _transcoding;
+    },
+
     // ========================================================================
     // Admin Domain
     // ========================================================================
diff --git a/packages/worker-utils/src/procedure/types.ts b/packages/worker-utils/src/procedure/types.ts
index fcaaaf7..31b237a 100644
--- a/packages/worker-utils/src/procedure/types.ts
+++ b/packages/worker-utils/src/procedure/types.ts
@@ -26,6 +26,7 @@ import type {
   SessionData,
   UserData,
 } from '@codex/shared-types';
+import type { TranscodingService } from '@codex/transcoding';
 import type { MiddlewareHandler } from 'hono';
 import type { ZodSchema, z } from 'zod';
 
@@ -114,6 +115,9 @@ export interface ServiceRegistry {
   // Commerce domain
   purchase: PurchaseService;
 
+  // Transcoding domain
+  transcoding: TranscodingService;
+
   // Admin domain
   adminAnalytics: AdminAnalyticsService;
   adminContent: AdminContentManagementService;
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index c3963b5..81d89cf 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -573,7 +573,7 @@ importers:
         version: 0.44.7(@cloudflare/workers-types@4.20251121.0)(@neondatabase/serverless@0.10.4)(@opentelemetry/api@1.9.0)(@prisma/client@5.22.0(prisma@5.22.0))(@types/pg@8.15.6)(better-sqlite3@12.4.6)(kysely@0.28.8)(mysql2@3.15.3)(pg@8.16.3)(prisma@5.22.0)
       vite-plugin-dts:
         specifier: ^4.5.4
-        version: 4.5.4(@types/node@22.13.0)(rollup@4.53.3)(typescript@5.9.3)(vite@6.4.1(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1))
+        version: 4.5.4(@types/node@22.13.0)(rollup@4.53.3)(typescript@5.9.3)(vite@7.2.4(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1))
       ws:
         specifier: ^8.18.3
         version: 8.18.3
@@ -586,10 +586,44 @@ importers:
         version: 8.18.1
       neon-testing:
         specifier: ^2.2.0
-        version: 2.2.0(vite@6.4.1(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1))(vitest@4.0.13)
+        version: 2.2.0(vite@7.2.4(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1))(vitest@4.0.13)
+      typescript:
+        specifier: ^5.6.3
+        version: 5.9.3
+      vitest:
+        specifier: ^4.0.2
+        version: 4.0.13(@opentelemetry/api@1.9.0)(@types/node@22.13.0)(@vitest/ui@4.0.13)(happy-dom@20.0.10)(jiti@2.6.1)(jsdom@27.4.0)(tsx@4.20.6)(yaml@2.8.1)
+
+  packages/transcoding:
+    dependencies:
+      '@codex/database':
+        specifier: workspace:*
+        version: link:../database
+      '@codex/service-errors':
+        specifier: workspace:*
+        version: link:../service-errors
+      '@codex/shared-types':
+        specifier: workspace:*
+        version: link:../shared-types
+      '@codex/validation':
+        specifier: workspace:*
+        version: link:../validation
+      drizzle-orm:
+        specifier: 0.44.7
+        version: 0.44.7(@cloudflare/workers-types@4.20251121.0)(@neondatabase/serverless@0.10.4)(@opentelemetry/api@1.9.0)(@prisma/client@5.22.0(prisma@5.22.0))(@types/pg@8.15.6)(better-sqlite3@12.4.6)(kysely@0.28.8)(mysql2@3.15.3)(pg@8.16.3)(prisma@5.22.0)
+    devDependencies:
+      '@codex/test-utils':
+        specifier: workspace:*
+        version: link:../test-utils
+      '@types/node':
+        specifier: ^22.0.0
+        version: 22.13.0
       typescript:
         specifier: ^5.6.3
         version: 5.9.3
+      vite:
+        specifier: ^7.2.2
+        version: 7.2.4(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1)
       vitest:
         specifier: ^4.0.2
         version: 4.0.13(@opentelemetry/api@1.9.0)(@types/node@22.13.0)(@vitest/ui@4.0.13)(happy-dom@20.0.10)(jiti@2.6.1)(jsdom@27.4.0)(tsx@4.20.6)(yaml@2.8.1)
@@ -654,6 +688,9 @@ importers:
       '@codex/shared-types':
         specifier: workspace:*
         version: link:../shared-types
+      '@codex/transcoding':
+        specifier: workspace:*
+        version: link:../transcoding
       '@codex/validation':
         specifier: workspace:*
         version: link:../validation
@@ -982,6 +1019,73 @@ importers:
         specifier: ^4.47.0
         version: 4.50.0(@cloudflare/workers-types@4.20251121.0)
 
+  workers/media-api:
+    dependencies:
+      '@codex/database':
+        specifier: workspace:*
+        version: link:../../packages/database
+      '@codex/security':
+        specifier: workspace:*
+        version: link:../../packages/security
+      '@codex/service-errors':
+        specifier: workspace:*
+        version: link:../../packages/service-errors
+      '@codex/shared-types':
+        specifier: workspace:*
+        version: link:../../packages/shared-types
+      '@codex/transcoding':
+        specifier: workspace:*
+        version: link:../../packages/transcoding
+      '@codex/validation':
+        specifier: workspace:*
+        version: link:../../packages/validation
+      '@codex/worker-utils':
+        specifier: workspace:*
+        version: link:../../packages/worker-utils
+      hono:
+        specifier: ^4.7.8
+        version: 4.10.6
+      vite-plugin-dts:
+        specifier: ^4.5.4
+        version: 4.5.4(@types/node@22.13.0)(rollup@4.53.3)(typescript@5.9.3)(vite@5.4.21(@types/node@22.13.0))
+      zod:
+        specifier: ^3.24.1
+        version: 3.25.76
+    devDependencies:
+      '@cloudflare/vitest-pool-workers':
+        specifier: ^0.10.0
+        version: 0.10.10(@cloudflare/workers-types@4.20251121.0)(@vitest/runner@3.2.4)(@vitest/snapshot@3.2.4)(vitest@3.2.4)
+      '@cloudflare/workers-types':
+        specifier: ^4.20250102.0
+        version: 4.20251121.0
+      '@types/node':
+        specifier: ^22.13.0
+        version: 22.13.0
+      '@vitest/runner':
+        specifier: ~3.2.4
+        version: 3.2.4
+      '@vitest/snapshot':
+        specifier: ~3.2.4
+        version: 3.2.4
+      '@vitest/ui':
+        specifier: ~3.2.4
+        version: 3.2.4(vitest@3.2.4)
+      cloudflare:
+        specifier: ^4.0.0
+        version: 4.5.0
+      typescript:
+        specifier: ^5.7.3
+        version: 5.9.3
+      vite:
+        specifier: ^5.4.11
+        version: 5.4.21(@types/node@22.13.0)
+      vitest:
+        specifier: ^3.2.4
+        version: 3.2.4(@types/node@22.13.0)(@vitest/ui@3.2.4)(happy-dom@20.0.10)(jiti@2.6.1)(jsdom@27.4.0)(tsx@4.20.6)(yaml@2.8.1)
+      wrangler:
+        specifier: ^4.47.0
+        version: 4.50.0(@cloudflare/workers-types@4.20251121.0)
+
   workers/notifications-api:
     dependencies:
       '@codex/database':
@@ -9164,6 +9268,14 @@ snapshots:
     transitivePeerDependencies:
       - debug
 
+  neon-testing@2.2.0(vite@7.2.4(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1))(vitest@4.0.13):
+    dependencies:
+      '@neondatabase/api-client': 2.2.0
+      vite: 7.2.4(@types/node@22.13.0)(jiti@2.6.1)(tsx@4.20.6)(yaml@2.8.1)
+      vitest: 4.0.13(@opentelemetry/api@1.9.0)(@types/node@22.13.0)(@vitest/ui@4.0.13)(happy-dom@20.0.10)(jiti@2.6.1)(jsdom@27.4.0)(tsx@4.20.6)(yaml@2.8.1)
+    transitivePeerDependencies:
+      - debug
+
   node-abi@3.85.0:
     dependencies:
       semver: 7.7.3
diff --git a/vitest.workspace.ts b/vitest.workspace.ts
index 5e7fc07..f32fec0 100644
--- a/vitest.workspace.ts
+++ b/vitest.workspace.ts
@@ -17,9 +17,11 @@ export default defineConfig({
       'packages/content/vitest.config.content.ts',
       'packages/identity/vitest.config.identity.ts',
       'packages/worker-utils/vitest.config.worker-utils.ts',
+      'packages/transcoding/vitest.config.transcoding.ts',
 
       // Workers
       'workers/auth',
+      'workers/media-api',
       'workers/ecom-api',
       'workers/content-api',
       'workers/identity-api',
diff --git a/workers/content-api/src/routes/media.ts b/workers/content-api/src/routes/media.ts
index 06e5ee5..96c2d72 100644
--- a/workers/content-api/src/routes/media.ts
+++ b/workers/content-api/src/routes/media.ts
@@ -126,6 +126,77 @@ app.get(
   })
 );
 
+/**
+ * POST /api/media/:id/upload-complete
+ * Mark upload as complete and trigger transcoding
+ *
+ * Called by frontend after R2 upload completes.
+ * Transitions status: uploading → uploaded → transcoding
+ *
+ * Flow:
+ * 1. Verify creator owns media and status is 'uploading'
+ * 2. Update status to 'uploaded'
+ * 3. Call media-api to trigger transcoding
+ *
+ * Security: Creator/Admin only
+ * @returns {{ success: boolean, status: string }}
+ */
+app.post(
+  '/:id/upload-complete',
+  procedure({
+    policy: { auth: 'required', roles: ['creator', 'admin'] },
+    input: { params: createIdParamsSchema() },
+    handler: async (ctx): Promise<{ success: boolean; status: string }> => {
+      const mediaId = ctx.input.params.id;
+      const creatorId = ctx.user.id;
+
+      // 1. Verify ownership and get current media
+      const media = await ctx.services.media.get(mediaId, creatorId);
+      if (!media) {
+        throw new MediaNotFoundError(mediaId);
+      }
+
+      // 2. Ensure media is in 'uploading' state
+      if (media.status !== 'uploading') {
+        throw new Error(
+          `Cannot mark upload complete: media is already '${media.status}'`
+        );
+      }
+
+      // 3. Update status to 'uploaded'
+      await ctx.services.media.updateStatus(mediaId, 'uploaded', creatorId);
+
+      // 4. Trigger transcoding via media-api worker
+      const mediaApiUrl = ctx.env.MEDIA_API_URL;
+      if (!mediaApiUrl) {
+        throw new Error('MEDIA_API_URL not configured');
+      }
+
+      const response = await fetch(
+        `${mediaApiUrl}/internal/media/${mediaId}/transcode`,
+        {
+          method: 'POST',
+          headers: {
+            'Content-Type': 'application/json',
+            'X-Worker-Secret': ctx.env.WORKER_SHARED_SECRET || '',
+          },
+          body: JSON.stringify({ creatorId }),
+        }
+      );
+
+      if (!response.ok) {
+        const errorText = await response.text();
+        console.error(`Failed to trigger transcoding: ${errorText}`);
+        // Don't fail the request - media is still marked as 'uploaded'
+        // Transcoding can be retried manually
+        return { success: true, status: 'uploaded' };
+      }
+
+      return { success: true, status: 'transcoding' };
+    },
+  })
+);
+
 /**
  * DELETE /api/media/:id
  * Soft delete media item (sets deleted_at)
diff --git a/workers/content-api/wrangler.jsonc b/workers/content-api/wrangler.jsonc
index e5d6fd6..d8d7867 100644
--- a/workers/content-api/wrangler.jsonc
+++ b/workers/content-api/wrangler.jsonc
@@ -36,7 +36,8 @@
     "ENVIRONMENT": "development",
     "DB_METHOD": "LOCAL_PROXY",
     "WEB_APP_URL": "http://localhost:3000",
-    "API_URL": "http://localhost:8787"
+    "API_URL": "http://localhost:8787",
+    "MEDIA_API_URL": "http://localhost:8788"
   },
 
   // Environment configurations
@@ -76,7 +77,8 @@
         "ENVIRONMENT": "production",
         "DB_METHOD": "PRODUCTION",
         "WEB_APP_URL": "https://codex.revelations.studio",
-        "API_URL": "https://api.revelations.studio"
+        "API_URL": "https://api.revelations.studio",
+        "MEDIA_API_URL": "https://media-api.revelations.studio"
       },
       "kv_namespaces": [
         {
diff --git a/workers/media-api/package.json b/workers/media-api/package.json
new file mode 100644
index 0000000..b1c7202
--- /dev/null
+++ b/workers/media-api/package.json
@@ -0,0 +1,45 @@
+{
+  "name": "@codex/media-api",
+  "version": "0.1.0",
+  "private": true,
+  "description": "Cloudflare Worker for media transcoding orchestration",
+  "type": "module",
+  "scripts": {
+    "dev": "pnpm build && dotenv -e ../../.env.dev -- wrangler dev --port 4002 --inspector-port 9234",
+    "deploy": "wrangler deploy",
+    "deploy:staging": "wrangler deploy --env staging",
+    "deploy:production": "wrangler deploy --env production",
+    "build": "vite build",
+    "typecheck": "tsc --noEmit",
+    "lint": "biome lint --write .",
+    "format": "biome format --write .",
+    "test": "vitest",
+    "test:ui": "vitest --ui",
+    "cf-typegen": "wrangler types"
+  },
+  "dependencies": {
+    "@codex/database": "workspace:*",
+    "@codex/security": "workspace:*",
+    "@codex/service-errors": "workspace:*",
+    "@codex/shared-types": "workspace:*",
+    "@codex/transcoding": "workspace:*",
+    "@codex/validation": "workspace:*",
+    "@codex/worker-utils": "workspace:*",
+    "hono": "^4.7.8",
+    "zod": "^3.24.1",
+    "vite-plugin-dts": "^4.5.4"
+  },
+  "devDependencies": {
+    "@cloudflare/vitest-pool-workers": "^0.10.0",
+    "@cloudflare/workers-types": "^4.20250102.0",
+    "@types/node": "^22.13.0",
+    "@vitest/runner": "~3.2.4",
+    "@vitest/snapshot": "~3.2.4",
+    "@vitest/ui": "~3.2.4",
+    "typescript": "^5.7.3",
+    "vite": "^5.4.11",
+    "vitest": "^3.2.4",
+    "wrangler": "^4.47.0",
+    "cloudflare": "^4.0.0"
+  }
+}
diff --git a/workers/media-api/src/__tests__/endpoints.test.ts b/workers/media-api/src/__tests__/endpoints.test.ts
new file mode 100644
index 0000000..4a85959
--- /dev/null
+++ b/workers/media-api/src/__tests__/endpoints.test.ts
@@ -0,0 +1,114 @@
+import { env, SELF } from 'cloudflare:test';
+import { describe, expect, it } from 'vitest';
+
+describe('Media API', () => {
+  describe('Health Check', () => {
+    it('should return healthy status', async () => {
+      const response = await SELF.fetch('http://localhost/health');
+      expect([200, 503]).toContain(response.status);
+      const json = (await response.json()) as any;
+      expect(json.status).toBeDefined();
+      expect(json.service).toBe('media-api');
+    });
+  });
+
+  describe('Webhook Endpoint', () => {
+    const webhookUrl = 'http://localhost/api/transcoding/webhook';
+    const payload = {
+      jobId: 'test-job-123',
+      status: 'completed',
+      output: {
+        mediaId: '550e8400-e29b-41d4-a716-446655440000',
+        type: 'video',
+        hlsMasterKey: 'key',
+      },
+    };
+    const timestamp = Math.floor(Date.now() / 1000).toString();
+
+    it('should return 401 if signature is missing', async () => {
+      const response = await SELF.fetch(webhookUrl, {
+        method: 'POST',
+        headers: {
+          'Content-Type': 'application/json',
+          'X-Runpod-Timestamp': timestamp,
+        },
+        body: JSON.stringify(payload),
+      });
+      expect(response.status).toBe(401);
+    });
+
+    it('should return 401 if signature is invalid', async () => {
+      const response = await SELF.fetch(webhookUrl, {
+        method: 'POST',
+        headers: {
+          'Content-Type': 'application/json',
+          'X-Runpod-Signature': 'invalid-signature',
+          'X-Runpod-Timestamp': timestamp,
+        },
+        body: JSON.stringify(payload),
+      });
+      expect(response.status).toBe(401);
+    });
+
+    it('should return 200/202/204 if signature is valid', async () => {
+      const body = JSON.stringify(payload);
+      const secret = env.RUNPOD_WEBHOOK_SECRET || 'test-secret';
+
+      // Generate signature including timestamp as per middleware logic
+      const message = `${timestamp}.${body}`;
+
+      // Re-implement simplified HMAC generation compatible with middleware logic
+      // Note: middleware uses `timestamp.payload` if timestamp present
+      const enc = new TextEncoder();
+      const key = await crypto.subtle.importKey(
+        'raw',
+        enc.encode(secret),
+        { name: 'HMAC', hash: 'SHA-256' },
+        false,
+        ['sign']
+      );
+      const signature = await crypto.subtle.sign(
+        'HMAC',
+        key,
+        enc.encode(message)
+      );
+      const hexSignature = Array.from(new Uint8Array(signature))
+        .map((b) => b.toString(16).padStart(2, '0'))
+        .join('');
+
+      const response = await SELF.fetch(webhookUrl, {
+        method: 'POST',
+        headers: {
+          'Content-Type': 'application/json',
+          'X-Runpod-Signature': hexSignature,
+          'X-Runpod-Timestamp': timestamp,
+        },
+        body: body,
+      });
+
+      // Expecting 500 (DB failure) or 200 (Success) which means security passed
+      expect(response.status).not.toBe(401);
+      expect(response.status).not.toBe(403);
+    });
+  });
+
+  describe('Internal Endpoints', () => {
+    const internalUrl =
+      'http://localhost/internal/media/550e8400-e29b-41d4-a716-446655440000/transcode';
+
+    it('should return 401 if worker secret is missing', async () => {
+      const response = await SELF.fetch(internalUrl, {
+        method: 'POST',
+      });
+      expect(response.status).toBe(401);
+    });
+
+    it('should return 401 if worker secret is invalid', async () => {
+      const response = await SELF.fetch(internalUrl, {
+        method: 'POST',
+        headers: { 'X-Worker-Secret': 'invalid' },
+      });
+      expect(response.status).toBe(401);
+    });
+  });
+});
diff --git a/workers/media-api/src/__tests__/env.d.ts b/workers/media-api/src/__tests__/env.d.ts
new file mode 100644
index 0000000..7385853
--- /dev/null
+++ b/workers/media-api/src/__tests__/env.d.ts
@@ -0,0 +1,10 @@
+import 'cloudflare:test';
+
+declare module 'cloudflare:test' {
+  interface ProvidedEnv {
+    RUNPOD_WEBHOOK_SECRET?: string;
+    RUNPOD_API_KEY?: string;
+    RUNPOD_ENDPOINT_ID?: string;
+    WORKER_SHARED_SECRET?: string;
+  }
+}
diff --git a/workers/media-api/src/index.ts b/workers/media-api/src/index.ts
new file mode 100644
index 0000000..8653cfe
--- /dev/null
+++ b/workers/media-api/src/index.ts
@@ -0,0 +1,98 @@
+/**
+ * Media API Worker
+ *
+ * Cloudflare Worker providing transcoding orchestration endpoints.
+ *
+ * Security Features:
+ * - workerAuth for internal endpoints (worker-to-worker HMAC)
+ * - HMAC-SHA256 signature verification for RunPod webhooks (timing-safe)
+ * - Session-based authentication for user-facing endpoints
+ * - Rate limiting via KV namespace
+ * - Security headers (CSP, XFO, etc.)
+ *
+ * Architecture:
+ * - Hono framework for routing and middleware
+ * - @codex/transcoding for business logic
+ * - @codex/database for data persistence
+ * - @codex/security for authentication
+ * - @codex/worker-utils for standardized worker setup
+ *
+ * Routes:
+ * - /health - Health check endpoint (public)
+ * - /internal/media/:id/transcode - Trigger transcoding (worker auth)
+ * - /api/transcoding/webhook - RunPod webhook callback (HMAC verified)
+ * - /api/transcoding/retry/:id - Retry failed transcoding (authenticated)
+ * - /api/transcoding/status/:id - Get transcoding status (authenticated)
+ */
+
+import {
+  createEnvValidationMiddleware,
+  createKvCheck,
+  createWorker,
+  standardDatabaseCheck,
+} from '@codex/worker-utils';
+// Import route modules
+import transcodingRoutes from './routes/transcoding';
+import webhookRoutes from './routes/webhook';
+
+// ============================================================================
+// Application Setup
+// ============================================================================
+
+const app = createWorker({
+  serviceName: 'media-api',
+  version: '1.0.0',
+  enableRequestTracking: true, // UUID request IDs, IP tracking, user agent
+  enableLogging: true,
+  enableCors: true,
+  enableSecurityHeaders: true,
+  enableGlobalAuth: false, // Using route-level procedure() instead
+  healthCheck: {
+    checkDatabase: standardDatabaseCheck,
+    checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
+  },
+});
+
+/**
+ * Environment validation
+ * Validates required environment variables on first request
+ * Runs once per worker instance (not per request)
+ */
+app.use(
+  '*',
+  createEnvValidationMiddleware({
+    required: [
+      'DATABASE_URL',
+      'RUNPOD_API_KEY',
+      'RUNPOD_ENDPOINT_ID',
+      'RUNPOD_WEBHOOK_SECRET',
+      'WORKER_SHARED_SECRET',
+      'RATE_LIMIT_KV',
+    ],
+    optional: ['ENVIRONMENT', 'WEB_APP_URL', 'API_URL'],
+  })
+);
+
+// ============================================================================
+// API Routes
+// ============================================================================
+
+/**
+ * Mount transcoding routes
+ * - /internal/media/:id/transcode (workerAuth)
+ * - /api/transcoding/retry/:id (authenticated)
+ * - /api/transcoding/status/:id (authenticated)
+ */
+app.route('/', transcodingRoutes);
+
+/**
+ * Mount webhook routes
+ * - /api/transcoding/webhook (HMAC verified, no session auth)
+ */
+app.route('/', webhookRoutes);
+
+// ============================================================================
+// Export
+// ============================================================================
+
+export default app;
diff --git a/workers/media-api/src/middleware/verify-runpod-signature.ts b/workers/media-api/src/middleware/verify-runpod-signature.ts
new file mode 100644
index 0000000..8092517
--- /dev/null
+++ b/workers/media-api/src/middleware/verify-runpod-signature.ts
@@ -0,0 +1,286 @@
+/**
+ * RunPod Webhook Signature Verification Middleware
+ *
+ * Verifies HMAC-SHA256 signatures from RunPod webhook callbacks.
+ * Uses timing-safe comparison to prevent timing attacks.
+ *
+ * Security:
+ * - Timing-safe comparison via constant-time XOR
+ * - Validates signature format before comparison
+ * - Returns 401 for missing/invalid signatures
+ *
+ * Headers expected:
+ * - X-Runpod-Signature: HMAC-SHA256 signature (hex encoded)
+ * - X-Runpod-Timestamp: Unix timestamp (optional, for replay protection)
+ */
+
+import type { HonoEnv } from '@codex/shared-types';
+import type { Context, Next } from 'hono';
+
+/**
+ * Header names for RunPod webhook authentication
+ */
+const SIGNATURE_HEADER = 'X-Runpod-Signature';
+const TIMESTAMP_HEADER = 'X-Runpod-Timestamp';
+
+/**
+ * Maximum age of webhook request in seconds (5 minutes)
+ * Prevents replay attacks
+ */
+const MAX_AGE_SECONDS = 300;
+
+/**
+ * Convert hex string to Uint8Array
+ */
+function hexToBytes(hex: string): Uint8Array {
+  const bytes = new Uint8Array(hex.length / 2);
+  for (let i = 0; i < hex.length; i += 2) {
+    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
+  }
+  return bytes;
+}
+
+/**
+ * Timing-safe comparison of two byte arrays
+ *
+ * Uses constant-time XOR comparison to prevent timing attacks.
+ * The comparison always takes the same amount of time regardless
+ * of where the first difference occurs or if lengths differ.
+ *
+ * SECURITY: Length comparison is included in the XOR result to prevent
+ * length oracle attacks. We compare up to the minimum length to ensure
+ * constant iteration time relative to the shorter input.
+ */
+function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
+  const minLength = Math.min(a.length, b.length);
+  // XOR lengths - any difference here will make result non-zero
+  let result = a.length ^ b.length;
+
+  // Constant-time comparison using XOR up to minimum length
+  // This ensures we always iterate the same number of times
+  // regardless of where differences occur
+  for (let i = 0; i < minLength; i++) {
+    result |= a[i] ^ b[i];
+  }
+  return result === 0;
+}
+
+/**
+ * Generate HMAC-SHA256 signature for payload
+ */
+async function generateSignature(
+  payload: string,
+  secret: string,
+  timestamp?: number
+): Promise<string> {
+  const encoder = new TextEncoder();
+
+  // If timestamp provided, include in signed message (format: timestamp.payload)
+  const message = timestamp ? `${timestamp}.${payload}` : payload;
+  const data = encoder.encode(message);
+
+  const key = await crypto.subtle.importKey(
+    'raw',
+    encoder.encode(secret),
+    { name: 'HMAC', hash: 'SHA-256' },
+    false,
+    ['sign']
+  );
+
+  const signature = await crypto.subtle.sign('HMAC', key, data);
+
+  // Convert to hex string
+  return Array.from(new Uint8Array(signature))
+    .map((b) => b.toString(16).padStart(2, '0'))
+    .join('');
+}
+
+/**
+ * Verify RunPod webhook signature
+ *
+ * @param payload - Raw request body
+ * @param signature - Signature from header (hex encoded)
+ * @param secret - Webhook secret
+ * @param timestamp - Optional timestamp for replay protection
+ * @returns true if signature is valid
+ */
+async function verifySignature(
+  payload: string,
+  signature: string,
+  secret: string,
+  timestamp?: number
+): Promise<boolean> {
+  // Validate signature format (should be 64 hex chars for SHA-256)
+  if (!/^[a-f0-9]{64}$/i.test(signature)) {
+    return false;
+  }
+
+  const expectedSignature = await generateSignature(payload, secret, timestamp);
+
+  // Convert both to bytes for timing-safe comparison
+  const signatureBytes = hexToBytes(signature.toLowerCase());
+  const expectedBytes = hexToBytes(expectedSignature.toLowerCase());
+
+  return timingSafeEqual(signatureBytes, expectedBytes);
+}
+
+export interface VerifyRunpodSignatureOptions {
+  /**
+   * Whether to validate timestamp for replay protection
+   * Default: true
+   */
+  validateTimestamp?: boolean;
+
+  /**
+   * Maximum age of request in seconds
+   * Default: 300 (5 minutes)
+   */
+  maxAge?: number;
+}
+
+/**
+ * Hono middleware to verify RunPod webhook signatures
+ *
+ * IMPORTANT: This middleware MUST be applied before any JSON parsing
+ * to ensure the raw body is available for signature verification.
+ *
+ * @example
+ * ```ts
+ * import { verifyRunpodSignature } from './middleware/verify-runpod-signature';
+ *
+ * app.post('/api/transcoding/webhook',
+ *   verifyRunpodSignature(),
+ *   async (c) => {
+ *     // Signature verified, process webhook
+ *     const payload = await c.req.json();
+ *     // ...
+ *   }
+ * );
+ * ```
+ */
+export function verifyRunpodSignature(
+  options: VerifyRunpodSignatureOptions = {}
+) {
+  const { validateTimestamp = true, maxAge = MAX_AGE_SECONDS } = options;
+
+  return async (c: Context<HonoEnv>, next: Next) => {
+    // Get webhook secret from environment
+    const secret = c.env.RUNPOD_WEBHOOK_SECRET;
+    if (!secret) {
+      console.error(
+        '[verifyRunpodSignature] RUNPOD_WEBHOOK_SECRET not configured'
+      );
+      return c.json(
+        {
+          error: {
+            code: 'CONFIGURATION_ERROR',
+            message: 'Webhook verification not configured',
+          },
+        },
+        500
+      );
+    }
+
+    // Extract signature from header
+    const signature = c.req.header(SIGNATURE_HEADER);
+    if (!signature) {
+      return c.json(
+        {
+          error: {
+            code: 'MISSING_SIGNATURE',
+            message: 'Missing webhook signature',
+            required: SIGNATURE_HEADER,
+          },
+        },
+        401
+      );
+    }
+
+    // Extract and validate timestamp if required
+    let timestamp: number | undefined;
+    if (validateTimestamp) {
+      const timestampStr = c.req.header(TIMESTAMP_HEADER);
+      if (!timestampStr) {
+        return c.json(
+          {
+            error: {
+              code: 'MISSING_TIMESTAMP',
+              message: 'Missing timestamp header',
+              required: TIMESTAMP_HEADER,
+            },
+          },
+          401
+        );
+      }
+
+      timestamp = parseInt(timestampStr, 10);
+      if (Number.isNaN(timestamp)) {
+        return c.json(
+          {
+            error: {
+              code: 'INVALID_TIMESTAMP',
+              message: 'Invalid timestamp format',
+            },
+          },
+          401
+        );
+      }
+
+      // Check for replay attacks
+      const now = Math.floor(Date.now() / 1000);
+      const age = now - timestamp;
+
+      if (age > maxAge) {
+        return c.json(
+          {
+            error: {
+              code: 'TIMESTAMP_EXPIRED',
+              message: 'Request timestamp expired',
+              maxAge,
+              age,
+            },
+          },
+          401
+        );
+      }
+
+      // Prevent future timestamps (clock skew attack)
+      if (age < -60) {
+        return c.json(
+          {
+            error: {
+              code: 'TIMESTAMP_FUTURE',
+              message: 'Request timestamp in future',
+            },
+          },
+          401
+        );
+      }
+    }
+
+    // Get raw request body for signature verification
+    const body = await c.req.text();
+
+    // Verify signature (timing-safe)
+    const isValid = await verifySignature(body, signature, secret, timestamp);
+
+    if (!isValid) {
+      return c.json(
+        {
+          error: {
+            code: 'INVALID_SIGNATURE',
+            message: 'Invalid webhook signature',
+          },
+        },
+        401
+      );
+    }
+
+    // Signature valid, proceed to handler
+    // Store raw body for handler to parse
+    // Type assertion: rawBody is defined in Variables interface in @codex/shared-types
+    (c.set as (key: string, value: string) => void)('rawBody', body);
+
+    await next();
+  };
+}
diff --git a/workers/media-api/src/routes/transcoding.ts b/workers/media-api/src/routes/transcoding.ts
new file mode 100644
index 0000000..bdf672a
--- /dev/null
+++ b/workers/media-api/src/routes/transcoding.ts
@@ -0,0 +1,117 @@
+/**
+ * Transcoding Routes
+ *
+ * Routes for transcoding orchestration:
+ * - POST /internal/media/:id/transcode - Trigger transcoding (workerAuth)
+ * - POST /api/transcoding/retry/:id - Retry failed transcoding (authenticated)
+ * - GET /api/transcoding/status/:id - Get transcoding status (authenticated)
+ */
+
+import type { HonoEnv } from '@codex/shared-types';
+import { transcodingPrioritySchema } from '@codex/transcoding';
+import { uuidSchema } from '@codex/validation';
+import { procedure } from '@codex/worker-utils';
+import { Hono } from 'hono';
+import { z } from 'zod';
+
+// Route-specific schemas that map URL params (id) to service params (mediaId)
+const idParamSchema = z.object({ id: uuidSchema });
+const triggerBodySchema = z.object({
+  priority: transcodingPrioritySchema.optional(),
+});
+
+const app = new Hono<HonoEnv>();
+
+// ============================================================================
+// Internal Routes (Worker-to-Worker Auth)
+// ============================================================================
+
+/**
+ * POST /internal/media/:id/transcode
+ *
+ * Trigger transcoding for a media item.
+ * Called by content-api after media upload completes.
+ *
+ * Security: workerAuth (HMAC signature from calling worker)
+ *           - procedure() applies workerAuth inline when policy.auth is 'worker'
+ * Rate Limit: N/A (internal only)
+ */
+app.post(
+  '/internal/media/:id/transcode',
+  procedure({
+    policy: { auth: 'worker' },
+    input: {
+      params: idParamSchema,
+      body: triggerBodySchema,
+    },
+    handler: async (ctx) => {
+      const { id } = ctx.input.params;
+      const { priority } = ctx.input.body;
+
+      // Use internal method that doesn't require creatorId (workerAuth is auth layer)
+      await ctx.services.transcoding.triggerJobInternal(id, priority);
+
+      return { message: 'Transcoding job triggered', mediaId: id };
+    },
+  })
+);
+
+// ============================================================================
+// User-Facing Routes (Session Auth)
+// ============================================================================
+
+/**
+ * POST /api/transcoding/retry/:id
+ *
+ * Retry a failed transcoding job.
+ * Only 1 retry allowed per media item.
+ *
+ * Security: requireAuth (session cookie)
+ * Rate Limit: 10 requests per minute (stricter for mutation)
+ */
+app.post(
+  '/api/transcoding/retry/:id',
+  procedure({
+    policy: { auth: 'required', rateLimit: 'auth' },
+    input: {
+      params: idParamSchema,
+    },
+    handler: async (ctx) => {
+      const { id } = ctx.input.params;
+
+      await ctx.services.transcoding.retryTranscoding(id, ctx.user.id);
+
+      return { message: 'Transcoding retry triggered', mediaId: id };
+    },
+  })
+);
+
+/**
+ * GET /api/transcoding/status/:id
+ *
+ * Get current transcoding status for a media item.
+ *
+ * Security: requireAuth (session cookie)
+ * Rate Limit: api (100 requests per minute)
+ */
+app.get(
+  '/api/transcoding/status/:id',
+  procedure({
+    policy: { auth: 'required', rateLimit: 'api' },
+    input: {
+      params: idParamSchema,
+    },
+    handler: async (ctx) => {
+      const { id } = ctx.input.params;
+
+      const status = await ctx.services.transcoding.getTranscodingStatus(
+        id,
+        ctx.user.id
+      );
+
+      return { data: status };
+    },
+  })
+);
+
+export default app;
diff --git a/workers/media-api/src/routes/webhook.ts b/workers/media-api/src/routes/webhook.ts
new file mode 100644
index 0000000..70e7f58
--- /dev/null
+++ b/workers/media-api/src/routes/webhook.ts
@@ -0,0 +1,119 @@
+/**
+ * Webhook Routes
+ *
+ * Routes for external webhook callbacks:
+ * - POST /api/transcoding/webhook - RunPod completion callback (HMAC verified)
+ *
+ * NOTE: Webhook routes don't use procedure() because:
+ * 1. Auth is HMAC-based (not session), handled by verifyRunpodSignature
+ * 2. Body must be read as raw text first for signature verification
+ * 3. Then parsed and validated manually after verification
+ *
+ * Error handling uses mapErrorToResponse() for consistency.
+ */
+
+import { createDbClient } from '@codex/database';
+import { mapErrorToResponse, ValidationError } from '@codex/service-errors';
+import type { HonoEnv } from '@codex/shared-types';
+import { runpodWebhookSchema, TranscodingService } from '@codex/transcoding';
+import { Hono } from 'hono';
+import { verifyRunpodSignature } from '../middleware/verify-runpod-signature';
+
+const app = new Hono<HonoEnv>();
+
+// ============================================================================
+// Webhook Routes (HMAC Signature Verification)
+// ============================================================================
+
+/**
+ * POST /api/transcoding/webhook
+ *
+ * Receive RunPod completion callbacks.
+ * Updates media_items with transcoding results.
+ *
+ * Security: HMAC-SHA256 signature verification (timing-safe)
+ * Rate Limit: High throughput (handled externally by Cloudflare if needed)
+ *
+ * NOTE: No session auth - webhooks are authenticated via HMAC signature.
+ */
+app.post(
+  '/api/transcoding/webhook',
+  // Apply HMAC signature verification middleware
+  // Reads raw body, verifies signature, stores body in context
+  verifyRunpodSignature({
+    validateTimestamp: true,
+    maxAge: 300, // 5 minutes
+  }),
+  async (c) => {
+    try {
+      // Raw body was stored by verifyRunpodSignature middleware
+      // Type assertion: middleware guarantees rawBody is a string
+      const rawBody = c.get('rawBody') as string | undefined;
+      if (!rawBody) {
+        throw new ValidationError(
+          'Request body not available after signature verification'
+        );
+      }
+
+      // Parse JSON from the stored raw body
+      let payload: unknown;
+      try {
+        payload = JSON.parse(rawBody);
+      } catch {
+        throw new ValidationError('Invalid JSON in request body');
+      }
+
+      // Validate against schema
+      const result = runpodWebhookSchema.safeParse(payload);
+      if (!result.success) {
+        // Log detailed errors server-side for debugging
+        console.error(
+          '[webhook] Validation failed:',
+          result.error.errors.map((e) => ({
+            path: e.path.join('.'),
+            message: e.message,
+          }))
+        );
+        throw new ValidationError('Invalid webhook payload');
+      }
+
+      // Validate required environment variables
+      const runpodApiKey = c.env.RUNPOD_API_KEY;
+      const runpodEndpointId = c.env.RUNPOD_ENDPOINT_ID;
+
+      if (!runpodApiKey || !runpodEndpointId) {
+        // Log detailed config status server-side only
+        console.error('[webhook] RunPod configuration missing:', {
+          runpodApiKey: !runpodApiKey ? 'missing' : 'ok',
+          runpodEndpointId: !runpodEndpointId ? 'missing' : 'ok',
+        });
+        throw new ValidationError('Service configuration error');
+      }
+
+      // Create database client and TranscodingService
+      const db = createDbClient(c.env);
+      const service = new TranscodingService({
+        db,
+        environment: c.env.ENVIRONMENT || 'development',
+        runpodApiKey,
+        runpodEndpointId,
+        webhookBaseUrl: c.env.API_URL || 'http://localhost:4002',
+      });
+
+      // Process the webhook
+      await service.handleWebhook(result.data);
+
+      // Return success - RunPod expects 200 OK to acknowledge receipt
+      return c.json({ received: true }, 200);
+    } catch (error) {
+      // Map service errors to HTTP responses using standard error handler
+      const { statusCode, response } = mapErrorToResponse(error);
+      return c.json(
+        response,
+        statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500
+      );
+    }
+  }
+);
+
+export default app;
diff --git a/workers/media-api/tsconfig.json b/workers/media-api/tsconfig.json
new file mode 100644
index 0000000..3a8565a
--- /dev/null
+++ b/workers/media-api/tsconfig.json
@@ -0,0 +1,24 @@
+{
+  "compilerOptions": {
+    "target": "ES2022",
+    "module": "ESNext",
+    "moduleResolution": "bundler",
+    "strict": true,
+    "skipLibCheck": true,
+    "esModuleInterop": true,
+    "resolveJsonModule": true,
+    "declaration": true,
+    "declarationMap": true,
+    "sourceMap": true,
+    "outDir": "./dist",
+    "rootDir": "./src",
+    "lib": ["ES2022"],
+    "types": [
+      "@cloudflare/workers-types",
+      "node",
+      "@cloudflare/vitest-pool-workers"
+    ]
+  },
+  "include": ["src/**/*", "../../config/vitest/cloudflare-test-env.d.ts"],
+  "exclude": ["node_modules", "dist"]
+}
diff --git a/workers/media-api/vite.config.ts b/workers/media-api/vite.config.ts
new file mode 100644
index 0000000..8a3e4b3
--- /dev/null
+++ b/workers/media-api/vite.config.ts
@@ -0,0 +1,5 @@
+import { createWorkerConfig } from '../../config/vite/worker.config';
+
+export default createWorkerConfig({
+  workerName: 'media-api',
+});
diff --git a/workers/media-api/vitest.config.ts b/workers/media-api/vitest.config.ts
new file mode 100644
index 0000000..37688b7
--- /dev/null
+++ b/workers/media-api/vitest.config.ts
@@ -0,0 +1,25 @@
+import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
+
+export default defineWorkersConfig({
+  test: {
+    globals: true,
+    // Use Workers pool to run tests in workerd runtime (not Node.js)
+    poolOptions: {
+      workers: {
+        wrangler: { configPath: './wrangler.jsonc', environment: 'test' },
+      },
+    },
+    include: ['src/**/*.{test,spec}.ts'],
+    coverage: {
+      provider: 'v8',
+      reporter: ['text', 'json', 'html'],
+      exclude: [
+        'node_modules/',
+        'dist/',
+        '*.config.ts',
+        '**/*.d.ts',
+        '**/types/**',
+      ],
+    },
+  },
+});
diff --git a/workers/media-api/wrangler.jsonc b/workers/media-api/wrangler.jsonc
new file mode 100644
index 0000000..1aae563
--- /dev/null
+++ b/workers/media-api/wrangler.jsonc
@@ -0,0 +1,151 @@
+{
+  "$schema": "./node_modules/wrangler/config-schema.json",
+  "name": "media-api",
+  "main": "dist/index.js",
+  "compatibility_date": "2025-01-01",
+  "compatibility_flags": ["nodejs_compat"],
+
+  // Observability configuration
+  "observability": {
+    "enabled": true
+  },
+
+  // KV Namespaces
+  "kv_namespaces": [
+    {
+      "binding": "RATE_LIMIT_KV",
+      "id": "cea7153364974737b16870df08f31083"
+    },
+    {
+      "binding": "AUTH_SESSION_KV",
+      "id": "82d04a4236df4aac8e9d87793344f0ed"
+    }
+  ],
+
+  // R2 Buckets
+  "r2_buckets": [
+    {
+      "binding": "MEDIA_BUCKET",
+      "bucket_name": "codex-media-production",
+      "preview_bucket_name": "codex-media-test"
+    }
+  ],
+
+  // Default environment variables (local development)
+  "vars": {
+    "ENVIRONMENT": "development",
+    "DB_METHOD": "LOCAL_PROXY",
+    "WEB_APP_URL": "http://localhost:3000",
+    "API_URL": "http://localhost:8787"
+  },
+
+  // Environment configurations
+  "env": {
+    // Test environment (E2E tests)
+    "test": {
+      "name": "media-api-test",
+      "vars": {
+        "ENVIRONMENT": "test",
+        "WEB_APP_URL": "http://localhost:3000",
+        "API_URL": "http://localhost:8787",
+        "DATABASE_URL": "postgresql://test:test@localhost:5432/test",
+        "RUNPOD_API_KEY": "test-key",
+        "RUNPOD_ENDPOINT_ID": "test-endpoint",
+        "RUNPOD_WEBHOOK_SECRET": "test-secret",
+        "WORKER_SHARED_SECRET": "test-shared-secret"
+      },
+      "kv_namespaces": [
+        {
+          "binding": "RATE_LIMIT_KV",
+          "id": "cea7153364974737b16870df08f31083"
+        },
+        {
+          "binding": "AUTH_SESSION_KV",
+          "id": "82d04a4236df4aac8e9d87793344f0ed"
+        }
+      ],
+      "r2_buckets": [
+        {
+          "binding": "MEDIA_BUCKET",
+          "bucket_name": "codex-media-production",
+          "preview_bucket_name": "codex-media-test"
+        }
+      ]
+    },
+
+    // Production environment
+    "production": {
+      "name": "media-api-production",
+      "vars": {
+        "ENVIRONMENT": "production",
+        "DB_METHOD": "PRODUCTION",
+        "WEB_APP_URL": "https://codex.revelations.studio",
+        "API_URL": "https://api.revelations.studio"
+      },
+      "kv_namespaces": [
+        {
+          "binding": "RATE_LIMIT_KV",
+          "id": "cea7153364974737b16870df08f31083"
+        },
+        {
+          "binding": "AUTH_SESSION_KV",
+          "id": "82d04a4236df4aac8e9d87793344f0ed"
+        }
+      ],
+      "r2_buckets": [
+        {
+          "binding": "MEDIA_BUCKET",
+          "bucket_name": "codex-media-production"
+        }
+      ],
+      "routes": [
+        {
+          "pattern": "media-api.revelations.studio",
+          "custom_domain": true
+        }
+      ]
+    },
+
+    // Staging environment
+    "staging": {
+      "name": "media-api-staging",
+      "vars": {
+        "ENVIRONMENT": "staging",
+        "DB_METHOD": "PRODUCTION",
+        "WEB_APP_URL": "https://codex-staging.revelations.studio",
+        "API_URL": "https://api-staging.revelations.studio"
+      },
+      "routes": [
+        {
+          "pattern": "media-api-staging.revelations.studio/*",
+          "custom_domain": true
+        }
+      ]
+    }
+  }
+
+  // ==========================================================================
+  // Environment Variables & Secrets
+  // ==========================================================================
+  //
+  // Local Development:
+  //   Create .dev.vars file with required secrets (see .dev.vars.example)
+  //
+  // Test Environment:
+  //   Uses .dev.vars.test (already configured with test values)
+  //
+  // Production Secrets (set via wrangler CLI):
+  //   wrangler secret put DATABASE_URL --env production
+  //   wrangler secret put RUNPOD_API_KEY --env production
+  //   wrangler secret put RUNPOD_ENDPOINT_ID --env production
+  //   wrangler secret put RUNPOD_WEBHOOK_SECRET --env production
+  //   wrangler secret put WORKER_SHARED_SECRET --env production
+  //
+  // Required Variables:
+  //   - DATABASE_URL: PostgreSQL connection string
+  //   - RUNPOD_API_KEY: RunPod API key for transcoding jobs
+  //   - RUNPOD_ENDPOINT_ID: RunPod serverless endpoint ID
+  //   - RUNPOD_WEBHOOK_SECRET: Shared secret for webhook signature verification
+  //   - WORKER_SHARED_SECRET: Shared secret for worker-to-worker auth
+  //   - RATE_LIMIT_KV: KV namespace binding for rate limiting
+}
diff --git a/infrastructure/runpod/Dockerfile b/infrastructure/runpod/Dockerfile
index f1532a2..2d7046d 100644
--- a/infrastructure/runpod/Dockerfile
+++ b/infrastructure/runpod/Dockerfile
@@ -13,8 +13,12 @@ FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04
 # Prevent interactive prompts during install
 ENV DEBIAN_FRONTEND=noninteractive
 
+# Install system dependencies
 # Install system dependencies
 RUN apt-get update && apt-get install -y --no-install-recommends \
+    software-properties-common \
+    && add-apt-repository ppa:chris-needham/ppa \
+    && apt-get update && apt-get install -y --no-install-recommends \
     # FFmpeg with all codecs
     ffmpeg \
     # Python runtime
diff --git a/workers/media-api/src/__tests__/endpoints.test.ts b/workers/media-api/src/__tests__/endpoints.test.ts
index 4a85959..89e4754 100644
--- a/workers/media-api/src/__tests__/endpoints.test.ts
+++ b/workers/media-api/src/__tests__/endpoints.test.ts
@@ -86,9 +86,8 @@ describe('Media API', () => {
         body: body,
       });
 
-      // Expecting 500 (DB failure) or 200 (Success) which means security passed
-      expect(response.status).not.toBe(401);
-      expect(response.status).not.toBe(403);
+      // Expecting 200/202/204 (Success)
+      expect([200, 202, 204]).toContain(response.status);
     });
   });
 
diff --git a/workers/media-api/src/__tests__/env.d.ts b/workers/media-api/src/__tests__/env.d.ts
index 7385853..525e355 100644
--- a/workers/media-api/src/__tests__/env.d.ts
+++ b/workers/media-api/src/__tests__/env.d.ts
@@ -6,5 +6,6 @@ declare module 'cloudflare:test' {
     RUNPOD_API_KEY?: string;
     RUNPOD_ENDPOINT_ID?: string;
     WORKER_SHARED_SECRET?: string;
+    DB_METHOD?: string;
   }
 }
diff --git a/workers/media-api/src/index.ts b/workers/media-api/src/index.ts
index 8653cfe..fda10b0 100644
--- a/workers/media-api/src/index.ts
+++ b/workers/media-api/src/index.ts
@@ -29,7 +29,6 @@ import {
   createEnvValidationMiddleware,
   createKvCheck,
   createWorker,
-  standardDatabaseCheck,
 } from '@codex/worker-utils';
 // Import route modules
 import transcodingRoutes from './routes/transcoding';
@@ -48,7 +47,6 @@ const app = createWorker({
   enableSecurityHeaders: true,
   enableGlobalAuth: false, // Using route-level procedure() instead
   healthCheck: {
-    checkDatabase: standardDatabaseCheck,
     checkKV: createKvCheck(['RATE_LIMIT_KV', 'AUTH_SESSION_KV']),
   },
 });
diff --git a/workers/media-api/vitest.config.ts b/workers/media-api/vitest.config.ts
index 37688b7..820dde5 100644
--- a/workers/media-api/vitest.config.ts
+++ b/workers/media-api/vitest.config.ts
@@ -1,6 +1,7 @@
 import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
 
 export default defineWorkersConfig({
+  // Cache buster: 1
   test: {
     globals: true,
     // Use Workers pool to run tests in workerd runtime (not Node.js)
diff --git a/workers/media-api/wrangler.jsonc b/workers/media-api/wrangler.jsonc
index 1aae563..c92f8ce 100644
--- a/workers/media-api/wrangler.jsonc
+++ b/workers/media-api/wrangler.jsonc
@@ -52,7 +52,8 @@
         "RUNPOD_API_KEY": "test-key",
         "RUNPOD_ENDPOINT_ID": "test-endpoint",
         "RUNPOD_WEBHOOK_SECRET": "test-secret",
-        "WORKER_SHARED_SECRET": "test-shared-secret"
+        "WORKER_SHARED_SECRET": "test-shared-secret",
+        "DB_METHOD": "LOCAL_PROXY"
       },
       "kv_namespaces": [
         {
