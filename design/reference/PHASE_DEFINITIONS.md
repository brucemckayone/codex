# Codex Platform - Phase Definitions

**Purpose**: Define what each phase means for the platform, including timeline, scope, features, limitations, and migration strategies. This is the single source of truth for platform evolution.

**Version**: 1.0
**Last Updated**: 2025-11-05

---

## Table of Contents

1. [Overview - What Phases Mean](#overview---what-phases-mean)
2. [Phase 1: Foundation (Current)](#phase-1-foundation-current)
3. [Phase 2: Enhancement](#phase-2-enhancement)
4. [Phase 3: Advanced](#phase-3-advanced)
5. [Phase 4+: Enterprise](#phase-4-enterprise)
6. [Decision Criteria](#decision-criteria)
7. [Migration Strategy](#migration-strategy)
8. [References](#references)

---

## Overview - What Phases Mean

### Purpose of Phases

Codex is designed to evolve through well-defined phases, each building upon the previous without requiring major architectural changes. This phased approach enables:

1. **Rapid MVP Launch**: Phase 1 delivers core value quickly
2. **Future-Proof Architecture**: Database schema and code patterns support all phases from day one
3. **No Costly Migrations**: Schema designed for multi-tenant, subscriptions, and advanced features upfront
4. **Progressive Complexity**: Add features gradually as business needs evolve
5. **Validated Growth**: Each phase validates market fit before expanding complexity

### Phase Philosophy

```
Build for multi-tenant from day one, operate as single-tenant in Phase 1
```

**Key Principles**:
- **Additive, Not Destructive**: New phases add features without removing or breaking Phase 1 features
- **Architecture-First**: Database schema and code patterns support all phases from the start
- **Feature Flags**: Phases enabled through configuration, not code rewrites
- **Seamless Transitions**: Moving between phases requires minimal code changes
- **Security by Design**: Multi-tenant isolation and RLS policies designed from Phase 1

### How Phases Work

| Aspect | Phase 1 | Phase 2+ |
|--------|---------|----------|
| **Database Schema** | Supports all phases | No schema migration needed |
| **Code Architecture** | Multi-tenant ready | Just enable features |
| **RLS Policies** | Designed, not enforced | Enable existing policies |
| **User Roles** | `platform_owner`, `customer`, org roles | Add `creator` role |
| **Organization Model** | Single org operates | Enable multi-org creation |
| **Feature Activation** | Phase 1 features only | Enable Phase 2+ features via config |

---

## Phase 1: Foundation (Current)

### Overview

**Timeline**: MVP launch (current phase)
**Scope**: Single organization, direct purchases, core content delivery
**Goal**: Launch a functional platform where a Platform Owner can upload content, sell it, and customers can purchase and access it

### Success Criteria

- Platform Owner makes first sale within 1 week of launch
- Platform Owner can publish content in <5 minutes without technical help
- Customer can buy and access content in <2 minutes
- 99% uptime, zero payment failures
- Platform Owner operates platform without developer assistance

### Architecture

**Operational Model**: Single-tenant operations
**Code Model**: Multi-tenant architecture
**Why**: Testing multi-tenant patterns with zero risk, preparing for Phase 2 without refactoring

**Key Architectural Decisions**:
- Organization as root entity (all data scoped to organizations)
- `activeOrganizationId` in session (even with single org)
- RLS policies designed but not enforced
- Organization-scoped queries everywhere
- Database schema supports unlimited organizations

### Key Features

#### Authentication & Authorization
**Status**: ✅ Core Features Complete

**Capabilities**:
- Email/password registration and login
- Password reset flow
- Session management with activeOrganizationId context
- Cloudflare KV session caching
- Email verification
- Two user roles:
  - Platform-level: `platform_owner` or `customer`
  - Organization-level: `owner`, `admin`, `member` (for staff)
- Guard functions for route protection: `require.auth()`, `require.owner()`, `require.admin()`, `require.member()`, `require.platformOwner()`

**Limitations** (Intentional):
- Creators are invited as team members with `member` role (upgraded to `creator` in Phase 2)
- No custom membership tiers (Phase 2)
- No multi-org switching UI (Phase 2)
- RLS policies not enforced (single org removes need)

**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

---

#### Content Management
**Status**: ✅ Core Features Complete

**Content Types**:
- Video (MP4, MOV - up to 5GB)
- Audio (MP3, WAV, AAC - up to 500MB)

**Capabilities**:
- Upload video and audio files with progress tracking
- Direct browser → R2 upload (presigned URLs)
- Automatic thumbnail generation from video frames
- Content metadata: title, description, price, tags
- Publish/unpublish toggle (draft vs live)
- Processing status visibility (uploading → processing → ready → published)
- Organization-scoped content (all queries include `organizationId`)

**Limitations** (Intentional):
- No video transcoding (original files only) - Phase 2 adds HLS adaptive streaming
- No content series/collections - Phase 2
- No content scheduling - Phase 2
- No written content / blog posts - Phase 2

**Documentation**: Content Management PRD/TDD

---

#### Content Delivery
**Status**: ✅ Core Features Complete

**Video Player**:
- Play/pause, volume control, fullscreen
- Quality selector (if multiple available)
- Playback speed (0.5x, 1x, 1.5x, 2x)
- Resume from last position
- Keyboard shortcuts
- Mux Web Component Player (excellent UX)

**Audio Player**:
- Play/pause, volume control
- Playback speed controls
- Seek bar with time display
- Resume from last position
- Background playback

**Access Control**:
- Signed URLs (expire after 1 hour)
- Purchase verification before URL generation
- Cannot share direct video/audio URLs
- Layer 1: Application guards
- Layer 2: Query-level filtering
- Layer 3: Signed URLs
- (Layer 4: RLS - designed for Phase 2)

**Limitations** (Intentional):
- Single quality (no adaptive bitrate) - Phase 2 adds HLS
- No download support - Phase 3
- No DRM - Phase 3
- No offline access - Phase 4

**Documentation**: [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md)

---

#### E-Commerce
**Status**: ✅ Core Features Complete

**Payment Processing**:
- Stripe Checkout (hosted checkout page)
- Credit card, Apple Pay, Google Pay
- One-time payments only
- USD currency only
- Automatic tax calculation (Stripe Tax)

**Purchase Flow**:
- Direct "Buy Now" button (no shopping cart)
- Checkout session created → redirect to Stripe → webhook confirms → purchase record created → access granted
- Free content: "Get Access" button (no payment, instant access)
- Purchase records link customers to content

**Purchase Management**:
- Customer purchase history
- Receipt access for each purchase
- Admin refund management
- Revenue tracking per creator (for future payouts)

**Limitations** (Intentional):
- No shopping cart (single-item purchases only) - Phase 2
- No subscriptions - Phase 2
- No bundles/packages - Phase 2
- No discount codes - Phase 2
- No creator payouts (tracked but not transferred) - Phase 3
- USD only - Phase 2 adds multi-currency

**Documentation**: [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

---

#### Admin Dashboard
**Status**: ✅ Core Features Complete

**Content Management**:
- List all content (published, unpublished, processing)
- Create new content (upload flow)
- Edit metadata (title, description, price, tags)
- Publish/unpublish content
- View content statistics (purchases, revenue, views)
- Delete content (with confirmation)

**Customer Management**:
- List all customers
- View customer details (email, join date, purchases, total spent)
- View what content each customer owns
- Manually grant access (for support, refunds, promotions)

**Analytics Dashboard** (Simple):
- Total revenue (all-time and this month)
- Customer count
- Purchase count
- Top 5 most purchased content
- Recent activity (last 10 purchases)

**Settings**:
- Branding: logo upload, primary color selection, platform name
- Business info: contact email, business name
- Integrations: Stripe connection status, email settings

**Limitations** (Intentional):
- No multi-org management UI - Phase 2
- No creator-specific dashboard - Phase 2
- No advanced analytics (cohorts, funnels) - Phase 2
- No content approval workflows - Phase 3

**Documentation**: [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

---

#### Platform Settings
**Status**: ✅ Core Features Complete

**Basic Information**:
- Organization name, business legal name, contact email
- Timezone, business category
- Currency selection (USD only in Phase 1)

**Branding**:
- Logo upload (to R2 assets bucket)
- Primary color selection (generates full palette automatically)
- Auto-generated secondary colors and shades for WCAG compliance

**Business Configuration**:
- Refund policy text (free text field)
- Terms of service (rich text editor)
- Privacy policy (rich text editor)

**Content Defaults**:
- Default visibility (public or private)
- Allow downloads toggle
- Enable customer reviews toggle
- Moderation level (none / light / strict)

**Limitations** (Intentional):
- No custom domain - Phase 2
- No advanced branding (fonts, custom CSS) - Phase 2/3
- No email template customization - Phase 2
- No API keys/webhooks - Phase 3

**Documentation**: [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md)

---

### Tech Stack (Complete)

**Frontend**:
- SvelteKit (framework)
- TypeScript (type safety)
- Tailwind CSS (styling)
- Mux Web Component Player (video)

**Backend**:
- SvelteKit (server-side rendering + API routes)
- BetterAuth (authentication)
- Drizzle ORM (database queries)

**Infrastructure**:
- Cloudflare Pages (hosting)
- Neon Postgres (database)
- Cloudflare R2 (object storage)
- Cloudflare Workers (background jobs)
- Cloudflare Queues (async job queue)
- Cloudflare KV (session caching)

**External Services**:
- Stripe (payment processing)
- Resend (transactional email)

**Cost Estimate**: ~$15-30/month + Stripe fees (2.9% + $0.30/txn)

---

### Phase 1 Complete Feature Matrix

| Feature | Status | Description |
|---------|--------|-------------|
| Email/Password Auth | ✅ | Registration, login, password reset |
| Session Management | ✅ | KV-cached sessions with org context |
| User Roles | ✅ | Platform-level + org-level roles |
| Video Upload | ✅ | Direct browser → R2 upload |
| Audio Upload | ✅ | Direct browser → R2 upload |
| Content Metadata | ✅ | Title, description, price, tags |
| Publish/Unpublish | ✅ | Draft vs live toggle |
| Video Streaming | ✅ | Signed URLs, resume playback |
| Audio Streaming | ✅ | Signed URLs, resume playback |
| Stripe Checkout | ✅ | Hosted checkout page |
| Direct Purchase | ✅ | "Buy Now" button |
| Free Content | ✅ | "Get Access" without payment |
| Purchase Tracking | ✅ | Purchase records for access control |
| Webhook Processing | ✅ | Payment confirmation |
| Purchase History | ✅ | Customer view of all purchases |
| Refund Management | ✅ | Admin-initiated refunds |
| Revenue Tracking | ✅ | Creator revenue display |
| Admin Dashboard | ✅ | Content, customers, analytics |
| Logo Upload | ✅ | Branding customization |
| Color Palette | ✅ | Auto-generated from primary color |
| Email Notifications | ✅ | Purchase confirmations, receipts |

---

## Phase 2: Enhancement

### Overview

**Timeline**: 3-6 months after Phase 1
**Scope**: Multiple organizations, subscription tiers, creators, advanced features
**Goal**: Enable recurring revenue through subscriptions, support multiple organizations, and add creator role for multi-creator marketplaces

### Success Criteria

- First subscription customer within 2 weeks of Phase 2 launch
- 20% of customers are subscribers
- First creator onboarded and publishing content
- Multi-org data isolation verified (no cross-org data leaks)
- 30% increase in total revenue

### Key Changes from Phase 1

**What Changes**:
- Enable RLS policies (already designed in Phase 1)
- Add organization creation UI (Platform Owner can create orgs)
- Add organization switcher (users can switch between orgs)
- Update `organization_role` enum to include `creator`
- Enable subscription features (Stripe Subscriptions)
- Add subdomain routing (org1.revelations.com)

**What Doesn't Change**:
- Database schema (no migration - already supports multi-org and subscriptions)
- Query patterns (already organization-scoped)
- Authorization guards (already check organization membership)
- RLS policies (already written, just enabling)

### New Features

#### Multi-Organization Support
**Status**: 🔄 Phase 2

**Capabilities**:
- Platform Owner can create new organizations
- Organization Owner is a user who owns one or more organizations
- Users can belong to multiple organizations
- Session includes organization switching capability (`availableOrganizations`)
- Subdomain routing: `org1.revelations.com`, `org2.revelations.com`
- Organization switcher UI in dashboard

**Implementation**:
- Enable RLS policies on all multi-tenant tables
- Add organization creation endpoint
- Update session logic to handle multiple orgs
- Build organization switcher component

**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)

---

#### Creator Role & Multi-Creator Support
**Status**: 🔄 Phase 2

**Capabilities**:
- `member` role in Phase 1 becomes `creator` in Phase 2
- Creators can join multiple organizations
- Creators have their own dashboard showing all org memberships
- Organization admin can promote `member` → `creator`
- Creator earnings tracked per organization
- Stripe Connect for creator payouts (revenue splits)

**Implementation**:
- Update enum: `organization_role` adds `'creator'`
- Add Creator Dashboard UI
- Implement Stripe Connect onboarding
- Add revenue split calculation

**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Overview](/home/user/codex/design/overview.md)

---

#### Subscriptions & Credits
**Status**: 🔄 Phase 2

**Capabilities**:
- Create multiple subscription tiers per organization
- Configure category access per tier (e.g., "Yoga Tier" includes all yoga content)
- Grant offering access per tier (e.g., "free access to all workshops")
- Allocate monthly credits per tier (e.g., "2 session credits per month")
- Monthly vs annual billing options
- Subscription lifecycle management (trials, renewals, cancellations)
- Credit expiration rules (monthly, rollover, accumulate)
- Credit balance display in customer dashboard

**Database Additions**:
```sql
-- New tables
CREATE TABLE subscription_access (...);
CREATE TABLE credit_transaction (...);
CREATE TABLE subscription_tier (...);
```

**Implementation**:
- Integrate Stripe Subscriptions
- Add subscription tier management UI
- Add credit tracking system
- Update Content Access to check subscription status

**Documentation**: [Overview](/home/user/codex/design/overview.md)

---

#### Content Enhancements
**Status**: 🔄 Phase 2

**Capabilities**:
- Content series/collections management
- Content scheduling (publish on specific date)
- Bulk content updates
- Content versioning/revisions
- Content preview link (share before publish)
- Written content / blog posts (rich text editor)

**Implementation**:
- Add series/collections tables
- Add scheduled publishing cron job
- Add rich text editor for written content
- Add preview token system

**Documentation**: Content Management TDD

---

#### Analytics Enhancements
**Status**: 🔄 Phase 2

**Capabilities**:
- Engagement metrics (completion rate, time watched)
- Customer segmentation (by purchase value, engagement)
- Revenue attribution (creator vs org owner split)
- Cohort analysis (customers acquired in same period)
- Trend analysis (revenue growth rate)
- Export reports (CSV, PDF)

**Implementation**:
- Add analytics event tracking
- Add materialized views for fast queries
- Add report generation background jobs
- Add export API endpoints

**Documentation**: [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

---

#### Offerings Management
**Status**: 🔄 Phase 2

**Capabilities**:
- Create and manage offerings (events, services, programs)
- Offering types: one-time events, multi-day programs, recurring services, cohort courses
- Booking management (calendar, time slots, capacity)
- Customer portals (dedicated page per offering)
- Video conferencing integration (Zoom, Google Meet)
- Session recordings storage
- Participant management

**Database Additions**:
```sql
CREATE TABLE offering (...);
CREATE TABLE booking (...);
CREATE TABLE offering_session (...);
CREATE TABLE offering_portal_content (...);
```

**Implementation**:
- Add offering creation UI
- Add booking calendar system
- Add customer portal builder
- Integrate video conferencing APIs

**Documentation**: [Overview](/home/user/codex/design/overview.md)

---

### Phase 2 Feature Matrix

| Feature | Type | Description |
|---------|------|-------------|
| Multi-Organization | Core | Create/manage multiple orgs |
| Organization Switcher | UI | Switch between orgs in dashboard |
| RLS Policies | Security | Enable database-level isolation |
| Creator Role | Auth | Distinct creator role with multi-org support |
| Stripe Connect | Payment | Creator payouts and revenue splits |
| Subscription Tiers | E-Commerce | Recurring billing, tier management |
| Credits System | E-Commerce | Monthly credits, credit tracking |
| Offerings | Feature | Events, services, programs, bookings |
| Content Series | Feature | Organize content into series/collections |
| Content Scheduling | Feature | Publish content on specific dates |
| Written Content | Content Type | Blog posts, articles (rich text) |
| Advanced Analytics | Analytics | Cohorts, funnels, retention, exports |
| HLS Transcoding | Media | Adaptive bitrate streaming |

---

### Migration from Phase 1 to Phase 2

**Database Changes**: ✅ Zero schema migrations
- Schema already supports everything needed
- Just enable RLS policies

**Code Changes**: 🔄 Minimal
- Add organization creation UI
- Add organization switcher component
- Enable subscription features
- Add Creator Dashboard

**Configuration Changes**:
```typescript
// Feature flags
const features = {
  multiOrg: true,              // Enable multi-org creation
  subscriptions: true,         // Enable subscription tiers
  credits: true,               // Enable credit system
  offerings: true,             // Enable offerings management
  creator: true,               // Enable creator role
  advancedAnalytics: true,     // Enable advanced analytics
};
```

**Steps**:
1. Enable RLS policies on all multi-tenant tables (SQL migration)
2. Add `creator` to `organization_role` enum
3. Deploy new UI components (org switcher, creator dashboard)
4. Enable feature flags in configuration
5. Test multi-org data isolation thoroughly
6. Document for organization owners

---

## Phase 3: Advanced

### Overview

**Timeline**: 6-12 months after Phase 2
**Scope**: Enterprise features, custom roles, granular permissions, automation
**Goal**: Support enterprise customers with advanced customization, approval workflows, and granular access control

### Success Criteria

- Support 100+ concurrent users
- Page load time < 1.5 seconds
- 95% customer satisfaction score
- Custom roles in use by at least 10 organizations
- Automated workflows reducing admin time by 30%

### Key Features

#### Custom Roles & Permissions
**Status**: 🔜 Phase 3

**Capabilities**:
- Organizations define their own roles (not just owner/admin/member)
- Example roles: `instructor`, `moderator`, `support_staff`
- Assign custom permissions to each role
- Permission matrix: action × role → allowed/denied
- Individual permission grants (user-specific overrides)

**Database Additions**:
```sql
CREATE TABLE organization_role_definition (...);
CREATE TABLE permission (...);
CREATE TABLE user_permission (...);
```

**Implementation**:
- Add custom role management UI
- Update guards to check custom permissions
- Add permission inheritance system

**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

---

#### Content Approval Workflows
**Status**: 🔜 Phase 3

**Capabilities**:
- Content approval chains (Editor → Reviewer → Publisher)
- Scheduled bulk publishing
- A/B testing (different pricing/descriptions)
- Content recommendations engine
- Auto-categorization from AI

**Implementation**:
- Add workflow builder UI
- Add approval state machine
- Add A/B testing infrastructure
- Integrate AI categorization

**Documentation**: [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

---

#### Customer Management Enhancements
**Status**: 🔜 Phase 3

**Capabilities**:
- Customer segmentation and tags
- Targeted messaging campaigns
- Customer lifecycle automation
- Dunning management (failed subscriptions)
- Churn prediction and retention campaigns
- VIP customer management

**Implementation**:
- Add customer tagging system
- Add email campaign builder
- Add lifecycle automation triggers
- Add churn prediction ML model

**Documentation**: [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

---

#### API & Webhooks
**Status**: 🔜 Phase 3

**Capabilities**:
- Generate/revoke API keys
- Set API rate limits
- Configure webhook endpoints
- Manage webhook event subscriptions
- Review webhook logs
- Webhook signature verification

**Database Additions**:
```sql
CREATE TABLE api_key (...);
CREATE TABLE webhook_endpoint (...);
CREATE TABLE webhook_event_log (...);
```

**Implementation**:
- Add API key generation system
- Add webhook management UI
- Add rate limiting middleware
- Add webhook delivery system

**Documentation**: [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md)

---

#### Advanced Security
**Status**: 🔜 Phase 3

**Capabilities**:
- Session duration configuration
- Re-authentication requirements for sensitive actions
- IP whitelist for admin access
- MFA enforcement toggles
- Password complexity rules
- Login attempt limits before lockout
- GDPR compliance status tracking
- Data retention policies by data type

**Implementation**:
- Add session policy enforcement
- Add IP filtering middleware
- Add MFA requirement checks
- Add audit logging system

**Documentation**: [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md)

---

### Phase 3 Feature Matrix

| Feature | Type | Description |
|---------|------|-------------|
| Custom Roles | Auth | Organization-specific role definitions |
| Permission Matrix | Auth | Granular action-based permissions |
| Approval Workflows | Content | Multi-step content approval |
| A/B Testing | Content | Test different pricing/descriptions |
| Customer Segmentation | CRM | Tag and segment customers |
| Email Campaigns | Marketing | Targeted email campaigns |
| API Keys | Integration | Programmatic platform access |
| Webhooks | Integration | Event notifications to external systems |
| Session Policies | Security | Configurable session behavior |
| MFA Enforcement | Security | Require two-factor authentication |
| Audit Logging | Compliance | Track all sensitive actions |
| Data Retention | Compliance | Automated data cleanup policies |

---

## Phase 4+: Enterprise

### Overview

**Timeline**: 12+ months after Phase 3 (future)
**Scope**: White-label, SSO, global scale, advanced automation
**Goal**: Support enterprise customers with full branding control, SSO integration, and global distribution

### Success Criteria

- Support 1000+ concurrent users
- < 5% churn rate
- Enterprise contracts with 5+ organizations
- SSO integration with major IdPs
- Global CDN distribution

### Key Features

#### White-Label Support
**Status**: 🔜 Phase 4+

**Capabilities**:
- Remove all Codex branding
- Custom company name everywhere
- Custom email templates
- Custom help/support pages
- Custom footer content
- Custom logo in all contexts
- Custom domain for each organization

**Implementation**:
- Add white-label configuration UI
- Update all templates to use org branding
- Add custom domain DNS management
- Add SSL certificate automation

**Documentation**: [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md), [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

---

#### Single Sign-On (SSO)
**Status**: 🔜 Phase 4+

**Capabilities**:
- SAML IdP configuration
- OIDC provider setup
- Automatic user provisioning
- Group/role synchronization
- Just-in-time provisioning

**Database Additions**:
```sql
CREATE TABLE sso_config (...);
CREATE TABLE sso_connection (...);
```

**Implementation**:
- Add SAML/OIDC handlers
- Add SSO configuration UI
- Add user provisioning sync jobs
- Add role mapping system

**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

---

#### Advanced Automation
**Status**: 🔜 Phase 4+

**Capabilities**:
- Workflow builder interface (if-then-else rules)
- Automated customer journeys
- Content recommendation engine
- Marketing automation integration
- Execution logs and performance metrics

**Implementation**:
- Add visual workflow builder
- Add workflow execution engine
- Add ML recommendation system
- Add third-party integrations

**Documentation**: [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

---

#### DRM & Advanced Content Security
**Status**: 🔜 Phase 4+

**Capabilities**:
- Encrypted video streams (Widevine, FairPlay)
- License-key protected content
- Time-limited keys
- Device binding (one device per license)
- Anti-screen-recording
- Offline download with DRM

**Implementation**:
- Integrate DRM providers
- Add license key management
- Add device tracking
- Add encrypted packaging

**Documentation**: [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md)

---

#### Global Scale Features
**Status**: 🔜 Phase 4+

**Capabilities**:
- Multi-language support (i18n)
- Multi-currency support (135+ currencies)
- Geo-blocking (location-based access control)
- Multi-region deployment
- Global CDN with edge caching
- Data residency selection (GDPR compliance)

**Implementation**:
- Add i18n framework
- Add multi-currency Stripe integration
- Add geo-location middleware
- Add multi-region database replicas
- Add global CDN configuration

**Documentation**: Infrastructure documents

---

### Phase 4+ Feature Matrix

| Feature | Type | Description |
|---------|------|-------------|
| White-Label | Branding | Full platform rebrand |
| Custom Domains | Infrastructure | Per-org custom domains |
| SSO/SAML | Auth | Enterprise identity integration |
| Audit Logging | Compliance | Complete audit trail |
| DRM | Security | Encrypted content delivery |
| Multi-Language | i18n | Platform translation |
| Multi-Currency | E-Commerce | 135+ currencies |
| Geo-Blocking | Access Control | Location-based restrictions |
| Multi-Region | Infrastructure | Global deployment |
| Advanced Automation | Workflows | Visual workflow builder |

---

## Decision Criteria

### When to Move to Next Phase

**Phase 1 → Phase 2**:
- ✅ Platform Owner successfully selling content
- ✅ At least 10 paying customers
- ✅ Stable revenue stream (3+ months)
- ✅ Platform Owner requests subscriptions or multi-org
- ✅ Interest from creators wanting to join platform
- ✅ Phase 1 infrastructure stable and tested

**Phase 2 → Phase 3**:
- ✅ At least 5 organizations operating successfully
- ✅ At least 10 creators publishing content
- ✅ Subscription revenue > 30% of total revenue
- ✅ Organizations requesting custom roles/permissions
- ✅ Need for approval workflows or advanced features
- ✅ Multi-org data isolation verified in production

**Phase 3 → Phase 4+**:
- ✅ Enterprise customers requesting white-label
- ✅ SSO integration requests from multiple orgs
- ✅ Global expansion needs (multi-region, multi-language)
- ✅ At least 20 organizations operating
- ✅ Platform supporting 1000+ active customers
- ✅ Advanced features (custom roles, workflows) in production use

### Validation Checklist

Before moving to the next phase, validate:
- [ ] Previous phase features stable in production
- [ ] No critical bugs in core flows
- [ ] Performance metrics met (uptime, load time, error rates)
- [ ] Security audit completed (especially for Phase 1 → 2)
- [ ] Database optimization completed (indexes, query performance)
- [ ] Documentation updated for all Phase 1 features
- [ ] Customer feedback incorporated
- [ ] Business metrics justify complexity increase

---

## Migration Strategy

### General Migration Principles

1. **Zero-Downtime Deployments**: All phase transitions must maintain service availability
2. **Feature Flags**: New features enabled gradually via configuration
3. **Backward Compatibility**: Phase 1 features continue working in Phase 2+
4. **Data Integrity**: Database migrations tested thoroughly before production
5. **Rollback Plan**: Every migration has a documented rollback procedure

### Database Migration Strategy

**Phase 1 → Phase 2**:
```sql
-- Step 1: Enable RLS policies (no data migration)
ALTER TABLE organization_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE offering ENABLE ROW LEVEL SECURITY;
-- ... repeat for all multi-tenant tables

-- Step 2: Update enum to add creator role
ALTER TYPE organization_role ADD VALUE 'creator';

-- Step 3: Add new tables for subscriptions/credits
CREATE TABLE subscription_access (...);
CREATE TABLE credit_transaction (...);
-- ... other Phase 2 tables
```

**No Schema Changes Needed**:
- Organization table already supports multiple orgs
- Session table already has `activeOrganizationId`
- Content/purchase tables already have `organizationId`
- RLS policies already written, just enabling

**Phase 2 → Phase 3**:
```sql
-- Add new tables for custom roles and permissions
CREATE TABLE organization_role_definition (...);
CREATE TABLE permission (...);
CREATE TABLE user_permission (...);
CREATE TABLE api_key (...);
CREATE TABLE webhook_endpoint (...);
```

**Phase 3 → Phase 4+**:
```sql
-- Add SSO and enterprise tables
CREATE TABLE sso_config (...);
CREATE TABLE sso_connection (...);
CREATE TABLE audit_log (...);
```

### Application Code Migration

**Phase 1 → Phase 2**:
1. Add organization creation UI (`/admin/organizations/new`)
2. Add organization switcher component (header dropdown)
3. Update session logic to support multiple orgs
4. Add Creator Dashboard routes (`/creator/dashboard`)
5. Enable subscription features (Stripe Subscriptions integration)
6. Deploy with feature flags initially disabled
7. Enable features gradually per organization

**Configuration Changes**:
```typescript
// environment.ts
export const features = {
  multiOrg: process.env.ENABLE_MULTI_ORG === 'true',
  subscriptions: process.env.ENABLE_SUBSCRIPTIONS === 'true',
  creator: process.env.ENABLE_CREATOR_ROLE === 'true',
  offerings: process.env.ENABLE_OFFERINGS === 'true',
};

// Usage in code
if (features.multiOrg) {
  // Show organization switcher
}
```

### Testing Strategy for Migrations

**Pre-Migration Tests**:
- [ ] Full E2E test suite passing on current phase
- [ ] Database backup created and verified
- [ ] Load test completed (simulate peak traffic)
- [ ] Security audit completed (especially multi-org isolation)

**Post-Migration Tests**:
- [ ] All Phase 1 features still work (regression testing)
- [ ] New phase features work as expected
- [ ] Multi-org data isolation verified (if Phase 2)
- [ ] Performance metrics still met
- [ ] No increase in error rates

**Rollback Tests**:
- [ ] Rollback procedure documented and tested in staging
- [ ] Database rollback verified
- [ ] Feature flag disabling tested

### Deployment Process

1. **Staging Deployment**:
   - Deploy to staging environment
   - Run full test suite
   - Manual QA of new features
   - Performance testing under load

2. **Gradual Production Rollout**:
   - Deploy code with features disabled
   - Enable features for beta organizations (1-2 orgs)
   - Monitor metrics for 48 hours
   - Enable for 25% of organizations
   - Monitor for 1 week
   - Enable for all organizations

3. **Monitoring**:
   - Error rate monitoring (Sentry)
   - Performance monitoring (response times, database queries)
   - Business metrics (purchase completion rate, user satisfaction)
   - User feedback collection

---

## References

### Evolution Documents
- [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md) - User types, roles, session management across all phases
- [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md) - Dashboard features per phase
- [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md) - Content delivery evolution
- [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md) - Settings and configuration evolution

### Architecture Documents
- [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md) - Organization model, RLS, query patterns
- [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md) - Storage architecture and patterns
- [Access Control Patterns](/home/user/codex/design/core/ACCESS_CONTROL_PATTERNS.md) - Authorization and security patterns

### Platform Overview
- [Overview](/home/user/codex/design/overview.md) - Complete platform vision and requirements
- [MVP Definition](/home/user/codex/design/MVP-Definition.md) - Phase 1 detailed specification
- [Cross-Feature Dependencies](/home/user/codex/design/cross-feature-dependencies.md) - How features interact

### Reference Documents
- [GLOSSARY.md](/home/user/codex/design/reference/GLOSSARY.md) - Unified platform terminology

---

**Document Version**: 1.0
**Last Updated**: 2025-11-05
**Status**: Active Reference Document
**Maintained By**: Platform Architecture Team
