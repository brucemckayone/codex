# Codex Infrastructure Plan - Cloudflare + Neon Architecture

![Infrastructure Architecture Diagram](assets/infraplan.png)

## Architecture Philosophy

**Cloudflare + Neon Hybrid**: Leverage Cloudflare's global edge network for hosting, storage, and edge compute, combined with Neon's serverless Postgres for reliable, production-grade database operations. Use external services where specialized: RunPod for GPU processing, Neon for transactional data.

## Core Services Stack

### Cloudflare Platform

#### 1. Cloudflare Pages

- **Purpose**: Frontend hosting, static assets, SSR
- **Hosts**: Svelte Kit application
- **Features**:
  - Global CDN
  - Automatic HTTPS
  - Preview deployments
  - Edge rendering
  - Integrated with Workers

#### 2. Cloudflare Workers

- **Purpose**: Background job processing (queue consumers)
- **Use Cases**:
  - Queue consumer for video processing jobs
  - Dispatching jobs to RunPod GPU
  - Processing RunPod webhooks (optional, can use SvelteKit)

**Note**: Most API routes are handled by SvelteKit's `+server.ts` files, not separate Workers. Workers are primarily used for queue consumers and long-running background tasks.

#### 3. Neon Postgres (External Service)

- **Purpose**: Primary database for all relational data
- **Stores**:
  - User accounts
  - Content metadata (videos, posts)
  - Purchases and subscriptions
  - Access control records
  - Platform settings
  - Session data (via BetterAuth)

**Why Neon over Cloudflare D1?**

- **Production-grade Postgres**: ACID transactions, proper concurrency
- **Serverless**: Scales to zero like D1, pay per usage
- **Battle-tested**: Standard Postgres, not SQLite limitations
- **Payment safety**: Handles concurrent purchases reliably
- **No vendor lock-in**: Easy migration to any Postgres provider
- **Future-proof**: Complex analytics queries, JOINs perform well
- **BetterAuth native support**: Official Postgres adapter
- **Cost**: $5/month minimum (same as D1 at scale)

**Connection**:

- SvelteKit connects via Neon's serverless driver
- Connection pooling built-in (pgBouncer)
- ~50-100ms latency (acceptable for database operations)

#### 4. Cloudflare KV

- **Purpose**: Key-value store for fast reads
- **Stores**:
  - Auth sessions (Better Auth)
  - Temporary tokens
  - Rate limiting counters
  - Cache data
  - Feature flags
  - User preferences

**Why KV?**

- Ultra-low latency (edge caching)
- Perfect for session data
- High read performance
- TTL support

#### 5. Cloudflare Queues

- **Purpose**: Message queue for async job processing
- **Use Cases**:
  - Video upload → transcode job
  - New user → welcome email
  - Purchase → receipt generation
  - Content publish → notifications
  - Sync jobs between Workers and RunPod

**Why Queues?**

- Reliable message delivery
- At-least-once delivery
- Integrates with Workers
- Dead letter queue support

#### 6. Cloudflare R2

- **Purpose**: Object storage (S3-compatible)
- **Stores**:
  - Original uploaded videos
  - Transcoded video outputs
  - Generated thumbnails
  - Audio files
  - Images and assets
  - User uploads
  - Subtitle files (.srt, .vtt)

**Why R2?**

- No egress fees (huge cost saving)
- S3-compatible API
- Global availability
- Integrated with Workers

### External Services

#### RunPod Serverless GPU

- **Purpose**: GPU-accelerated processing
- **Use Cases**:
  - Video transcoding (FFmpeg on GPU)
  - Audio transcription (Whisper)
  - Subtitle generation
  - Image processing
  - Thumbnail generation from video
  - AI-powered content analysis

**Why RunPod?**

- Pay-per-second GPU usage
- No idle costs
- Fast cold starts
- Multiple GPU types
- API-driven
- Cost-effective for sporadic GPU workloads

**How it Works**:

1. SvelteKit endpoint receives upload request
2. Generate presigned R2 URL, return to client
3. Client uploads directly to R2
4. SvelteKit endpoint creates Neon record (status: processing)
5. SvelteKit sends job to Cloudflare Queue (or calls RunPod directly for MVP)
6. Queue consumer Worker (or direct API call) triggers RunPod
7. RunPod processes video (transcode to 720p/1080p, generate thumbnails)
8. RunPod uploads outputs to R2
9. RunPod calls webhook (SvelteKit endpoint)
10. SvelteKit endpoint updates Neon with processed file URLs

## Data Flow Examples

### Video Upload & Processing

