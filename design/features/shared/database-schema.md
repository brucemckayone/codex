# Complete Database Schema

**Version**: 2.0
**Last Updated**: 2025-11-08

This document contains the **complete database schema** for all phases of the platform. Tables and fields marked with phase indicators show when they're introduced or fully utilized.

---

## Version 2.0 Changes (2025-11-08)

### Critical Fixes

1. **Fixed User Roles** - Removed outdated 'platform_creator', 'media_owner' terminology
   - New roles: 'platform_owner', 'creator', 'customer'
   - Organization ownership tracked in `organization_memberships` table

2. **Money as Integer Cents** - Eliminates floating-point rounding errors
   - `purchases` table now uses `amount_paid_cents`, `platform_fee_cents`, etc.
   - CHECK constraint ensures splits add up exactly

3. **3-Way Revenue Splits** - Added support for platform/organization/creator splits
   - New `revenue_split_configurations` table
   - Configurable models: percentage, flat_fee, hybrid
   - Aligned with Stripe Connect best practices

4. **Organization-Scoped Subscriptions** - Fixed subscription model
   - `subscription_tiers` now has `organization_id` (not platform-wide)
   - `subscriptions` linked to `organization_memberships` via `membership_id`
   - Removed denormalized `organization_id` from subscriptions

5. **Organization-Scoped Credits** - Clarified credit system
   - `credit_balances` and `credit_transactions` now have `organization_id`
   - Customers have separate balances per organization
   - Added CHECK constraints for data consistency

### New Tables

- **organization_memberships** - Tracks creator-organization relationships
- **revenue_split_configurations** - Configurable revenue splitting

### ACID Compliance Improvements

- All foreign keys have explicit ON DELETE behavior
- CHECK constraints prevent invalid data
- Partial unique indexes created correctly (as separate indexes)
- No redundant data (removed subscription.organization_id denormalization)

See `design/features/shared/SCHEMA_ANALYSIS_AND_FIXES.md` for detailed analysis.

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
  role VARCHAR(50) NOT NULL CHECK (role IN ('platform_owner', 'creator', 'customer')),
  -- Phase 1: platform_owner (super admin), creator (content creator), customer (buyer)
  --   - 'platform_owner' = Developer/super admin (not content creator)
  --   - 'creator' = Content creator (may or may not own an organization)
  --   - Organization ownership determined by organization_memberships.role='owner'
  -- Phase 2+: creator role used for invited creators to organizations

  -- Profile
  profile_image_url TEXT,
  bio TEXT, -- Used for creator profiles

  -- Email verification
  email_verified_at TIMESTAMP,
  email_verification_token VARCHAR(255),
  email_verification_expires_at TIMESTAMP,

  -- Password reset
  password_reset_token VARCHAR(255),
  password_reset_expires_at TIMESTAMP,

  -- Stripe
  stripe_customer_id VARCHAR(255), -- Phase 1: For customer payment methods
  stripe_connect_account_id VARCHAR(255), -- Phase 3: For creator payouts via Stripe Connect

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

- `role`: 'platform_owner' (super admin), 'creator' (content creator), 'customer' (buyer)
- Organization ownership tracked in `organization_memberships` table
- Email verification required before purchase
- Stripe customer ID for saved payment methods

**Phase 2+ Extensions**:

- Multi-creator organizations (invite creators via `organization_memberships`)
- `bio` used for public creator profiles

**Phase 3+ Extensions**:

- `stripe_connect_account_id` for creator payouts via Stripe Connect
- Automated revenue splitting and transfers

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

  -- Payment (stored as integer cents to avoid rounding errors)
  amount_paid_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,

  -- Revenue Split (calculated at purchase time using revenue_split_configurations)
  revenue_split_config_id UUID REFERENCES revenue_split_configurations(id),
  -- Tracks which configuration was used for this purchase

  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  -- Phase 1: 0 (no platform fee)
  -- Phase 2+: Based on revenue_split_configuration

  organization_fee_cents INTEGER NOT NULL DEFAULT 0,
  -- Phase 1: 0 (no organization fee)
  -- Phase 2+: Based on revenue_split_configuration (only if content.organization_id NOT NULL)

  creator_payout_cents INTEGER NOT NULL,
  -- Phase 1: = amount_paid_cents (100% to creator)
  -- Phase 2+: = amount_paid_cents - platform_fee_cents - organization_fee_cents

  -- Ensure splits add up exactly (no rounding errors with integer cents)
  CHECK (amount_paid_cents = platform_fee_cents + organization_fee_cents + creator_payout_cents),
  CHECK (amount_paid_cents >= 0),

  -- Stripe Connect Payout Tracking (Phase 3+)
  creator_payout_status VARCHAR(50) DEFAULT 'pending'
    CHECK (creator_payout_status IN ('pending', 'paid', 'failed')),
  creator_stripe_transfer_id VARCHAR(255), -- Stripe Transfer ID to creator's Connect account
  creator_payout_at TIMESTAMPTZ,

  organization_payout_status VARCHAR(50) DEFAULT 'pending'
    CHECK (organization_payout_status IN ('pending', 'paid', 'failed')),
  organization_stripe_transfer_id VARCHAR(255), -- Stripe Transfer ID to org's Connect account
  organization_payout_at TIMESTAMPTZ,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),

  -- Refund Tracking
  purchased_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,
  refund_amount_cents INTEGER, -- Can be partial refund (Phase 2+)
  stripe_refund_id VARCHAR(255),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_purchases_customer_id (customer_id),
  INDEX idx_purchases_content_id (content_id),
  INDEX idx_purchases_status (status),
  INDEX idx_purchases_created_at (created_at),
  INDEX idx_purchases_stripe_payment_intent_id (stripe_payment_intent_id),
  INDEX idx_purchases_payout_status (creator_payout_status, organization_payout_status)
);

