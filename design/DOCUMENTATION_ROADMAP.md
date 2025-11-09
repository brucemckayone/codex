# Codex Documentation Roadmap

**Status**: Complete - All core features documented with Phase 1→4 vision

**Purpose**: Track the complete architectural documentation for Codex platform.

---

## Documentation Structure

All features now follow the EVOLUTION.md pattern:
- **Single source of truth** per feature (no redundant PRD/TDD cross-references)
- **Phase 1→4 roadmap** showing complete evolution
- **Architecture principles** explaining design decisions
- **Clear implementation paths** for each phase

---

## Core Feature Documentation (Complete)

### 1. Authentication & Authorization
- **File**: `design/features/auth/EVOLUTION.md`
- **Scope**: User identity, role-based access, organization membership
- **Key Concept**: BetterAuth + organization plugin + multi-tenant ready
- **Phase 1**: Email/password, role-based guards, session with org context
- **Phase 2+**: Multi-org switching, creator role, custom permissions

### 2. Admin Dashboard
- **File**: `design/features/admin-dashboard/EVOLUTION.md`
- **Scope**: Organization management interface for owners/admins
- **Key Concept**: Progressive disclosure, org-scoped data, role-based visibility
- **Phase 1**: Content management, team, settings, basic analytics
- **Phase 2+**: Multi-org views, creator-specific dashboard, advanced workflows

### 3. Content Access & Delivery
- **File**: `design/features/content-access/EVOLUTION.md`
- **Scope**: How users access content (public, purchased, subscription)
- **Key Concept**: Multi-layer security (guards → RLS → signed URLs)
- **Phase 1**: Public/purchased access, adaptive bitrate video
- **Phase 2+**: Subscriptions, DRM, offline access, personalization

### 4. Content Management
- **File**: `design/features/content-management/EVOLUTION.md`
- **File**: `design/features/content-management/CONTENT_OWNERSHIP_MODEL.md`
- **Scope**: Creator uploads, media library, resource management
- **Key Concept**: Creator-owned content, media library pattern, R2 organization
- **Phase 1**: Video/audio upload, metadata, lifecycle (draft/published/archived)
- **Phase 2+**: Multi-creator, transcoding, org assignments, collaboration

### 5. E-Commerce & Payments
- **File**: `design/features/e-commerce/EVOLUTION.md`
- **Scope**: Payment processing, purchases, subscriptions, monetization
- **Key Concept**: Stripe integration, progressive monetization, provider abstraction
- **Phase 1**: Direct purchases, free content, refunds
- **Phase 2+**: Shopping cart, subscriptions, promo codes, invoices

### 6. Notifications
- **File**: `design/features/notifications/EVOLUTION.md`
- **Scope**: Multi-channel notifications (email, in-app, SMS, push)
- **Key Concept**: Email abstraction layer, provider-agnostic, template system
- **Phase 1**: Transactional email (auth, receipts), Resend adapter
- **Phase 2+**: In-app notifications, email digests, multi-channel

### 7. Platform Settings
- **File**: `design/features/platform-settings/EVOLUTION.md`
- **Scope**: Organization configuration, branding, business setup
- **Key Concept**: Non-technical owner configuration, intelligent defaults
- **Phase 1**: Basic info, branding (colors, logo), business config
- **Phase 2+**: Integrations (Stripe, email), team settings, advanced features

### 8. Offerings & Bookings
- **File**: `design/features/offerings/EVOLUTION.md`
- **Scope**: Events, services, bookable sessions, customer portals
- **Key Concept**: Unified offering model, flexible scheduling, dedicated portals
- **Phase 1**: OUT OF SCOPE (Phase 2+ feature)
- **Phase 2+**: One-time events, recurring services, bookable offerings, cohorts

---

## Supporting Documentation

### Content Ownership Model
- **File**: `design/features/content-management/CONTENT_OWNERSHIP_MODEL.md`
- **Scope**: Architectural decision on content ownership
- **Decision**: Creator-owned content (recommended)
- **Reasoning**: Aligns with R2 structure, supports multi-creator marketplace, no duplication
- **Schema**: Database structure supporting creator ownership
- **Evolution**: Phase 1 (single creator) → Phase 2+ (multi-creator with org assignments)

### Architecture Documents
- **ARCHITECTURE.md**: System components, middleware stack, deployment pipeline
- **R2BucketStructure.md**: Cloud storage organization by creator
- **DatabaseSchema.md**: Postgres schema (to be updated with ownership model)
- **EnvironmentManagement.md**: Dev, CI/CD, production configurations
- **TestingStrategy.md**: Unit, integration, E2E testing pyramid

