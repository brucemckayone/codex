# Complete Database Schema

**Version**: 1.0
**Last Updated**: 2025-10-16

This document contains the **complete database schema** for all phases of the platform. Tables and fields marked with phase indicators show when they're introduced or fully utilized.

---

## Design Principles

1. **Extensibility First**: Schema includes fields for future features (marked with phase)
2. **Soft Deletes**: Use `deleted_at` instead of hard deletes for audit trail
3. **Timestamps**: All tables have `created_at` and `updated_at`
4. **UUIDs**: Use UUIDs for primary keys (better for distributed systems)
5. **JSONB for Flexibility**: Use JSONB for flexible/evolving data structures

---

## Core Tables

### User

Stores all user accounts across all roles.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('platform_creator', 'platform_owner', 'media_owner', 'customer')),
  -- Phase 1: Only platform_owner and customer used
  -- Phase 3: media_owner introduced

  -- Profile
  profile_image_url TEXT,
  bio TEXT, -- Phase 3: Used for media_owner profiles

  -- Email verification
  email_verified_at TIMESTAMP,
  email_verification_token VARCHAR(255),
  email_verification_expires_at TIMESTAMP,

  -- Password reset
  password_reset_token VARCHAR(255),
  password_reset_expires_at TIMESTAMP,

  -- Stripe (for future media_owner payouts)
  stripe_customer_id VARCHAR(255), -- Phase 1: For customer payment methods
  stripe_connect_account_id VARCHAR(255), -- Phase 3: For media_owner payouts

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP, -- Soft delete

  -- Indexes
  INDEX idx_users_email (email),
  INDEX idx_users_role (role),
  INDEX idx_users_deleted_at (deleted_at)
);
```

**Phase 1 Usage**:

- `role`: 'platform_owner', 'customer'
- Email verification required before purchase
- Stripe customer ID for saved payment methods

**Phase 3 Extensions**:

- `role`: 'media_owner' enabled
- `bio` used for creator profiles
- `stripe_connect_account_id` for revenue sharing

---

### MediaItems

Stores uploaded media files (videos, audio) owned by creators. Separate from content for reusability.

```sql
CREATE TYPE media_type AS ENUM ('video', 'audio');
CREATE TYPE media_status AS ENUM ('uploading', 'uploaded', 'transcoding', 'ready', 'failed');