-- Prevent duplicate purchases (partial unique index)
CREATE UNIQUE INDEX idx_no_duplicate_purchases
  ON purchases(customer_id, content_id)
  WHERE status = 'completed' AND refunded_at IS NULL;
```

**Phase 1 Usage**:

- Simple one-time purchases
- Money stored as integer cents (eliminates rounding errors)
- `platform_fee_cents` = 0, `organization_fee_cents` = 0
- `creator_payout_cents` = `amount_paid_cents` (100% to creator)
- `revenue_split_config_id` = platform default (no fees)

**Phase 2+ Extensions**:

- Revenue splitting using `revenue_split_configurations`
- 3-way splits: platform + organization + creator
- Configurable models: percentage, flat_fee, hybrid

**Phase 3+ Extensions**:

- Stripe Connect automated payouts
- `creator_stripe_transfer_id` and `organization_stripe_transfer_id` track transfers
- Payout status tracking for reconciliation

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

### OrganizationMemberships

Tracks which users belong to which organizations and their roles.

```sql
CREATE TYPE org_membership_role AS ENUM ('owner', 'creator', 'subscriber', 'admin');

CREATE TABLE organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Role within organization
  role org_membership_role NOT NULL,
  -- 'owner' = Organization owner (only one per org)
  -- 'creator' = Invited creator (can post content)
  -- 'subscriber' = Paying member via subscription (Phase 2+)
  -- 'admin' = Manager role (Phase 3+)

  -- Permissions (JSONB for flexibility)
  permissions JSONB DEFAULT '{}',
  -- Phase 1: Empty
  -- Phase 2+: { can_post: true, can_edit_others: false, can_manage_members: false }

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'invited')),
  -- 'active' = Current member
  -- 'inactive' = Removed/left organization
  -- 'invited' = Pending invitation acceptance (Phase 2+)

  -- Subscription link (Phase 2+)
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  -- If role='subscriber', this links to their active subscription
  -- When subscription ends, membership.status = 'inactive'

  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_org_memberships_org_id (organization_id),
  INDEX idx_org_memberships_user_id (user_id),
  INDEX idx_org_memberships_role (organization_id, role),
  INDEX idx_org_memberships_subscription_id (subscription_id),

  -- Constraints
  UNIQUE (organization_id, user_id) -- One membership per user per org
);

-- One owner per organization (partial unique index)
CREATE UNIQUE INDEX idx_one_owner_per_org
  ON organization_memberships(organization_id)
  WHERE role = 'owner';
```

**Phase 1 Usage**:

- Created automatically when organization is created (owner membership)
- `role = 'owner'` for organization owner
- Single membership per organization

**Phase 2+ Extensions**:

- Invite creators: `role = 'creator'`
- Subscriptions create: `role = 'subscriber'` memberships
- Content access checks include membership status

**Key Relationships**:

- Subscription → Membership: When customer subscribes, creates membership with `role='subscriber'`
- Membership → Access: Active members can access org content with `visibility='members_only'`
- Organization ownership: Derived from `role='owner'` (not from `users.role`)

---

### RevenueSplitConfigurations

Configures how revenue is split between platform, organization, and creator.

```sql
CREATE TYPE split_model AS ENUM ('percentage', 'flat_fee', 'hybrid');

CREATE TABLE revenue_split_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL = platform-wide default
  -- NOT NULL = organization-specific override

  -- Model Type
  model split_model NOT NULL,
  -- 'percentage' = All splits as percentages
  -- 'flat_fee' = All splits as fixed amounts (in cents)
  -- 'hybrid' = Mix of percentage and flat fee

  -- Platform Split
  platform_percentage DECIMAL(5,2), -- e.g., 5.00 for 5%
  platform_flat_fee_cents INTEGER,  -- e.g., 200 for $2.00

  -- Organization Split (only applies if content.organization_id NOT NULL)
  organization_percentage DECIMAL(5,2), -- e.g., 20.00 for 20%
  organization_flat_fee_cents INTEGER,  -- e.g., 1000 for $10.00

  -- Creator gets remainder: amount_paid - platform_fee - organization_fee

  -- Validation
  CHECK (
    (model = 'percentage' AND platform_percentage IS NOT NULL) OR
    (model = 'flat_fee' AND platform_flat_fee_cents IS NOT NULL) OR
    (model = 'hybrid' AND (platform_percentage IS NOT NULL OR platform_flat_fee_cents IS NOT NULL))
  ),
  CHECK (platform_percentage IS NULL OR (platform_percentage >= 0 AND platform_percentage <= 100)),
  CHECK (organization_percentage IS NULL OR (organization_percentage >= 0 AND organization_percentage <= 100)),
  CHECK (COALESCE(platform_percentage, 0) + COALESCE(organization_percentage, 0) <= 100),

  -- Status
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ, -- NULL = active indefinitely

  -- Notes
  description TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_revenue_split_org_id (organization_id),
  INDEX idx_revenue_split_active (active, effective_from, effective_until)
);