```
1. Platform Owner selects video file in admin UI
   ↓
2. SvelteKit endpoint: POST /api/admin/upload/presigned-url
   ↓
3. SvelteKit generates presigned R2 upload URL
   ↓
4. Client uploads video directly to R2 (videos/original/{uuid}.mp4)
   ↓
5. Client: POST /api/admin/content
   { videoKey, title, description, ... }
   ↓
6. SvelteKit creates Neon record:
   - content.status = 'processing'
   - content.video_original_url = R2 URL
   ↓
7. SvelteKit sends job to Cloudflare Queue
   OR calls RunPod API directly (MVP approach)
   ↓
8. (If using Queue) Worker consumes job, calls RunPod API
   ↓
9. RunPod downloads from R2, processes:
   - Transcodes to 1080p (H.264, good quality)
   - Transcodes to 720p (H.264, mobile fallback)
   - Generates thumbnail (frame at 2 seconds)
   - (Phase 2: Extracts audio, generates subtitles with Whisper)
   ↓
10. RunPod uploads outputs to R2:
    - videos/1080p/{content_id}.mp4
    - videos/720p/{content_id}.mp4
    - thumbnails/{content_id}.jpg
   ↓
11. RunPod webhook: POST /api/webhooks/runpod
    { content_id, output_urls: {...} }
   ↓
12. SvelteKit endpoint updates Neon:
    - video_1080p_url
    - video_720p_url
    - thumbnail_url
    - status: 'published'
   ↓
13. Video now appears on platform, ready to watch
```

**MVP Simplification**: For initial launch, can skip Cloudflare Queue and call RunPod API directly from SvelteKit endpoint. Add queue in Phase 2 for better reliability.

### User Authentication

```
1. User submits login form
   ↓
2. SvelteKit form action: POST /login (form action)
   ↓
3. BetterAuth handles authentication:
   - Queries Neon for user credentials
   - Validates password hash (BetterAuth handles hashing algorithm)
   - Creates session in Neon database
   ↓
4. BetterAuth (via sveltekitCookies plugin) sets session cookie
   ↓
5. Response redirects to /dashboard or /library
   ↓
6. Subsequent requests:
   - SvelteKit hooks.server.ts calls BetterAuth.getSession()
   - BetterAuth queries Neon for session
   - Populates event.locals.user and event.locals.session
   ↓
7. Protected routes check event.locals.user
```

**Note**: BetterAuth handles all session management, password hashing (uses modern secure algorithms), and cookie security. We use Neon for session storage (can optionally use KV for caching, but Postgres is fine for MVP).

### Content Purchase

```
1. Customer clicks "Purchase" on content detail page
   ↓
2. SvelteKit endpoint: POST /api/purchases
   { content_id, payment_method: 'card' }
   ↓
3. SvelteKit creates Stripe Payment Intent:
   - Amount from content.price
   - Metadata: { user_id, content_id }
   - Returns client_secret
   ↓
4. Client renders Stripe payment form
   Customer enters card details
   Stripe processes payment
   ↓
5. Stripe webhook: POST /api/webhooks/stripe
   { type: 'payment_intent.succeeded', ... }
   ↓
6. SvelteKit webhook handler:
   - Verifies Stripe signature
   - Checks payment status
   ↓
7. SvelteKit updates Neon (in transaction):
   - Creates purchase record (status: 'completed')
   - Creates content_access record (grants access)
   ↓
8. SvelteKit sends receipt email via Resend API
   ↓
9. Frontend polls GET /api/purchases/{id} until status = 'completed'
   ↓
10. Customer redirected to /watch/{content_id} or /read/{content_id}
```

**Critical**: Payment operations use Postgres transactions to ensure purchase and access grant are atomic. If either fails, both roll back.

---

## Database Schema

Database schema and table definitions are documented separately in:

- **[Database Schema Design](./DatabaseSchema.md)** - Complete table definitions, relationships, and migrations

## Environment Configuration

Environment-specific configuration and deployment strategies are documented in:

- **[Environment Management Guide](./EnvironmentManagement.md)** - Local development, staging, and production setup

### Required Environment Variables (All Environments)

```bash
# Database
DATABASE_URL=              # Neon Postgres connection string

# Cloudflare R2
R2_BUCKET_NAME=           # codex-media-{env}
R2_ACCESS_KEY_ID=         # R2 access key
R2_SECRET_ACCESS_KEY=     # R2 secret key
R2_PUBLIC_URL=            # Public R2 domain

# RunPod
RUNPOD_API_KEY=           # RunPod API key
RUNPOD_ENDPOINT_ID=       # Serverless endpoint ID

# Stripe
STRIPE_SECRET_KEY=        # sk_test_... (dev) or sk_live_... (prod)
STRIPE_WEBHOOK_SECRET=    # whsec_... (unique per environment)
STRIPE_PUBLISHABLE_KEY=   # pk_test_... or pk_live_...

# BetterAuth
AUTH_SECRET=              # Random 32+ character string
AUTH_URL=                 # http://localhost:5173 (dev) or https://yourdomain.com (prod)

# Email
RESEND_API_KEY=           # Resend API key

# Optional: Cloudflare KV (if using for session caching)
KV_NAMESPACE_ID=          # Cloudflare KV namespace ID
```

See [EnvironmentManagement.md](./EnvironmentManagement.md) for detailed setup instructions per environment.

## Cost Estimation (MVP - Month 1-3)

### Fixed Costs

