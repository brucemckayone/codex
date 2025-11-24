# Codex Platform - Specialized Implementation Agents

This directory contains specialized AI agents designed to implement specific work packets in the Codex platform. Each agent has deep knowledge of the relevant APIs, design patterns, and architectural decisions.

---

## Agent Directory

| Agent | Work Packet | Specialization |
|-------|-------------|----------------|
| [content-service-agent](#content-service-agent) | P1-CONTENT-001 | Content management, media items, Drizzle ORM |
| [content-access-agent](#content-access-agent) | P1-ACCESS-001 | Access control, R2 signed URLs, playback tracking |
| [stripe-checkout-agent](#stripe-checkout-agent) | P1-ECOM-001 | Stripe Checkout API, payment intents, idempotency |
| [stripe-webhook-agent](#stripe-webhook-agent) | P1-ECOM-002 | Stripe webhooks, HMAC verification, event routing |
| [transcoding-agent](#transcoding-agent) | P1-TRANSCODE-001 | RunPod API, FFmpeg, HLS streaming, webhook callbacks |
| [admin-dashboard-agent](#admin-dashboard-agent) | P1-ADMIN-001 | SQL aggregations, role-based auth, analytics |
| [notification-agent](#notification-agent) | P1-NOTIFY-001 | Resend API, email templates, PII redaction |
| [platform-settings-agent](#platform-settings-agent) | P1-SETTINGS-001 | R2 file uploads, upsert patterns, branding |

---

## Usage

To invoke an agent for a specific work packet:

```bash
# Using Claude Code
/task Use the stripe-checkout-agent to implement P1-ECOM-001

# Using Claude API
Use the stripe-checkout-agent personality to implement Stripe checkout integration
```

---

## Agent Specifications

### content-service-agent

**Work Packet**: P1-CONTENT-001 - Content Service
**Status**: ✅ Completed (use for reference/updates)

**Expertise**:
- Drizzle ORM query patterns (scoped queries, soft deletes, pagination)
- Content lifecycle management (draft → published → archived)
- Media item status transitions (uploading → uploaded → transcoding → ready)
- Slug generation and uniqueness validation
- BaseService pattern extension
- Custom error classes (ContentNotFoundError, MediaNotReadyError, SlugConflictError)

**Key APIs & Tools**:
- **Drizzle ORM**: Query builders, schema inference, migrations
- **@codex/database**: `scopedNotDeleted()`, `withPagination()`, `creatorScope()`
- **@codex/validation**: Zod schemas for content and media validation
- **Context7 MCP**: For Drizzle ORM documentation lookups

**Design Patterns to Implement**:
1. Scoped query pattern (organization + creator + not deleted)
2. Status transition validation (prevent invalid state changes)
3. Soft delete pattern (set deletedAt timestamp)

**References**:
- Work packet: `design/roadmap/work-packets/P1-CONTENT-001-content-service.md`
- Actual implementation: `packages/content/src/services/`

---

### content-access-agent

**Work Packet**: P1-ACCESS-001 - Content Access
**Status**: 🚧 Not Started (blocked by P1-ECOM-001)

**Expertise**:
- Access control rules (free, purchased, members-only)
- R2 signed URL generation (time-limited streaming URLs)
- Playback progress tracking (upsert pattern for resume functionality)
- Purchase verification logic
- BaseService pattern extension

**Key APIs & Tools**:
- **Cloudflare R2 SDK**: Signed URL generation, expiration policies
- **@codex/cloudflare-clients**: `R2Service.generateSignedUrl()`
- **@codex/database**: Purchase verification queries
- **Context7 MCP**: For Cloudflare R2 documentation

**Design Patterns to Implement**:
1. Access verification chain (check free → check purchase → check membership)
2. Time-limited URL generation (1-hour expiration for streaming)
3. Upsert pattern for playback progress (unique constraint on user + content)

**References**:
- Work packet: `design/roadmap/work-packets/P1-ACCESS-001-content-access.md`
- R2 client: `packages/cloudflare-clients/src/r2/`

**Important Notes**:
- Phase 1: Implement free content + playback tracking only
- Phase 2: Add purchase verification (requires P1-ECOM-001 completion)
- Phase 3: Add membership verification (requires organization membership)

---

### stripe-checkout-agent

**Work Packet**: P1-ECOM-001 - Stripe Checkout
**Status**: 🚧 Not Started

**Expertise**:
- Stripe Checkout Sessions API (create, retrieve, expire)
- Payment Intent lifecycle (requires_payment_method → succeeded)
- Idempotent purchase recording (prevent duplicate charges)
- Revenue split calculations (70% creator, 30% platform)
- Service factory pattern (BaseService + Stripe SDK)
- Money handling (integer cents, no floating point)

**Key APIs & Tools**:
- **Stripe SDK**: `stripe.checkout.sessions.create()`, `stripe.paymentIntents.retrieve()`
- **Stripe API Version**: `2024-11-20.acacia`
- **@codex/database**: Purchase table upserts
- **Context7 MCP**: For Stripe API documentation
- **Web Search**: For latest Stripe best practices

**Design Patterns to Implement**:
1. **Service Factory Pattern**:
   ```typescript
   export class PurchaseService extends BaseService {
     private stripe: Stripe;
     constructor(config: ServiceConfig & { stripeSecretKey: string }) {
       super(config);
       this.stripe = new Stripe(config.stripeSecretKey, { apiVersion: '2024-11-20.acacia' });
     }
   }
   ```

2. **Idempotent Purchase Recording**:
   ```typescript
   async completePurchase(paymentIntentId: string): Promise<Purchase> {
     // Check if already processed
     const existing = await this.db.query.purchases.findFirst({
       where: eq(purchases.stripePaymentIntentId, paymentIntentId)
     });
     if (existing) return existing; // Idempotent
     // Process purchase...
   }
   ```

3. **Money Handling**:
   ```typescript
   // ALWAYS store as integer cents
   const priceCents = 2999; // $29.99
   const platformFeeCents = Math.round(priceCents * 0.30); // 900 cents
   const creatorShareCents = priceCents - platformFeeCents; // 2099 cents
   ```

**Stripe Checkout Flow**:
1. Create Checkout Session with `line_items` (price in cents)
2. Redirect user to Stripe-hosted checkout page
3. User completes payment → `checkout.session.completed` webhook fires
4. Retrieve Payment Intent to get final amount and status
5. Record purchase with `stripePaymentIntentId` (idempotency key)
6. Calculate revenue split and store in `purchases` table

**Security Considerations**:
- NEVER trust client-provided prices (fetch from database)
- Validate `organizationId` matches content owner
- Use Stripe Payment Intent ID as idempotency key
- Store all amounts as integer cents (no floating point)

**References**:
- Work packet: `design/roadmap/work-packets/P1-ECOM-001-stripe-checkout.md`
- Stripe Docs: https://stripe.com/docs/checkout/quickstart
- Service pattern: `packages/content/src/services/content-service.ts` (reference)

**Environment Variables Required**:
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=https://yourdomain.com/success
STRIPE_CANCEL_URL=https://yourdomain.com/cancel
```

---

### stripe-webhook-agent

**Work Packet**: P1-ECOM-002 - Stripe Webhooks
**Status**: 🏗️ 50% Complete (infrastructure exists, needs handler wiring)

**Expertise**:
- Stripe webhook signature verification (HMAC-SHA256)
- Event routing pattern (map event types to handlers)
- Thin handler pattern (delegate to services)
- Webhook idempotency (handle duplicate events)
- Error handling (always return 200, log failures)

**Key APIs & Tools**:
- **Stripe SDK**: `stripe.webhooks.constructEvent()` for signature verification
- **@codex/database**: Purchase table updates
- **Context7 MCP**: For Stripe webhook documentation
- **Web Search**: For Stripe webhook best practices

**Design Patterns to Implement**:
1. **HMAC Signature Verification**:
   ```typescript
   export function verifyStripeSignature(
     payload: string,
     signature: string,
     secret: string
   ): Stripe.Event {
     try {
       return stripe.webhooks.constructEvent(payload, signature, secret);
     } catch (err) {
       throw new Error('Invalid signature');
     }
   }
   ```

2. **Event Router Pattern**:
   ```typescript
   const eventHandlers: Record<string, WebhookHandler> = {
     'checkout.session.completed': handleCheckoutCompleted,
     'payment_intent.succeeded': handlePaymentIntentSucceeded,
     'charge.refunded': handleChargeRefunded,
   };

   export async function routeWebhookEvent(event: Stripe.Event, env: Env): Promise<void> {
     const handler = eventHandlers[event.type];
     if (!handler) {
       log.warn('Unknown webhook event type', { type: event.type });
       return; // Ignore unknown events
     }
     await handler(event, env);
   }
   ```

3. **Thin Handler Pattern**:
   ```typescript
   // GOOD: Thin handler delegates to service
   export async function handleCheckoutCompleted(event: Stripe.Event, env: Env) {
     const session = event.data.object as Stripe.Checkout.Session;
     const paymentIntentId = session.payment_intent as string;

     // Delegate to service (all business logic there)
     const purchaseService = createPurchaseService(env);
     await purchaseService.completePurchase(paymentIntentId);
   }
   ```

**Webhook Events to Handle**:
- `checkout.session.completed` → Record purchase, trigger receipt email
- `payment_intent.succeeded` → Update payment status
- `charge.refunded` → Mark purchase as refunded, revoke access

**Security Considerations**:
- ALWAYS verify webhook signature before processing
- Return 200 immediately (Stripe retries on non-200)
- Log failures but don't throw errors (prevents retry storms)
- Use idempotent operations (purchases table has unique constraint)

**References**:
- Work packet: `design/roadmap/work-packets/P1-ECOM-002-stripe-webhooks.md`
- Existing worker: `workers/stripe-webhook-handler/`
- Stripe webhook docs: https://stripe.com/docs/webhooks

**Important Notes**:
- Worker skeleton exists, needs handler wiring
- Signature verification middleware complete
- Security headers and rate limiting configured

---

### transcoding-agent

**Work Packet**: P1-TRANSCODE-001 - Media Transcoding
**Status**: 🚧 Not Started

**Expertise**:
- RunPod Serverless API (trigger GPU jobs, webhook callbacks)
- FFmpeg video transcoding (HLS, adaptive bitrate streaming)
- Audiowaveform generation (waveform visualization)
- Docker containerization (custom RunPod images)
- Async job pattern with webhook callbacks
- Retry logic with attempt counters

**Key APIs & Tools**:
- **RunPod API**: `POST /v2/{endpoint_id}/run` to trigger jobs
- **FFmpeg**: Video transcoding, HLS segmentation, quality variants
- **Audiowaveform**: Waveform data generation for audio visualization
- **@codex/cloudflare-clients**: R2 upload for transcoded files
- **Context7 MCP**: For FFmpeg and RunPod documentation
- **Web Search**: For latest FFmpeg HLS best practices

**Design Patterns to Implement**:
1. **Async Job with Webhook Callback**:
   ```typescript
   export class TranscodingService extends BaseService {
     async triggerJob(mediaId: string, userId: string): Promise<void> {
       const media = await this.getMediaItem(mediaId, userId);

       // Call RunPod API
       const response = await fetch(
         `https://api.runpod.ai/v2/${this.runpodEndpointId}/run`,
         {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${this.runpodApiKey}`,
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({
             input: {
               mediaId: media.id,
               type: media.mediaType,
               inputKey: media.r2Key,
               webhookUrl: `${this.webhookBaseUrl}/api/transcoding/webhook`,
             },
           }),
         }
       );

       // Update status to 'transcoding'
       await this.updateMediaStatus(mediaId, 'transcoding');
     }
   }
   ```

2. **HMAC Webhook Verification**:
   ```typescript
   export function verifyRunPodSignature(
     payload: string,
     signature: string,
     secret: string
   ): boolean {
     const hmac = crypto.createHmac('sha256', secret);
     const expectedSignature = hmac.update(payload).digest('hex');
     return crypto.timingSafeEqual(
       Buffer.from(signature),
       Buffer.from(expectedSignature)
     );
   }
   ```

3. **Retry with Attempt Counter**:
   ```typescript
   async retryTranscoding(mediaId: string, userId: string): Promise<void> {
     const media = await this.getMediaItem(mediaId, userId);

     // Check retry limit (max 1 retry)
     if (media.transcodingAttempts >= 1) {
       throw new ValidationError('Maximum retry attempts reached');
     }

     // Reset status and increment attempts
     await this.db.update(mediaItems)
       .set({
         status: 'uploaded',
         transcodingAttempts: media.transcodingAttempts + 1,
         transcodingError: null,
       })
       .where(eq(mediaItems.id, mediaId));

     // Trigger new job
     await this.triggerJob(mediaId, userId);
   }
   ```

**FFmpeg HLS Transcoding Command**:
```bash
ffmpeg -i input.mp4 \
  -vf scale=w=1920:h=1080:force_original_aspect_ratio=decrease \
  -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k \
  -hls_time 10 -hls_playlist_type vod \
  -hls_segment_filename "output_%03d.ts" \
  output.m3u8
```

**HLS Quality Variants**:
- 1080p: 1920x1080, 5000 kbps
- 720p: 1280x720, 2500 kbps
- 480p: 854x480, 1000 kbps
- 360p: 640x360, 600 kbps

**RunPod Docker Image**:
```dockerfile
FROM runpod/pytorch:3.10-2.0.0-117

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Install audiowaveform
RUN apt-get install -y audiowaveform

# Copy handler script
COPY handler.py /handler.py

CMD ["python", "/handler.py"]
```

**Webhook Payload**:
```json
{
  "mediaId": "uuid",
  "status": "completed",
  "outputs": {
    "m3u8Key": "transcoded/uuid/master.m3u8",
    "waveformKey": "waveforms/uuid.json"
  },
  "error": null
}
```

**References**:
- Work packet: `design/roadmap/work-packets/P1-TRANSCODE-001-media-transcoding.md`
- RunPod docs: https://docs.runpod.io/serverless/overview
- FFmpeg HLS: https://ffmpeg.org/ffmpeg-formats.html#hls-2

**Important Notes**:
- Transcoding is expensive (GPU time costs money)
- Limit retries to 1 attempt (prevent cost spirals)
- Store waveform data separately (audio visualization)

---

### admin-dashboard-agent

**Work Packet**: P1-ADMIN-001 - Admin Dashboard
**Status**: 🚧 Not Started

**Expertise**:
- SQL aggregations (SUM, COUNT, GROUP BY in database, not application)
- Role-based middleware composition (requireAuth + requirePlatformOwner)
- Revenue analytics (total revenue, daily breakdown, top content)
- Organization scoping (all queries filtered by organizationId)
- Manual access grants (support/refund workflow)

**Key APIs & Tools**:
- **Drizzle ORM**: SQL aggregations with `sql` template literals
- **@codex/database**: Aggregation query helpers
- **@codex/security**: `requirePlatformOwner()` middleware
- **Context7 MCP**: For PostgreSQL aggregation patterns

**Design Patterns to Implement**:
1. **Role-Based Middleware Composition**:
   ```typescript
   // Two-step authorization
   app.use('*', requireAuth());           // Step 1: JWT validation
   app.use('*', requirePlatformOwner());  // Step 2: Role check (platform_owner only)

   // All routes now guaranteed to have platform owner user
   app.get('/api/admin/analytics/revenue', async (c) => {
     const user = c.get('user'); // Guaranteed: user.role === 'platform_owner'
     // ...
   });
   ```

2. **Database Aggregation (Not Application Code)**:
   ```typescript
   import { sql, eq, and, count } from 'drizzle-orm';

   async getRevenueStats(organizationId: string, params: { startDate?: Date; endDate?: Date }) {
     const conditions = [
       eq(purchases.organizationId, organizationId),
       eq(purchases.status, 'completed'),
     ];

     if (params.startDate) conditions.push(gte(purchases.createdAt, params.startDate));
     if (params.endDate) conditions.push(lte(purchases.createdAt, params.endDate));

     // Aggregate in database (single query, fast)
     const totals = await this.db
       .select({
         totalRevenueCents: sql<number>`COALESCE(SUM(${purchases.priceCents}), 0)`,
         totalPurchases: count(purchases.id),
       })
       .from(purchases)
       .where(and(...conditions));

     // Daily breakdown (GROUP BY in database)
     const revenueByDay = await this.db
       .select({
         date: sql<string>`DATE(${purchases.createdAt})`,
         revenueCents: sql<number>`SUM(${purchases.priceCents})`,
         count: count(purchases.id),
       })
       .from(purchases)
       .where(and(...conditions))
       .groupBy(sql`DATE(${purchases.createdAt})`)
       .orderBy(sql`DATE(${purchases.createdAt}) DESC`)
       .limit(30); // Last 30 days

     return { totals, revenueByDay };
   }
   ```

3. **Idempotent Manual Access Grant**:
   ```typescript
   async grantContentAccess(organizationId: string, customerId: string, contentId: string): Promise<void> {
     // Validate customer and content exist
     const customer = await this.db.query.users.findFirst({
       where: and(eq(users.id, customerId), eq(users.organizationId, organizationId))
     });
     if (!customer) throw new NotFoundError('Customer not found');

     // Check for existing purchase (idempotency)
     const existingPurchase = await this.db.query.purchases.findFirst({
       where: and(
         eq(purchases.customerId, customerId),
         eq(purchases.contentId, contentId)
       )
     });
     if (existingPurchase) throw new ConflictError('Customer already has access');

     // Create manual grant ($0 purchase, no Stripe references)
     await this.db.insert(purchases).values({
       id: crypto.randomUUID(),
       customerId,
       contentId,
       organizationId,
       priceCents: 0, // Manual grant = free
       status: 'completed',
       stripeCheckoutSessionId: null,
       stripePaymentIntentId: null,
     });
   }
   ```

**SQL Aggregations to Implement**:
- Total revenue: `SUM(price_cents) WHERE status = 'completed'`
- Purchase count: `COUNT(*) WHERE status = 'completed'`
- Average order value: `AVG(price_cents)`
- Revenue by day: `GROUP BY DATE(created_at)`
- Top content: `GROUP BY content_id ORDER BY SUM(price_cents) DESC`

**Platform Owner Role Check**:
```typescript
export function requirePlatformOwner() {
  return async (c: Context<AuthContext>, next: Next) => {
    const user = c.get('user');
    if (!user || user.role !== 'platform_owner') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Platform owner access required' } }, 403);
    }
    await next();
  };
}
```

**References**:
- Work packet: `design/roadmap/work-packets/P1-ADMIN-001-admin-dashboard.md`
- Query helpers: `packages/database/src/utils/query-helpers.ts`

**Important Notes**:
- ALL admin operations require `role = 'platform_owner'`
- ALL queries MUST filter by `organizationId` (multi-tenant ready)
- Aggregate in database, not application code (performance)

---

### notification-agent

**Work Packet**: P1-NOTIFY-001 - Email Notification Service
**Status**: 🚧 Not Started

**Expertise**:
- Resend API (transactional email delivery)
- Email template design (HTML + text versions)
- PII redaction for GDPR compliance (email address logging)
- Strategy pattern (provider-agnostic email)
- Pure template functions (testable, composable)
- MailHog for local development email testing

**Key APIs & Tools**:
- **Resend SDK**: `client.emails.send()` for production email delivery
- **Nodemailer**: SMTP client for MailHog (local dev)
- **@codex/observability**: PII redaction with `redactEmail()`
- **Context7 MCP**: For Resend API documentation
- **Web Search**: For email accessibility best practices

**Design Patterns to Implement**:
1. **Strategy Pattern (Provider-Agnostic Email)**:
   ```typescript
   export interface EmailProvider {
     sendEmail(message: EmailMessage): Promise<{ id: string }>;
   }

   export class ResendEmailProvider implements EmailProvider {
     private client: Resend;
     constructor(apiKey: string) {
       this.client = new Resend(apiKey);
     }

     async sendEmail(message: EmailMessage): Promise<{ id: string }> {
       const response = await this.client.emails.send({
         from: message.from,
         to: message.to,
         subject: message.subject,
         html: message.html,
         text: message.text,
       });
       return { id: response.data!.id };
     }
   }

   // Factory function for dependency injection
   export function getNotificationService(env: Env): NotificationService {
     let emailProvider: EmailProvider;
     if (env.USE_MOCK_EMAIL === 'true') {
       emailProvider = new MockSMTPEmailProvider(env.SMTP_HOST, env.SMTP_PORT);
     } else {
       emailProvider = new ResendEmailProvider(env.RESEND_API_KEY);
     }
     return new NotificationService({ emailProvider, ...env });
   }
   ```

2. **Pure Template Functions**:
   ```typescript
   export function generateVerificationEmail(data: VerificationEmailData): EmailTemplate {
     const subject = 'Verify your email address';

     const html = `
       <!DOCTYPE html>
       <html>
       <body>
         <h1>Welcome, ${escapeHtml(data.userName)}!</h1>
         <p>Please verify your email by clicking the button below:</p>
         <a href="${data.verificationUrl}">Verify Email</a>
         <p>This link will expire in ${data.expiryHours} hours.</p>
       </body>
       </html>
     `;

     const text = `
       Welcome, ${data.userName}!
       Verify your email: ${data.verificationUrl}
       This link expires in ${data.expiryHours} hours.
     `;

     return { subject, html, text };
   }

   // XSS prevention helper
   function escapeHtml(unsafe: string): string {
     return unsafe
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#039;");
   }
   ```

3. **PII Redaction in Logs**:
   ```typescript
   // Add to @codex/observability
   export class ObservabilityClient {
     redactEmail(email: string): string {
       if (!email || !email.includes('@')) return '[invalid-email]';
       const [localPart, domain] = email.split('@');
       const redactedLocal = localPart.length > 0 ? `${localPart[0]}***` : '***';
       return `${redactedLocal}@${domain}`;
     }
   }

   // Usage in notification service
   async sendVerificationEmail(to: string, data: VerificationEmailData) {
     this.obs.info('Sending verification email', {
       to: this.obs.redactEmail(to), // "user@example.com" → "u***@example.com"
       userName: data.userName,
     });

     const template = generateVerificationEmail(data);
     return this.emailProvider.sendEmail({ to, ...template });
   }
   ```

**Email Templates to Implement**:
- Verification email (with time-limited link)
- Password reset email (with secure token)
- Purchase receipt email (with content access link)

**Resend API Example**:
```typescript
const response = await resend.emails.send({
  from: 'noreply@yourdomain.com',
  to: 'customer@example.com',
  subject: 'Receipt for your purchase',
  html: '<h1>Thank you for your purchase!</h1>',
  text: 'Thank you for your purchase!',
  tags: {
    type: 'purchase-receipt',
    environment: 'production',
  },
});
```

**MailHog Local Development**:
```typescript
// docker-compose.dev.local.yml
services:
  mailhog:
    image: mailhog/mailhog:latest
    ports:
      - "1025:1025"  # SMTP
      - "8025:8025"  # Web UI
```

**References**:
- Work packet: `design/roadmap/work-packets/P1-NOTIFY-001-email-service.md`
- Resend docs: https://resend.com/docs/send-with-nodejs
- Email accessibility: https://www.w3.org/WAI/standards-guidelines/wcag/

**Important Notes**:
- ALL emails must have both HTML and text versions (accessibility)
- Email addresses MUST be redacted in logs (GDPR compliance)
- Resend requires sender domain verification (DNS records)

---

### platform-settings-agent

**Work Packet**: P1-SETTINGS-001 - Platform Settings
**Status**: 🚧 Not Started

**Expertise**:
- Upsert pattern (one row per organization, atomic updates)
- R2 file uploads (logo management with validation)
- File validation (type and size checking before upload)
- Composition over inheritance (minimal dependencies)
- Graceful defaults (return defaults if settings not found)

**Key APIs & Tools**:
- **Cloudflare R2 SDK**: File uploads, public URL generation
- **@codex/cloudflare-clients**: `R2Service.uploadFile()`, `R2Service.deleteFile()`
- **@codex/database**: Upsert pattern with `onConflictDoUpdate()`
- **Context7 MCP**: For Cloudflare R2 documentation

**Design Patterns to Implement**:
1. **Upsert Pattern (One Row Per Organization)**:
   ```typescript
   async updateSettings(input: UpdatePlatformSettingsInput): Promise<void> {
     await this.db.insert(platformSettings).values({
       organizationId: this.organizationId,
       platformName: input.platformName ?? 'My Platform',
       supportEmail: input.supportEmail ?? 'support@example.com',
       primaryColor: input.primaryColor ?? '#3498db',
       updatedAt: new Date(),
     }).onConflictDoUpdate({
       target: platformSettings.organizationId,
       set: {
         ...input,
         updatedAt: new Date(),
       },
     });
   }
   ```

2. **File Validation Before Upload**:
   ```typescript
   async uploadLogo(file: File): Promise<{ logoUrl: string }> {
     // Step 1: Validate file type (fail fast before R2 upload)
     const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
     if (!allowedTypes.includes(file.type)) {
       throw new Error('INVALID_FILE_TYPE');
     }

     // Step 2: Validate file size (fail fast before R2 upload)
     const maxSizeBytes = 5 * 1024 * 1024; // 5MB
     if (file.size > maxSizeBytes) {
       throw new Error('FILE_TOO_LARGE');
     }

     // Step 3: Upload to R2
     const extension = file.type.split('/')[1];
     const r2Path = `logos/${this.organizationId}.${extension}`;
     const buffer = await file.arrayBuffer();
     await this.r2.uploadFile(r2Path, new Uint8Array(buffer), {
       contentType: file.type,
     });

     // Step 4: Generate public URL
     const logoUrl = await this.r2.getPublicUrl(r2Path);

     // Step 5: Update settings (upsert)
     await this.updateSettings({ logoUrl });

     return { logoUrl };
   }
   ```

3. **Composition (Not Inheritance)**:
   ```typescript
   export interface PlatformSettingsServiceConfig {
     db: DrizzleClient;
     r2: R2Service;
     obs: ObservabilityClient;
     organizationId: string;
   }

   export class PlatformSettingsService {
     constructor(private config: PlatformSettingsServiceConfig) {}

     async uploadLogo(file: File): Promise<{ logoUrl: string }> {
       const { r2, db, obs, organizationId } = this.config;
       // Only depend on what you need (no userId, no unnecessary coupling)
     }
   }
   ```

**File Upload Validation**:
- Allowed types: PNG, JPEG, WebP (MIME types)
- Maximum size: 5MB
- Store in R2: `logos/{organizationId}.{extension}`
- Generate public URL (or signed URL if bucket private)

**Graceful Defaults**:
```typescript
async getSettings(): Promise<PlatformSettings> {
  const settings = await this.db.query.platformSettings.findFirst({
    where: eq(platformSettings.organizationId, this.organizationId),
  });

  // Return defaults if not found (no error thrown)
  if (!settings) {
    return {
      platformName: 'My Platform',
      logoUrl: null,
      primaryColor: '#3498db',
      secondaryColor: '#2c3e50',
      supportEmail: 'support@example.com',
      enableSignups: true,
      enablePurchases: true,
    };
  }

  return settings;
}
```

**References**:
- Work packet: `design/roadmap/work-packets/P1-SETTINGS-001-platform-settings.md`
- R2 client: `packages/cloudflare-clients/src/r2/`

**Important Notes**:
- GET `/api/settings` is public (for frontend branding)
- Write operations require `role = 'platform_owner'`
- Logo deletion extracts R2 path from URL (parse URL to get path)

---

## Cross-Agent Collaboration

Some work packets depend on others. Agents should be aware of these dependencies:

**Dependency Chain**:
```
P1-CONTENT-001 (Content Service)
    ↓ provides content table
P1-ECOM-001 (Stripe Checkout)
    ↓ provides purchases table
P1-ACCESS-001 (Content Access)
    ↓ uses purchases for access verification

P1-ECOM-002 (Stripe Webhooks)
    ↓ triggers email notifications
P1-NOTIFY-001 (Email Service)
```

**Shared Infrastructure**:
- All agents use `@codex/database` (Drizzle ORM)
- All agents use `@codex/validation` (Zod schemas)
- All agents extend or compose with `BaseService` from `@codex/service-errors`
- All agents use `@codex/observability` for logging

---

## MCP Servers Available

Agents have access to the following MCP servers:

1. **Context7**: Up-to-date library documentation (Stripe, Drizzle, Resend, etc.)
2. **IDE Tools**: Get diagnostics, execute code in Jupyter notebooks

**Usage Example**:
```
Use Context7 to fetch the latest Stripe Checkout API documentation
Use IDE diagnostics to check TypeScript errors in the service
```

---

## Agent Invocation Examples

### Example 1: Implement Stripe Checkout

```
Use the stripe-checkout-agent to implement P1-ECOM-001.

Requirements:
- Create PurchaseService extending BaseService with Stripe SDK
- Implement createCheckoutSession() with idempotency
- Implement completePurchase() with revenue split calculation
- Add validation schemas for checkout inputs
- Create API endpoint with route-level security
- Write unit tests for service layer

References:
- Work packet: design/roadmap/work-packets/P1-ECOM-001-stripe-checkout.md
- Stripe API version: 2024-11-20.acacia
- Use Context7 for latest Stripe documentation
```

### Example 2: Implement Email Notifications

```
Use the notification-agent to implement P1-NOTIFY-001.

Requirements:
- Create NotificationService using composition pattern
- Implement strategy pattern for email providers (Resend + MailHog)
- Create pure template functions for verification and receipt emails
- Add PII redaction to ObservabilityClient
- Set up MailHog for local development testing
- Write unit tests for template functions

References:
- Work packet: design/roadmap/work-packets/P1-NOTIFY-001-email-service.md
- Resend API docs via Context7
- Email accessibility standards
```

### Example 3: Implement Admin Analytics

```
Use the admin-dashboard-agent to implement P1-ADMIN-001.

Requirements:
- Create AdminAnalyticsService with database aggregation methods
- Implement requirePlatformOwner() middleware
- Create revenue stats endpoint with SQL aggregations
- Implement manual access grant with idempotency
- Add organization scoping to all queries
- Write integration tests for API endpoints

References:
- Work packet: design/roadmap/work-packets/P1-ADMIN-001-admin-dashboard.md
- PostgreSQL aggregation patterns
- Drizzle ORM SQL template literals
```

---

## Best Practices for All Agents

1. **Read the Work Packet First**: Always start by reading the complete work packet to understand architectural decisions
2. **Use Context7 for APIs**: Fetch latest documentation for third-party APIs (Stripe, Resend, RunPod)
3. **Follow Design Patterns**: Implement the exact patterns specified in the work packet
4. **Write Tests**: Every service needs unit tests, every API needs integration tests
5. **Security First**: Validate inputs, scope queries, redact PII in logs
6. **Error Handling**: Use custom error classes, map to HTTP status codes
7. **Observability**: Log operations with structured metadata
8. **Type Safety**: Let Zod infer types, use Drizzle schema inference

---

**Last Updated**: 2025-11-24
**Agent System Version**: 1.0