-- Only one active config per organization (including NULL for platform default)
CREATE UNIQUE INDEX idx_one_active_config_per_org
  ON revenue_split_configurations(COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'))
  WHERE active = TRUE;
```

**Phase 1 Default**:

```sql
INSERT INTO revenue_split_configurations (
  organization_id, model, platform_percentage, platform_flat_fee_cents,
  organization_percentage, description
) VALUES (
  NULL, 'percentage', 0.00, 0, 0.00,
  'Phase 1 - No platform fees (100% to creator)'
);
```

**Phase 2+ Examples**:

```sql
-- Platform default: 5% + $0.50
INSERT INTO revenue_split_configurations (
  organization_id, model, platform_percentage, platform_flat_fee_cents, description
) VALUES (
  NULL, 'hybrid', 5.00, 50, 'Platform default: 5% + $0.50'
);

-- Organization-specific: 20% to org
INSERT INTO revenue_split_configurations (
  organization_id, model, organization_percentage, description
) VALUES (
  '{org-id}', 'percentage', 20.00, 'Yoga Studio - 20% organization fee'
);
```

**Revenue Calculation**:

```typescript
// Get active config for organization (or platform default if org has no config)
const config = getActiveSplitConfig(content.organizationId);

const totalCents = purchase.amountPaidCents;

// Calculate platform fee
let platformCents = 0;
if (config.platformPercentage) {
  platformCents += Math.floor(totalCents * (config.platformPercentage / 100));
}
if (config.platformFlatFeeCents) {
  platformCents += config.platformFlatFeeCents;
}

// Calculate organization fee (only if content posted to org)
let orgCents = 0;
if (content.organizationId) {
  const remaining = totalCents - platformCents;
  if (config.organizationPercentage) {
    orgCents += Math.floor(remaining * (config.organizationPercentage / 100));
  }
  if (config.organizationFlatFeeCents) {
    orgCents += config.organizationFlatFeeCents;
  }
}

// Creator gets exact remainder (no rounding errors)
const creatorCents = totalCents - platformCents - orgCents;
```

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

Defines subscription plans (organization-scoped).

```sql
CREATE TABLE subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Organization Scoping
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Subscriptions are ORGANIZATION-SCOPED (not platform-wide)
  -- Each organization defines its own tiers

  name VARCHAR(255) NOT NULL, -- e.g., "Basic Membership", "VIP Access"
  slug VARCHAR(255) NOT NULL, -- URL-friendly identifier
  description TEXT,

  -- Pricing
  price_monthly DECIMAL(10,2),
  price_yearly DECIMAL(10,2),

  -- Content access
  category_access JSONB DEFAULT '[]', -- Array of categories granted
  -- e.g., ["yoga", "meditation"]
  full_catalog_access BOOLEAN NOT NULL DEFAULT FALSE, -- Access to all org content?

  -- Offering access (Phase 2+)
  offering_access_rules JSONB DEFAULT '[]',
  -- e.g., [{ type: "one_time_event", included: true }]

  -- Credits (Phase 2+)
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  credit_rollover BOOLEAN NOT NULL DEFAULT FALSE,

  -- Status
  active BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_subscription_tiers_org_id (organization_id),
  INDEX idx_subscription_tiers_active (organization_id, active),

  -- Constraints
  UNIQUE (organization_id, slug) -- Slug unique per organization
);
```

**Phase**: 2

**Key Changes**:
- Added `organization_id` - Tiers are organization-specific
- Added `slug` for URL-friendly identifiers
- Each organization can have: "Basic", "Premium", "VIP", etc.

---

### Subscription

Customer subscription records (linked to organization memberships).

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES subscription_tiers(id) ON DELETE RESTRICT,
  -- ON DELETE RESTRICT prevents tier deletion if active subscriptions exist

  -- Stripe
  stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
  stripe_customer_id VARCHAR(255) NOT NULL, -- Customer's Stripe ID

  -- Billing
  billing_period VARCHAR(20) NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,

  -- Status
  status VARCHAR(50) NOT NULL
    CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete')),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,

  -- Trial
  trial_end TIMESTAMPTZ,

  -- Membership Link
  membership_id UUID REFERENCES organization_memberships(id) ON DELETE SET NULL,
  -- Links to the organization_membership record created by this subscription
  -- When subscription is active, membership.role = 'subscriber'
  -- When subscription ends, membership.status = 'inactive'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,

  -- Indexes
  INDEX idx_subscriptions_customer_id (customer_id),
  INDEX idx_subscriptions_tier_id (tier_id),
  INDEX idx_subscriptions_status (status),
  INDEX idx_subscriptions_stripe_subscription_id (stripe_subscription_id),
  INDEX idx_subscriptions_membership_id (membership_id)
);
```

**Phase**: 2

**Key Changes**:
- Added `membership_id` - Links subscription to organization membership
- Removed denormalized `organization_id` (derive from tier)
- Added ON DELETE behaviors for data integrity
- Subscription lifecycle → Membership lifecycle

