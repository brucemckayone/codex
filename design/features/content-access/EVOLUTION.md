# Content Access: Long-Term Evolution

**Purpose**: This document defines the complete evolution of how users access content in Codex from Phase 1 through Phase 4+. It serves as the single source of truth for content access control, delivery, and security.

**Version**: 1.0
**Last Updated**: 2025-11-04

---

## Part 1: Core Principles

### Design Philosophy

1. **Organization-scoped** - Content belongs to organizations, access controlled per org
2. **Access control at multiple layers** - Guards, RLS, signed URLs
3. **Fast delivery** - CDN for global distribution, adaptive bitrate for video
4. **Security-first** - No leakage between organizations, signed URLs for streams
5. **Scalable** - Supports 100s of creators and 1000s of customers
6. **Future-proof** - Architecture ready for subscriptions, memberships, DRM

### Access Levels

```
Public Content (Guest)
├─ Browse/preview
├─ See metadata
└─ Cannot watch/listen (redirects to login)

Unauthenticated Customer
├─ Browse all public content
├─ Read reviews
└─ Add to cart (login required to checkout)

Authenticated Customer
├─ Browse all public content
├─ Browse their purchased content
├─ Watch purchased content
├─ Get download links (if enabled)
├─ Leave reviews

Subscribed Customer (Phase 2+)
├─ Access all purchased content
├─ Access subscription tier content
├─ Use credits for bookable offerings
└─ Get priority support

Organization Member (Admin, Creator)
├─ View all org content (published + unpublished)
├─ Download content files
├─ See analytics
└─ Manage content
```

---

## Part 2: Phase-by-Phase Evolution

### Phase 1: Foundation (Public & Purchased Content)

**When**: MVP launch
**Content Types**: Video, audio, written content
**Access Types**: Public, purchased only
**Delivery**: Adaptive bitrate video, streaming audio, HTML rendered text

#### Phase 1 Content Delivery

**Public Content (Guest Accessible)**
```
User browsing platform
  ├─ Sees all published public content
  ├─ Can read title, description, preview image
  ├─ Can see price, reviews (if enabled)
  ├─ CAN watch trailer (30 sec preview, Phase 2)
  └─ Cannot watch full content (redirects to login)
```

**Purchased Content (Customer Accessible)**
```
Customer who purchased
  ├─ Can browse their library (/library)
  ├─ Can stream video (adaptive quality)
  ├─ Can stream audio (with seek support)
  ├─ Can read written content
  ├─ Playback position tracked/resumed
  ├─ Can download (if enabled by owner)
  ├─ Cannot share links (links are personal)
  └─ Permanent access (until refund)
```

**Organization Content (Team Access)**
```
Organization admin/member
  ├─ Can see all content (published + draft)
  ├─ Can download files
  ├─ Can view analytics (views, engagement)
  ├─ Can download CSV of engagement data
  └─ Can edit/publish/delete own content
```

#### Phase 1 Technical Architecture

**Database Schema**
```sql
CREATE TABLE content (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id),
  createdBy UUID REFERENCES "user"(id),
  title VARCHAR NOT NULL,
  description TEXT,
  contentType content_type, -- 'video' | 'audio' | 'written'
  status publication_status, -- 'draft' | 'published' | 'archived'
  pricing_type VARCHAR, -- 'free' | 'purchase' | 'subscription' (Phase 2+)
  price DECIMAL,
  visibility visibility_type, -- 'public' | 'private' | 'members_only'
  -- Media storage
  fileUrl VARCHAR, -- URL to R2 file
  duration INTEGER, -- seconds for video/audio
  -- Metadata
  thumbnail TEXT,
  category VARCHAR,
  tags TEXT[],
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);

CREATE TABLE purchase (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id),
  contentId UUID REFERENCES content(id),
  userId UUID REFERENCES "user"(id),
  amount DECIMAL,
  status purchase_status, -- 'completed' | 'refunded'
  createdAt TIMESTAMP
);

CREATE TABLE view_event (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id),
  contentId UUID REFERENCES content(id),
  userId UUID REFERENCES "user"(id),
  watchDuration INTEGER, -- seconds watched
  totalDuration INTEGER, -- total video duration
  completionRate DECIMAL, -- 0.0 to 1.0
  createdAt TIMESTAMP
);

CREATE TABLE content_access (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id),
  contentId UUID REFERENCES content(id),
  userId UUID REFERENCES "user"(id),
  accessType access_type, -- 'purchased' | 'subscription' (Phase 2+) | 'staff'
  grantedAt TIMESTAMP,
  expiresAt TIMESTAMP, -- NULL = permanent
  -- For resumed playback
  lastWatchedAt TIMESTAMP,
  playbackPosition INTEGER, -- seconds into video
  createdAt TIMESTAMP
);

CREATE INDEX idx_content_org ON content(organizationId, status);
CREATE INDEX idx_purchase_user_org ON purchase(userId, organizationId);
CREATE INDEX idx_content_access_user_org ON content_access(userId, organizationId);
```

