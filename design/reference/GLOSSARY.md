# Codex Platform - Glossary

**Purpose**: Unified glossary of all platform terminology extracted from feature documents. This is the single source of truth for platform vocabulary.

**Version**: 1.0
**Last Updated**: 2025-11-05

---

## User Types

### Platform Owner
**Definition**: The system administrator (developer/owner) responsible for platform deployment, maintenance, and system-level configuration. Has access to the entire system and can manage all organizations.

**Introduced**: Phase 1
**Platform Role**: `platform_owner`
**Organization Role**: `owner` (of one or more organizations)
**Scope**: System-wide

**Related Terms**: Organization Owner, System Admin
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Overview](/home/user/codex/design/overview.md)

### Organization Owner
**Definition**: The non-technical business owner who operates their organization (e.g., yoga studio, coaching business). Manages their entire business without technical knowledge. In Phase 1, may be the same person as Platform Owner.

**Introduced**: Phase 1
**Platform Role**: `customer`
**Organization Role**: `owner`
**Scope**: Organization (one in Phase 1, multiple in Phase 2+)

**Related Terms**: Business Owner, Creator (when creating own content)
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)

### Organization Admin
**Definition**: Staff members with elevated permissions within an organization. Can approve content, manage team members, and view analytics, but cannot change organization settings.

**Introduced**: Phase 1
**Platform Role**: `customer`
**Organization Role**: `admin`
**Scope**: Organization

**Related Terms**: Admin, Staff
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)

### Organization Member
**Definition**: Basic team member with limited permissions. In Phase 1, creators are invited as members; in Phase 2, they upgrade to creator role.

**Introduced**: Phase 1
**Platform Role**: `customer`
**Organization Role**: `member`
**Scope**: Organization

**Related Terms**: Team Member, Staff
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Creator
**Definition**: Freelance content creators invited to contribute content to one or more organizations. Receive payments through Stripe Connect (Phase 2+). In Phase 1, they are team "members"; Phase 2+ upgrades them to "creator" role.

**Introduced**: Phase 1 (as members), Phase 2 (as distinct creator role)
**Platform Role**: `customer`
**Organization Role**: `creator` (Phase 2+), `member` (Phase 1)
**Scope**: Multiple organizations (Phase 2+), single organization (Phase 1)

**Related Terms**: Media Owner, Guest Creator, Content Creator
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Overview](/home/user/codex/design/overview.md)

### Customer
**Definition**: End consumers who purchase and consume content. They do NOT need to be organization members; they simply purchase content from the platform. Core revenue source.

**Introduced**: Phase 1
**Platform Role**: `customer`
**Organization Role**: None (not a member)
**Scope**: Public content browsing, purchased content access

**Related Terms**: Subscriber (Phase 2+), End User
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md), [Overview](/home/user/codex/design/overview.md)

### Guest
**Definition**: Unauthenticated visitors browsing the platform. Can see public content but must create an account to purchase.

**Introduced**: Phase 1
**Platform Role**: None (unauthenticated)
**Organization Role**: None
**Scope**: Public content only

**Related Terms**: Visitor, Unauthenticated User
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

---

## Platform Concepts

### Organization
**Definition**: The root tenant container for all business data. Each organization represents a separate business operating on the platform (e.g., yoga studio, coaching business). All content, purchases, and members belong to exactly one organization.

**Introduced**: Phase 1 (single org), Phase 2 (multi-org)
**Database**: `organization` table
**Key Fields**: `id`, `name`, `slug`, `ownerId`, `logoUrl`, `primaryColorHex`