---

### CreditBalance

Tracks customer credit balances (organization-scoped).

```sql
CREATE TABLE credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Credits are ORGANIZATION-SCOPED
  -- Customer has separate credit balance per organization

  current_balance INTEGER NOT NULL DEFAULT 0,
  lifetime_earned INTEGER NOT NULL DEFAULT 0,
  lifetime_spent INTEGER NOT NULL DEFAULT 0,

  -- Data integrity: ensure balance = earned - spent
  CHECK (current_balance = lifetime_earned - lifetime_spent),
  CHECK (current_balance >= 0),
  CHECK (lifetime_earned >= 0),
  CHECK (lifetime_spent >= 0),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_credit_balances_customer_id (customer_id),
  INDEX idx_credit_balances_org_id (organization_id),

  -- Constraints
  UNIQUE (customer_id, organization_id) -- One balance per customer per org
);
```

**Phase**: 2

**Key Changes**:
- Added `organization_id` - Credits scoped to organizations
- Added CHECK constraints for data consistency
- Customer can have different credit balances for different organizations

**Purpose**:
- Primary: Subscriber benefits (monthly credits from active subscriptions)
- Secondary: Gifting by organization owners
- Tertiary: Purchase bonuses (e.g., spend $100, earn 10 credits)

---

### CreditTransaction

Ledger of credit transactions (organization-scoped).

```sql
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  type VARCHAR(50) NOT NULL
    CHECK (type IN (
      'earned_subscription',   -- Monthly credits from active subscription
      'earned_purchase',       -- Bonus credits from content purchase
      'earned_gift',           -- Gifted by organization owner
      'spent_content',         -- Used to purchase content
      'spent_offering',        -- Used to book offering (Phase 2+)
      'expired',               -- Credits expired
      'adjustment'             -- Manual admin adjustment
    )),

  amount INTEGER NOT NULL, -- Positive for earn, negative for spend
  balance_after INTEGER NOT NULL,

  -- References
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  -- If type='earned_subscription'

  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  -- If type='earned_purchase' or 'spent_content'

  offering_booking_id UUID REFERENCES offering_bookings(id) ON DELETE SET NULL,
  -- If type='spent_offering' (Phase 2+)

  -- Expiration
  expires_at TIMESTAMPTZ, -- For credits that expire (e.g., monthly subscription credits)

  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Indexes
  INDEX idx_credit_transactions_customer_id (customer_id),
  INDEX idx_credit_transactions_org_id (organization_id),
  INDEX idx_credit_transactions_created_at (created_at),
  INDEX idx_credit_transactions_type (type)
);
```

**Phase**: 2

**Key Changes**:
- Added `organization_id` - Transactions scoped to organizations
- Expanded `type` enum for clearer purposes
- Added `purchase_id` reference for credit spending on content
- Added expiration tracking

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

---

## Row-Level Security Strategy

### What Is Row-Level Security?

Row-Level Security (RLS) is a data protection strategy that controls which specific rows of data a user can see or modify in the database. Rather than giving someone access to an entire table, we grant access only to the specific records they're allowed to interact with. Think of it like a filter that automatically applies to every database query based on who's asking.

For example, when a creator queries the `content` table, they should only see content they created or content from organizations they belong to—not content from other creators or organizations. RLS enforces this automatically at the database level, so even if application code has bugs, the database itself prevents unauthorized access.

---

### Why We Need RLS

**Data Isolation**: In a multi-organization platform, we need strict boundaries. Organization A should never accidentally see Organization B's financial data, customer lists, or unpublished content. RLS guarantees this separation.

**Security Defense-in-Depth**: Application-level permission checks can have bugs. A developer might forget to add `WHERE organization_id = current_user_org` to a query. RLS acts as a safety net—even if the application makes a mistake, the database won't return unauthorized data.

**Compliance and Trust**: When handling customer purchases, creator payouts, and subscription data, we need to demonstrate that we've implemented proper access controls. RLS provides auditable, database-enforced security.

**Simplifies Application Code**: Once RLS policies are in place, developers don't need to remember to add organization filters to every single query. The database handles it automatically.

---

### Access Control by User Type

#### 1. Platform Owner (Super Admin)

**Who They Are**: The developer or platform administrator. Not a content creator. Has technical access to everything for platform management, debugging, and support.

**What They Can See**:
- **Everything** - No restrictions
- All organizations and their settings
- All users across all organizations
- All content (published and unpublished)
- All media files uploaded by any creator
- All purchases, revenue splits, and financial data
- All subscriptions and membership records
- All credit balances across all organizations
- System-wide analytics and logs

**Why**: Platform owners need full visibility to:
- Debug issues ("Why isn't Creator X's video appearing?")
- Handle customer support ("Can you help me find my purchase?")
- Monitor system health and abuse
- Manage revenue and payouts
- Investigate disputes or refund requests

**Security Note**: Platform owner credentials must be extremely secure (2FA required, IP restrictions, audit logging of all actions). This role should be used sparingly and only by trusted technical staff.

---

#### 2. Organization Owners

**Who They Are**: The business operator who owns an organization (e.g., a yoga studio owner, an online course creator). They ARE also a content creator—they can upload and sell their own content.