**RLS Policies** (Designed, not enforced Phase 1)

```sql
-- Content visibility
CREATE POLICY content_public_view ON content
  FOR SELECT
  USING (
    status = 'published' AND visibility = 'public'
    OR organizationId = (SELECT active_org_id()) -- admin access
  );

-- Purchase-based access
CREATE POLICY purchased_content_view ON content
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM purchase p
      WHERE p.contentId = content.id
      AND p.userId = current_user_id()
      AND p.status = 'completed'
    )
  );

-- Watch events (only if access granted)
CREATE POLICY view_event_insert ON view_event
  FOR INSERT
  WITH CHECK (
    -- User must have access to content
    EXISTS (
      SELECT 1 FROM content_access ca
      WHERE ca.contentId = view_event.contentId
      AND ca.userId = current_user_id()
    )
  );
```

**Access Control Guards**

```typescript
// Public content: anyone can see
GET /content/:id  -- Returns title, description, preview

// Purchased content: only buyer
GET /content/:id/stream
  ├─ Check: User purchased this content
  ├─ Generate: Signed R2 URL (expires in 1 hour)
  ├─ Track: View event
  └─ Return: Video/audio stream

// Organization content: members only
GET /admin/content/:id
  ├─ Check: User is organization member
  ├─ Check: User is admin or creator (role-based)
  └─ Return: Full content details + analytics
```

**Content Delivery**

```
Video Content:
  Browser request → /api/content/:id/stream
    ↓
  SvelteKit checks: Is user authenticated? Did they purchase?
    ↓
  Generate signed R2 URL (expires 1 hour)
    ↓
  Browser receives streaming URL
    ↓
  Browser streams from Cloudflare R2 (CDN)
    ↓
  Track playback events (optional, for analytics)

Audio Content:
  Similar flow to video
  Support seeking (byte range requests)

Written Content:
  Serve directly from SvelteKit
  Render Markdown → HTML
  No special security (if published, it's public)
```

---

### Phase 2: Subscriptions & Advanced Access

**When**: 3-6 months after Phase 1
**New Access Types**: Subscription tiers, member-only content, credits

#### Phase 2 Content Access Additions

**Subscription Tier Access** (New)

```
Customer subscribed to "Yoga Tier"
  ├─ Can see all yoga category content
  ├─ Cannot see non-yoga (unless purchased separately)
  ├─ Access persists while subscribed
  ├─ Revokes on subscription cancellation
  └─ Can access old content even after unsubscribe (grace period)
```

**Member-Only Content** (New)

```
Membership levels per organization
  ├─ Bronze, Silver, Gold (configurable)
  ├─ Content tagged with required level
  ├─ Customer must be subscribed to that level
  └─ Stripe manages membership status
```

**Credit-Based Bookable Access** (New)

```
Customer has 5 credits
  ├─ Can book offerings that cost credits
  ├─ Credits debited on booking confirmation
  ├─ Expiring credits notification
  └─ Can purchase more credits
```

**Preview/Trailer Content** (New)

```
30-second trailer of paid content
  ├─ Unauthenticated users can watch
  ├─ Stored separately from full content
  ├─ Auto-played on content page
  └─ Links to purchase
```

#### Phase 2 Database Changes

```sql
-- Add new columns (no schema migration from Phase 1)
ALTER TABLE content ADD COLUMN
  requiresSubscription BOOLEAN DEFAULT FALSE,
  subscriptionTier VARCHAR, -- 'free' | 'bronze' | 'silver' | 'gold'
  trailerUrl VARCHAR; -- R2 URL to short trailer

ALTER TABLE purchase ADD COLUMN
  refundedAt TIMESTAMP,
  refundAmount DECIMAL;

-- New table for subscription access
CREATE TABLE subscription_access (
  id UUID PRIMARY KEY,
  organizationId UUID REFERENCES organization(id),
  userId UUID REFERENCES "user"(id),
  tier VARCHAR, -- 'bronze' | 'silver' | 'gold'
  startDate DATE,
  endDate DATE,
  stripeSubscriptionId VARCHAR,
  createdAt TIMESTAMP
);

CREATE INDEX idx_subscription_access_user_org
  ON subscription_access(userId, organizationId, endDate);
```