CREATE TABLE media_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id), -- Creator owns media
  -- Phase 1: Can be organization_owner or future creators

  -- Basic Info
  title VARCHAR(255) NOT NULL,
  description TEXT,
  media_type media_type NOT NULL,
  status media_status DEFAULT 'uploading' NOT NULL,

  -- R2 Storage (in creator's bucket: codex-media-{creator_id})
  r2_key VARCHAR(500) NOT NULL, -- e.g., "originals/{media_id}/video.mp4"
  file_size_bytes BIGINT,
  mime_type VARCHAR(100),

  -- Media Metadata
  duration_seconds INTEGER,
  width INTEGER,  -- For video
  height INTEGER, -- For video

  -- HLS Transcoding (Phase 1+, handled by Media Transcoding feature)
  hls_master_playlist_key VARCHAR(500), -- e.g., "hls/{media_id}/master.m3u8"
  thumbnail_key VARCHAR(500), -- e.g., "thumbnails/{media_id}/thumb.jpg"

  -- Timestamps
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  deleted_at TIMESTAMPTZ,

  -- Indexes
  INDEX idx_media_items_creator_id (creator_id) WHERE deleted_at IS NULL,
  INDEX idx_media_items_status (creator_id, status) WHERE deleted_at IS NULL,
  INDEX idx_media_items_type (creator_id, media_type) WHERE deleted_at IS NULL
);
```

**Phase 1 Usage**:

- Creator uploads video/audio → creates media_item
- Media stored in creator's R2 bucket (`codex-media-{creator_id}`)
- Status tracks upload/transcoding lifecycle
- One media_item can be referenced by multiple content posts

---

### Content

Stores content posts (references media items). Can belong to organization or creator's personal profile.

```sql
CREATE TABLE content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id), -- Who created this post
  organization_id UUID REFERENCES organizations(id), -- NULL = personal profile, NOT NULL = org content

  -- Media Reference (separates content from media for reusability)
  media_item_id UUID REFERENCES media_items(id), -- Links to creator-owned media
  -- Note: media_item_id can be NULL for written content (no media)

  -- Basic Info
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) NOT NULL, -- Unique per organization (or per creator if personal)
  description TEXT,
  content_type VARCHAR(50) NOT NULL CHECK (content_type IN ('video', 'audio', 'written')),
  -- Phase 1: video, audio
  -- Phase 2: written content

  -- Thumbnail (optional custom thumbnail, otherwise uses media_items.thumbnail_key)
  thumbnail_url TEXT,

  -- Written content (Phase 2+)
  content_body TEXT, -- HTML from rich text editor

  -- Organization
  category VARCHAR(100), -- Phase 1: Simple string category
  tags JSONB DEFAULT '[]', -- Array of tag strings
  series_id UUID REFERENCES content_series(id), -- Phase 2: Content series

  -- Access & Pricing
  visibility VARCHAR(50) NOT NULL DEFAULT 'purchased_only'
    CHECK (visibility IN ('public', 'private', 'members_only', 'purchased_only')),
  -- Phase 1: public, purchased_only
  -- Phase 2: members_only (for subscription content)
  price DECIMAL(10,2), -- null = free

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  published_at TIMESTAMP,

  -- Metadata
  view_count INTEGER NOT NULL DEFAULT 0,
  purchase_count INTEGER NOT NULL DEFAULT 0,

  -- Future: Prerequisites
  prerequisite_content_ids JSONB DEFAULT '[]', -- Phase 3: Array of content IDs

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,

  -- Indexes
  INDEX idx_content_creator_id (creator_id),
  INDEX idx_content_organization_id (organization_id) WHERE organization_id IS NOT NULL,
  INDEX idx_content_media_item_id (media_item_id),
  INDEX idx_content_slug (slug, organization_id), -- Unique per org or personal
  INDEX idx_content_status (status),
  INDEX idx_content_published_at (published_at),
  INDEX idx_content_category (category),
  INDEX idx_content_series_id (series_id),

  -- Constraints
  UNIQUE (slug, organization_id) -- Slug unique per organization (NULL = personal)
);
```

**Phase 1 MVP Fields**:

- Separates content metadata from media files
- `organization_id = NULL` for personal creator content
- `organization_id = {org_id}` for organization content
- `media_item_id` references reusable media library
- creator_id can be organization_owner or future creators

**Key Concepts**:

- **Media Library Pattern**: Content references media_items (no file duplication)
- **Personal vs Org Content**: NULL organization_id = creator's personal profile
- **Reusability**: Same media_item can be used in multiple content posts
- **Creator Ownership**: Media owned by creator, content posts can be personal or org

**Phase 2 Extensions**:

- `content_type`: 'written' for blog posts
- `series_id`: Content organization
- `visibility`: 'members_only' for subscriptions

---

### ContentSeries

Groups related content into series/courses.

```sql
CREATE TABLE content_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),

  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) UNIQUE NOT NULL,
  description TEXT,
  thumbnail_url TEXT,

  -- Pricing (can sell series as bundle)
  price DECIMAL(10,2),

  -- Order for content in series
  content_order JSONB DEFAULT '[]', -- Array of content IDs in order

  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,

  INDEX idx_series_creator_id (creator_id),
  INDEX idx_series_slug (slug)
);
```

**Phase**: 2 (Not in MVP)

---

### Purchase

Records of content purchases (one-time).

```sql
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  content_id UUID NOT NULL REFERENCES content(id),

  -- Payment
  amount_paid DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,

  -- Revenue tracking (for future splitting)
  platform_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Phase 1: 0
  -- Phase 3: 30% of amount_paid for media_owner content
  creator_payout_amount DECIMAL(10,2) NOT NULL,
  -- Phase 1: = amount_paid
  -- Phase 3: = amount_paid - platform_fee_amount

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),

  -- Timestamps
  purchased_at TIMESTAMP,
  refunded_at TIMESTAMP,
  refund_reason TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_purchases_customer_id (customer_id),
  INDEX idx_purchases_content_id (content_id),
  INDEX idx_purchases_status (status),
  INDEX idx_purchases_created_at (created_at),
  INDEX idx_purchases_stripe_payment_intent_id (stripe_payment_intent_id),

  -- Constraint: Can't purchase same content twice (unless refunded)
  UNIQUE (customer_id, content_id, status)
);
```

**Phase 1 Usage**:

- Simple one-time purchases
- `platform_fee_amount` = 0 (no split)
- `creator_payout_amount` = `amount_paid`

**Phase 3 Extensions**:

- Revenue splitting for media_owner content
- Stripe Connect payout tracking

---

### ContentAccess

Grants access to content (decoupled from Purchase for flexibility).

```sql
CREATE TABLE content_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  content_id UUID NOT NULL REFERENCES content(id),

  access_type VARCHAR(50) NOT NULL
    CHECK (access_type IN ('purchased', 'subscription', 'complimentary', 'preview')),
  -- Phase 1: purchased, complimentary
  -- Phase 2: subscription

  -- Access window
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP, -- null = permanent
  -- Phase 1: Always null (permanent)
  -- Phase 2: Can expire with subscriptions

  -- Metadata
  last_accessed_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_content_access_user_id (user_id),
  INDEX idx_content_access_content_id (content_id),
  INDEX idx_content_access_expires_at (expires_at),

  -- Constraint: One access record per user per content
  UNIQUE (user_id, content_id)
);
```

**Why Separate from Purchase?**:

- Supports complimentary access (gifts, promos)
- Supports subscription-based access (Phase 2)
- Supports time-limited access (Phase 2)
- Single source of truth for "does user have access?"

**Phase 1 Usage**:

- Created when Purchase.status = 'completed'
- `access_type` = 'purchased'
- `expires_at` = null (permanent)

---

### VideoPlayback

Tracks video watching progress for resume functionality.

```sql
CREATE TABLE video_playback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  content_id UUID NOT NULL REFERENCES content(id)
    WHERE content.content_type = 'video',

  position_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE, -- Watched >= 95%

  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_video_playback_user_id (user_id),
  INDEX idx_video_playback_content_id (content_id),

  -- Constraint: One playback record per user per video
  UNIQUE (user_id, content_id)
);
```

**Phase 1 Usage**:

- Upsert on position change (every 10 seconds)
- Resume watching from saved position
- Track completion for analytics

---

### PlatformSettings

Single-row table for platform configuration.

```sql
CREATE TABLE platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Only one row ever exists

  -- Branding
  platform_name VARCHAR(255) NOT NULL DEFAULT 'My Platform',
  logo_url TEXT,
  primary_color VARCHAR(7) NOT NULL DEFAULT '#3b82f6', -- Hex color

  -- Homepage
  hero_title VARCHAR(500),
  hero_subtitle TEXT,
  hero_background_url TEXT,
  hero_cta_text VARCHAR(100),
  hero_cta_link VARCHAR(500),

  -- Featured content
  featured_content_ids JSONB DEFAULT '[]', -- Array of content IDs

  -- Contact & Social
  contact_email VARCHAR(255),
  social_links JSONB DEFAULT '{}', -- {instagram: url, facebook: url, etc}

  -- About page
  about_content TEXT, -- HTML

  -- Future: Advanced settings
  stripe_account_id VARCHAR(255), -- Phase 3: For platform Stripe account
  email_from_name VARCHAR(255),
  timezone VARCHAR(50) DEFAULT 'UTC',

  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Phase 1 Usage**:

- Single settings row
- Basic branding (logo, color, hero)
- About page content

---

## Subscription Tables (Phase 2)

### SubscriptionTier

Defines subscription plans.

```sql
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  name VARCHAR(255) NOT NULL, -- e.g., "Yoga Tier", "VIP"
  description TEXT,

  -- Pricing
  price_monthly DECIMAL(10,2),
  price_yearly DECIMAL(10,2),

  -- Content access
  category_access JSONB DEFAULT '[]', -- Array of categories granted
  -- e.g., ["yoga", "meditation"]
  full_catalog_access BOOLEAN NOT NULL DEFAULT FALSE, -- All content?

  -- Offering access
  offering_access_rules JSONB DEFAULT '[]',
  -- e.g., [{ type: "one_time_event", included: true }]

  -- Credits
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  credit_rollover BOOLEAN NOT NULL DEFAULT FALSE,

  -- Status
  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_subscription_tiers_active (active)
);
```

**Phase**: 2

---

### Subscription

Customer subscription records.

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  tier_id UUID NOT NULL REFERENCES subscription_tiers(id),

  -- Stripe
  stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,

  -- Billing
  billing_period VARCHAR(20) NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  current_period_start TIMESTAMP NOT NULL,
  current_period_end TIMESTAMP NOT NULL,

  -- Status
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,

  -- Trial
  trial_end TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  canceled_at TIMESTAMP,

  INDEX idx_subscriptions_customer_id (customer_id),
  INDEX idx_subscriptions_status (status),
  INDEX idx_subscriptions_stripe_subscription_id (stripe_subscription_id)
);
```

**Phase**: 2

---

### CreditBalance

Tracks customer credit balances.

```sql
CREATE TABLE credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),

  current_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,

  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_credit_balances_customer_id (customer_id),

  UNIQUE (customer_id)
);
```

**Phase**: 2

---

### CreditTransaction

Ledger of credit transactions.

```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),

  type VARCHAR(50) NOT NULL
    CHECK (type IN ('earned_subscription', 'earned_purchase', 'spent_offering', 'expired', 'adjustment')),
  amount INTEGER NOT NULL, -- Positive for earn, negative for spend

  balance_after INTEGER NOT NULL,

  -- Reference
  subscription_id UUID REFERENCES subscriptions(id),
  offering_booking_id UUID REFERENCES offering_bookings(id),

  description TEXT,
  expires_at TIMESTAMP, -- For credits that expire

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_credit_transactions_customer_id (customer_id),
  INDEX idx_credit_transactions_created_at (created_at)
);
```

**Phase**: 2

---

## Offering Tables (Phase 2-3)

### Offering

The unified model for events, services, programs, retreats.

```sql
CREATE TABLE offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES users(id),

  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) UNIQUE NOT NULL,
  description TEXT,

  offering_type VARCHAR(50) NOT NULL
    CHECK (offering_type IN (
      'one_time_event',
      'multi_day_program',
      'recurring_fixed',
      'recurring_bookable',
      'cohort_course',
      'retreat'
    )),

  -- Capacity
  capacity_type VARCHAR(50) NOT NULL
    CHECK (capacity_type IN ('one_on_one', 'small_group', 'large_group', 'unlimited')),
  max_participants INTEGER, -- null for unlimited

  -- Delivery
  delivery_method VARCHAR(50) NOT NULL
    CHECK (delivery_method IN ('online', 'in_person', 'hybrid', 'self_guided')),
  location_details TEXT, -- For in-person
  video_conference_provider VARCHAR(50), -- 'zoom', 'google_meet', etc.

  -- Scheduling (JSONB for flexibility across offering types)
  schedule JSONB NOT NULL,
  -- Structure varies by offering_type:
  -- one_time_event: { date: '2025-03-15', start_time: '19:00', duration_minutes: 120 }
  -- recurring_fixed: { pattern: 'weekly', day: 'tuesday', time: '18:00', duration_minutes: 60 }
  -- recurring_bookable: { availability: {...}, booking_window_days: 14, buffer_minutes: 15 }
  -- etc.

  -- Pricing
  price DECIMAL(10,2),
  credit_cost INTEGER, -- Credits required to book (null = can't use credits)
  payment_options JSONB DEFAULT '{}', -- e.g., { installments: true, pay_per_session: true }

  -- Access & Visibility
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  registration_deadline TIMESTAMP,

  -- Portal configuration
  portal_config JSONB DEFAULT '{}',
  -- e.g., { access_before_days: 30, access_after_days: 60, tabs: [...] }

  -- Metadata
  booking_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP,

  INDEX idx_offerings_creator_id (creator_id),
  INDEX idx_offerings_slug (slug),
  INDEX idx_offerings_type (offering_type),
  INDEX idx_offerings_status (status)
);
```

**Phase**: 2-3

---

### OfferingBooking

Customer bookings/registrations for offerings.

```sql
CREATE TABLE offering_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  offering_id UUID NOT NULL REFERENCES offerings(id),

  -- Payment
  payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('purchase', 'subscription', 'credits')),
  amount_paid DECIMAL(10,2) DEFAULT 0,
  credits_used INTEGER DEFAULT 0,
  stripe_payment_intent_id VARCHAR(255),

  -- Booking details (varies by offering type)
  booking_details JSONB DEFAULT '{}',
  -- For recurring_bookable: { booked_sessions: [{date, time}, ...] }
  -- For cohort_course: { cohort_start_date: '2025-04-01' }

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'canceled', 'completed', 'no_show')),

  canceled_at TIMESTAMP,
  cancellation_reason TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_offering_bookings_customer_id (customer_id),
  INDEX idx_offering_bookings_offering_id (offering_id),
  INDEX idx_offering_bookings_status (status)
);
```

**Phase**: 2-3

---

### OfferingPortalAccess

Grants access to offering portals.

```sql
CREATE TABLE offering_portal_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES offering_bookings(id),
  user_id UUID NOT NULL REFERENCES users(id),
  offering_id UUID NOT NULL REFERENCES offerings(id),

  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP, -- Based on offering portal_config

  last_accessed_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_offering_portal_access_user_id (user_id),
  INDEX idx_offering_portal_access_offering_id (offering_id),

  UNIQUE (booking_id)
);
```

**Phase**: 2-3

---

### OfferingResource

Resources attached to offerings (content, files, etc.).

```sql
CREATE TABLE offering_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES offerings(id),

  resource_type VARCHAR(50) NOT NULL
    CHECK (resource_type IN ('content', 'file', 'link', 'text')),

  -- Reference (depends on type)
  content_id UUID REFERENCES content(id), -- If resource_type = 'content'
  file_url TEXT, -- If resource_type = 'file'
  link_url TEXT, -- If resource_type = 'link'
  text_content TEXT, -- If resource_type = 'text'

  title VARCHAR(500) NOT NULL,
  description TEXT,

  -- Visibility rules
  available_when VARCHAR(50) NOT NULL DEFAULT 'during'
    CHECK (available_when IN ('before', 'during', 'after', 'always')),
  unlock_at TIMESTAMP, -- For time-gated content

  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_offering_resources_offering_id (offering_id),
  INDEX idx_offering_resources_display_order (display_order)
);
```

**Phase**: 2-3

---

## Notification Tables

### EmailLog

Tracks sent emails for debugging.

```sql
CREATE TABLE email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  recipient_email VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES users(id), -- null if recipient not a user

  email_type VARCHAR(100) NOT NULL, -- 'welcome', 'purchase_receipt', 'password_reset', etc.
  subject VARCHAR(500) NOT NULL,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'failed')),

  -- Provider details
  provider VARCHAR(50), -- 'resend', 'sendgrid', etc.
  provider_message_id VARCHAR(255),
  error_message TEXT,

  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_email_logs_user_id (user_id),
  INDEX idx_email_logs_email_type (email_type),
  INDEX idx_email_logs_status (status),
  INDEX idx_email_logs_created_at (created_at)
);
```

**Phase 1 Usage**:

- Log all transactional emails
- Debug email deliverability issues

---

### Notification (Phase 3)

In-app notifications.

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),

  type VARCHAR(100) NOT NULL, -- 'new_content', 'booking_reminder', 'credit_expiring', etc.
  title VARCHAR(500) NOT NULL,
  message TEXT NOT NULL,

  -- Optional action
  action_url TEXT,
  action_label VARCHAR(100),

  -- Status
  read_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_notifications_user_id (user_id),
  INDEX idx_notifications_read_at (read_at),
  INDEX idx_notifications_created_at (created_at)
);
```

