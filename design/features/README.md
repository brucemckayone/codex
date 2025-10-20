# Feature-Based Design Documentation

This directory contains modular design documentation for **all features** of the complete platform. Each feature folder contains the full feature specification, with an `mvp.md` file indicating what's included in Phase 1.

## Philosophy

- **Full Feature Scope**: Each folder documents the complete feature (all phases)
- **MVP Subset**: `mvp.md` in each folder defines what's in Phase 1
- **Extensible Design**: All features designed to evolve from simple to complex
- **Clear Boundaries**: Each feature has well-defined responsibilities and interfaces

## Directory Structure

```
features/
├── README.md                    # This file (complete feature overview)
├── shared/                      # Shared components, types, utilities
│   ├── database-schema.md      # Complete database schema (all phases)
│   ├── api-conventions.md      # API design patterns
│   ├── types.md                # Shared TypeScript types
│   └── permissions.md          # RBAC permission system
│
├── auth/                        # Authentication & Authorization
│   ├── README.md               # Complete feature scope
│   ├── mvp.md                  # Phase 1 scope
│   ├── flows.md                # All user flows
│   └── api.md                  # All API endpoints
│
├── content-management/          # Content creation & management
│   ├── README.md               # Complete feature (video, audio, written, series)
│   ├── mvp.md                  # Phase 1: video + written only
│   ├── upload-flow.md
│   └── api.md
│
├── e-commerce/                  # Purchases & payments (one-time)
│   ├── README.md               # Complete feature (purchases, bundles, discounts)
│   ├── mvp.md                  # Phase 1: individual purchases only
│   ├── purchase-flow.md
│   └── api.md
│
├── subscriptions/               # Recurring billing & subscription tiers
│   ├── README.md               # Complete feature spec
│   ├── mvp.md                  # Phase 2 (not in Phase 1)
│   ├── tier-configuration.md
│   └── api.md
│
├── credits/                     # Credit system for offerings
│   ├── README.md               # Complete feature spec
│   ├── mvp.md                  # Phase 2 (not in Phase 1)
│   ├── credit-flow.md
│   └── api.md
│
├── offerings/                   # Events, services, programs, retreats
│   ├── README.md               # Complete feature (all 6 offering types)
│   ├── mvp.md                  # Phase 2-3 (not in Phase 1)
│   ├── offering-types.md       # Detailed specs for each type
│   ├── booking-flow.md
│   └── api.md
│
├── offering-portals/            # Customer portals for offerings
│   ├── README.md               # Complete portal system
│   ├── mvp.md                  # Phase 2-3 (not in Phase 1)
│   ├── portal-features.md      # Resources, communication, progress
│   └── api.md
│
├── multi-creator/               # Media Owner support & revenue sharing
│   ├── README.md               # Complete multi-creator platform
│   ├── mvp.md                  # Phase 3 (not in Phase 1)
│   ├── invite-flow.md
│   ├── revenue-sharing.md
│   └── api.md
│
├── content-access/              # Video player, content reader, library
│   ├── README.md               # Complete feature spec
│   ├── mvp.md                  # Phase 1 scope
│   └── api.md
│
├── admin-dashboard/             # Platform Owner admin interface
│   ├── README.md               # Complete dashboard (all analytics)
│   ├── mvp.md                  # Phase 1: basic revenue stats
│   └── api.md
│
├── analytics/                   # Advanced analytics & reporting
│   ├── README.md               # Complete analytics system
│   ├── mvp.md                  # Phase 3-4 (basic analytics in Phase 1)
│   └── api.md
│
├── notifications/               # Email & in-app notifications
│   ├── README.md               # Complete notification system
│   ├── mvp.md                  # Phase 1: transactional emails only
│   ├── email-templates.md
│   └── api.md
│
└── platform-settings/           # Branding & configuration
    ├── README.md               # Complete settings system
    ├── mvp.md                  # Phase 1: basic branding only
    └── api.md
```

## Complete Feature Set

### Phase 1: MVP (Months 1-3)
**Goal**: Platform Owner sells content to customers

Features included:
- ✅ Auth
- ✅ Content Management (video, written)
- ✅ E-Commerce (individual purchases)
- ✅ Content Access (player, library)
- ✅ Admin Dashboard (basic)
- ✅ Notifications (transactional emails)
- ✅ Platform Settings (basic branding)