#### Phase 2 Access Logic

```typescript
// Determine what user can access
async function getContentAccess(userId: string, contentId: string) {
  const content = await getContent(contentId);
  const user = await getUser(userId);
  const org = await getOrganization(content.organizationId);

  // Public content
  if (content.visibility === 'public' && content.status === 'published') {
    return { access: 'public', canWatch: !user ? 'preview-only' : 'full' };
  }

  // Must be authenticated
  if (!user) return { access: 'none' };

  // Purchased
  const purchased = await checkPurchase(userId, contentId);
  if (purchased) return { access: 'purchased' };

  // Subscription tier
  const subscription = await checkSubscription(userId, org.id);
  if (subscription && content.tier === subscription.tier) {
    return { access: 'subscription' };
  }

  // Organization member
  const member = await checkMember(userId, org.id);
  if (member) return { access: 'staff' };

  return { access: 'none' };
}
```

---

### Phase 3: DRM, Offline Access, Advanced Features

**When**: 6-9 months after Phase 2
**New Capabilities**: Offline content, DRM, certificates, series prerequisites

#### Phase 3 Content Access Additions

**Offline Access**

```
Download content for offline viewing
  ├─ Platform owner enables per content
  ├─ Downloaded content expires after N days
  ├─ DRM protection (optional)
  ├─ Works on mobile apps (Phase 4)
  └─ Automatic refresh when online
```

**DRM (Digital Rights Management)**

```
Encrypted video streams
  ├─ License-key protected (Widevine, FairPlay)
  ├─ Time-limited keys
  ├─ Device binding (one device per license)
  ├─ Anti-screen-recording
  └─ Optional per organization
```

**Series Prerequisites**

```
Course requirements
  ├─ Content A must be watched before Content B
  ├─ Progress tracking through series
  ├─ Completion certificate (optional)
  ├─ Branching paths (different series based on choices)
  └─ Earned badges/achievements
```

**Advanced Playback**

```
Video features
  ├─ Configurable quality options (480p-4K)
  ├─ Playback speed (0.75x - 2x)
  ├─ Subtitles/captions
  ├─ Chapter markers
  ├─ Bookmarks within content
  └─ Notes alongside playback
```

---

### Phase 4+: Enterprise & Advanced

**When**: 9+ months
**Scope**: Enterprise compliance, advanced analytics, AI features

#### Phase 4 Additions

**Content Expiration**

```
Temporary access windows
  ├─ Content available only during specific dates
  ├─ Auto-revoke after end date
  ├─ Notification before expiration
  └─ Used for limited-time offers, seasonal content
```

**Geo-Blocking**

```
Location-based access
  ├─ Content available only in certain countries
  ├─ IP-based detection
  ├─ Organization can set per content
  └─ Used for licensing compliance
```

**Adaptive Content**

```
AI-personalized experience
  ├─ Recommend next content based on history
  ├─ Personalized learning paths
  ├─ Intelligent subtitles (auto-generated in user's language)
  ├─ Dynamic pricing (personalized offers)
  └─ Content variations based on user segment
```

---

## Part 3: Security Model

Content access uses Codex's **defense-in-depth security model** with multiple independent layers protecting against unauthorized access. For complete details, see [Access Control Patterns](/design/core/ACCESS_CONTROL_PATTERNS.md).

### Three-Layer Protection

**Layer 1: Application Guards**
- `requireAuth()` ensures user is logged in
- `checkAccess()` verifies purchase before content access
- Fast-fail route protection at application boundary

**Layer 2: Database RLS (Phase 2+)**
- Row-level security policies enforce organization isolation
- Purchase-based access filtering
- Automatic query scoping to user's organizations

**Layer 3: Query Scoping & Signed URLs**
- Explicit purchase verification in queries
- Time-limited signed URLs for media streaming (1 hour expiry)
- Organization-scoped queries prevent cross-tenant leakage

### Content-Specific Security Implementation

**Purchase Verification Flow**:
```typescript
// Layer 1: Require authentication
const user = requireAuth(event);

// Layer 3: Verify purchase
const hasAccess = await contentAccessService.checkAccess(
  user.id,
  contentId,
  'content'
);

if (!hasAccess) {
  throw redirect(303, `/purchase/${contentId}`);
}

// Generate signed URL for streaming
const signedUrl = await generateSignedUrl(contentId, userId, {
  expiresIn: 3600, // 1 hour
});
```