---

## Key Architectural Principles

### Multi-Tenant Foundation
✓ Phase 1: Single org with multi-tenant schema
✓ Phase 2+: Multiple orgs, unlimited organizations
✓ Zero-migration: Phase 1 schema supports all future phases
✓ RLS policies: Designed Phase 1, enforced Phase 2+

### Creator-Owned Content
✓ Creators own all content they create
✓ Organizations feature/license creator content
✓ R2 organized by {creatorId} (single source of truth)
✓ Supports independent creators and multi-org freelancers

### Organization-Scoped Access
✓ All features organized by organization
✓ Permission hierarchy: Platform Owner → Org Owner → Admin → Member
✓ Session context includes activeOrganizationId
✓ Multi-org switching foundation ready

### Provider Abstraction
✓ Stripe for payments (easy to swap)
✓ Resend for email (easy to swap to SendGrid, Postmark, etc.)
✓ All vendor calls through abstraction layer
✓ Configuration changes select different provider

### Progressive Monetization
✓ Phase 1: Direct purchases ($29.99 video, etc.)
✓ Phase 2: Subscriptions ($79/month tier with credits)
✓ Phase 3: Payment plans, affiliate revenue sharing
✓ Phase 4: Dynamic pricing, enterprise billing

### Non-Technical Owner Configuration
✓ All platform features configurable without code
✓ Branding, business setup, integrations, analytics
✓ Goal: "Can a non-technical user do this?" for every feature

---

## Phase 1 MVP Scope Summary

**In Scope**:
- Authentication (email/password, password reset, sessions)
- Content management (video/audio upload, metadata, lifecycle)
- Content access (public, purchased, access control)
- E-commerce (Stripe purchases, free content, refunds)
- Notifications (email transactional messages)
- Platform settings (branding, business config)
- Admin dashboard (content, team, settings, basic analytics)

**Out of Scope**:
- Offerings/Bookings (Phase 2+ feature)
- Subscriptions (Phase 2+ feature)
- Multi-creator (Phase 2+ feature)
- Multi-org switching (Phase 2+ feature)
- Video transcoding (Phase 2+ feature)
- In-app notifications (Phase 2+ feature)

---

## Phase Evolution Overview

```
PHASE 1 (Foundation)
├─ Single organization (you own it)
├─ Single creator (you create all content)
├─ Direct purchases only
├─ Basic email notifications
└─ Simple admin dashboard

PHASE 2 (Enhancement)
├─ Multi-organization support
├─ Multi-creator marketplace (freelancers)
├─ Subscriptions with tiers
├─ Video transcoding & streaming
├─ Organization switching
└─ Advanced content features

PHASE 3 (Advanced)
├─ Custom roles & permissions
├─ Content collaboration
├─ Affiliate revenue sharing
├─ Payment plans
├─ Offerings & bookings
└─ Advanced analytics

PHASE 4+ (Enterprise)
├─ White-label options
├─ SSO/SAML
├─ Dynamic pricing AI
├─ Global scale (multi-currency)
├─ Enterprise automation
└─ Advanced compliance
```

---

## How to Use This Documentation

1. **Understanding Phase 1**: Read each EVOLUTION.md for Part 1 & 2 (Phase 1 and 2)
2. **Understanding Future Phases**: Continue reading each EVOLUTION.md for Phase 3+ details
3. **Making Architectural Decisions**: Read CONTENT_OWNERSHIP_MODEL.md for decision-making pattern
4. **Implementation**: Use PRD/TDD for Phase 1 implementation details
5. **Database Design**: Use documented schemas in EVOLUTION.md files

---

## Documentation Quality Standards

✓ Each document has clear purpose statement
✓ Phase-by-phase breakdown (Phase 1 → 2 → 3 → 4+)
✓ Core principles and design philosophy
✓ Use descriptive language for concepts (not rigid code/SQL)
✓ Related documents linked (no duplicate content)
✓ Flexibility maintained (design not over-specified)

---

## Next Phase: Implementation Planning

Once architectural documentation is approved:

1. **Database Schema TDD** - Create Drizzle ORM models
2. **API Specification** - Define REST endpoints or GraphQL
3. **Component Design** - SvelteKit components for admin UI
4. **Testing Plan** - Unit, integration, E2E tests
5. **Deployment Plan** - CI/CD, environments, monitoring

---

**Document Version**: 1.0
**Last Updated**: 2025-11-04
**Status**: Complete - Ready for Implementation