**What They Can See Within Their Organization**:

**Content & Media**:
- All content posted to their organization (by them or any invited creators)
- All media files uploaded by creators who are members of their organization
- Published and unpublished content within their organization
- Content analytics (views, purchases, revenue) for org content
- Preview media items from their org's media library

**Members & Creators**:
- All organization members (other creators, subscribers, admins)
- Member roles and permissions
- Membership join dates and status (active/inactive)
- Invitation status for pending creators

**Financial Data**:
- Revenue from all content sold through their organization
- Organization's share of revenue splits
- Pending payouts to the organization's bank account
- Revenue breakdown by content and creator
- Subscription revenue for the organization

**Subscriptions**:
- All subscription tiers they've created for their organization
- All active/canceled subscribers to their organization
- Subscription analytics (monthly recurring revenue, churn rate)
- Credit balances for subscribers within their organization

**What They CANNOT See**:
- Other organizations' data (completely isolated)
- Content posted by their creators to other organizations
- Creators' personal content (content with `organization_id = NULL`)
- Individual creators' total earnings across all organizations
- Detailed customer payment methods (credit card info - handled by Stripe)
- Platform-level financial data (platform fee totals, etc.)

**Example Scenario**:
Sarah owns "Yoga Studio Online" organization. She has invited two creators: Mike and Jenny.
- Sarah can see all yoga content posted to her organization (whether by her, Mike, or Jenny)
- Sarah can see that Mike earned $500 from sales in her organization this month
- Sarah cannot see that Mike also teaches cooking classes in "Chef's Corner" organization
- Sarah cannot see Mike's personal content posted to his own creator profile
- Sarah can see all customers subscribed to "Yoga Studio Online" tiers
- Sarah cannot see customers' other subscriptions to different organizations

---

#### 3. Creators (Organization Members)

**Who They Are**: Content creators who have been invited to post content within an organization. They're not the organization owner, but they're members of the organization with the role `creator` in the `organization_memberships` table.

**What They Can See**:

**Their Own Content**:
- All media they personally uploaded (regardless of which organization)
- All content they personally created (personal profile or organization posts)
- Analytics for their own content (views, purchases, revenue)
- Their own earnings from content sales