**Related Terms**: Tenant, Business, Organization Context
**Documentation**: [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md), [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Multi-Tenant
**Definition**: Architectural pattern where a single platform serves multiple organizations (tenants) with complete data isolation. Codex is multi-tenant from day one in code/schema, even though Phase 1 operates with a single organization.

**Introduced**: Phase 1 (architecture), Phase 2 (operational)
**Scope**: Database schema, RLS policies, query patterns

**Related Terms**: Organization, Tenant Isolation, Organization-Scoped
**Documentation**: [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)

### Single-Tenant
**Definition**: Phase 1 operational mode where only one organization exists on the platform. The platform operates as single-tenant while the code/schema supports multi-tenant.

**Introduced**: Phase 1
**Scope**: Operational model

**Related Terms**: Single Organization, Phase 1 Mode
**Documentation**: [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md)

### Active Organization
**Definition**: The organization context in which a user is currently operating. Stored as `activeOrganizationId` in session. In Phase 1, always the same value; in Phase 2+, users can switch between organizations.

**Introduced**: Phase 1
**Session Field**: `activeOrganizationId`

**Related Terms**: Organization Context, Current Organization
**Documentation**: [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md), [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Session Context
**Definition**: The authenticated session state containing user identity and organization context. Includes `userId`, `userRole`, `activeOrganizationId`, `organizationRole`. Passed to every request via `event.locals` in SvelteKit.

**Introduced**: Phase 1
**Storage**: Database (persistent), Cloudflare KV (cache), Cookie (session token)

**Related Terms**: Session, Auth Context, User Context
**Documentation**: [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md), [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### RLS (Row-Level Security)
**Definition**: Database-level security policies that automatically filter rows based on session context. Ensures no data leaks between organizations even if application code has bugs. Designed in Phase 1, enforced in Phase 2+.

**Introduced**: Phase 1 (designed), Phase 2 (enforced)
**Database**: PostgreSQL policies

**Related Terms**: Row-Level Policies, Database Isolation, Security Policies
**Documentation**: [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md), [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Guard Functions
**Definition**: Server-side authorization functions that protect routes by checking user permissions before allowing access. Examples: `require.auth()`, `require.owner()`, `require.admin()`.

**Introduced**: Phase 1
**Location**: Server middleware, route handlers

**Related Terms**: Route Protection, Authorization Guards, Access Control
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Middleware
**Definition**: Server-side code that runs before route handlers to extract session context, validate authentication, and populate `event.locals` with user/session data.

**Introduced**: Phase 1
**Framework**: SvelteKit hooks

**Related Terms**: Hooks, Session Validation, Request Interceptor
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

---

## Content Concepts

### Content
**Definition**: Any purchasable media (video, audio, or written content in MVP). A "content" record is a sellable package with pricing and metadata that references a media item from the media library.

**Introduced**: Phase 1
**Database**: `content` table
**Types**: Video, Audio, Written (text/blog)

**Related Terms**: Media, Content Item, Purchasable Content
**Documentation**: [MVP Definition](/home/user/codex/design/MVP-Definition.md), [Overview](/home/user/codex/design/overview.md)

### Media Item
**Definition**: An uploaded file (video or audio) stored in the media library. Separate from "content" - one media item can be referenced by multiple content records. Stored in R2 with transcoding status tracking.

**Introduced**: Phase 1
**Database**: `media_items` table
**Storage**: Cloudflare R2 (originals + HLS streams)

**Related Terms**: Media Library, Video File, Audio File
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md), [MVP Definition](/home/user/codex/design/MVP-Definition.md)

### Resource
**Definition**: Reusable downloadable file (PDF, workbook, attachment) owned by a creator. Stored once in R2, can be attached to multiple content items or offerings via `resource_attachments` table.

**Introduced**: Phase 1
**Database**: `resources` table, `resource_attachments` table
**Storage**: Cloudflare R2 (resources bucket)

**Related Terms**: Downloadable, Attachment, Workbook, PDF
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Asset
**Definition**: Branding and visual files like thumbnails, logos, banners. Stored in R2 assets bucket, typically public-readable.

**Introduced**: Phase 1
**Storage**: Cloudflare R2 (assets bucket)
**Types**: Thumbnails, logos, banners, profile images

**Related Terms**: Branding Asset, Image, Thumbnail
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Media Library
**Definition**: Centralized storage for all uploaded media files (videos and audio). Media items are created here first, then referenced by content records. Enables reusability: one video → many content items with different pricing.

**Introduced**: Phase 1
**Database**: `media_items` table

**Related Terms**: Media Item, Content Library, Asset Management
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Content Library
**Definition**: Customer's collection of all purchased content. Accessible at `/library`. Shows all content the customer owns with playback progress and filtering.

**Introduced**: Phase 1
**UI**: Customer dashboard

**Related Terms**: Library, My Content, Purchased Content
**Documentation**: [MVP Definition](/home/user/codex/design/MVP-Definition.md), [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md)

### Reusable Resource
**Definition**: A file stored once in R2 and attached to multiple entities (content, offerings, courses) via database relationships. Avoids file duplication and enables centralized updates.

**Introduced**: Phase 1
**Pattern**: Single file → multiple attachments

**Related Terms**: Resource, Attachment, File Reference
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Content-Resource Relationship
**Definition**: Many-to-many relationship between content and resources via `resource_attachments` table. Allows a single resource (e.g., workbook) to be attached to multiple content items or offerings.

**Introduced**: Phase 1
**Database**: `resource_attachments` table

**Related Terms**: Attachment, Resource Link, Resource Reference
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

---

## E-Commerce Concepts

### Purchase
**Definition**: A transaction record linking a customer to a purchased item (content, offering, etc.). Created after successful payment. Source of truth for access control.

**Introduced**: Phase 1
**Database**: `purchase` table
**Key Fields**: `userId`, `itemId`, `itemType`, `pricePaid`, `status`, `purchasedAt`, `refundedAt`

**Related Terms**: Transaction, Sale, Order
**Documentation**: [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

### Direct Purchase
**Definition**: One-time payment for permanent access to specific content or offering. "Buy Now" button → Stripe Checkout → purchase record → instant access. No shopping cart in Phase 1.

**Introduced**: Phase 1
**Payment**: Stripe Checkout (one-time)

**Related Terms**: One-Time Purchase, Buy Now, Single-Item Purchase
**Documentation**: [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md), [MVP Definition](/home/user/codex/design/MVP-Definition.md)

### Subscription
**Definition**: Recurring payment for ongoing access to categories of content, offerings, and/or monthly credits. Billed monthly or annually.

**Introduced**: Phase 2
**Payment**: Stripe Subscriptions (recurring)

**Related Terms**: Subscription Tier, Recurring Billing, Membership
**Documentation**: [Overview](/home/user/codex/design/overview.md)

### Stripe Checkout Session
**Definition**: A Stripe-hosted payment page created via Stripe API. Customer redirected to Stripe to enter payment details. On success, Stripe sends webhook to confirm payment.

**Introduced**: Phase 1
**Service**: Stripe Checkout

**Related Terms**: Payment Session, Checkout, Hosted Checkout
**Documentation**: [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

### Webhook
**Definition**: HTTP callback from Stripe to the platform when an event occurs (e.g., payment completed). Used to create purchase records and grant access after successful payment. Handled by dedicated Cloudflare Worker.

**Introduced**: Phase 1
**Events**: `checkout.session.completed`, `checkout.session.expired`

**Related Terms**: Stripe Webhook, Payment Callback, Event Notification
**Documentation**: [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

### Purchase Record
**Definition**: Database entry in `purchase` table created after successful payment. Links customer to purchased item. Source of truth for access control - Content Access checks this table to grant access.

**Introduced**: Phase 1
**Database**: `purchase` table
**Critical For**: Content access verification

**Related Terms**: Purchase, Transaction Record, Order Record
**Documentation**: [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

### Access Grant
**Definition**: The act of creating an access record (e.g., in `content_access` table) after purchase confirmation. Triggered by webhook processing. Enables customer to watch/listen to content.

**Introduced**: Phase 1
**Database**: `content_access` table

**Related Terms**: Content Access, Permission Grant, Access Control
**Documentation**: [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md), [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

---

## Technical Concepts

### Presigned URL
**Definition**: Time-limited URL with embedded signature that allows browser to upload files directly to R2 (PUT method). Generated on-demand for each upload. Expires after 15 minutes (typical).

**Introduced**: Phase 1
**Purpose**: Direct browser → R2 upload (bypasses server)
**Method**: PUT (upload)

**Related Terms**: Upload URL, Signed Upload URL, Temporary URL
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Signed URL
**Definition**: Time-limited URL with embedded signature that allows downloading/viewing files from R2 (GET method). Generated on-demand for each access. Expires after 1 hour (typical).

**Introduced**: Phase 1
**Purpose**: Secure content delivery (videos, resources)
**Method**: GET (download/view)

**Related Terms**: Download URL, Signed Download URL, Temporary URL, Secure URL
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md), [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md)

### R2 Bucket
**Definition**: Cloudflare's S3-compatible object storage container. Codex uses environment-specific buckets: media, resources, assets, platform (e.g., `codex-media-production`).

**Introduced**: Phase 1
**Service**: Cloudflare R2
**Categories**: Media, Resources, Assets, Platform

**Related Terms**: Object Storage, S3 Bucket, Storage Container
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Bucket Key
**Definition**: The full path to a file within an R2 bucket. Follows naming convention: `{creatorId}/{category}/{entityId}/{filename}`. Also called "file key" or "object key".

**Introduced**: Phase 1
**Example**: `{creatorId}/originals/{mediaId}/video.mp4`

**Related Terms**: File Key, Object Key, File Path, S3 Key
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### File Key
**Definition**: Synonym for Bucket Key. The path to a file within an R2 bucket.

**Introduced**: Phase 1

**Related Terms**: Bucket Key, Object Key, File Path
**Documentation**: [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md)

### Cloudflare KV
**Definition**: Key-value storage for session caching. Stores session data for fast lookups without hitting database on every request. TTL-based expiration.

**Introduced**: Phase 1
**Service**: Cloudflare KV (Workers KV)
**Use Cases**: Session cache, temporary data

**Related Terms**: KV Store, Cache, Session Cache
**Documentation**: [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Neon Postgres
**Definition**: Serverless PostgreSQL database provider. Primary database for all platform entities (users, content, purchases, organizations). Production-grade with ACID transactions.

**Introduced**: Phase 1
**Service**: Neon (managed Postgres)

**Related Terms**: Database, PostgreSQL, Neon DB
**Documentation**: [MVP Definition](/home/user/codex/design/MVP-Definition.md)

### BetterAuth
**Definition**: Framework-agnostic authentication library used for user authentication, session management, and role-based access control. Type-safe, modern architecture.

**Introduced**: Phase 1
**Service**: BetterAuth (npm package)

**Related Terms**: Auth Library, Authentication, Auth System
**Documentation**: [MVP Definition](/home/user/codex/design/MVP-Definition.md), [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md)

### Drizzle ORM
**Definition**: Type-safe ORM for database queries. Used to interact with Neon Postgres. Provides schema definition, migrations, and query builder.

**Introduced**: Phase 1
**Service**: Drizzle ORM (npm package)

**Related Terms**: ORM, Database ORM, Query Builder
**Documentation**: Database schema documents

---

## Phase Terminology

### Phase 1
**Definition**: Foundation phase. Single organization, direct purchases, core features only. MVP launch.

**Timeline**: MVP launch (current)
**Scope**: Single organization, direct purchases, basic content delivery
**Key Features**: Auth, content upload, video/audio streaming, Stripe purchases, admin dashboard

**Related Terms**: MVP, Foundation, Core Features
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md), [MVP Definition](/home/user/codex/design/MVP-Definition.md)

### Phase 2
**Definition**: Enhancement phase. Multi-organization support, subscriptions, creators, advanced features.

**Timeline**: 3-6 months after Phase 1
**Scope**: Multiple organizations, subscription tiers, credits, creator role
**Key Features**: Multi-org, subscriptions, offerings, creator payouts, analytics enhancements

**Related Terms**: Enhancement, Multi-Org, Advanced Monetization
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### Phase 3
**Definition**: Advanced features. Custom roles, granular permissions, automation, collaboration.

**Timeline**: 6-12 months after Phase 2
**Scope**: Enterprise features, custom roles, workflows, advanced permissions
**Key Features**: Custom roles, permission matrix, approval workflows, advanced analytics

**Related Terms**: Advanced, Enterprise Features
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### Phase 4+
**Definition**: Enterprise and scale. White-label, SSO, global distribution, AI features.

**Timeline**: 12+ months (future)
**Scope**: Enterprise compliance, white-label, SSO, global scale
**Key Features**: SSO/SAML, white-label, audit logging, session policies, DRM

**Related Terms**: Enterprise, Scale, Global
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### MVP
**Definition**: Minimum Viable Product. The smallest version that delivers core value: upload content → sell it → customers access it. Equivalent to Phase 1.

**Timeline**: Initial launch
**Scope**: Essential features only

**Related Terms**: Phase 1, Foundation, Core Features
**Documentation**: [MVP Definition](/home/user/codex/design/MVP-Definition.md)

### Foundation
**Definition**: Alternative name for Phase 1. Building the core foundation that future phases build upon.

**Timeline**: Phase 1
**Scope**: Core architecture and features

**Related Terms**: Phase 1, MVP, Base Features
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### Enhancement
**Definition**: Alternative name for Phase 2. Enhancing the foundation with advanced monetization and multi-tenancy.

**Timeline**: Phase 2
**Scope**: Multi-org, subscriptions, enhanced features

**Related Terms**: Phase 2, Advanced Features
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### Advanced
**Definition**: Alternative name for Phase 3. Advanced enterprise features and customization.

**Timeline**: Phase 3
**Scope**: Custom roles, workflows, advanced permissions

**Related Terms**: Phase 3, Enterprise Features
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

### Enterprise
**Definition**: Alternative name for Phase 4+. Enterprise-grade features for large organizations.

**Timeline**: Phase 4+
**Scope**: SSO, white-label, compliance, global scale

**Related Terms**: Phase 4+, Scale, Global
**Documentation**: [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md)

---

## Document Index

### Primary References
- [Auth EVOLUTION](/home/user/codex/design/features/auth/EVOLUTION.md) - User types, roles, session management
- [Multi-Tenant Architecture](/home/user/codex/design/core/MULTI_TENANT_ARCHITECTURE.md) - Organization model, RLS, query patterns
- [R2 Storage Patterns](/home/user/codex/design/core/R2_STORAGE_PATTERNS.md) - Storage architecture, buckets, file patterns
- [PHASE_DEFINITIONS.md](/home/user/codex/design/reference/PHASE_DEFINITIONS.md) - Phase timeline and scope

### Feature Documentation
- [Admin Dashboard EVOLUTION](/home/user/codex/design/features/admin-dashboard/EVOLUTION.md)
- [Content Access EVOLUTION](/home/user/codex/design/features/content-access/EVOLUTION.md)
- [Platform Settings EVOLUTION](/home/user/codex/design/features/platform-settings/EVOLUTION.md)
- [E-Commerce PRD](/home/user/codex/design/features/e-commerce/pdr-phase-1.md)

### Platform Overview
- [Overview](/home/user/codex/design/overview.md) - Complete platform vision
- [MVP Definition](/home/user/codex/design/MVP-Definition.md) - Phase 1 scope and requirements

---

**Document Version**: 1.0
**Last Updated**: 2025-11-05
**Status**: Active Reference Document