**Phase**: 3

---

## Analytics Tables (Phase 3-4)

### Event

Event tracking for analytics.

```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID REFERENCES users(id), -- null for anonymous
  session_id VARCHAR(255), -- Track user sessions

  event_type VARCHAR(100) NOT NULL, -- 'page_view', 'content_view', 'purchase_start', etc.
  event_data JSONB DEFAULT '{}', -- Flexible event properties

  -- Request metadata
  ip_address VARCHAR(45),
  user_agent TEXT,
  referrer TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  INDEX idx_events_user_id (user_id),
  INDEX idx_events_type (event_type),
  INDEX idx_events_created_at (created_at)
);
```

**Phase**: 3-4 (MVP has basic view counts only)

---

## Indexes Summary

Key indexes for performance:

**User lookups**: `users.email`, `users.role`
**Content discovery**: `content.status`, `content.category`, `content.published_at`
**Purchase history**: `purchases.customer_id`, `purchases.created_at`
**Access checks**: `content_access.user_id + content_id`
**Video resume**: `video_playback.user_id + content_id`

---

## Migrations Strategy

### Phase 1 → Phase 2

- Add `content_series` table
- Add subscription tables
- Add credit tables
- Add `offerings` table (basic)
- Populate `content.series_id` (nullable)

### Phase 2 → Phase 3

- Add media_owner role to users
- Add offering portal tables
- Add notification tables
- Add event tracking
- Enable `content.creator_id` to reference media_owners

### Phase 3 → Phase 4

- Add analytics aggregation tables
- Add white-label settings
- Add API key tables
- Performance optimizations

---

## Backup Strategy

- **Daily automated backups**: Full database snapshot
- **Point-in-time recovery**: Enabled (WAL archiving)
- **Retention**: 30 days of daily backups
- **Test restores**: Monthly verification

---

## Notes for Developers

1. **Always use transactions** for operations spanning multiple tables
2. **Soft delete** instead of hard delete (set `deleted_at`)
3. **Audit important changes** via event logging
4. **JSONB queries**: Use GIN indexes for frequent JSONB queries
5. **Foreign keys**: Always ON DELETE CASCADE or SET NULL appropriately

---

This schema is designed to evolve. When adding fields or tables, consider:

- Can this be JSONB initially for flexibility?
- Is this used in queries (needs index)?
- Does this need to be normalized now or later?