| Service                | Tier             | Monthly Cost  |
| ---------------------- | ---------------- | ------------- |
| **Neon Postgres**      | Launch           | $5 minimum    |
| **Cloudflare Pages**   | Free             | $0            |
| **Cloudflare Workers** | Paid ($5)        | $5            |
| **Resend Email**       | Free (3k emails) | $0            |
|                        | **Fixed Total**  | **$10/month** |

### Variable Costs (Usage-Based)

#### Neon Postgres

- **Compute**: $0.14/CU-hour
  - Estimate: ~30 CU-hours/month (light traffic) = $4.20
  - Covered by $5 minimum
- **Storage**: $0.35/GB-month
  - Estimate: ~2GB (metadata only, videos in R2) = $0.70
  - Covered by $5 minimum

**Neon Total**: $5/month (minimum billing)

#### Cloudflare R2

- **Storage**: $0.015/GB-month
  - Estimate: 100GB (50 videos × 2GB avg) = $1.50
- **Egress**: $0 (free!)
- **Operations**: Negligible (Class A/B operations ~$0.50)

**R2 Total**: ~$2/month

#### RunPod Serverless GPU

- **GPU**: $0.0002/second (A4000)
- **Processing time**: ~5 minutes per 1-hour video
  - 1 video: 300 seconds × $0.0002 = $0.06
  - 50 videos/month: 50 × $0.06 = $3
  - 100 videos/month: $6

**RunPod Total**: $3-10/month

#### Cloudflare Queues (if used)

- **Operations**: $0.40/million operations
- **Estimate**: ~10k operations/month = negligible

**Queues Total**: <$1/month

#### Stripe

- **Percentage**: 2.9% + $0.30 per transaction
- **Example**: 20 sales @ $30 avg = $600 revenue
  - Fees: (20 × $0.30) + ($600 × 0.029) = $6 + $17.40 = $23.40
- **Not infrastructure cost** (comes out of revenue)

### Total Monthly Cost (MVP)

| Scenario         | Videos Uploaded | Storage Used | Monthly Cost |
| ---------------- | --------------- | ------------ | ------------ |
| **Light Usage**  | 20 videos       | 40GB         | $15-20       |
| **Medium Usage** | 50 videos       | 100GB        | $20-25       |
| **Heavy Usage**  | 100 videos      | 200GB        | $25-30       |

**Expected MVP Cost**: **$20-30/month**

### Cost at Scale (Year 1)

| Metric              | Estimate         | Monthly Cost      |
| ------------------- | ---------------- | ----------------- |
| Neon (more traffic) | 200 CU-hours     | $28               |
| R2 Storage          | 500GB            | $8                |
| RunPod              | 200 videos/month | $12               |
| Workers             | 5M requests      | $5                |
|                     | **Total**        | **~$50-60/month** |

### Cost Optimization Notes

1. **Biggest savings: R2 over S3/Cloudflare Stream**
   - R2: $0.015/GB storage + $0 egress
   - S3: $0.023/GB storage + $0.09/GB egress (9x more!)
   - Cloudflare Stream: $5 + $1/1000 minutes stored (very expensive)

2. **Neon serverless scales to zero**
   - Only pay for compute when database is active
   - Storage is cheap ($0.70 for 2GB)

3. **RunPod pay-per-second**
   - No idle costs vs dedicated GPU server ($500+/month)
   - Only pay during video processing (~5 min per video)

4. **Future optimization paths**:
   - Cache Neon queries in Cloudflare KV (reduce CU-hours)
   - Batch video processing jobs (optimize RunPod usage)
   - Use Cloudflare Images for thumbnails (automatic optimization)

---

## Migration & Vendor Lock-in Assessment

### Easy to Migrate (No Lock-in)

✅ **Neon Postgres** → Any Postgres provider

- Standard `pg_dump` / `pg_restore`
- Migration time: <1 hour
- Targets: AWS RDS, Supabase, Railway, self-hosted

✅ **Cloudflare R2** → AWS S3 or compatible

- S3-compatible API
- `rclone sync` or `aws s3 sync`
- Migration time: Few hours (depends on data size)

✅ **SvelteKit** → Any Node.js host

- Standard SvelteKit adapter swap
- Targets: Vercel, Netlify, self-hosted
- Migration time: <1 hour

### Moderate Migration Effort

⚠️ **Cloudflare Pages** → Vercel/Netlify

- Mostly environment variable changes
- May need adapter adjustments
- Migration time: 2-4 hours

⚠️ **Cloudflare Workers** → AWS Lambda/Vercel Functions

- Code mostly portable (standard Web APIs)
- Queue consumers need rewrite
- Migration time: 4-8 hours

### Vendor-Specific (Acceptable)

🔒 **Cloudflare Queues** → AWS SQS/RabbitMQ

- Queue consumer logic needs rewrite
- But queues are optional (can call RunPod directly)
- Migration time: 8-16 hours

🔒 **Cloudflare KV** → Redis/Upstash

- Key-value semantics mostly portable
- Mainly used for caching (not critical data)
- Migration time: 4-8 hours

**Risk Assessment**: **LOW**

- Critical data (Postgres) has zero lock-in
- Most infrastructure is portable or replaceable
- Total migration time estimate: 1-2 weeks if needed