**Organization Context** (For Organizations They Belong To):
- Published content from other creators in the same organization (to see what's in the catalog)
- Organization's public information (name, description, branding)
- Other creators who are members (names and public profiles)
- Subscription tiers offered by the organization

**What They CANNOT See**:

**Organization Management**:
- Organization financial data (how much revenue the org earns)
- Organization revenue split configurations
- Other creators' individual earnings
- Subscription revenue details
- Organization bank account or payout information
- Unpublished content from other creators

**Other Creators' Data**:
- Other creators' media files (in the media library)
- Other creators' draft/unpublished content
- Other creators' analytics or purchase history
- Customer information (who bought what)

**Customer Data**:
- Individual customer purchase history
- Customer email addresses or personal information
- Subscription details for individual customers
- Credit balances of customers

**Example Scenario**:
Mike is a creator in "Yoga Studio Online" (owned by Sarah) and "Chef's Corner" (owned by John).
- Mike can see his yoga videos and cooking videos (all his media)
- Mike can see his total earnings from both organizations combined
- Mike can see published yoga content from Sarah and Jenny (co-creators in Yoga Studio)
- Mike cannot see Jenny's draft yoga videos (unpublished)
- Mike cannot see Sarah's revenue split settings for the organization
- Mike cannot see the list of customers who bought his yoga course
- Mike can see published cooking content from other chefs in "Chef's Corner"
- Mike can post content to either organization or his personal creator profile

---

#### 4. Customers (Buyers)

**Who They Are**: End users who purchase content or subscribe to organizations. They don't create or upload content—they consume it.

**What They Can See**:

**Purchased Content**:
- All content they've personally purchased
- Playback history and watch progress for their purchased videos
- Access to content included in their active subscriptions
- Preview content (free 30-second previews before purchase)

**Their Own Data**:
- Their complete purchase history
- Receipts for all their purchases
- Their active and canceled subscriptions
- Their credit balances within each organization
- Credit transaction history (earned and spent)
- Their organization memberships (as a subscriber)

**Public Content Discovery**:
- All published content that's publicly listed (catalog browsing)
- Content titles, descriptions, thumbnails, prices
- Creator names and public profiles
- Organization public pages
- Subscription tier descriptions and pricing

**What They CANNOT See**:

**Other Customers' Data**:
- Other users' purchase history
- Other users' subscription status
- Other users' credit balances
- Who else purchased the same content they did

**Creator/Organization Data**:
- Unpublished or draft content
- Content analytics (view counts, revenue)
- Media files in the creator's media library
- Organization financial data
- Revenue split information
- Creator earnings or payout details

**Content They Haven't Purchased**:
- Full videos/audio they haven't bought (only previews)
- Members-only content if they're not subscribed
- Content marked as private

**Example Scenario**:
Customer Jane subscribes to "Yoga Studio Online" and purchased a cooking course from "Chef's Corner".
- Jane can watch all yoga content included in her "Yoga Studio Online" subscription
- Jane can watch the cooking course she purchased from Mike
- Jane can see her credit balance: 10 credits in Yoga Studio, 0 in Chef's Corner
- Jane cannot see that John (another customer) also bought Mike's cooking course
- Jane cannot see how many people have purchased content she's interested in
- Jane cannot see draft yoga videos that Sarah is working on
- Jane can browse the public catalog to discover new content to purchase

---

### Data Access Rules by Table

#### Content Table

**Published Content** (`status = 'published'`):
- **Platform Owner**: Can see all published content everywhere
- **Organization Owner**: Can see all published content in their organization
- **Creators**: Can see their own published content + published content in organizations they belong to
- **Customers**: Can see all published content in the catalog (public discovery)

**Unpublished Content** (`status = 'draft' or 'archived'`):
- **Platform Owner**: Can see all drafts (for support)
- **Organization Owner**: Can see drafts in their organization
- **Creators**: Can ONLY see their own drafts (not other creators' drafts)
- **Customers**: Cannot see any unpublished content

**Filtering Logic**:
- Organization Owner sees: `content.organization_id = their_org_id`
- Creator sees: `content.creator_id = their_user_id OR (content in organizations they belong to AND published)`
- Customer sees: `content.status = 'published' AND content.visibility IN ('public', 'members_only')`

---

#### Media Items Table

**Access Rules**:
- **Platform Owner**: Can see all media files
- **Organization Owner**: Can see media uploaded by any creator in their organization
- **Creators**: Can ONLY see their own media (`media_items.creator_id = their_user_id`)
- **Customers**: Cannot directly access media_items table (they access via content they purchased)

**Why This Matters**:
Media files are the creator's personal library. Even if a creator posts content to an organization, the underlying media file remains their property. If they leave the organization, their media goes with them (though content posts to the org may remain until removed).

**Example**:
Mike uploads a yoga video (media_item). He creates content post A in "Yoga Studio Online" and content post B on his personal profile—both reference the same media_item. Only Mike can see this media item in the media library. Sarah (org owner) sees content post A, but she doesn't have direct access to Mike's media file—she accesses it through the published content.

---

#### Purchases Table

**Access Rules**:
- **Platform Owner**: Can see all purchases (for platform analytics and support)
- **Organization Owner**: Can see purchases of content from their organization (for revenue tracking)
- **Creators**: Can see purchases of their own content (for earnings tracking)
- **Customers**: Can ONLY see their own purchases (`purchases.customer_id = their_user_id`)

**Financial Data Visibility**:
- Customers see: `amount_paid_cents` (what they paid)
- Creators see: `creator_payout_cents` (what they earned)
- Organization Owners see: `organization_fee_cents` (what org earned) + `creator_payout_cents` (what creator earned)
- Platform Owner sees: All revenue split fields

**Privacy Protection**:
- Creators cannot see which specific customers purchased their content (privacy)
- Creators see aggregate data: "15 people purchased this video, you earned $300"
- Organization owners see purchase totals, not individual customer identities
- Only platform owner can correlate customer email to purchases (for support requests)

---

#### Organization Memberships Table

**Access Rules**:
- **Platform Owner**: Can see all memberships in all organizations
- **Organization Owner**: Can see all members of their organization
- **Creators**: Can see memberships in organizations they belong to (to know their co-creators)
- **Customers**: Can ONLY see their own memberships (if they're a subscriber)

**What's Visible**:
- Organization owners see: All member names, roles, join dates, status
- Creators see: Names of other creators in the same org (for collaboration context)
- Customers see: "You're a VIP member of Yoga Studio Online since Jan 2025"
- Customers cannot see: Full membership list of an organization

---

#### Subscriptions and Subscription Tiers

**Subscription Tiers** (Public Information):
- **Everyone**: Can see active subscription tiers for public organizations (for purchasing)
- Visibility: Tier name, price, benefits, description
- Hidden: Number of current subscribers, revenue data

**Subscriptions** (Who Subscribes):
- **Platform Owner**: Can see all subscriptions
- **Organization Owner**: Can see all subscriptions to their organization's tiers
- **Creators**: Cannot see subscription data
- **Customers**: Can ONLY see their own active/canceled subscriptions

**Revenue Data**:
- Organization owners see: Total subscription revenue, subscriber count
- Organization owners cannot see: Individual customer names who subscribe (aggregate only)
- For customer support, platform owner can look up "Is Jane subscribed?" but this isn't exposed to org owners

---

#### Credit Balances and Transactions

**Access Rules**:
- **Platform Owner**: Can see all credit balances and transactions (support and auditing)
- **Organization Owner**: Can see aggregate credit statistics (total credits issued to subscribers)
- **Organization Owner**: Cannot see individual customer credit balances (privacy)
- **Creators**: Cannot see credit data
- **Customers**: Can ONLY see their own credit balances and transaction history

**Organization Scoping**:
Credits are isolated by organization. Jane's 10 credits in "Yoga Studio Online" are separate from her 0 credits in "Chef's Corner." She can only see her own balances.

Organization owner sees: "1,000 total credits distributed to subscribers this month" but not "Jane has 10 credits, John has 50 credits."

---

#### Revenue Split Configurations

**Access Rules**:
- **Platform Owner**: Can see and modify all revenue split configurations
- **Organization Owner**: Can see their organization's split configuration (read-only in Phase 1)
- **Organization Owner**: Can modify their organization's split in Phase 2+ (subject to platform minimums)
- **Creators**: Cannot see split configurations (they just see their payout amounts)
- **Customers**: Cannot see split configurations

**What's Visible**:
- Org owners know: "Platform takes 5%, organization takes 20%, creator gets 75%"
- Creators know: "I earned $75 from a $100 sale" (but don't see the breakdown)
- Customers know: "I paid $100 for this content" (don't see how it's split)

**Why This Separation**:
Revenue split terms might be confidential between platform and organization. Creators see their net earnings but not necessarily the business agreement between the platform and the organization they work with.

---

### Implementation Strategy

#### Phase 1: Application-Level Enforcement

In Phase 1, we implement access control in the application code (SvelteKit server-side logic):

**How It Works**:
Every database query includes filters based on the authenticated user's role and context. For example:

- When a creator fetches content, the query includes: `WHERE creator_id = current_user_id OR (organization_id IN current_user_organizations AND status = 'published')`
- When a customer fetches purchases, the query includes: `WHERE customer_id = current_user_id`
- When an org owner fetches revenue, the query includes: `WHERE organization_id = their_org_id`

**Authentication Context**:
When a user logs in, the application stores their session context:
- User ID
- User role (platform_owner, creator, customer)
- Organization memberships (which orgs they belong to and their role in each)

Every API request checks this context and applies appropriate filters.

**Benefits of Starting with Application-Level**:
- Easier to develop and debug
- More flexible during active development
- Can change rules quickly without database migrations
- Better error messages ("You don't have permission" vs generic database error)

**Limitations**:
- Requires discipline from developers to always include filters
- Risk of bugs if a developer forgets to add organization_id filter
- No protection if there's a SQL injection vulnerability

---

#### Phase 2+: Database-Level RLS Policies

Once the application is stable and access patterns are well understood, we enable PostgreSQL Row-Level Security:

**How It Works**:
We create database policies that automatically filter rows based on the current database user session:

The application sets session variables when executing queries:
```
SET LOCAL app.current_user_id = 'uuid-of-logged-in-user';
SET LOCAL app.current_user_role = 'creator';
SET LOCAL app.user_organizations = '{org-uuid-1, org-uuid-2}';
```

Then database policies use these variables to filter data:
- A policy on the `content` table checks: "Is current_user_id the creator? Or is the content's organization in the user's organization list?"
- A policy on `purchases` table checks: "Does customer_id match current_user_id?"

**Benefits of Database-Level RLS**:
- **Guaranteed Security**: Even if application code has bugs, database enforces access
- **Defense in Depth**: SQL injection attacks cannot bypass RLS
- **Audit Compliance**: Can prove to auditors that database enforces separation
- **Simplified Code**: Developers don't need to remember to add WHERE clauses

**Migration Path**:
1. Application-level filters (Phase 1) - Develop and test access patterns
2. Add RLS policies alongside application filters (Phase 2) - Double protection, verify policies match application logic
3. Monitor for policy violations (Phase 2) - Catch any application bugs
4. Eventually rely primarily on RLS (Phase 3+) - Simplify application code

---

### Special Cases and Edge Cases

#### Multi-Organization Creators

**Scenario**: Mike is a creator in both "Yoga Studio Online" and "Chef's Corner."

**Access Rules**:
- Mike has two entries in `organization_memberships` (one for each org)
- When Mike views his content library, he sees content from both organizations
- When Mike views his earnings, he sees combined total but can filter by organization
- Mike cannot see financial details of either organization (unless he's an owner)

**Data Isolation**:
Even though Mike is in two orgs, he cannot see:
- Org A's revenue from content created by other creators in Org A
- Org B's subscription revenue
- Other creators' earnings in either organization

#### Personal Creator Profile vs Organization Content

**Scenario**: Mike posts some content to his personal profile (`organization_id = NULL`) and some to organizations.

**Access Rules**:
- Mike's personal content: Only Mike can edit/delete it; customers can view if published
- Mike's org content: Organization owner can unpublish/remove it from the org (but doesn't delete Mike's underlying media)
- If Mike leaves an organization, his personal content stays; org content may remain (business decision)

**Visibility**:
- Personal content appears on Mike's public creator profile
- Org content appears in the organization's catalog
- Same content cannot be in both places simultaneously (it's one or the other)

#### Subscription-Based Membership Access

**Scenario**: Jane subscribes to "Yoga Studio Online" VIP tier.

**What Happens**:
1. Subscription created in `subscriptions` table
2. Membership created in `organization_memberships` with `role = 'subscriber'`
3. Jane can now access content marked `visibility = 'members_only'` in Yoga Studio

**Access Rule**:
When Jane browses content, the query checks:
- Has Jane purchased this content? OR
- Is Jane an active subscriber with access to this content's category? OR
- Is the content free/public?

**Membership Expiration**:
When Jane cancels subscription:
- Subscription status changes to `canceled`
- Membership status changes to `inactive` (at end of billing period)
- Jane loses access to members-only content
- Jane keeps access to content she purchased individually

#### Platform Owner Impersonation (Support Mode)

**Scenario**: Platform owner needs to debug "Why can't Jane see her purchased content?"

**Access Rule**:
Platform owners can "impersonate" a user for debugging:
- Application allows platform owner to temporarily view the system as Jane
- All queries apply Jane's access rules
- Actions are logged: "Platform Owner (admin@example.com) viewed as Jane (jane@example.com)"
- Cannot make purchases or modifications while impersonating (read-only)

**Security**:
- Requires additional authentication step
- All impersonation sessions logged and auditable
- Time-limited (auto-expires after 30 minutes)
- Notifications sent to user if their account is accessed by support

---

### Privacy and Compliance Considerations

#### Customer Privacy

**What We Protect**:
- Customer purchase history is private (creators don't see who bought what)
- Customer subscription status is private (org owners see aggregate counts only)
- Customer credit card details never stored (handled entirely by Stripe)
- Customer email addresses not shared with creators

**What We Share**:
- Creators see aggregate analytics: "15 purchases, average rating 4.5 stars"
- Organization owners see revenue totals: "Your organization earned $5,000 this month"
- Public information: Customer display name on reviews (if we add reviews in future)

#### Creator Privacy

**What We Protect**:
- Creator's total earnings across all organizations (org owners only see earnings within their org)
- Creator's bank account details (Stripe Connect)
- Creator's personal content (separate from organization content)
- Creator's media library (other creators can't browse it)

**What We Share**:
- Creator's name and public profile (for attribution on content)
- Creator's content posted to an organization (visible to org owner)
- Creator's membership in organizations (visible to other members)

#### Financial Data Separation

**Strict Rules**:
- Customers never see revenue split details
- Creators see their payout but not the full revenue breakdown
- Organization owners see their organization's share but not platform's total fees
- Platform owner has full visibility for reconciliation and tax reporting

**Why This Matters**:
- Compliance with financial regulations
- Contractual confidentiality (platform-org agreements)
- Tax reporting requirements
- Trust and transparency with creators

---

### Audit and Compliance

**Logging Requirements**:

Every sensitive data access should be logged:
- Who accessed what data
- When (timestamp)
- Why (what operation: view purchase, download media, export report)
- Result (success or permission denied)

**Audit Trail Examples**:
- "Organization Owner (sarah@yoga.com) viewed revenue report for Yoga Studio Online on 2025-11-08"
- "Creator (mike@example.com) accessed media item abc-123 for editing on 2025-11-08"
- "Customer (jane@example.com) downloaded purchased content xyz-789 on 2025-11-08"
- "Platform Owner (admin@platform.com) impersonated customer jane@example.com for support ticket #4567"

**Compliance Benefits**:
- GDPR: Can prove we enforce data minimization (users only see what they need)
- SOC 2: Demonstrates access controls and audit logging
- Financial Audits: Clear trail of who accessed financial data
- Dispute Resolution: Can investigate "I never purchased this" claims

---

### Testing Access Control

**Test Scenarios to Verify**:

1. **Organization Isolation**:
   - Creator from Org A logs in → cannot see content from Org B
   - Organization Owner A logs in → cannot see revenue from Org B

2. **Creator Permissions**:
   - Creator logs in → cannot see other creators' unpublished content
   - Creator logs in → cannot see organization's revenue split configuration

3. **Customer Permissions**:
   - Customer logs in → cannot see content they haven't purchased
   - Customer logs in → cannot see other customers' purchase history

4. **Role Boundaries**:
   - Creator creates content → organization owner can see it
   - Creator uploads media → organization owner cannot directly access media file

5. **Subscription Access**:
   - Subscribed customer → can access members-only content
   - Canceled subscriber → loses access to members-only content
   - Subscribed customer → cannot access content from other organizations

**Automated Tests**:
Every database query should have integration tests that verify:
- User sees only their authorized data
- User cannot access unauthorized data
- Attempting unauthorized access returns empty results (not error)
- Cross-organization data leakage is impossible

---

### Summary: Who Sees What

| Data Type | Platform Owner | Org Owner | Creator | Customer |
|-----------|---------------|-----------|---------|----------|
| **All organizations** | ✅ Everything | ❌ Only theirs | ❌ None | ❌ None |
| **Org content (published)** | ✅ All | ✅ Their org | ✅ Their content + org content | ✅ Public catalog |
| **Org content (draft)** | ✅ All | ✅ Their org | ✅ Only own drafts | ❌ None |
| **Media files** | ✅ All | ✅ Org creators' media | ✅ Only own media | ❌ None |
| **All purchases** | ✅ All | ✅ Their org's content | ✅ Their content | ✅ Only own purchases |
| **Revenue breakdown** | ✅ Full details | ✅ Org + creator shares | ✅ Only own payout | ❌ None |
| **Subscriptions (who)** | ✅ All | ✅ Aggregates only | ❌ None | ✅ Only own subscriptions |
| **Credit balances** | ✅ All | ✅ Aggregates only | ❌ None | ✅ Only own balance |
| **Org members** | ✅ All | ✅ All members | ✅ Member names | ❌ None (unless subscriber) |
| **Customer PII** | ✅ For support only | ❌ Aggregates only | ❌ None | ✅ Only own data |

---

This row-level security strategy ensures that every user sees exactly what they need to do their job—nothing more, nothing less. It protects customer privacy, prevents data leakage between organizations, and maintains trust across the entire platform.