**Media Streaming Security**:
- Signed R2 URLs prevent direct media access
- URLs expire after 1 hour (requires refresh for long sessions)
- Purchase re-verified before each URL generation
- R2 validates signature before serving content

**Threat Prevention**:

For detailed threat prevention strategies, see [Access Control Patterns - Security Considerations](/design/core/ACCESS_CONTROL_PATTERNS.md#security-considerations).

```
Unauthorized Playback (Watch without purchase)
  ├─ Layer 1: Check purchase before loading page
  ├─ Layer 1: Check purchase before generating URL
  ├─ Layer 3: Signed URL validates purchase
  └─ Layer 4: R2 validates signature

Data Leakage (Org A sees Org B content)
  ├─ Layer 1: organizationId check in every query
  ├─ Layer 2: RLS policies block cross-org (Phase 2+)
  └─ Layer 3: Signed URLs include validation

License/DRM Bypass (Phase 3+)
  ├─ Industry-standard DRM (Widevine, FairPlay)
  ├─ Time-limited license keys
  ├─ Server revocation of compromised keys
  └─ Audit logs of all license issuance
```

**Reference**: See [Access Control Patterns](/design/core/ACCESS_CONTROL_PATTERNS.md) for complete security implementation details.

---

## Part 4: Performance & Scaling

### Phase 1 Performance

**Streaming**
- Video: Adaptive bitrate (auto-selects quality)
- Audio: Progressive streaming with seek
- Written: HTML rendered server-side

**Caching**
- Content metadata: Redis (1 day TTL)
- R2 content: CloudFlare CDN (1 year)
- Signed URLs: None (generated per request)

**Scaling**
- Video files: Cloudflare R2 (auto-scaled)
- Metadata: PostgreSQL + indexes
- Playback tracking: Async to avoid latency

### Phase 2+ Performance

**Analytics**
- View events: Batch written (every 10 seconds)
- Analytics queries: Materialized views, refreshed hourly
- Export: Background job (not blocking UI)

**Recommendations**
- Collaborative filtering: Batch job (daily)
- Personal recommendations: Cached (24 hour TTL)
- Real-time: Fallback to trending

---

## Part 5: Data Models & APIs

### Content Metadata API

```typescript
GET /api/content/:id
  Response: {
    id, title, description,
    thumbnail, duration,
    visibility, status, tier,
    price, reviews, rating,
    creator: { name, avatar },
    preview: { trailerUrl, duration }
  }

GET /api/content/:id/stream
  Required: User purchased OR public OR subscriber
  Response: {
    url: "https://cdn.r2.../signed-url",
    expiresAt: timestamp,
    quality: ['480p', '720p', '1080p']
  }
```

### Access Control API

```typescript
GET /api/content/:id/access
  Response: {
    canWatch: boolean,
    reason: "public" | "purchased" | "subscription" | "staff" | "not_authorized",
    accessType: "full" | "preview_only",
    expiresAt?: timestamp
  }

POST /api/content/:id/resume
  Body: { playbackPosition: 1234 }
  Response: { saved: true }

GET /api/content/:id/resume
  Response: { playbackPosition: 1234, lastWatched: timestamp }
```

---

## Part 6: Related Documentation

### Core Architecture
- **[Access Control Patterns](/design/core/ACCESS_CONTROL_PATTERNS.md)** - Three-layer security model, purchase verification, guards, threat prevention
- **[R2 Storage Patterns](/design/core/R2_STORAGE_PATTERNS.md)** - Signed URL generation, media streaming, security patterns

### Feature Documents
- **Auth EVOLUTION**: [authentication/EVOLUTION.md](../auth/EVOLUTION.md)
- **Admin Dashboard EVOLUTION**: [admin-dashboard/EVOLUTION.md](../admin-dashboard/EVOLUTION.md)
- **Phase 1 PRD**: [content-access/pdr-phase-1.md](./pdr-phase-1.md)
- **Phase 1 TDD**: [content-access/ttd-dphase-1.md](./ttd-dphase-1.md)

---

## Conclusion

Content access evolves from simple public/purchased model (Phase 1) to sophisticated multi-tier subscription and DRM system (Phase 4+). At each phase:

- Security is multi-layered (application + database + URL signing)
- Organization isolation is maintained throughout
- Performance is optimized (CDN, caching, async operations)
- Future phases are architecturally prepared in Phase 1

This foundation allows secure, scalable content delivery across all user types and access levels.