### Phase 2: Enhanced Monetization (Months 4-6)
**Goal**: Add subscription model and first offerings

Features added/enhanced:
- ✅ Subscriptions (recurring billing, tiers)
- ✅ Credits (allocation, tracking, expiration)
- ✅ Offerings (one-time events, basic portal)
- ✅ Content Management (audio, series)
- ✅ E-Commerce (bundles, discounts)
- ✅ Admin Dashboard (enhanced analytics)

### Phase 3: Multi-Creator Platform (Months 7-9)
**Goal**: Support Media Owners and multiple offering types

Features added/enhanced:
- ✅ Multi-Creator (Media Owner role, invites, revenue sharing)
- ✅ Offerings (all 6 types, advanced scheduling)
- ✅ Offering Portals (complete portal system)
- ✅ Analytics (per-creator, cohort analysis)
- ✅ Notifications (in-app, advanced automation)

### Phase 4: Scale & Optimize (Months 10+)
**Goal**: Professional platform features

Features added/enhanced:
- ✅ Analytics (predictive, forecasting, funnel analysis)
- ✅ Notifications (marketing automation)
- ✅ Platform Settings (white-label, multi-language)
- ✅ Advanced features (live streaming, mobile apps, API)

---

## Feature Boundaries

### 1. Auth (All Phases)
**Responsibility**: User authentication, registration, session management, password reset

**Owns**:
- User registration and email verification
- Login/logout flows
- Password reset
- Session management (via BetterAuth)
- Role-based access control (RBAC) middleware

**Dependencies**: None (foundational feature)

**Exports**:
- `useAuth()` hook
- `requireAuth()` middleware
- `checkPermission()` utility
- User type definitions

---

### 2. Content Management
**Responsibility**: Creating, editing, and organizing content (Platform Owner side)

**Owns**:
- Video upload flow (presigned R2 URLs)
- Written content creation (rich text editor)
- Content metadata management
- Draft/publish workflow
- Content list with filters and search
- Thumbnail generation

**Dependencies**:
- Auth (requires Platform Owner role)
- Shared (database schema, types)

**Exports**:
- Content CRUD API
- Upload utilities
- Content type definitions

---

### 3. E-Commerce
**Responsibility**: Purchases, payments, revenue tracking

**Owns**:
- Stripe Payment Intent creation
- Checkout UI
- Payment processing
- Webhook handling
- Purchase records
- Refund processing
- Revenue calculations

**Dependencies**:
- Auth (requires authenticated user)
- Content Management (purchases reference content)
- Shared (database schema)

**Exports**:
- Purchase API
- Stripe utilities
- Payment components

---

### 4. Content Access
**Responsibility**: Consuming purchased content (Customer side)

**Owns**:
- Video player with progress tracking
- Written content reader
- Customer library (purchased content)
- Access control checks
- Resume watching functionality
- Signed URL generation for video playback

**Dependencies**:
- Auth (requires authenticated user)
- E-Commerce (checks purchase status)
- Content Management (reads content data)

**Exports**:
- Player components
- Access check utilities
- Library UI

---

### 5. Admin Dashboard
**Responsibility**: Platform Owner analytics and management

**Owns**:
- Revenue dashboard
- Purchase list and management
- Customer list
- Content analytics
- Refund interface
- CSV exports

**Dependencies**:
- Auth (requires Platform Owner role)
- E-Commerce (revenue data)
- Content Management (content data)

**Exports**:
- Dashboard components
- Analytics utilities

---

### 6. Platform Settings
**Responsibility**: Platform configuration and branding

**Owns**:
- Logo and color customization
- Homepage hero section
- About page editor
- Social media links
- Platform name/title
- Settings persistence

**Dependencies**:
- Auth (requires Platform Owner role)
- Shared (database schema)

**Exports**:
- Settings API
- Branding utilities
- Public settings for frontend

---

### 7. Shared
**Responsibility**: Common utilities, types, and schemas used across features

**Contains**:
- Database schema (complete)
- TypeScript type definitions
- API design conventions
- Permission system
- Common UI components
- Error handling utilities
- Validation schemas (Zod)

**Dependencies**: None (foundational)

**Exports**: Everything shared across features

---

## Development Approach

### 1. Bottom-Up Development
Develop features in dependency order:

1. **Shared** (database schema, types, utilities)
2. **Auth** (foundational for everything)
3. **Content Management** (Platform Owner can create content)
4. **E-Commerce** (can sell content)
5. **Content Access** (customers can consume)
6. **Admin Dashboard** (analytics and management)
7. **Platform Settings** (branding and customization)

### 2. Feature-Driven Workflow

When working on a feature:
1. Read the feature's `mvp.md` to understand scope
2. Check dependencies in `README.md`
3. Refer to `shared/` for database schema and types
4. Implement feature in isolation
5. Test integration with dependent features
6. Update documentation as needed

### 3. Cross-Feature Communication

Features communicate via:
- **Database**: Shared schema in `shared/database-schema.md`
- **API**: RESTful endpoints documented in each feature's `api.md`
- **Types**: Shared TypeScript types in `shared/types.md`
- **Events**: (Future) Event bus for decoupled communication

### 4. Testing Strategy

Each feature has:
- **Unit tests**: Test feature logic in isolation
- **Integration tests**: Test feature with dependencies
- **E2E tests**: Test critical user flows across features

---

## MVP Priority Order

### Phase 1: Foundation (Weeks 1-2)
1. **Shared**: Database schema, types
2. **Auth**: Registration, login, session management

### Phase 2: Core Value (Weeks 3-6)
3. **Content Management**: Upload and manage content
4. **E-Commerce**: Purchase flow
5. **Content Access**: Video player and library

### Phase 3: Polish (Weeks 7-10)
6. **Admin Dashboard**: Revenue and management
7. **Platform Settings**: Branding and customization

---

## Extensibility Guidelines

When implementing features, always consider:

### 1. Multi-Creator Future
Even though MVP is Platform Owner only:
- Track `creator_id` on all content
- Permission checks use role, not hard-coded assumptions
- Revenue calculations have split logic (even if 100%/0% now)

### 2. Subscription Future
Even though MVP is one-time purchases only:
- Use `ContentAccess` table (not just Purchase check)
- Access can have `expires_at` (null = permanent for now)
- Revenue tracking separates subscription vs purchase

### 3. Offerings Future
Even though MVP is content only:
- Generic "Product" concept in checkout (content now, offerings later)
- Access control flexible (content now, offering portals later)

### 4. API Versioning
- Use semantic versioning for breaking changes
- Keep backwards compatibility when possible
- Document all breaking changes

---

## File Naming Conventions

- `mvp.md`: Feature scope and user stories for MVP
- `flows.md`: User flows, diagrams, state machines
- `api.md`: API endpoint documentation
- `schema.md`: Feature-specific database tables (if not in shared)
- `components.md`: UI component specifications
- `README.md`: Feature overview and quick reference

---

## Inter-Feature Dependencies

```
           Shared (Database, Types, Utilities)
              ↓
           Auth (Authentication, RBAC)
              ↓
     ┌────────┴────────┐
     ↓                 ↓
Content Mgmt    Platform Settings
     ↓
E-Commerce
     ↓
Content Access
     ↓
Admin Dashboard
```

**Legend**:
- `→` depends on
- Features can depend on multiple features
- Circular dependencies are not allowed

---

## Documentation Standards

### MVP Files Should Include:
1. **Feature Overview**: What is this feature?
2. **Scope**: What's in MVP vs Phase 2+
3. **User Stories**: With acceptance criteria
4. **Technical Design**: Database, API, components
5. **Dependencies**: What does this feature need?
6. **Exports**: What does this feature provide?
7. **Testing Approach**: How to test this feature

### API Documentation Should Include:
- Endpoint URL and method
- Authentication requirements
- Request parameters and body
- Response format
- Error cases
- Example requests/responses

### Flow Documentation Should Include:
- Diagrams (Mermaid or ASCII)
- Step-by-step descriptions
- Error/edge case handling
- User experience notes

---

## Quick Start

To understand a feature:
1. Read `mvp.md` for scope and user stories
2. Read `api.md` for technical interface
3. Check `shared/database-schema.md` for data model
4. Review dependencies in this README

To implement a feature:
1. Ensure dependencies are complete
2. Start with database schema (if not in shared)
3. Implement API endpoints
4. Build UI components
5. Write tests
6. Update documentation

---

## Questions?

Refer to:
- `/Design /Overview.md` for high-level requirements
- `/Design /MVP-Definition.md` for overall MVP scope
- Individual feature `mvp.md` files for specific requirements
